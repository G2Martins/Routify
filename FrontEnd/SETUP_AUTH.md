# Setup do Auth + Histórico (Supabase)

## 1. Aplicar SQL no Supabase

No Supabase Dashboard → SQL Editor, rode o arquivo:
```
BackEnd/sql/001_route_history.sql
```

Cria:
- Tabela `route_history` (com RLS por user_id)
- Tabela `profiles` (perfil de usuário com tema/mapa preferido)
- Trigger automático criando profile ao registrar

## 2. Habilitar Email Auth

Supabase Dashboard → Authentication → Providers → Email:
- **Enable Email Provider**: ON
- **Confirm email**: OFF (TCC, deixar simples) ou ON (produção)

## 3. Criar `.env` no FrontEnd

```bash
cd FrontEnd
cp .env.example .env
```

Preencher com as credenciais do Supabase Dashboard → Settings → API:
```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

## 4. Instalar dependências novas

```bash
cd FrontEnd
npm install
```

Adiciona:
- `@supabase/supabase-js`
- `@iconify/react` (web only)
- `@react-native-async-storage/async-storage`
- `react-native-url-polyfill`
- `expo-linear-gradient`

## 5. Rodar

```bash
npx expo start
```

- Abre tela de login
- Registra → confirma email (se ON) → logado
- Tabs: **Mapa** · **Painel** · **Histórico** · **Perfil**

## 6. Backend — atualizar requirements

```bash
cd BackEnd/API
pip install -r requirements.txt   # adiciona httpx
```

Reiniciar API.

---

## Erros comuns

**"Invalid login credentials"** — registre o usuário primeiro em `/Register`.

**Histórico vazio mesmo após calcular rota** — verifique se SQL foi aplicado e RLS está habilitado. Olhe console do browser por erros `42501` (RLS policy).

**Web: "Não foi possível obter sua localização"** — geolocalização exige `https://` ou `http://localhost`. IP local (192.168.x.x) não funciona.

**Autocomplete vazio** — backend `/search/places` precisa do `.env` em `BackEnd/Servidor/config/.env` com SUPABASE_URL e SUPABASE_KEY (mesmas credenciais).
