# Deploy em produção (custo zero)

**Última revisão:** 2026-11-02

Topologia decidida em 2026-09-23: o projeto é acadêmico e precisa custar **zero** até dez/2026
(ver `CLAUDE.md` §6). Domínios ficam fora do repo: aqui `<app>` é o domínio do front e
`api-<app>` o da API.

| Peça | Onde | Como roda |
|---|---|---|
| App (Expo web) em `/` + painel ADM (Next) em `/admin` | Hostinger Business, **1 site Node** | Next standalone pré-buildado; o site só executa |
| API FastAPI + LIA | AWS plano Free, EC2 **t3.small** (2 GB) em us-east-1 | systemd (usuário sem root) atrás do Caddy (HTTPS automático) |
| Coletor TomTom (desde 2026-11-01) | **mesma EC2**, serviço `routify-collector` | systemd (mesmo usuário), cadência pela cota, Fase 3 desligada — §1.1 |
| Banco/Auth | Supabase free | keep-alive diário no CI |

Custo: a EC2 consome ~US$ 20/mês do crédito de US$ 100 (≈ US$ 67 até 31/12). O plano Free
da AWS não cobra: quando o crédito ou os 6 meses acabam, a conta é encerrada.

## 1. API na EC2

**Criar (console AWS, us-east-1):**
- Ubuntu **24.04 LTS** x86, **t3.small**, 20 GiB gp3;
- *Detalhes avançados → Especificação de crédito*: **Padrão (standard)**. O "Ilimitado" cobra CPU extra do crédito;
- grupo de segurança: SSH (22) só do IP do dono; HTTP (80) e HTTPS (443) abertos;
- **IP elástico** associado à instância;
- DNS `api-<app>` → A → IP elástico.

Não ativar AWS Organizations nem AMI do Marketplace: a conta vira plano pago.

**Provisionar** (do repo local, com a chave `.pem` do par criado):
1. Código do commit implantado: `git -c core.autocrlf=false archive --format=tar.gz -o code.tgz HEAD` → `scp` → extrair em `/opt/routify`.
2. Artefatos fora do git → `/opt/routify/ml/artifacts/`:
   - `lia_2.3*.pkl` (padrão), `lia_2.2*.pkl` e `lia_2.1*.pkl` (rollback);
   - `transfer_confidence_isotonic.pkl`;
   - `brasilia_graph_38km.pkl` + `.graphml` (reserva).
   Depois, `touch` no `.pkl` para ele ficar mais novo que o GraphML.
3. `sudo env API_DOMAIN=api-<app> APP_ORIGIN=https://<app> bash /opt/routify/apps/api/deploy/provisionar-ec2.sh`:
   swap de 2 GB, venv, unidade `routify-api` (`ProtectSystem=strict`, `MemoryMax=1500M`, `StartLimit*`, sem access log), Caddy (teto de corpo 64 KB) e ufw.
4. **O dono copia as credenciais** (o assistente não lê segredos). A pasta `config/` é 700 do usuário `routify`,
   então o `scp` direto para ela falha; passe por `/tmp`:
   ```bash
   scp -i <chave.pem> services/collector/config/.env services/collector/config/tomtom_keys.json ubuntu@<ip>:/tmp/
   ssh -i <chave.pem> ubuntu@<ip> 'sudo install -o routify -g routify -m 600 /tmp/.env /tmp/tomtom_keys.json /opt/routify/services/collector/config/ && shred -u /tmp/.env /tmp/tomtom_keys.json'
   ```
   A unidade `routify-api.path` sobe a API sozinha quando o `.env` chega. Sem ele, o serviço nem tenta
   (`ConditionPathExists`).

**Verificar:** `curl https://api-<app>/health` deve responder `modelo_ativo: lia_2.3`, `velocidade_livre: calibrada`, `contexto` e as contagens da TomTom.
Logs: `journalctl -u routify-api -f`.

