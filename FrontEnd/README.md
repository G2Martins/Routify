<div align="center">
  <img src="assets/Logo_Routify.png" alt="Routify Logo" width="350"/>

  # Routify — Front-End (App Multiplataforma)

  <img src="https://img.shields.io/badge/React_Native-0.81-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React Native" />
  <img src="https://img.shields.io/badge/Expo-54-000020?style=for-the-badge&logo=expo&logoColor=white" alt="Expo" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
</div>

<br/>

## 📖 Sobre o App

Cliente do **Routify** rodando em **iOS, Android e Web** via Expo + React Native. Consome a `BackEnd/API` para roteamento A\* com pesos da LIA, mostra mapa interativo (Leaflet/web, react-native-maps/mobile), histórico de rotas, perfil e dashboard de métricas.

## 🏗️ Estrutura

```text
📦 FrontEnd
 ┣ 📂 assets/             # Logos, ícones
 ┣ 📂 src/
 ┃ ┣ 📂 components/       # MapComponent.web/native, SideRail, AddressAutocomplete...
 ┃ ┣ 📂 constants/        # Theme.ts (cores, tile URLs)
 ┃ ┣ 📂 context/          # AuthContext, ThemeContext
 ┃ ┣ 📂 lib/              # supabase client, responsive, api
 ┃ ┣ 📂 navigation/       # MainNavigator (tabs + auth stack)
 ┃ ┗ 📂 screens/          # Map, Dashboard, History, Profile, Login...
 ┣ 📜 App.tsx             # Entry point
 ┣ 📜 app.json            # Config Expo
 ┗ 📜 package.json
```

## 🚀 Como Iniciar

### 1. Pré-requisitos

- Node 18+ e npm
- Expo CLI (instalado automaticamente via `npx`)
- Para mobile: app **Expo Go** no celular OU emulador Android/iOS
- `BackEnd/API` rodando localmente em `http://localhost:8000`

### 2. Instalação

```bash
cd FrontEnd
npm install
```

### 3. Configurar variáveis de ambiente

Criar `.env` na raiz de `FrontEnd/`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://localhost:8000
```

> Em mobile físico, trocar `localhost` pelo IP da máquina (`http://192.168.x.x:8000`).

### 4. Rodar

| Plataforma | Comando |
|---|---|
| Web (browser) | `npm run web` |
| Android (emulador/Expo Go) | `npm run android` |
| iOS (simulador/Expo Go) | `npm run ios` |
| Tudo (escolher no terminal) | `npm start` |

Após `npm run web`, abrir `http://localhost:8081`.

## 🚨 Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `POSITION_UNAVAILABLE` no Edge mesmo com permissão | Edge usa `lfsvc` (Windows Geolocation Service) e ele está desligado | Admin CMD: `sc config lfsvc start=auto && sc start lfsvc`. Ou usar Chrome/Comet. Código já tem fallback IP. |
| `Tracking Prevention blocked access` no console | Edge "Strict" tracking | `edge://settings/privacy` → mudar para Balanced |
| `useNativeDriver is not supported` | Animated em web (sem RCTAnimation) | Warning benigno em react-native-web, ignorar |
| `Network request failed` ao chamar API | API não está rodando ou IP errado | Conferir `EXPO_PUBLIC_API_URL`. Em mobile físico, usar IP da rede, não `localhost` |
| `shadow* style props are deprecated` | RN 0.81+ migrou para `boxShadow` | Warning, não impede execução. Migração pendente em alguns componentes |
| Mapa branco / tiles não carregam | CDN Leaflet bloqueado ou offline | Verificar conexão. `MAP_TILE_URLS` em `constants/Theme.ts` permite trocar provider |
| `npm install` falha com peer-dep React 19 | Conflito de versão | `npm install --legacy-peer-deps` |
| Expo Go conecta mas tela branca | Cache antigo | `npx expo start --clear` |
| Erro 401 em chamadas Supabase | Sessão expirada | Sair → relogar (`AuthContext` recria token) |
| Rota não traça no mapa | Backend lento na 1ª req (cold start grafo OSM) | Aguardar 30-60s. Logs do API mostram progresso |
| `EXPO_PUBLIC_*` undefined em runtime | `.env` não recarregou | Reiniciar Expo (`Ctrl+C` → `npm run web`) |

## 🌐 Geolocalização (Web)

Cascata de fallback em [src/components/MapComponent.web.tsx](src/components/MapComponent.web.tsx):

1. **HIGH accuracy** (GPS, timeout 8s — 4s no Edge)
2. **LOW accuracy** (Wi-Fi/network, timeout 12s — pulado no Edge se HIGH falhar com `POSITION_UNAVAILABLE`)
3. **IP geolocation** (`ipapi.co`, `ipwho.is`, `bigdatacloud.net`, `geolocation-db.com` — precisão de cidade)

Edge requer `lfsvc` ativo (Windows). Chrome/Firefox/Comet usam Google Location API próprio.

<div align="center">
  <img src="assets/Logo_Routify.png" alt="Routify Logo" width="350"/>

 <i>Desenvolvido para o avanço em Cidades Inteligentes e Logística Preditiva.</i>
</div>
