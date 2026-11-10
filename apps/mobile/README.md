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

**Última revisão:** 2026-11-09

Cliente do **Routify** rodando em **iOS, Android e Web** via Expo + React Native. Consome a `apps/api` para roteamento A\* com pesos da LIA, fundido com a TomTom. Tem:
- mapa interativo: vetorial (MapLibre GL + OpenFreeMap) na web, com o Leaflet de reserva sem WebGL; react-native-maps no celular;
- **Planejar saída** (aba Planejar, `PlanejarScreen`): origem e destino pelo mesmo autocomplete do mapa, dia (hoje a +6)
  e período (manhã 6–12 h, tarde 12–18 h, noite 18–23 h). Abre numa janela útil (`escolhaPadrao` em `src/lib/planejar.ts`),
  nunca na madrugada, e o pedido sai sozinho (`POST /route/horarios`, espera 300 ms e guarda as respostas). O trajeto aparece
  no mapa pintado pelo `trafego` da saída escolhida; trocar de saída só refaz a pintura (`atualizarTrafego`). Colunas em
  `View` puro (`Colunas.tsx`): base = tempo sem trânsito, a melhor em destaque; clique, arrasto ou setas do teclado trocam
  a saída, com setas de 44 px para o dedo. Abaixo de 2 min de diferença a tela diz "Tanto faz o horário" em uma linha, sem
  gráfico. Desktop: painel e mapa lado a lado. Celular: o mapa só monta quando há resultado e fica fixo no topo;
- **Trânsito agora** (aba Trânsito, `TransitoScreen`): a previsão da LIA para este instante em cada ponto monitorado
  (`GET /trafego/agora`, atualiza a cada minuto com a tela aberta), pontos no mapa vetorial, faixa livre/moderado/lento/parado
  e as vias mais lentas. Tocar num ponto (alvo de 44 px em volta do dedo) ou numa linha abre `DetalhePonto`
  (`GET /trafego/ponto/{id}`): visão geral e, abaixo, histórico por hora, por dia da semana, últimos dias e últimas leituras.
  Painel lateral no desktop, folha de baixo no celular; Esc fecha;
- **Radares** (`BotaoRadares.tsx`, `src/lib/radares.ts`): camada nos três mapas, de `/radares_df.json` (OpenStreetMap), baixada
  quando o primeiro mapa abre. Ligar e desligar fica em `localStorage`, por conta. Sem o arquivo, ou no nativo, o botão não
  aparece. Nome e limite só entram como texto (`Popup.setText`). No card da rota (`NavigationPanel`), `radaresNaRota` lista
  os radares a até 15 m do traçado, na ordem do trajeto, com o limite de cada um e o limite médio (sem o sentido da via no
  arquivo, um canteiro estreito ainda pode contar o radar da pista oposta);
- **Fontes**: `assets/fontes/` é um subconjunto latino das Geist do `@expo-google-fonts` (566 → 202 KB; o app espera por
  elas antes de desenhar). O comando para refazer está no `App.tsx`; licença em `assets/fontes/OFL.txt`;
- histórico de rotas, perfil e dashboard de métricas.

**Ícones:** na web, `@iconify/react/offline` só desenha o que está em `src/constants/icones.json` (nada vai à rede;
o modo online punha SVG de terceiro no `innerHTML`). Usou ícone novo: `node scripts/icones.mjs`; o
`tests/icones.test.mjs` falha enquanto faltar. No celular, `@expo/vector-icons`.

**Design:** paleta da logo + linguagem Valerium. Tokens em `src/constants/Theme.ts`, peças prontas em `src/components/ui.tsx`, regras em [docs/core/design-system.md](../../docs/core/design-system.md).

**Navegação:** `BarraAbas` (celular) e o `SideRail` (desktop) acendem o item e a barra de progresso (`BarraNavegacao.tsx`) antes de
a tela nova montar. A barra anda por CSS, no compositor: não trava enquanto o mapa inicia. O atraso ao trocar de aba vinha de
(medido em 2026-11-09, CPU 4×): um laço em `AuthContext` que relia o perfil sem parar com a aba Perfil aberta (78 pedidos em 6 s),
`Surgir` em `Animated` (refazia o componente a cada quadro), entrada de 760 ms e esqueleto a cada volta ao Painel.