**Atualizar o código** (qualquer commit novo; a extração por cima preserva `.venv`, `ml/artifacts` e `config/`):
```bash
git -c core.autocrlf=false archive --format=tar.gz -o code.tgz HEAD
scp -i <chave.pem> code.tgz ubuntu@<ip>:/tmp/
ssh -i <chave.pem> ubuntu@<ip> 'sudo tar -xzf /tmp/code.tgz -C /opt/routify && sudo env API_DOMAIN=api-<app> APP_ORIGIN=https://<app> bash /opt/routify/apps/api/deploy/provisionar-ec2.sh'
```
O `provisionar-ec2.sh` é idempotente: reescreve a unidade e o Caddyfile e reinicia. Depois da primeira
atualização com `--no-access-log`, limpe o journal antigo, que pode ter URLs com chave TomTom e coordenadas:
`sudo journalctl --rotate && sudo journalctl --vacuum-time=1s` (o `--rotate` fecha o arquivo ativo; sem ele o
vacuum só apaga os arquivados).

**SSH deu `Connection timed out`?** O security group só libera o IP do dono (`/32`) e IP residencial muda.
Console → EC2 → Security Groups → Inbound → regra SSH → *Source* = **My IP** → Save. Ou, no **CloudShell** do console
(ícone de terminal na barra superior; já autenticado como você), com o IP atual da sua máquina
(`curl checkip.amazonaws.com` **na sua máquina, com a VPN desligada**; não no CloudShell, e não o IP da VPN, que muda a cada conexão):
```bash
SG=$(aws ec2 describe-instances --instance-ids <id-da-instância> --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
aws ec2 describe-security-group-rules --filters Name=group-id,Values=$SG --query 'SecurityGroupRules[?FromPort==`22`].[SecurityGroupRuleId,CidrIpv4]' --output text
aws ec2 modify-security-group-rules --group-id $SG --security-group-rules "SecurityGroupRuleId=<sgr-da-linha-acima>,SecurityGroupRule='{IpProtocol=tcp,FromPort=22,ToPort=22,CidrIpv4=<ip-atual>/32}'"
```
Com o Session Manager (§5.1) isso deixa de ser necessário.

### 1.1 Coletor TomTom ao lado da API

Desde 2026-11-01 a coleta de `historico_trafego` voltou, na mesma EC2 (custo zero), como serviço `routify-collector`:

- **Cadência pela cota.** A cota free da TomTom é mensal e por API (Flow 20 mil). Com 39 chaves e 630 pontos,
  reservando 15% pra API sob demanda: **1 ciclo a cada 43 min** (~33 ciclos/dia, ~21 mil chamadas/dia,
  ~650 mil/mês). `COLETOR_INTERVALO_MIN` força outro valor; `COLETOR_RESERVA_API` e `COLETOR_COTA_MENSAL_CHAVE`
  ajustam o cálculo. Fórmula e invariante testados em `services/collector/tests/test_rotacao.py`.
- **Memória.** ~80 MB (`MemoryMax=300M`) ao lado da API (~0,8 GB, `MemoryMax=1500M`). A Fase 3 fica
  **desligada** (`COLETOR_FASE3=0`): ela carrega grafo + modelo (~1,4 GB) e não cabe numa t3.small.
- **Pool compartilhado.** Coletor e API leem o mesmo `tomtom_keys.json`; cada um tem cooldown em memória.
  O coletor espalha o consumo em round-robin; chave com cota esgotada (429 repetido) fica 24 h fora nos dois.
- **Mesmo `.env`** (`SUPABASE_KEY` = service_role): `historico_trafego` tem RLS sem policy, só a service_role escreve.

