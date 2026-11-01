# Deploy em produção (custo zero)

**Última revisão:** 2026-11-01

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
   - `lia_2.2*.pkl` e `lia_2.1*.pkl` (rollback);
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

**Verificar:** `curl https://api-<app>/health` deve responder `modelo_ativo: lia_2.2`, `contexto` e as contagens da TomTom.
Logs: `journalctl -u routify-api -f`.

**Atualizar o código** (qualquer commit novo; a extração por cima preserva `.venv`, `ml/artifacts` e `config/`):
```bash
git -c core.autocrlf=false archive --format=tar.gz -o code.tgz HEAD
scp -i <chave.pem> code.tgz ubuntu@<ip>:/tmp/
ssh -i <chave.pem> ubuntu@<ip> 'sudo tar -xzf /tmp/code.tgz -C /opt/routify && sudo env API_DOMAIN=api-<app> APP_ORIGIN=https://<app> bash /opt/routify/apps/api/deploy/provisionar-ec2.sh'
```
O `provisionar-ec2.sh` é idempotente: reescreve a unidade e o Caddyfile e reinicia. Depois da primeira
atualização com `--no-access-log`, limpe o journal antigo, que pode ter URLs com chave TomTom e coordenadas:
`sudo journalctl --vacuum-time=1s`.

**SSH deu `Connection timed out`?** O security group só libera o IP do dono (`/32`) e IP residencial muda.
Console → EC2 → Security Groups → Inbound → regra SSH → trocar pelo IP atual (`curl checkip.amazonaws.com`).
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

Parar: `sudo systemctl disable --now routify-collector`. Pausar chaves no painel ADM **não** afeta o coletor
(ele não lê `config_runtime`); para tirar chaves dele, aponte `TOMTOM_KEYS_FILE` para um JSON com o subconjunto.

## 2. Front na Hostinger

A Hostinger compartilhada **não builda** o Next: estoura o limite de recursos do plano (LVE) e
instala só `dependencies`, sem as devDeps do Tailwind. Então o build roda em Linux e sobe pronto:

1. Local: `API_URL=https://api-<app> bash scripts/empacotar-front.sh /tmp/front-src.tar.gz`
   (export web do Expo com `--clear` + código do painel).
2. Em qualquer Linux x64 com Node 22 (usamos a própria EC2, usuário `builder` **sem sudo**):
   `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… NEXT_PUBLIC_API_URL=https://api-<app> NEXT_PUBLIC_APP_URL=/ bash montar-front-linux.sh ~/routify-front.tar.gz`.
3. Publicar com o MCP da Hostinger: `hosting_deployJsApplication` (domínio `<app>`, arquivo do passo 2).
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

- API: `LIA_VERSION=lia_2.1` num drop-in do systemd → `systemctl restart routify-api`.
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

### 5.1 Preparação (dono, uma vez)

1. **Custo visível para usuários IAM:** console → menu da conta (canto superior direito) → *Account* →
   *IAM user and role access to Billing information* → **Activate**. Sem isso, usuário IAM não vê fatura nem crédito.
2. **Session Manager** (shell no navegador, sem SSH e sem IP no security group):
   - IAM → *Roles* → *Create role* → *AWS service* → *EC2* → policy **`AmazonSSMManagedInstanceCore`** → nome `routify-ec2-ssm`.
   - EC2 → instância → *Actions* → *Security* → **Modify IAM role** → `routify-ec2-ssm`.
   - O Ubuntu 24.04 da AWS já traz o SSM Agent (snap). Em 1–2 min a instância aparece em
     *Systems Manager → Fleet Manager*. Se não aparecer: `sudo snap start amazon-ssm-agent` por SSH.
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