**Responsivo:** `useDesktopLayout` (≥ 900 px), `useTelaLarga` (≥ 600 px), `useAlvo` (44 px em toque, 34 no desktop com mouse),
`useFonteCampo` (16 px em toque: abaixo disso o Safari dá zoom ao focar). `Tela` (`ui.tsx`) é a casca das telas de conteúdo: rolagem,
área segura, teclado e voltar. `MapComponent` recebe `margem`: o vão que os painéis deixam livre, medido, é onde a rota enquadra. A
meta `interactive-widget=resizes-content` faz a janela encolher com o teclado no Android. `tests/e2e/tests/responsivo.spec.ts`
confere 360, 390, 768 e 1366 px. Acessibilidade: `aria-*`, porque o RN-web 0.21 ignora `accessibilityState`.

**Sessão:** na web, a sessão Supabase fica em **cookie** (`@supabase/ssr`; Secure em https, 30 dias), a mesma que o painel ADM (`/admin`) lê. O login é único, e o acesso ao "Painel ADM" (rail no desktop; Perfil e Painel no celular) aparece só para `app_metadata.role = admin`; a proteção real é no servidor. No celular, a sessão fica no AsyncStorage.

**Busca:**
- destinos recentes ao focar o campo, e os que casam com o texto vêm antes dos resultados;
- debounce de 250 ms com cancelamento, limite de 8 s, 429 respeitado, resposta guardada 5 min na memória, trecho digitado destacado;
- teclado: ↑ ↓ Enter Esc (Enter durante a busca espera a resposta nova) e a tecla "buscar" do celular escolhe;
- web: padrão combobox/listbox para leitor de tela; sem o histórico do navegador por cima da lista;
- eventos sem texto nem coordenada (LGPD).

**Login e verificação em duas etapas:**
- login e cadastro na linguagem de auth do Valerium: títulos em Geist leve, rótulo técnico em mono, cartão elevado,
  entrada `Surgir auth` (480 ms, 70 ms por item); erro genérico (não revela se a conta existe);
- Perfil → Segurança ativa o TOTP: QR na web (fundo branco fixo), "Abrir no app autenticador" e chave no celular;
  o primeiro código confirma. Quem ativou cai na etapa 2 (`MfaVerificarScreen`) depois da senha: `CodigoOtp`
  com envio automático, tremida no erro, pausa de 30 s depois de 5 erros e "Entrar com outra conta";
- em dev, `?preview=mfa` abre a etapa 2 sem sessão (só para ver a tela).