Instalar ou atualizar (depois de extrair o código como em "Atualizar o código"):
```bash
ssh -i <chave.pem> ubuntu@<ip> 'sudo bash /opt/routify/services/collector/deploy/instalar-ec2.sh'
```
Verificar:
```bash
journalctl -u routify-collector -n 30     # "Cadência: 1 ciclo a cada 43 min — 39 chaves…" e "Salvando lote de 6xx registros"
systemctl show routify-collector -p MemoryCurrent
```
No Supabase: `select count(*) from historico_trafego where data_hora_coleta > now() - interval '1 hour'`
cresce ~630 por ciclo. O painel ADM (Qualidade dos dados) mostra a recência por via.

**Comparador LIA × provedores** (mesmo diretório e venv): depois da migration
`20261102000000_lia_vs_provedores.sql`, `sudo COMPARADOR=1 bash /opt/routify/services/collector/deploy/instalar-ec2.sh`
liga o timer (8 rodadas por dia). Teste manual sem gravar:
`sudo -u routify bash -c 'cd /opt/routify/services/collector && .venv/bin/python comparar_provedores.py --sem-gravar'`.

**Rotina de validação** (`scripts/rotina_validacao.py`, unit `routify-rotina.service`, instalada pelo mesmo script):
roda ao fim de cada rodada do comparador (`OnSuccess`/`OnFailure`), sem timer próprio e sem gastar TomTom além de
1 busca. Confere a API pelo loopback (fuso, 422 com NaN/Infinity/ano 1/override, previsão na faixa, busca, erros no
log desde a execução anterior, coletor vivo) e resume a rodada que a disparou (LIA × TomTom no mesmo trajeto e
contra a rota própria, Mapbox, OSRM). Roda com usuário dinâmico do systemd que só lê o journal: não enxerga o
`.env` nem as chaves. Saída em `/var/lib/routify-rotina/` (`historico.jsonl` + `relatorio.md`):
`sudo cat /var/lib/routify-rotina/relatorio.md` (do PC, pelo SSH por dentro do SSM do §5.6).

**A/B nos picos de dia útil** (`scripts/ab_ec2.sh`, `routify-ab.service` + `.timer`; liga com
`sudo AB=1 bash …/instalar-ec2.sh`): às 07:40, 08:40, 17:40 e 18:40 (seg–sex) sobe um braço B na porta 8001, o
mesmo código da produção com UMA variável trocada, e roda `scripts/ab_rotas.py` contra a produção (A) no mesmo
instante, viagem a viagem; no fim derruba o B. Variantes: `sensores` (`SENSORES_VIRTUAIS=1`, 10 viagens pelos
buracos de sensor), `restricoes` (`RESTRICOES_CONVERSAO=1`, as 30 viagens do comparador) e `lia24`
(`LIA_VERSION=lia_2.4`, 16 corredores; pulada sem o `lia_2.4.pkl`). A unit roda `sensores restricoes`. Resultado em
`/var/lib/routify-ab/<variante>_<data>_<hora>.json`. Teto de 1,1 GB (o B ocupa ~0,8 GB, igual à produção; a
máquina tem 2 GB de swap). Para sozinho depois de `AB_ATE` (2026-11-13), porque cada passada gasta Flow e Routing
da TomTom nos dois braços. Rodar fora do horário: `sudo systemctl start routify-ab.service`.

Parar: `sudo systemctl disable --now routify-collector`. Pausar chaves no painel ADM **não** afeta o coletor
(ele não lê `config_runtime`); para tirar chaves dele, aponte `TOMTOM_KEYS_FILE` para um JSON com o subconjunto.

## 2. Front na Hostinger

A Hostinger compartilhada **não builda** o Next: estoura o limite de recursos do plano (LVE) e
instala só `dependencies`, sem as devDeps do Tailwind. Então o build roda em Linux e sobe pronto:

1. Local: `API_URL=https://api-<app> bash scripts/empacotar-front.sh /tmp/front-src.tar.gz`
   (export web do Expo com `--clear` + código do painel).
2. Em qualquer Linux x64 com Node 22 (usamos a própria EC2, usuário `builder` **sem sudo**):
   `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… NEXT_PUBLIC_API_URL=https://api-<app> NEXT_PUBLIC_APP_URL=/ bash montar-front-linux.sh ~/routify-front.tar.gz`.
