#!/usr/bin/env bash
# routify-aws.sh — bootstrap da conta AWS do Routify. Rodar no CloudShell (console AWS, icone de
# terminal na barra superior), logado como o dono da conta. Idempotente: pode rodar de novo.
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=""

INSTANCIA=i-0123456789abcdef0   # EC2 da API (console -> EC2 -> Instancias)
IP_SSH=203.0.113.10      # IP de casa, VPN desligada. Vira a UNICA origem liberada na porta 22.
USUARIO_COLEGA=pedro     # usuario IAM do colega (console + MFA obrigatoria). "" = pular
USUARIO_CLI=claude-ops   # usuario de automacao (access key, sem console). "" = pular

CONTA=$(aws sts get-caller-identity --query Account --output text)
echo "== conta $CONTA | instancia $INSTANCIA | regiao $AWS_DEFAULT_REGION"

politica() {  # nome json -> arn (cria se nao existir; nao atualiza uma existente)
  local arn="arn:aws:iam::$CONTA:policy/$1"
  aws iam get-policy --policy-arn "$arn" >/dev/null 2>&1 \
    || aws iam create-policy --policy-name "$1" --policy-document "$2" >/dev/null
  echo "$arn"
}

# ---------- 1. porta 22: so o IP de casa ----------
SG=$(aws ec2 describe-instances --instance-ids "$INSTANCIA" \
     --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
for r in $(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" \
           --query 'SecurityGroupRules[?FromPort==`22` && IsEgress==`false`].SecurityGroupRuleId' --output text); do
  [ "$r" = None ] || aws ec2 revoke-security-group-ingress --group-id "$SG" --security-group-rule-ids "$r" >/dev/null
done
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$IP_SSH/32,Description=dono}]" >/dev/null
echo "1. SSH no $SG: so $IP_SSH/32"

# ---------- 2. Session Manager: role + instance profile na instancia ----------
ROLE=routify-ec2-ssm
aws iam get-role --role-name $ROLE >/dev/null 2>&1 || aws iam create-role --role-name $ROLE \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
if ! aws iam get-instance-profile --instance-profile-name $ROLE >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name $ROLE >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name $ROLE --role-name $ROLE
  sleep 10  # IAM e eventualmente consistente
fi
ATUAL=$(aws ec2 describe-iam-instance-profile-associations \
        --filters Name=instance-id,Values="$INSTANCIA" Name=state,Values=associated \
        --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text)
if [ "$ATUAL" = None ]; then
  aws ec2 associate-iam-instance-profile --instance-id "$INSTANCIA" --iam-instance-profile Name=$ROLE >/dev/null
  echo "2. perfil $ROLE associado a instancia"
else
  echo "2. instancia ja tinha perfil ($ATUAL); nao troquei. Se nao for o $ROLE, anexe AmazonSSMManagedInstanceCore a essa role."
