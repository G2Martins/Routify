# Deploy em produção (custo zero)

**Última revisão:** 2026-09-23

Topologia decidida em 2026-09-23: o projeto é acadêmico e precisa custar **zero** até dez/2026
(ver `CLAUDE.md` §6). Domínios ficam fora do repo: aqui `<app>` é o domínio do front e
`api-<app>` o da API.

| Peça | Onde | Como roda |
|---|---|---|
| App (Expo web) em `/` + painel ADM (Next) em `/admin` | Hostinger Business, **1 site Node** | Next standalone pré-buildado; o site só executa |
| API FastAPI + LIA | AWS plano Free, EC2 **t3.small** (2 GB) em us-east-1 | systemd (usuário sem root) atrás do Caddy (HTTPS automático) |
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
   swap de 2 GB, venv, unidade `routify-api` (`ProtectSystem=strict`, `MemoryMax=1500M`), Caddy e ufw.
4. **O dono copia as credenciais** (o assistente não lê segredos):
   `scp -i <chave.pem> services/collector/config/.env services/collector/config/tomtom_keys.json ubuntu@<ip>:/opt/routify/services/collector/config/`.
   A unidade `routify-api.path` sobe a API sozinha quando o `.env` chega. Sem ele, o serviço nem tenta
   (`ConditionPathExists`).

**Verificar:** `curl https://api-<app>/health` deve responder `modelo_ativo: lia_2.2`, `contexto` e as contagens da TomTom.
Logs: `journalctl -u routify-api -f`.

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
- Front: republicar o pacote anterior pelo mesmo MCP.
- Fim do projeto (dez/2026): terminar a EC2, liberar o IP elástico (IP parado também consome crédito), apagar o site na Hostinger e os registros DNS. O código fica no GitHub.