3. Publicar com o MCP da Hostinger: `hosting_deploy` (domínio `<app>`, arquivo do passo 2, `type: nodejs`, `appType: other`,
   `buildScript: build`, `entryFile: index.js`, Node 22) e acompanhar com `hosting_get-deployment`. O arquivo não pode
   estar dentro da pasta do usuário: a ferramenta recusa. Antes de 2026-11 a operação se chamava `hosting_deployJsApplication`.
   A config sai do `package.json` (entry `index.js`, build = copiar `prebuilt_node_modules`).

Pegadinhas já resolvidas:
- **tar sem prefixo `./`**: com `./` a Hostinger responde 500;
- **loader** (`apps/admin/deploy/index.js`) força `HOSTNAME=0.0.0.0` e encerra nos sinais de parada. Sem isso o restart deixa processo zumbi e estoura o teto de processos da conta;
- **Metro**: sem `--clear` o export reaproveita os `EXPO_PUBLIC_*` do dev (`localhost`). O empacotador falha se o bundle não contiver a `API_URL`.

**Verificar:**
- `/` → 200 com o app;
- `/admin` sem sessão → 307 para `/`;
- headers: CSP (Report-Only), HSTS, `Permissions-Policy` com `geolocation=(self)`;
- fontes em `/assets/node_modules/...` → 200.

**Supabase Auth** (dono, no painel): *URL Configuration* → Site URL `https://<app>` e Redirect `https://<app>/**`.

## 3. E-mails de autenticação (cadastro, senha, troca de e-mail)

O SMTP padrão do Supabase **só entrega para quem é da equipe do projeto**, com limite de poucos
e-mails por hora. Qualquer outro usuário fica sem o e-mail de confirmação. Por isso usamos SMTP próprio:
Resend, grátis até 3 mil e-mails por mês, com o domínio já verificado.

1. **Resend** → *API Keys* → *Create API key*: permissão **Sending access**, domínio do projeto. A chave
   aparece uma vez só e vai direto para o passo 2: não colar em chat nem em arquivo.
2. **Supabase** → *Authentication* → *Emails* → *SMTP Settings* → *Enable custom SMTP*:
   remetente `nao-responda@<domínio>`, nome `Routify`, host `smtp.resend.com`, porta `465`,
   usuário `resend`, senha = a chave do passo 1.
3. **Supabase** → *Authentication* → *Emails* → *Templates*: colar o HTML e o assunto de cada arquivo de
   `supabase/templates/`. O assunto está no comentário do topo de cada arquivo.
   - `confirmacao.html` → *Confirm signup*
   - `recuperacao.html` → *Reset password*
   - `troca-email.html` → *Change email address*

   O logo vem de `{{ .SiteURL }}/email/routify.png` (servido pelo site, de `apps/mobile/public/email/`),
   então a *Site URL* precisa ser o domínio de produção.

## 4. Rollback e desligamento

- API: `LIA_VERSION=lia_2.2` (ou `lia_2.1`), `VEL_LIVRE_CALIBRADA=0` e/ou `PRIOR_CONGESTIONAMENTO=perfil` num drop-in do systemd → `systemctl restart routify-api`. Fatores por grupo e δ de 2026-09-23: copiar `semaforos_calibracao_2026-09-23.json` por cima de `semaforos_calibracao.json`.
- Comparador: `sudo systemctl disable --now routify-comparador.timer` (a rotina de validação para junto).
- A/B: `sudo systemctl disable --now routify-ab.timer`.
- Coletor: `sudo systemctl disable --now routify-collector` (a API continua chamando a TomTom sob demanda).
- Front: republicar o pacote anterior pelo mesmo MCP.
- Fim do projeto (dez/2026): terminar a EC2, liberar o IP elástico (IP parado também consome crédito), apagar o site na Hostinger e os registros DNS. O código fica no GitHub.