fi
printf '   aguardando o SSM Agent ficar Online (ate 3 min)'
SSM=offline
for _ in $(seq 18); do
  [ "$(aws ssm describe-instance-information --filters Key=InstanceIds,Values="$INSTANCIA" \
       --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = Online ] && { SSM=Online; break; }
  printf .; sleep 10
done
echo " $SSM"
[ $SSM = Online ] || echo "   (nao registrou ainda: por SSH, 'sudo snap restart amazon-ssm-agent'; depois confira em Systems Manager -> Fleet Manager)"

# ---------- 3. usuario do colega: console + MFA obrigatoria (deploy.md 5.2) ----------
JSON_COLEGA=$(cat <<'J'
{"Version":"2012-10-17","Statement":[
 {"Sid":"LigarDesligarSoRoutify","Effect":"Allow","Action":["ec2:StartInstances","ec2:StopInstances","ec2:RebootInstances"],
  "Resource":"arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>"},
 {"Sid":"ShellPeloSessionManager","Effect":"Allow","Action":"ssm:StartSession",
  "Resource":["arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>",
              "arn:aws:ssm:<regiao>::document/SSM-SessionManagerRunShell",
              "arn:aws:ssm:<regiao>::document/AWS-StartInteractiveCommand"]},
 {"Sid":"EncerrarPropriasSessoes","Effect":"Allow","Action":["ssm:TerminateSession","ssm:ResumeSession"],
  "Resource":"arn:aws:ssm:*:*:session/${aws:username}-*"},
 {"Sid":"VerCustoECredito","Effect":"Allow","Action":["billing:Get*","ce:Get*","ce:Describe*","ce:List*","freetier:Get*",
  "budgets:ViewBudget","budgets:Describe*","account:GetAccountInformation"],"Resource":"*"},
 {"Sid":"ListarParaConfigurarMFA","Effect":"Allow","Action":["iam:ListUsers","iam:ListVirtualMFADevices","iam:GetAccountPasswordPolicy"],"Resource":"*"},
 {"Sid":"PropriaSenhaEMFA","Effect":"Allow","Action":["iam:ChangePassword","iam:GetUser","iam:CreateVirtualMFADevice","iam:EnableMFADevice",
  "iam:ResyncMFADevice","iam:ListMFADevices","iam:DeactivateMFADevice","iam:DeleteVirtualMFADevice"],
  "Resource":["arn:aws:iam::<id-conta>:user/${aws:username}","arn:aws:iam::<id-conta>:mfa/${aws:username}"]},
 {"Sid":"SemMFASoConfiguraMFA","Effect":"Deny","NotAction":["iam:CreateVirtualMFADevice","iam:EnableMFADevice","iam:GetUser","iam:ListMFADevices",
  "iam:ListVirtualMFADevices","iam:ResyncMFADevice","iam:ChangePassword","iam:GetAccountPasswordPolicy","sts:GetSessionToken"],
  "Resource":"*","Condition":{"BoolIfExists":{"aws:MultiFactorAuthPresent":"false"}}}
]}
J
)
if [ -n "$USUARIO_COLEGA" ]; then
  ARN=$(politica RoutifyOperacaoEC2 "$(sed "s/<regiao>/$AWS_DEFAULT_REGION/g; s/<id-conta>/$CONTA/g; s/<id-instancia>/$INSTANCIA/g" <<<"$JSON_COLEGA")")
  aws iam get-user --user-name "$USUARIO_COLEGA" >/dev/null 2>&1 || aws iam create-user --user-name "$USUARIO_COLEGA" >/dev/null
  aws iam attach-user-policy --user-name "$USUARIO_COLEGA" --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
  aws iam attach-user-policy --user-name "$USUARIO_COLEGA" --policy-arn "$ARN"
  if aws iam get-login-profile --user-name "$USUARIO_COLEGA" >/dev/null 2>&1; then
    echo "3. $USUARIO_COLEGA ja tinha senha; nada alterado"
  else
    SENHA="$(openssl rand -base64 15)!1a"
    aws iam create-login-profile --user-name "$USUARIO_COLEGA" --password "$SENHA" --password-reset-required >/dev/null
    echo "3. $USUARIO_COLEGA criado. Entregar por canal seguro (nunca e-mail aberto nem chat do repo):"
    echo "   URL   https://$CONTA.signin.aws.amazon.com/console"
    echo "   user  $USUARIO_COLEGA   senha temporaria: $SENHA"
    echo "   1o login: trocar senha -> Security credentials -> Assign MFA device -> sair e entrar. Sem MFA, EC2 fica negado."
  fi
fi

# ---------- 4. usuario de automacao: access key, sem console (deploy.md 5.6) ----------
JSON_CLI=$(cat <<'J'
{"Version":"2012-10-17","Statement":[
 {"Sid":"Ler","Effect":"Allow","Action":["ec2:Describe*","ssm:DescribeInstanceInformation","ssm:GetCommandInvocation","ssm:ListCommandInvocations"],"Resource":"*"},
 {"Sid":"RegraSSH","Effect":"Allow","Action":["ec2:AuthorizeSecurityGroupIngress","ec2:RevokeSecurityGroupIngress","ec2:ModifySecurityGroupRules"],
  "Resource":"arn:aws:ec2:<regiao>:<id-conta>:security-group/<sg-id>"},
 {"Sid":"LigarDesligar","Effect":"Allow","Action":["ec2:StartInstances","ec2:StopInstances","ec2:RebootInstances"],
  "Resource":"arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>"},
 {"Sid":"ComandosPeloSSM","Effect":"Allow","Action":["ssm:SendCommand","ssm:StartSession"],
  "Resource":["arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>",
              "arn:aws:ssm:<regiao>::document/AWS-RunShellScript",
              "arn:aws:ssm:<regiao>::document/AWS-StartSSHSession",
              "arn:aws:ssm:<regiao>::document/SSM-SessionManagerRunShell"]},
 {"Sid":"EncerrarPropriasSessoes","Effect":"Allow","Action":"ssm:TerminateSession","Resource":"arn:aws:ssm:*:*:session/${aws:username}-*"},
 {"Sid":"VerCustoMetricasECredito","Effect":"Allow","Action":["ce:GetCostAndUsage","ce:GetCostForecast","freetier:GetAccountPlanState",
  "freetier:GetFreeTierUsage","cloudwatch:GetMetricData","cloudwatch:GetMetricStatistics","cloudwatch:ListMetrics"],"Resource":"*"}
]}
J
)
if [ -n "$USUARIO_CLI" ]; then
  ARN=$(politica RoutifyOperacaoCLI "$(sed "s/<regiao>/$AWS_DEFAULT_REGION/g; s/<id-conta>/$CONTA/g; s/<id-instancia>/$INSTANCIA/g; s/<sg-id>/$SG/g" <<<"$JSON_CLI")")
  aws iam get-user --user-name "$USUARIO_CLI" >/dev/null 2>&1 || aws iam create-user --user-name "$USUARIO_CLI" >/dev/null
  aws iam attach-user-policy --user-name "$USUARIO_CLI" --policy-arn "$ARN"
  if [ "$(aws iam list-access-keys --user-name "$USUARIO_CLI" --query 'length(AccessKeyMetadata)' --output text)" = 0 ]; then
    echo "4. $USUARIO_CLI criado. Access key abaixo aparece UMA vez. Cole no SEU terminal:"
    echo "   aws configure --profile routify   (regiao us-east-1, output json). Nao cole no chat nem no repo."
    aws iam create-access-key --user-name "$USUARIO_CLI" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text
  else
    echo "4. $USUARIO_CLI ja tem access key; nao criei outra (IAM -> Users -> $USUARIO_CLI -> Security credentials)"
  fi
fi

# ---------- 5. lembretes (sem API) ----------
N=$(aws budgets describe-budgets --account-id "$CONTA" --query 'length(Budgets)' --output text 2>/dev/null || echo "?")
echo "5. budgets na conta: $N   (0 => Billing -> Budgets -> Zero spend budget, e-mail dos dois membros)"
echo "   Console-only: menu da conta -> Account -> 'IAM user and role access to Billing information' -> Activate (senao o colega nao ve custo)."
echo "== fim. Colega: EC2 -> instancia -> Connect -> Session Manager. Dono: ssh com a VPN desligada."