**Mapa:**
- web: MapLibre GL 5.24 com tiles vetoriais da [OpenFreeMap](https://openfreemap.org) (grátis, sem chave). O estilo
  `positron` é recolorido camada a camada com a paleta do app (`mapPalettes` em `constants/Theme.ts`, montagem em
  `components/mapa/estiloMapa.ts`): escuro, padrão e satélite híbrido (Esri + nomes), prédios em 3D a partir do zoom 14;
- rota com o gradiente da marca (azul → ciano → teal), brilho e contorno, desenhada do início ao fim; por cima, os trechos
  com trânsito (`trafego` da API: LIA onde há sensor, TomTom nos buracos) em âmbar, laranja e vermelho; um ponto de luz
  percorre a rota de tempos em tempos. Na navegação a câmera inclina 55° e segue o rumo;
- a linha sólida segue só a via; o trecho até o ponto escolhido e a alternativa da fusão LIA × TomTom aparecem tracejados;
- tudo respeita `prefers-reduced-motion`. Sem WebGL (ou se o estilo não carregar), cai no Leaflet
  (`MapaLeaflet.web.tsx`). O CSS do MapLibre vem do jsDelivr com SRI;
- celular: mapa escuro do Google com a mesma paleta (Android), brilho e trânsito por trecho na rota, marcadores próprios;
- desenvolvimento: `http://localhost:8081/?preview=mapa&de=lat,lon&para=lat,lon` abre o mapa sem login e já traça a
  rota (só com `__DEV__`; o export de produção não tem esse atalho);
- o painel mostra a fonte da rota, os semáforos e a comparação LIA × TomTom.

## 🏗️ Estrutura

```text
📦 apps/mobile
 ┣ 📂 assets/             # Logos, ícones
 ┣ 📂 public/             # copiado para / no export: index.html (molde do Expo, SEO), robots/sitemap/llms*.txt, og-image, ícones (docs/core/deploy.md §2.1)
 ┣ 📂 src/
 ┃ ┣ 📂 components/       # MapComponent.web/native, SideRail, AddressAutocomplete...
 ┃ ┣ 📂 constants/        # Theme.ts (cores, tile URLs)
 ┃ ┣ 📂 context/          # AuthContext, ThemeContext
 ┃ ┣ 📂 lib/              # supabase client, responsive, api
 ┃ ┣ 📂 navigation/       # MainNavigator (tabs + auth stack)
 ┃ ┗ 📂 screens/          # Map, Planejar, Dashboard, History, Profile, Login...
 ┣ 📜 App.tsx             # Entry point
 ┣ 📜 app.json            # Config Expo
 ┗ 📜 package.json
```

## 🚀 Como Iniciar

### 1. Pré-requisitos

- Node 18+ e npm
- Expo CLI (instalado automaticamente via `npx`)
- Para mobile: app **Expo Go** no celular OU emulador Android/iOS
- `apps/api` rodando localmente em `http://localhost:8000`

### 2. Instalação

```bash
cd apps/mobile
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Preencher com as credenciais do Supabase Dashboard → Settings → API:
```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://localhost:8000
EXPO_PUBLIC_ADMIN_URL=http://localhost:3000/admin   # em produção: /admin (mesmo domínio)
```

> Em mobile físico, trocar `localhost` pelo IP da máquina (`http://192.168.x.x:8000`).

### 4. Configurar autenticação e histórico (Supabase)

O app usa Supabase Auth (email/senha) e guarda o histórico de rotas por
usuário. Antes do primeiro login, rode no **Supabase Dashboard → SQL
Editor**, nesta ordem:
```
supabase/migrations/20260427000000_route_history.sql   ← tabelas route_history e profiles (com RLS)
supabase/migrations/20260907000000_thesis_validation.sql  ← colunas de instrumentação da Fase 3
```

E habilite o provedor de email: **Authentication → Providers → Email →
Enable Email Provider**. "Confirm email" pode ficar OFF para testar
localmente (liga o fluxo direto sem esperar confirmação por e-mail).

O autocomplete de endereços (`/search/places`) depende do backend, que por
sua vez lê `services/collector/config/.env` — mesmas credenciais do Supabase
usadas acima.

### 5. Rodar

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
| Mapa branco / tiles não carregam | OpenFreeMap ou jsDelivr bloqueados/offline | Verificar conexão. Sem o estilo vetorial o app cai no Leaflet (`MAP_TILE_URLS` em `constants/Theme.ts`) |
| `npm install` falha com peer-dep React 19 | Conflito de versão | `npm install --legacy-peer-deps` |
| Expo Go conecta mas tela branca | Cache antigo | `npx expo start --clear` |
| Erro 401 em chamadas Supabase | Sessão expirada | Sair → relogar (`AuthContext` recria token) |
| Rota não traça no mapa | Backend lento na 1ª req (cold start grafo OSM) | Aguardar alguns minutos na 1ª chamada. Logs do API mostram progresso |
| `EXPO_PUBLIC_*` undefined em runtime | `.env` não recarregou | Reiniciar Expo (`Ctrl+C` → `npm run web`) |
| `Invalid login credentials` | Usuário ainda não existe | Registre antes de logar (tela de cadastro) |
| Histórico de rotas vazio após calcular uma rota | SQL não aplicado ou RLS bloqueando | Rodar `supabase/migrations/20260427000000_route_history.sql`; conferir erro `42501` no console do navegador (política RLS) |
| Autocomplete de endereço não retorna nada | Backend sem `.env` configurado | Conferir `services/collector/config/.env` (`SUPABASE_URL`/`SUPABASE_KEY`) — usado pelo `/search/places` |
| Geolocalização falha na web com IP local (`192.168.x.x`) | Navegador exige contexto seguro | Geolocalização só funciona em `https://` ou `http://localhost` |

## 🌐 Geolocalização (Web)

Cascata de fallback em [src/components/mapa/geolocalizacao.ts](src/components/mapa/geolocalizacao.ts) (comum aos dois mapas web):

1. **HIGH accuracy** (GPS, timeout 8s — 4s no Edge)
2. **LOW accuracy** (Wi-Fi/network, timeout 12s — pulado no Edge se HIGH falhar com `POSITION_UNAVAILABLE`)
3. **IP geolocation** (`ipapi.co` — precisão de cidade)

Edge requer `lfsvc` ativo (Windows). Chrome/Firefox/Comet usam Google Location API próprio.

<div align="center">
  <img src="assets/Logo_Routify.png" alt="Routify Logo" width="350"/>

 <i>Desenvolvido para o avanço em Cidades Inteligentes e Logística Preditiva.</i>
</div>