## 5. Acesso de um segundo membro da equipe à AWS

Objetivo: o colega entra no console, enxerga custo, liga/desliga/reinicia a EC2 e abre um shell nela,
**sem** a senha root e **sem** a chave `.pem` do dono.

**Por que usuário IAM, e não IAM Identity Center.** A conta está no plano Free. Criar ou entrar numa
AWS Organization converte a conta para o plano pago e encerra o crédito
([FAQ do Free Tier](https://aws.amazon.com/free/faqs/)). O IAM Identity Center só dá acesso a contas pela
"organization instance", que exige Organizations; a "account instance" não suporta permission sets
([docs](https://docs.aws.amazon.com/singlesignon/latest/userguide/account-instances-identity-center.html)).
Logo: **usuário IAM com MFA obrigatória e política mínima**.

### 5.0 Atalho: tudo pelo CloudShell

`scripts/aws-bootstrap.sh` faz 5.1 (Session Manager), 5.2 (usuário do colega), 5.6 (usuário de automação) e ainda
deixa a porta 22 só com o IP do dono, de forma idempotente. Edite as variáveis do topo (instância, IP de casa com a
VPN desligada, nomes dos usuários ou `""` para pular), abra o CloudShell no console (ícone de terminal), *Actions →
Upload file* e `bash aws-bootstrap.sh`. Ele imprime a senha temporária do colega e a access key da automação
**uma vez**: copie na hora, por canal seguro. Só duas coisas continuam manuais: ativar o acesso de usuários IAM ao
Billing (5.1 item 1) e, se não houver, o budget (5.1 item 3).

### 5.1 Preparação (dono, uma vez)

1. **Custo visível para usuários IAM:** console → menu da conta (canto superior direito) → *Account* →
   *IAM user and role access to Billing information* → **Activate**. Sem isso, usuário IAM não vê fatura nem crédito.
2. **Session Manager** (shell no navegador, sem SSH e sem IP no security group):
   - IAM → *Roles* → *Create role* → *AWS service* → *EC2* → policy **`AmazonSSMManagedInstanceCore`** → nome `routify-ec2-ssm`.
   - EC2 → instância → *Actions* → *Security* → **Modify IAM role** → `routify-ec2-ssm`.
   - O Ubuntu 24.04 da AWS já traz o SSM Agent (snap). Em 1–2 min a instância aparece em
     *Systems Manager → Fleet Manager*. Se não aparecer: `sudo snap restart amazon-ssm-agent` por SSH (o agente guarda o estado "sem role" de antes
     da associação; em 2026-11-02 ficou offline até esse restart).
   - Teste: EC2 → instância → *Connect* → aba **Session Manager** → *Connect*. Abre um shell como `ssm-user` (tem `sudo`).
   - Com isso funcionando, a regra de SSH do security group pode ficar fechada (ou só pro dono).
3. **Alarme de custo:** *Billing and Cost Management* → *Budgets*. Deve existir o budget da decisão de 2026-09-23;
   se não, *Create budget* → *Zero spend budget* → e-mail dos dois membros.

### 5.2 Criar o usuário do colega (dono)

1. IAM → *Users* → **Create user** → nome `pedro` → marcar *Provide user access to the AWS Management Console*
   → *I want to create an IAM user* → senha gerada → marcar *Users must create a new password at next sign-in*.
2. *Permissions* → *Attach policies directly*:
   - **`ReadOnlyAccess`** (gerenciada pela AWS): vê tudo, muda nada;
   - **`RoutifyOperacaoEC2`** (criar antes em IAM → *Policies* → *Create policy* → *JSON*, texto abaixo):
     liga/desliga/reinicia **só** a instância do Routify, abre sessão do Session Manager nela, vê custo e
     cuida da própria senha e MFA. Enquanto a sessão não tiver MFA, tudo o resto é negado.
3. *Create user* → baixar o `.csv` com senha e URL de login (`https://<ID-da-conta>.signin.aws.amazon.com/console`)
   → entregar ao colega por canal seguro (pessoalmente ou mensagem que expira; nunca e-mail aberto nem o chat do repo).
4. **Primeiro login do colega:** troca a senha → menu da conta → *Security credentials* → *Assign MFA device*
   (app autenticador) → sai e entra de novo. Só a partir daí a política libera EC2 e Session Manager.

Política `RoutifyOperacaoEC2` — trocar `<regiao>` (ex.: `us-east-1`), `<id-conta>` (12 dígitos) e `<id-instancia>` (`i-…`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LigarDesligarSoRoutify",
      "Effect": "Allow",
      "Action": ["ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances"],
      "Resource": "arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>"
    },
    {
      "Sid": "ShellPeloSessionManager",
      "Effect": "Allow",
      "Action": "ssm:StartSession",
      "Resource": [
        "arn:aws:ec2:<regiao>:<id-conta>:instance/<id-instancia>",
        "arn:aws:ssm:<regiao>::document/SSM-SessionManagerRunShell",
        "arn:aws:ssm:<regiao>::document/AWS-StartInteractiveCommand"
      ]
    },
    {
      "Sid": "EncerrarPropriasSessoes",
      "Effect": "Allow",
      "Action": ["ssm:TerminateSession", "ssm:ResumeSession"],
      "Resource": "arn:aws:ssm:*:*:session/${aws:username}-*"
    },
    {
      "Sid": "VerCustoECredito",
      "Effect": "Allow",
      "Action": ["billing:Get*", "ce:Get*", "ce:Describe*", "ce:List*", "freetier:Get*",
                 "budgets:ViewBudget", "budgets:Describe*", "account:GetAccountInformation"],
      "Resource": "*"
    },
    {
      "Sid": "ListarParaConfigurarMFA",
      "Effect": "Allow",
      "Action": ["iam:ListUsers", "iam:ListVirtualMFADevices", "iam:GetAccountPasswordPolicy"],
      "Resource": "*"
    },
    {
      "Sid": "PropriaSenhaEMFA",
      "Effect": "Allow",
      "Action": ["iam:ChangePassword", "iam:GetUser", "iam:CreateVirtualMFADevice", "iam:EnableMFADevice",
                 "iam:ResyncMFADevice", "iam:ListMFADevices", "iam:DeactivateMFADevice", "iam:DeleteVirtualMFADevice"],
      "Resource": ["arn:aws:iam::<id-conta>:user/${aws:username}", "arn:aws:iam::<id-conta>:mfa/${aws:username}"]
    },
    {
      "Sid": "SemMFASoConfiguraMFA",
      "Effect": "Deny",
      "NotAction": ["iam:CreateVirtualMFADevice", "iam:EnableMFADevice", "iam:GetUser", "iam:ListMFADevices",
                    "iam:ListVirtualMFADevices", "iam:ResyncMFADevice", "iam:ChangePassword",
                    "iam:GetAccountPasswordPolicy", "sts:GetSessionToken"],
      "Resource": "*",
      "Condition": {"BoolIfExists": {"aws:MultiFactorAuthPresent": "false"}}
    }
  ]
}
```

### 5.3 SSH também? (opcional)

Se o colega preferir `ssh`: ele gera um par (`ssh-keygen -t ed25519 -C pedro`) e manda **só a chave pública**;
o dono a acrescenta em `/home/ubuntu/.ssh/authorized_keys` na EC2 e libera o IP dele no security group
(SSH, `/32`). O `.pem` do dono nunca é compartilhado. Com o Session Manager, nada disso é necessário.

### 5.4 O que não fazer

- Não compartilhar a senha root, o `.pem` nem credenciais por e-mail ou chat.
- Não criar *access keys* (programáticas) sem necessidade; se precisar de AWS CLI, criar, usar e rotacionar a cada 90 dias.
- Não entrar em AWS Organizations, IAM Identity Center ou Control Tower: a conta vira paga e perde o crédito.
- Não dar `AdministratorAccess` por conveniência. Se o colega precisar criar recursos, ampliar a política pontualmente.

### 5.5 Revogar

IAM → *Users* → `pedro` → *Security credentials* → *Console sign-in* → **Disable** (ou *Delete user*).
Se tinha SSH: tirar a linha de `authorized_keys` e a regra do security group.

### 5.6 Acesso por linha de comando (automação: assistente, scripts, Actions)

Para alguém (ou algo) operar a EC2 **sem** o console: AWS CLI + um usuário IAM só pra isso. É a única forma de um
agente local (ex.: o assistente desta máquina) editar a regra de SSH, mandar comandos pela instância (SSM) e
ligar/desligar a máquina. Custo: uma *access key* de longa duração em `~/.aws/credentials`, em texto claro.
Mitigação: política mínima abaixo, **a key é colada pelo dono no próprio terminal** (`aws configure --profile routify`),
nunca passa pelo chat, e é apagada em IAM quando a tarefa acaba (ou rotacionada a cada 90 dias).

1. IAM → *Users* → *Create user* → `claude-ops` → **sem** acesso ao console → *Attach policies directly* →
   *Create policy* → JSON abaixo (trocar `<id-da-conta>`, `<id-da-instância>` e `<sg-id>`) → nome `RoutifyOperacaoCLI`.
2. Usuário → *Security credentials* → *Create access key* → *Command Line Interface* → baixar o CSV (não commitar).
3. Na máquina que vai operar: `winget install --id Amazon.AWSCLI -e` e, para shell/scp pelo SSM,
   `winget install --id Amazon.SessionManagerPlugin -e` (ou o instalador em docs.aws.amazon.com/systems-manager).
4. `aws configure --profile routify` (região `us-east-1`, saída `json`). Teste sem segredo no chat:
   `aws --profile routify sts get-caller-identity`.
5. Com o Session Manager ativo (§5.1), SSH passa pelo SSM e a porta 22 pode ficar fechada no security group:
   `ssh -i <chave.pem> -o ProxyCommand="aws --profile routify ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p" ubuntu@<id-da-instância>`.
   `-o HostKeyAlias=<ip-elástico>` reaproveita a chave de host já conhecida pelo IP. Testado em 2026-11-02 no Git Bash,
   com o AWS CLI e o plugin no PATH.
   Sem o plugin, `aws ssm send-command --document-name AWS-RunShellScript` roda scripts sem shell interativo.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "Ler", "Effect": "Allow",
      "Action": ["ec2:Describe*", "ssm:DescribeInstanceInformation", "ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
      "Resource": "*" },
    { "Sid": "RegraSSH", "Effect": "Allow",
      "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress", "ec2:ModifySecurityGroupRules"],
      "Resource": "arn:aws:ec2:us-east-1:<id-da-conta>:security-group/<sg-id>" },
    { "Sid": "LigarDesligar", "Effect": "Allow",
      "Action": ["ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances"],
      "Resource": "arn:aws:ec2:us-east-1:<id-da-conta>:instance/<id-da-instância>" },
    { "Sid": "ComandosPeloSSM", "Effect": "Allow",
      "Action": ["ssm:SendCommand", "ssm:StartSession"],
      "Resource": ["arn:aws:ec2:us-east-1:<id-da-conta>:instance/<id-da-instância>",
                   "arn:aws:ssm:us-east-1::document/AWS-RunShellScript",
                   "arn:aws:ssm:us-east-1::document/AWS-StartSSHSession"] },
    { "Sid": "EncerrarPropriasSessoes", "Effect": "Allow",
      "Action": ["ssm:TerminateSession"],
      "Resource": "arn:aws:ssm:*:*:session/claude-ops-*" }
  ]
}
```

Revogar: IAM → *Users* → `claude-ops` → *Security credentials* → *Deactivate*/*Delete* a access key.
