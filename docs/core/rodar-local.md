# Rodar o Routify localmente — visão de usuário e visão ADM

**Última revisão:** 2026-09-23

Passo a passo para subir API, app e painel ADM na sua máquina e testar os dois lados. Tempo estimado: ~15 min na primeira vez.

Todo `cd` abaixo parte da **raiz do repo**. API, app e painel ficam rodando ao mesmo tempo, então abra **um terminal para cada um**.

```text
App (Expo web :8081) ──► API FastAPI (:8000) ──► Supabase · TomTom
Painel ADM (Next :3000) ─┘          └── LIA 2.1 + grafo OSM em memória
```

## 0. Pré-requisitos

- Python 3.11 e Node.js 20 ou mais novo.
- `services/collector/config/.env` preenchido (`SUPABASE_URL`, `SUPABASE_KEY` = service_role) e `services/collector/config/tomtom_keys.json` com as chaves (modelos em `*.example`). A API e o `ml/` leem esses mesmos arquivos.
- Artefatos da LIA em `ml/artifacts/` (fora do git):
  - `lia_2.1.pkl`, `lia_2.1_encoder.pkl`, `lia_2.1_profiles.pkl`, `transfer_confidence_isotonic.pkl`, `brasilia_graph.graphml`;
  - quem não tem, gera com `cd ml && python silver.py && python train.py --version lia_2.1 --skip-silver && python calibrate_transfer.py` (~5 min).

## 1. Banco — uma vez só

As migrations de `supabase/migrations/` precisam estar aplicadas, na ordem:

1. `20260907000000_thesis_validation.sql` — colunas de validação da tese em `route_history`;
2. `20260923000000_security_hardening.sql` — **liga o RLS** nas tabelas do dataset;
3. `20260923010000_usage_tracking_admin.sql` — tabelas de captura de uso, RPCs do painel, views de qualidade, `pg_cron`.

**Opção A — SQL Editor (mais simples).** No painel do Supabase → **SQL Editor** → **New query**, cole o conteúdo dos 3 arquivos (nessa ordem) e clique em **Run**. Tudo é idempotente: rodar de novo não estraga nada.

**Opção B — pelo Claude.** Numa sessão interativa, rode `/mcp` → `supabase` → **Authenticate** e peça para aplicar; o MCP precisa estar sem `read_only=true` na URL do `.mcp.json`.

### Promover administradores

O papel de admin mora em `app_metadata` da conta, que **só o banco grava** (o usuário não consegue se promover pelo app). No SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
where email in ('<email-1>', '<email-2>');
```

Depois da promoção, **saia e entre de novo** no painel: o papel vem dentro do token, que só é renovado no login.

### O que é "ativar o RLS" e como conferir

RLS (Row Level Security) faz o Postgres checar uma regra em **cada linha** antes de devolver ou alterar dados pela API pública do Supabase (a chave publishable que vai no app). Sem RLS, quem tem essa chave pública lê e apaga a tabela inteira.

- **Ligar numa tabela:** `alter table public.<tabela> enable row level security;` (a migration 2 já faz nas três do dataset). Com RLS ligado e nenhuma policy, a chave pública não enxerga nada; a API, o coletor e o `ml/` continuam funcionando porque usam a chave `service_role`, que ignora RLS.
- **Liberar só o necessário:** uma policy por operação. Exemplos no repo: `route_history` (cada usuário só vê as próprias rotas) e as tabelas de uso (só admin lê).
- **Conferir no painel:**
  - **Table Editor** — a tabela mostra "RLS enabled";
  - **Authentication → Policies** — lista as policies de cada tabela;
  - **Advisors → Security** — não pode sobrar alerta **ERROR** "RLS disabled in public".

## 2. Publicar as métricas da LIA no painel

```bash
cd ml
python publish_metrics.py
```

Lê os JSONs versionados de `ml/artifacts/` e alimenta `lia_treinos` e `lia_analises`. Rode de novo depois de cada treino: o painel acompanha a evolução.

## 3. API (porta 8000)

```bash
cd apps/api
pip install -r requirements.txt   # primeira vez
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Confira em <http://localhost:8000/health>. O esperado é:

- `modelo_ativo: "lia_2.1"`;
- `vias_monitoradas: 630`;
- `tomtom.ativo: true`.

O Swagger fica em `/docs`.

## 4. Visão de usuário — app (porta 8081)

```bash
cd apps/mobile
npm install        # primeira vez
npm run web
```

Abra <http://localhost:8081> e faça o roteiro:

1. **Entre** com uma conta existente (ou cadastre uma nova).
2. **Mapa:** escolha origem e destino no autocomplete e toque em **Otimizar rota**. A LIA calcula; a TomTom atualiza as vias do trajeto e remove interdições.
3. **Iniciar navegação** e depois **Encerrar viagem** (gera os eventos de navegação).
4. **Histórico:** abra a rota e informe o **tempo real** da viagem. Isso vira um ponto no gráfico "Erro real em produção" do painel.

## 5. Visão ADM — painel (porta 3000)

```bash
cd apps/admin
npm install        # primeira vez
```

Crie `apps/admin/.env.local` com as chaves **públicas**. Os valores são os mesmos de `apps/mobile/.env`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<mesmo valor de EXPO_PUBLIC_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<mesmo valor de EXPO_PUBLIC_SUPABASE_ANON_KEY>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

Abra <http://localhost:3000>, entre com uma conta **admin** e percorra:

| Página | O que conferir |
| --- | --- |
| Visão geral | a rota que você pediu no app aparece nos números e no gráfico diário |
| LIA · benchmarks | MAE/RMSE por versão, curva isotônica, LSTM × XGBoost, congestionamento, feedback |
| Arquitetura viva | status verde na API, no cache de recência, no pool TomTom e no Supabase; troque os fluxos |
| Uso da plataforma | sua rota com coordenadas arredondadas (~110 m), eventos e requisições |
| Qualidade dos dados | 1,5 mi leituras, heatmap hora × dia, vias menos amostradas |
| Usuários | as contas com o selo **admin** |

Conta sem papel admin cai em "Sem acesso", e o banco recusa as consultas mesmo que alguém force a URL.

## Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| Painel mostra "Acesso negado pelo banco" | token antigo, sem o papel | sair e entrar de novo depois da promoção |
| Painel mostra "Não foi possível carregar os dados" | migration 3 não aplicada | aplicar `20260923010000_usage_tracking_admin.sql` |
| Log da API: `Uso: falha ao gravar em …` | tabelas de uso não existem ainda | idem acima; a rota funciona mesmo assim |
| App web: erro de CORS | origem fora da lista | `CORS_ORIGINS` na API (padrão: `localhost:8081`, `:19006`, `:3000`) |
| `FileNotFoundError: lia_2.1.pkl` | artefatos ausentes nesta máquina | ver passo 0 |
| Host do Supabase não resolve | projeto free pausado | Dashboard → Resume; o workflow de keep-alive evita a próxima pausa |
