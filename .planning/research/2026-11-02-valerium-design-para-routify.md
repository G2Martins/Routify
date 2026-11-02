# Valerium → Routify: tokens, tipografia, motion, login, OTP/MFA e segurança de auth

**Última revisão:** 2026-11-02

Pedido do dono: o Routify deve adotar o visual do Valerium (outro produto dele): o mesmo estilo de animação e de efeitos, a mesma tipografia, as telas de login, as animações de OTP/MFA e as práticas de segurança de auth. Este documento é a especificação portátil para implementar isso no Routify (app Expo e painel Next).

**Como foi feito.** Leitura do código-fonte do repositório do Portal do Valerium (outra organização, somente leitura). **O app não foi executado**: todo valor vem do código, não de captura de tela. Onde a documentação do Valerium diverge do código, vale o código e está marcado (seção 1.4). Caminhos citados são relativos à raiz do repositório do Valerium. Nada aqui contém domínios, refs de projeto, chaves, e-mails ou dados de cliente (o repositório do Routify é público). Trechos de código do Valerium são curtos (≤ 25 linhas); os esboços da seção 8 são código novo para o Routify e **não foram executados**.

**Não copiar:** a marca do Valerium (logo "V", wordmark, textos "VL·26"), o texto de marketing e a copy literal. A linguagem visual e os números abaixo são o que se porta; o conteúdo é do Routify.

---

## 0. Resumo: o que portar primeiro

| # | O quê | Valores exatos | Custo |
|---|---|---|---|
| 1 | Gramática de entrada das telas de auth (`auth-rise`) | 480 ms, `cubic-bezier(0.16, 1, 0.3, 1)`, `translateY` 10 → 0 + opacidade 0 → 1, atraso de **70 ms** por item. O `Surgir` do Routify faz 760 ms / 12 px / 60 ms (equivale ao "materialize" do site): criar a variante de auth | baixo |
| 2 | Campo de código (`CodeEntry`) | 6 tiles 44×56 px (≥ 640 px: 48×64), raio 8, gap 8, "·" entre o 3º e o 4º; ativo sobe 2 px com borda `ring` + anel 2 px a 25 %; dígito entra em 220 ms (escala 0,55 → 1,08 → 1); caret 1,25 s; **erro: shake 420 ms** `cubic-bezier(0.36, 0.07, 0.19, 0.97)` com deslocamentos −2/4/−6/6/−6/6/−6/4/−2 px, limpa e refoca; barra varrendo 1,1 s enquanto verifica; selo de check no sucesso; envia sozinho no 6º dígito | médio |
| 3 | Cartão de login | raio 16, `surface`, borda 1 px, padding 24 (≥ 640: 32), sombra `0 24px 70px -40px rgba(0,0,0,.45)`; abas Entrar / Criar conta em pílula (`muted`, padding 4, abas de 36 px, pílula deslizante com spring bounce 0,2 / 0,5 s); título troca com fade ± 6 px em 180 ms; divisor "ou continue com" + botões sociais redondos de 48 px | médio |
| 4 | Tipografia só Geist | o Valerium **abandonou a Kalam em 2026-10-10** ("lia como rascunho"). Título de auth Geist 400, 24 px (≥ 1024: 30), wordmark 17 px / 500 / −0,03 em, eyebrow mono 11 px / caixa-alta / 0,16 em, dígitos mono 24 px tabulares. Decisão do dono (seção 8.7) | baixo |
| 5 | MFA TOTP com AAL2 de verdade | TOTP do Supabase, 10 códigos de recuperação `XXXXX-XXXXX` (single-use, hash no servidor), limite 10 tentativas / 10 min **fail-closed**, gate no proxy do admin **e no banco (`is_admin()`)**. O Valerium só barra no proxy do Next (a API aceita token aal1): não repetir a lacuna | alto |

**Riscos que viram bloqueio se ignorados** (detalhe na seção 8.5):

- `input-otp`, `framer-motion`, `@number-flow/react`, `lottie-react`, Radix e `tailwindcss-animate` são **somente DOM**. Não rodam no app nativo. O Routify já usa `Animated` do React Native; manter.
- O QR do TOTP exige `react-native-svg`, que **não está** no `package.json` do app. Verificar antes de prometer (`npx expo install react-native-svg`).
- Turnstile no nativo exige WebView; o Valerium só tem versão web.
- O SMTP padrão do Supabase não aguenta login por código de e-mail (limite baixo, entrega restrita): precisa de SMTP próprio (Resend). Conferir no painel do Supabase.
- `Animated` com `useNativeDriver: true` não existe na web (o Routify já isola com `NATIVO`).

---

## 1. Tokens

Fonte: `packages/ui/src/tokens.css` (único lugar com as variáveis; importado pelo layout raiz), `packages/ui/tailwind.config.ts`, `apps/dashboard/src/styles/base.css`. Regra do Valerium: componente usa classe Tailwind de token (`bg-background`, `border-border`…); **zero hex em componente** (exceções conhecidas: spinner, switch, checkbox).

### 1.1 Cores semânticas (HSL "h s% l%" sem `hsl()`, consumidas como `hsl(var(--x))`)

| Token | Light | Dark |
|---|---|---|
| `--background` | `45 29% 97%` (#FAF9F6, "paper" quente) | `0 0% 9%` (#171717, neutro sem tom azul) |
| `--foreground` | `45 6% 12%` (#21201D) | `0 0% 97%` (#F7F7F7) |
| `--card` / `--popover` | `43 26% 95%` (#F5F3EE) | `0 0% 12%` (#1F1F1F) |
| `--card-foreground` / `--popover-foreground` | `45 6% 12%` | `0 0% 97%` |
| `--primary` | `224 100% 43%` (#003ADD) | `224 100% 70%` (#668FFF) |
| `--primary-foreground` | `0 0% 100%` | `231 58% 14%` (#0F1539, AA sobre #668FFF) |
| `--secondary` | `43 20% 91%` | `0 0% 17%` (#2B2B2B) |
| `--secondary-foreground` | `45 6% 12%` | `0 0% 97%` |
| `--muted` | `45 18% 92%` | `0 0% 17%` |
| `--muted-foreground` | `44 5% 41%` (#6E6B63) | `0 0% 78%` (#C7C7C7) |
| `--accent` / `--accent-foreground` | `45 15% 93%` / `45 6% 12%` | `0 0% 17%` / `0 0% 97%` |
| `--destructive` | `0 75% 45%` | `0 84% 60%` (#EF4444) |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 100%` |
| `--border` | `45 21% 89%` (#E9E6DD) | `0 0% 26%` (#424242) |
| `--input` | `45 21% 89%` | `0 0% 17%` |
| `--ring` (foco, acento) | `224 100% 43%` | `224 100% 70%` |
| `--radius` | `0.5rem` | `0.5rem` |

Observação de composição: no claro, o `card` é **mais escuro** que o fundo (#F5F3EE sobre #FAF9F6): o cartão "afunda" em vez de flutuar. O Routify faz o oposto (cartão branco sobre #F6F8FB).

Tema: `next-themes`, `attribute="class"`, `defaultTheme="light"`, `enableSystem`, `disableTransitionOnChange` (`apps/dashboard/src/app/[locale]/providers.tsx`). Anti-flash em `base.css`: `html:not(.dark) { color-scheme: light; background-color: hsl(0 0% 100%) }` e `html.dark { color-scheme: dark; background-color: hsl(0 0% 9%) }`.

### 1.2 Tokens próprios (`--v-*`, marca, status)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--radius-card` | `0.75rem` | igual | cartões (`rounded-card`) |
| `--radius-button` / `--radius-input` | `0.5rem` | igual | |
| `--v-surface` | `45 18% 96%` | `0 0% 12%` | superfície |
| `--v-surface-elevated` | `45 11% 89%` | `0 0% 17%` | superfície elevada |
| `--v-text-secondary` | `0 0% 40%` | `0 0% 78%` | |
| `--v-text-muted` | `0 0% 60%` | `0 0% 65%` | |
| `--v-border-subtle` | `rgba(0,0,0,.06)` | `rgba(255,255,255,.08)` | |
| `--v-border-default` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.15)` | |
| `--v-accent-glow` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.10)` | |
| `--v-success` | `142 71% 38%` | `142 71% 45%` | |
| `--v-warning` | `38 92% 44%` | `38 92% 50%` | |
| `--v-danger` | `0 84% 55%` | `0 84% 60%` | |
| `--v-info` | `217 91% 55%` | `217 91% 60%` | |
| `--v-negative` | `10 68% 39%` | `9 67% 59%` | dado negativo (não é ação destrutiva); dessaturado de propósito, validado para daltonismo (ΔE 26 em protanopia) |
| `--v-ok` | `150 58% 32%` | `150 52% 52%` | estado OK, só traço fino/texto |
| `--v-shadow-card` | `0 1px 3px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06)` | `0 1px 3px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.08)` | `shadow-card` |
| `--v-shadow-card-hover` | `0 4px 16px rgba(0,0,0,.16), 0 0 0 1px rgba(0,0,0,.10)` | `0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.15)` | `shadow-card-hover` |
| `--v-transition` | `all .18s cubic-bezier(.4,0,.2,1)` | igual | (Tailwind: `duration-v` 180 ms, `ease-v-ease`) |
| `--grovic-blue` | `224 100% 43%` | `224 100% 70%` | acento de marca |
| `--grovic-blue-deep` | `231 58% 14%` (#0F1539) | igual | texto profundo sobre claro |
| `--sidebar-active` / `--sidebar-active-text` | `= grovic-blue` / `= deep` | `224 100% 70%` / `227 100% 78%` (#8FA8FF) | item ativo |
| `--status-paid` / `overdue` / `scheduled` / `refunded` / `muted-bg` | `0 201 105` / `255 208 43` / `31 111 235` / `249 115 22` / `242 241 239` (canais RGB, para `rgb(var(--x) / a)`) | iguais | únicos acentos de cor "viva" na UI logada |

### 1.3 Gráficos

Gráfico = cinza + **um** azul; negativo = vermelho dessaturado (não o `--destructive`).

| Token | Light | Dark |
|---|---|---|
| `--chart-1` (série 1) | `var(--grovic-blue)` | `var(--grovic-blue)` |
| `--chart-1-soft` (área) | `224 100% 43% / 0.14` | `224 100% 70% / 0.16` |
| `--chart-2` | `224 30% 60%` | `224 30% 55%` |
| `--chart-3` | `0 0% 55%` | `0 0% 55%` |
| `--chart-negative` | `0 62% 40%` | `0 55% 46%` |
| `--chart-negative-soft` | `0 62% 40% / 0.14` | `0 55% 46% / 0.16` |
| `--chart-grid` | `hsl(var(--border) / 0.4)` | igual |
| legado (hex): grade / eixo / linha de referência / previsão | `#e6e6e6` / `#707070` / `#e6e6e6` / `#666666` | `#2e2e2e` / `#808080` / `#3a3a3a` / `#aaaaaa` |
| legado: barra / barra secundária / gradiente (início → fim) | `#000000` / `#6666664d` / `#707070 → #000000` | `#ffffff` / `#6666664d` / `#666666 → #ffffff` |

### 1.4 Divergências doc × código (vale o código)

- `Docs/core/design-system.md` §1 lista `--primary` como `45 6% 12%` (claro) e `0 0% 100%` (escuro) e `--ring` escuro `0 0% 97%`. O `tokens.css` atual tem **`--primary` azul** (`224 100% 43%` / `224 100% 70%`) e `--ring` azul nos dois temas (mudou em 2026-10-12, quando o azul virou a cor do produto). A doc está defasada.
- `.marketing-theme` (só o site público, `apps/dashboard/src/styles/marketing.css`) ainda usa `--primary: 45 6% 12%` (quase-preto) e o acento azul fica em `--brand-accent`. O login, o MFA e o app logado usam o `:root` (primary azul). **Não misturar os dois ao portar.**

---

## 2. Tipografia

Fonte: `apps/dashboard/src/app/[locale]/layout.tsx`, `packages/ui/tailwind.config.ts`, `apps/dashboard/tailwind.config.ts`, `Docs/marketing/marketing-site.md`.

**Famílias.** Geist Sans (UI e títulos) e Geist Mono (eyebrows, dígitos, códigos). Pacote npm `geist` (`GeistSans.variable` → `--font-geist-sans`, `GeistMono.variable` → `--font-geist-mono`), fallback `system-ui, sans-serif` / `ui-monospace, monospace`. `body` usa `font-sans antialiased whitespace-pre-line overscroll-none`. Syne e Space Grotesk (Google, `display: swap`, `preload: false`) ainda existem como variável CSS mas **nenhuma tela de auth os usa**; o site mapeia o display para Geist. **Kalam e Hedvig foram removidas** (títulos `font-serif` apontam para Geist Sans). E-mail transacional: Geist self-hosted woff2 400/500/700.

| Papel | Valor | Onde |
|---|---|---|
| Título de auth | Geist 400, `text-2xl lg:text-3xl` = 24/32 px → 30/36 px (≥ 1024), cor `foreground`, sem tracking extra | `components/auth/login-card.tsx`, `components/verify-mfa.tsx` |
| Subtítulo | 14/20 px, `muted-foreground`, `mt-2` | idem |
| Wordmark (lockup) | 17 px / 500 / `tracking-[-0.03em]`; ícone 24 px; barra 1×20 px girada 20° (`bg-border`) | `login/page.tsx` |
| Eyebrow | Geist Mono 11 px, caixa-alta, `tracking-[0.16em]`, `muted-foreground` | `otp-sign-in.tsx`, `verify-mfa.tsx` |
| Rótulo do divisor | 11 px, caixa-alta, `tracking-widest` (0,1 em) | `login-card.tsx` |
| Dígitos do OTP | Geist Mono 24/32 px (`text-2xl`), `tabular-nums` | `components/auth/code-entry.tsx` |
| Título em cartão/diálogo | 18 px, 500, `leading-none tracking-tight` (−0,025 em) | `card.tsx`, `mfa-enroll-dialog.tsx` |
| Corpo | 14 px (`text-sm`); ajuda 12 px (`text-xs`); micro 9–11 px mono em objetos decorativos | geral |
| Título de seção (site) | `.mkt-h2`: peso 400, `letter-spacing: -0.045em`, `line-height: 1.05`, `text-wrap: balance`; 30 → 48 → 60 px | `marketing.css` |
| Headline do "ticket" | 28 px (1,75 rem) / 500 / `leading-[1.05]` / −0,04 em | `components/auth-showcase.tsx` |
| Código de recuperação | mono, 18 px, `uppercase tracking-[0.25em]`, campo `h-14` | `verify-mfa.tsx` |
| Números | mono + `tabular-nums`; moeda animada com NumberFlow (`currencyDisplay: narrowSymbol`) | `animated-number.tsx` |

Regras de estilo extraídas: pesos 400/500 (nada de 700 em tela de auth); tracking **negativo** em texto grande, **positivo** em texto pequeno em caixa-alta; mono só para "dado" (código, número, rótulo técnico).

---

## 3. Motion

Fontes: `apps/dashboard/src/styles/base.css`, `app.css`, `marketing.css`, `packages/ui/tailwind.config.ts`, `packages/ui/src/globals.css`, componentes citados.

### 3.1 Orçamento e tokens

- `base.css` (`:root`): `--motion-fast: 200ms`, `--motion-base: 350ms`, `--motion-slow: 550ms`, `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`.
- Tailwind: `ease-v-ease = cubic-bezier(.4,0,.2,1)`, `duration-v = 180ms`.
- Regras escritas nos comentários do código: (1) animar **só `opacity` e `transform`**; (2) `blur()` só em entrada única, ≤ 8 px (depois removido do hero por custo no celular); (3) estado de repouso **sempre visível** (o `opacity:0` mora dentro do keyframe); (4) chave de transição de rota = só o `pathname`, nunca a query string; (5) `prefers-reduced-motion` desliga entradas e loops.

### 3.2 Catálogo

Legenda de lib: **CSS** = keyframes/transition; **TW** = Tailwind (`tailwindcss-animate`); **FM** = framer-motion 12; **JS** = rAF/timer.

#### A. Telas de auth e OTP (o que importa para o Routify)

| Nome | Onde | Tempo / curva | Definição | Reduced-motion | Lib |
|---|---|---|---|---|---|
| `auth-rise` | login (passo do código), MFA, convite | 480 ms, `cubic-bezier(0.16,1,0.3,1)`, `both`, atraso `calc(var(--i) * 70ms)` | `from {opacity:0; transform:translateY(10px)} to {opacity:1; transform:translateY(0)}` | a classe só é definida dentro de `@media (prefers-reduced-motion: no-preference)`; fora disso nada anima e o conteúdo já está visível | CSS |
| `code-pop` | dígito digitado; selo de sucesso | 220 ms, ease-out-expo, `both` | `from {opacity:0; transform:scale(.55)} 60% {transform:scale(1.08)} to {opacity:1; transform:scale(1)}` | idem | CSS |
| `code-shake` | container dos tiles em erro | 420 ms, `cubic-bezier(0.36,0.07,0.19,0.97)`, `both` | `translateX`: 10 % e 90 % → −2 px; 20 % e 80 % → 4 px; 30 %, 50 %, 70 % → −6 px; 40 % e 60 % → 6 px | idem | CSS |
| `code-sweep` | barra sob os tiles em "verificando" | 1,1 s, `cubic-bezier(.4,0,.2,1)`, infinito | barra `w-1/3` anda `translateX(-100% → 100%)` dentro de trilha de 2 px (máx. 18 rem); trilha some/aparece em 300 ms de opacidade | idem | CSS |
| `caret-blink` | tile ativo | 1,25 s, ease-out, infinito | `0%,70%,100% {opacity:1}  20%,50% {opacity:0}` (caret 1×24 px `bg-foreground`) | **sem guarda** no código lido | TW |
| Estado do tile | cada tile | 200 ms ease-out | `transition-[transform,border-color,box-shadow,color]`; ativo: `-translate-y-0.5` + `border-ring` + `ring-2 ring-ring/25` | transição simples | TW |
| Flip 3D (`AuthFlipCard`) | alternar Entrar ↔ Criar conta | 600 ms, `cubic-bezier(0.25,0.46,0.45,0.94)` | `perspective: 1500px`; rotor `rotateY(0 ↔ 180deg)`, faces em `grid-area: 1/1` (rotor com a altura da mais alta), `backface-visibility: hidden`, face oculta `inert` + `aria-hidden` | `transition-duration: 0ms !important`; override de dev `?force-motion=1` | CSS |
| Troca de título | `LoginCard` | 180 ms | `AnimatePresence mode="wait" initial={false}`; `initial {opacity:0,y:6}` → `animate {opacity:1,y:0}` → `exit {opacity:0,y:-6}` | sem guarda explícita | FM |
| Pílula das abas | `LoginCard` | spring `bounce: 0.2`, `duration: 0.5` | `layoutId="login-tab-pill"`; `absolute inset-0 rounded-full bg-background border border-border shadow-sm` | sem guarda explícita | FM |
| Botão social | 5 botões redondos | 200 ms | hover: `-translate-y-0.5` + `border-foreground/40` + `shadow-sm`; desabilitado: `opacity-50` sem subir | transição simples | TW |
| Pressão de botão | `Button` | 200 ms ease-out | `active:scale-[0.98]`, `transition-all` | idem | TW |
| Botão tátil (`TactileButton`) | MFA (código de recuperação), CTAs do site | 150 ms, `cubic-bezier(0.23,1,0.32,1)` | base escura `depth` 5 px atrás; face desce 2 px no hover (só ponteiro fino) e `depth` no `active` | `motion-reduce:transform-none transition-none` | TW |
| Inclinação do ticket | painel esquerdo | 220 ms, `cubic-bezier(0.23,1,0.32,1)` | `perspective(1100px) rotateX/rotateY` até ±6°, `scale(1.018)`, 1 handler de `pointermove` por rAF | só roda sob `(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)` | JS |
| Spinner de envio | `SubmitButton` | 1 s linear | rótulo vira `invisible` (mantém largura) + spinner 20 px centralizado | n/a | TW |
| Medidor de senha | cadastro | `transition-colors`; checagem HIBP com debounce de 800 ms | 5 segmentos `h-1.5`, cor por nível | n/a | TW |
| Sucesso do MFA | `/mfa/verify` | `code-pop` | selo 20 px `bg-primary` com check 12 px (traço 3) + "Código confirmado"; depois navegação **completa** (`window.location.assign`) | idem | CSS |

#### B. Casca do app (referência; já existe equivalente no Routify)

| Nome | Onde | Tempo / curva | Definição | Reduced-motion | Lib |
|---|---|---|---|---|---|
| `route-enter` | troca de rota do app | 200 ms ease-out-expo, **sem fill-mode** | `from {opacity:0; transform:translateY(4px)}`; wrapper com `key={pathname}`; só a área de conteúdo | `animation: none` | CSS |
| Barra de rota | topo da página | 10 ms → 90 % em 600 ms ease-out; 180 ms → 100 % em 200 ms; some aos 600 ms | `fixed top-0 h-[2px] bg-foreground/80 z-[9999]` | n/a | JS |
| View Transitions | troca de rota/idioma | saída 120 ms ease-out, entrada 160 ms ease-in | `::view-transition-old/new(root)` + `experimental.viewTransition` | só sob `no-preference` | CSS |
| Diálogo | `dialog.tsx` | overlay 150 ms; conteúdo entra 200 ms e sai 150 ms | overlay `bg-black/70 backdrop-blur-[4px]`; conteúdo `translate(-50%, calc(-50% + 16px))` → centro (+opacidade); saída vai a +8 px | n/a | CSS |
| Popover / menu / select / tooltip | Radix | 150 ms (padrão do plugin) | `animate-in fade-in-0 zoom-in-95 slide-in-from-*-2` | n/a | TW |
| Sheet | `sheet.tsx` | abre 300 ms, fecha 200 ms | `slide-in-from-right` etc.; overlay `bg-background/60 dark:/80 backdrop-blur-sm` | n/a | TW |
| Toast | `toast.tsx`, `toaster.tsx` | 200 ms | entra `slide-in-from-right-full`; borda esquerda de 3 px por variante; duração: success 3000 ms, info 4000, default 5000, error/destructive 6000, progress/spinner sem fim; **1 toast por vez** | n/a | TW |
| Skeleton | `skeleton.tsx` | 2,5 s linear, infinito | `bg-gradient-to-r from-muted via-foreground/[0.08] to-muted`, `bg-[length:200%_100%]`, `backgroundPosition: 200% → -200%` | **sem guarda** no código lido | TW |
| Shimmer de texto | `text-shimmer.tsx` | 2 s linear, infinito | gradiente clipado no texto; `spread = len × 2 px` | n/a | FM |
| Reticências | `.loading-ellipsis` | 900 ms `steps(4,end)` | largura 0 → 1,25 em | n/a | CSS |
| Cascata da home | painel inicial | `home-rise` 0,55 s ease-out-expo (atraso `i × 60 ms`); barras `home-grow` 0,7 s (`i × 60 + 300 ms`); sparkline `home-draw` 0,95 s por `stroke-dashoffset`; área/delta `home-fadein` 0,6 s (`i × 60 + 520 ms`) | usa a propriedade `translate` (não `transform`) para não travar o `translateY(-1px)` do hover | só sob `no-preference` | CSS |
| Barras do hero | finanças | 300 / 350 / 400 ms | `scaleX(0 → 1)` com *hold* dentro do keyframe (sem fill-mode) | `animation: none` | CSS |
| Painel com halo | `.pulse-panel` | borda/transform 200 ms, halo 220 ms | hover: `translateY(-1px)`, borda `grovic-blue/.38`; halo `radial-gradient(260px circle at var(--mx) var(--my), grovic-blue/.11, transparent 62%)` seguindo o ponteiro | sem halo e sem `translateY`; borda ainda acende | CSS |
| Contagem | `useCountUp` | 800 ms, ease-out cúbico `1 − (1−t)³` | rAF 0 → alvo; só dispara quando `enabled` | pula direto ao alvo | JS |
| Números de moeda | `animated-number.tsx` | (lib) | `@number-flow/react`, `animated` só depois do primeiro valor ≠ 0 | n/a | lib |
| Troca de texto | `text-morph.tsx` | 300 ms easeOut | `{opacity:0,y:-6,blur(2px)}` → `{1,0,0}` → `{0,6,blur(2px)}` (`popLayout`) | n/a | FM |
| Largura animada | `animated-size-container.tsx` | spring, `duration: .3` | mede com ResizeObserver | n/a | FM |
| Indicadores deslizantes | menus/abas | spring `stiffness 500 / damping 40` (também 400/32, 400/25) | `layoutId` compartilhado | n/a | FM |
| Barra "salvando" | `saving-bar.tsx` | 200 ms easeOut | `y: 20 → 0`; fica 1500 ms em "salvo" e 3000 ms em "falhou" | n/a | FM |
| Check de conclusão | onboarding | spring `stiffness 380 / damping 22` | `scale .6 → 1` | `useReducedMotion` | FM |
| Modal de inatividade | `idle-session-guard.tsx` | n/a | alerta aos 25 min, contagem regressiva | n/a | Radix |

#### C. Site de marketing (baixa prioridade para o Routify)

`mkt-rise` 700 ms (`translateY 40 px`), `mkt-materialize` 800 ms (`translateY 14 px`), `mkt-mask-rise` 600 ms (`translateY 110 % → 0` dentro de máscara `overflow:hidden`, por palavra), `mkt-panel-settle` 950 ms (`perspective(1200px) rotateX(7deg) scale(.95) translateY(28px) → 0`), `mkt-wipe` 700 ms (`scaleX`), `mkt-route-enter` 350 ms (`translateY 8 px`), sublinhado de link 200 ms (`scaleX` a partir da esquerda), `mkt-tab-progress` 5 s linear. Todos com `both` e curva ease-out-expo; sob reduced-motion viram `animation:none; opacity:1; transform:none`. `Reveal` (`components/marketing/reveal.tsx`): IntersectionObserver de disparo único (`threshold .15`, `rootMargin 0 0 -10% 0`), `rise` = `opacity-0 translate-y-4` em 350 ms, `materialize` = `scale .97` em 550 ms, stagger limitado ao 8º item. `ScrambleText` (32 ms por passo, texto final de imediato sob reduced-motion e no 1º render para SSR). `ReceiptPrinter` (cena de "configuração" do onboarding: keyframes escalonados `translateY(-100% → 0)`, curvas `[0.23,1,0.32,1]` e `[0.77,0,0.175,1]`). Em 2026-09-13 o site saiu do framer-motion para CSS (−145 KB de JS por página).

### 3.3 Como o reduced-motion é tratado (padrões a copiar)

1. A classe de animação só existe dentro de `@media (prefers-reduced-motion: no-preference)`. Trecho de `apps/dashboard/src/styles/app.css`:

   ```css
   @media (prefers-reduced-motion: no-preference) {
     .auth-rise {
       animation: auth-rise 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
       animation-delay: calc(var(--i, 0) * 70ms);
     }
     .code-pop   { animation: code-pop 220ms cubic-bezier(0.16, 1, 0.3, 1) both; }
     .code-sweep { animation: code-sweep 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
     .code-shake { animation: code-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
   }
   ```

2. Repouso visível: `opacity:0` só dentro do `@keyframes`; `route-enter` nem usa `fill-mode`.
3. Classes com `opacity:0` na base (`mkt-*`) são resetadas no bloco `reduce` (`opacity:1; transform:none; filter:none`).
4. JS: `matchMedia` (count-up, scramble, inclinação do ticket), `useReducedMotion` (framer), variantes `motion-reduce:` e `motion-safe:` do Tailwind.
5. Lacunas do Valerium (não copiar): `caret-blink`, `shimmer`, troca de título e pílula de abas (framer) não têm guarda.

O Routify já cobre isso: `useMenosMovimento()` nos componentes e `animation-duration: .01ms !important` global na web (`App.tsx`).

### 3.4 Bibliotecas

framer-motion `^12.38` (dashboard) / `^12.34` (ui), `tailwindcss-animate ^1.0.7` com Tailwind 3.4.19, `input-otp ^1.4.2`, `@number-flow/react ^0.6.0`, `lottie-react ^2.4.1` (**só** no diálogo de sincronização bancária, não no login), `qrcode ^1.5.4`, `@marsidev/react-turnstile ^1.5.2`, `next-themes ^0.4.6`, `geist ^1.7`, `lucide-react`. Next 16.3, React com Compiler.

---

## 4. Efeitos

| Efeito | Valor exato | Onde |
|---|---|---|
| Overlay de diálogo (vidro) | `bg-black/70 backdrop-blur-[4px]` | `dialog.tsx` |
| Overlay de sheet | `bg-background/60` (escuro `/80`) + `backdrop-blur-sm` | `sheet.tsx` |
| Tooltip / barra "salvando" | `backdrop-blur-lg`; barra `bg-[rgba(247,247,247,.85)]` (escuro `rgba(19,19,19,.7)`), borda 1 px, `rounded-full` | `tooltip.tsx`, `saving-bar.tsx` |
| Cartão de login | `rounded-2xl` (16) `border border-border bg-card p-6 sm:p-8 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.45)]` | `login-card.tsx` |
| Moldura "poço" | externa `rounded-[18px] border bg-muted p-1.5`; interna `rounded-[13px] border border-b-2 bg-background` (borda inferior de 2 px = peso físico); no site, `.mkt-card` desenha o poço com anéis `0 0 0 6px muted, 0 0 0 7px border` | `auth-showcase.tsx`, `marketing.css` |
| Grade de pontos | `radial-gradient(circle, hsl(var(--foreground) / 0.06) 1px, transparent 1px)`, `background-size: 22px 22px` | `auth-showcase.tsx` |
| Sombra do ticket | `drop-shadow(0 1px 1px rgb(15 15 15 / 10%)) drop-shadow(0 18px 26px rgb(15 15 15 / 13%))` (selo: `12%` e `0 12px 22px / 9%`) | `kitchen/ticket.tsx`, `stamp.tsx` |
| Brilho do papel | `linear-gradient(145deg, rgb(255 255 255 / 12%), transparent 42%)` sobre a cor (selo `34%`) | idem |
| Recorte do ticket | `clip-path: polygon(...)` com entalhes laterais de 13 px e linha de rasgo `border-b border-dashed border-current opacity-30` | `kitchen/ticket.tsx` |
| Perfuração do selo | polígono gerado: 12 × 15 dentes, profundidade 2,4 % | `kitchen/stamp.tsx` |
| Botão tátil | face `color-mix(in oklab, foreground 86%, background)`, base `foreground`, realce interno `inset 0 1px 0`, borda interna 1 px a 35 % da base | `kitchen/tactile-button.tsx` |
| Gradiente de marca (site) | `linear-gradient(90deg, #001C80 0%, #003ADD 55%, #668FFF 100%)` (`227 100% 25%` → `224 100% 43%` → `224 100% 70%`), **sempre esquerda → direita**, orçamento fechado: hairline do header, `<em>` do h1, 1º divisor | `marketing.css` |
| Sombras do site (claro) | `--sh-xs 0 1px 2px rgba(33,32,29,.05)` · `--sh-sm 0 1px 3px .07, 0 1px 2px .04` · `--sh-md 0 4px 12px .08, 0 2px 4px .05` · `--sh-lg 0 12px 32px .12, 0 4px 8px .06`; no escuro profundidade = borda, sombras `none` | `marketing.css` |
| CTA do site (claro) | `0 4px 14px hsl(accent / .25)`, hover `0 6px 20px / .30` | `.mkt-cta` |
| Grão de papel | SVG `feTurbulence` (`baseFrequency .85`, `numOctaves 2`), alfa **0,02**, só no claro, em `:root:not(.dark)` como `background-image` | `tokens.css` |
| Foco | login/OAuth: `focus-visible:ring-2 ring-primary/40`; tile do código: `border-ring` + `ring-2 ring-ring/25`; site: `outline: 2px solid hsl(--brand-accent); offset 2px`; botão tátil: `outline-2 outline-offset-2` em `--ring` | vários |
| Glow | halo do `pulse-panel` (seção 3.2-B); glow do hero do site mais fraco no claro | `app.css`, `marketing.css` |
| Marcas de canto | `.mkt-ticks`: cantos de 9 px, 1 px, `foreground/.35`, deslocados −5 px | `marketing.css` |
| Fundo do login | **não há imagem**. O fundo é `bg-background`; a metade esquerda é a cena `AuthShowcase`. Os arquivos `public/assets/bg-login*.jpg` (herança do fork Midday, ~600 KB) **não são referenciados** por nenhum código; o Lottie `setup-animation*.json` só aparece no diálogo de sincronização bancária | `login/page.tsx` |

Alertas de implementação (inferidos do CSS; não conferi no navegador):

- O grão em `:root:not(.dark)` fica **debaixo** do `body { background: hsl(var(--background)) }` opaco, então provavelmente não aparece. O painel ADM do Routify já faz o certo (`body::before` fixo com opacidade): usar esse modelo.
- `Input` e `Button` (variantes `outline`/`ghost`) usam `border-white/25` e foco `border-white/60`: pensados para o escuro. No claro a borda quase some, e `*:focus { outline: none }` é global. **Não copiar** o `Input` do Valerium; o do Routify (borda `border`, foco `accent` + anel 3 px) é melhor.

---

## 5. Tela de login

Fontes: `apps/dashboard/src/app/[locale]/(public)/login/page.tsx` (página, Server Component) e, em `apps/dashboard/src/components/`: `auth/login-card.tsx`, `auth/auth-flip-card.tsx`, `otp-sign-in.tsx`, `password-sign-in.tsx`, `auth/oauth-icon-button.tsx`, `auth/password-meter.tsx`, `auth/code-entry.tsx`, `auth-showcase.tsx`, `captcha-widget.tsx`. Hook: `hooks/use-oauth-sign-in.ts`. Ação: `actions/verify-otp-action.ts`. Callback: `app/api/auth/callback/route.ts`.

### 5.1 Anatomia (tela dividida)

```text
┌───────────────────────── min-h-screen · flex · bg-background ─────────────────────────┐
│ [marca 24px] | Valerium            (fixo no topo, z-50, não bloqueia cliques)          │
│ ┌── esquerda (≥1024px) ──────┐   ┌── direita ───────────────────────────────────────┐ │
│ │ lg:w-1/2 · h-screen        │   │ lg:w-1/2 · centralizada · p-6 sm:p-8 lg:p-12     │ │
│ │ sticky · p-2 · pt-16       │   │ ┌──────── max-w-md (448px) ──────────────────┐   │ │
│ │ ┌ poço r18 (bg-muted p6) ┐ │   │ │ título (troca em fade) + subtítulo         │   │ │
│ │ │ ┌ r13 · grade 22px ──┐ │ │   │ │ ┌ cartão r16 ───────────────────────────┐  │   │ │
│ │ │ │  ticket + selo     │ │ │   │ │ │ [ Entrar | Criar conta ] pílula       │  │   │ │
│ │ │ └────────────────────┘ │ │   │ │ │ formulário (código OU senha)          │  │   │ │
│ │ └────────────────────────┘ │   │ │ │ ───── ou continue com ─────           │  │   │ │
│ └────────────────────────────┘   │ │ │ (G) (M) (S) (in) [(Ap)]  48px         │  │   │ │
│                                  │ │ └───────────────────────────────────────┘  │   │ │
│                                  │ │ link: alternar entrar/criar conta          │   │ │
│                                  │ └────────────────────────────────────────────┘   │ │
│                                  │ termos · privacidade (text-xs, fim da coluna)    │ │
│                                  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Abaixo de 1024 px a cena some; ficam o lockup fixo no topo e a coluna do formulário.

| Peça | Medidas e classes |
|---|---|
| Lockup (marca + barra + wordmark) | `fixed inset-x-0 top-0 z-50`, padding `py-3 xl:py-4 px-4 xl:px-6 2xl:px-8`; ícone 24 px (cor `--ring` no claro, `foreground` no escuro); barra `h-5 w-px rotate-[20deg] bg-border`; wordmark 17 px / 500 / −0,03 em; hover `opacity-80` 200 ms |
| Coluna esquerda | `hidden lg:flex lg:w-1/2 h-screen p-2 pt-16 sticky top-0` |
| Coluna direita | `w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-8 lg:p-12 pb-4 sm:pb-2`; miolo `max-w-md`, `flex-1 justify-center py-10`; rodapé legal `mt-auto text-xs` com links sublinhados |
| Bloco do título | `text-center mb-8 min-h-[72px]` (altura fixa evita salto na troca) |
| Cartão | seção 4 (`rounded-2xl`, borda, `p-6 sm:p-8`, sombra longa e suave) |
| Abas (`role="tablist"`) | `grid grid-cols-2 bg-muted rounded-full p-1 mb-8`; aba `h-9 rounded-full text-sm`; ativa `text-foreground font-medium`, inativa `text-muted-foreground hover:text-foreground`; pílula `bg-background border border-border shadow-sm` |
| Campos | sem rótulo visível (só placeholder); e-mail `autoCapitalize/autoCorrect/spellCheck` desligados; senha com olho (`Eye`/`EyeOff` 16 px, `absolute right-2`, `aria-pressed`, `tabIndex -1`); espaçamento `space-y-4` (código) / `space-y-3` (senha) |
| Botão principal | `SubmitButton` azul sólido `bg-primary` (texto `text-secondary`), `h-[40px] w-full`, `rounded-lg text-sm font-medium`, `active:scale-[0.98]`; carregando = rótulo invisível + spinner |
| Links secundários | `text-sm text-muted-foreground hover:text-foreground`: "Prefere entrar com senha?" ↔ "Entrar com link mágico" (alterna o formulário do passo 1); "Ainda não tem conta? Cadastre-se" ↔ "Já tem conta? Entrar" |
| Divisor | `my-8`; linha `border-t border-border`; rótulo central `px-3 bg-card text-[11px] uppercase tracking-widest` |
| Sociais | `flex justify-center gap-4`; Google, Outlook (Azure), Slack, LinkedIn + Apple só em dispositivo Apple (detectado no servidor pelo user-agent); botão `h-12 w-12 rounded-full border border-border bg-background`, ícone 18 px; ponto de "último usado" `h-3 w-3 rounded-full bg-primary border-2 border-card` em `-top-1 -right-1`; cada botão tem `aria-label` e `title` ("Continuar com X") |

**Cena da esquerda (`AuthShowcase`)**: "poço" com grade de pontos e objetos de papel. `welcomeBack`: ticket `w-64 aspect-[5/8] -rotate-3` em azul de marca com tinta branca (corpo: rótulos mono de 9 px, marca de 34 px, headline de 28 px; canhoto de 26 % com código de barras de 21 barras, 28 px de altura), mais um selo postal `w-32 rotate-[8deg]` na quina (`-right-20 -top-12`). `verify`: ticket de papel (`card`) girado 2° e selo azul girado −6°. O ticket inclina com o ponteiro (seção 3.2-A). Sem rede e sem tRPC.

### 5.2 Estados

| Estado | Comportamento |
|---|---|
| Ocioso | formulário do passo 1 (e-mail para receber código); foco no campo |
| Enviando | botão desabilitado, rótulo invisível (mantém largura), spinner centralizado; captcha reseta após cada tentativa |
| Código enviado | o formulário vira: eyebrow "Código enviado para" + e-mail mascarado (`j•••@dominio`: só a 1ª letra) + `CodeEntry` + "Não recebeu o email? Reenviar código" (volta ao passo do e-mail; **sem cronômetro**) |
| Verificando código | tiles travados, barra varrendo, spinner 14 px + "Verificando..." |
| Código errado | shake + limpa + refoca; texto `text-destructive` na linha de status (`aria-live="polite"`); a mensagem vem do servidor |
| Senha errada | `text-sm text-destructive font-medium` com a mensagem crua do Supabase (⚠ pode revelar "e-mail não confirmado"; o Routify já usa mensagem genérica, manter) |
| Conta bloqueada | antes de tentar a senha consulta o bloqueio e mostra "Muitas tentativas falhadas. Tente novamente em N minuto(s), ou redefina sua senha…"; se a API do bloqueio cair, **falha aberta** (não impede login legítimo) |
| Limite de taxa | tRPC `TOO_MANY_REQUESTS` (OTP, MFA, portal); no login por senha o limite do próprio Supabase volta como mensagem do `signInWithPassword` |
| Captcha pendente | botão desabilitado até haver token; "Complete o desafio de captcha." se tentar enviar |
| Cadastro por senha | `PasswordMeter` + política; sem sessão → "Verifique seu email" (confirmação); com sessão → `/mfa?enroll=1` |
| Falha de OAuth | uma linha `text-xs text-destructive role="alert"` abaixo da fileira; o botão fica com `border-destructive` |
| Erro de callback | banner no topo (`?error=auth_callback`): `border-destructive/40 bg-destructive/10 rounded-lg px-4 py-3 text-center role="alert"`; qualquer exceção na rota de callback cai aqui |
| Sessão ociosa | `?reason=idle` → aviso neutro `border-border bg-muted/50 role="status"` |
| Sucesso / redirecionamento | senha: `router.replace(returnTo)` + `router.refresh()`; código: a Server Action valida e faz `redirect()`; OAuth/link: o callback troca o `code` por sessão e redireciona: convite, convite de time, onboarding (se faltar nome ou time) ou `/`, nessa ordem |

**"Lembrar dispositivo": não existe.** O que há é sessão persistente do Supabase, um cookie de preferência do último método de login (1 ano, só para o ponto "último usado") e o timeout por inatividade de 30 min (seção 7). **"Esqueci a senha": não há link no login do Valerium**; o login por código já faz o papel (a rota `forgotPassword` existe na API, mas nenhuma tela a chama). O Routify tem o link e deve manter.

### 5.3 Tom do texto (pt-BR)

Frases curtas, voz de "você", sem exclamação, sem jargão, sem ponto final em subtítulos. Padrão a seguir (adaptar ao Routify, não copiar literal): título "Bem-vindo de volta" / "Crie sua conta"; subtítulo de uma linha ("Acesse sua conta…", "Comece em poucos minutos"); divisor "ou continue com"; erro de provedor "Não foi possível entrar com {nome}. Tente novamente ou use outra opção."; bloqueio com minutos restantes e o caminho de saída; MFA: eyebrow técnico em mono ("Etapa 2 de 2 · Verificação em duas etapas"), título curto ("Confirme que é você."), lead que cita apps conhecidos, dica "o código muda a cada 30 segundos… confira se o horário do celular está no automático", erro que diz **o que fazer** ("Espere o próximo código no app e tente de novo"), saída ("Entrar com outra conta").

### 5.4 Outras telas que reusam o layout

`/mfa/verify` (cena `verify`), onboarding (cenas `welcome`, `segments`, `setup`), convite (`invite/[token]`) e portal do cliente (`p/[portalId]`, cartão simples `max-w-sm` sobre fundo pontilhado `dotted-bg`) usam o mesmo `CodeEntry` e a mesma entrada `auth-rise`.

---

## 6. OTP e MFA

### 6.1 Componente de código (`components/auth/code-entry.tsx`)

- Biblioteca: `input-otp` (`OTPInput`). **Um único `<input>` transparente** sobreposto aos tiles: colar, preenchimento automático do e-mail/SMS, apagar e setas funcionam nativamente; "auto-avanço" é inerente (não existem N campos). `inputMode="numeric"`, `pattern=REGEXP_ONLY_DIGITS`, `autoComplete="one-time-code"`, `maxLength=6`, `autoFocus`, `aria-label`.
- API: `onComplete(code)` dispara no último dígito (inclusive por colagem) e **quem chama verifica** (o componente só enxerga dígitos); `status: "idle" | "verifying" | "error" | "success"`; `errorMessage`, `verifyingLabel`, `successLabel`, `length=6`, `disabled`.
- Erro: ao entrar em `error` limpa o valor, zera `touched` e refoca o input; se a pessoa digitar de novo, os tiles voltam ao visual `idle` mesmo que o pai ainda não tenha limpado o erro.
- Trava (`disabled`) enquanto `verifying` ou `success`.
- Separador "·" depois do tile `floor(length / 2)`; linha de status `min-h-[1.5rem]` com `aria-live="polite"` (sem pulo de layout).
- Tile (trecho de `code-entry.tsx`):

```tsx
className={cn(
  "relative flex h-14 w-11 items-center justify-center rounded-lg border bg-card font-mono text-2xl tabular-nums text-foreground sm:h-16 sm:w-12",
  "shadow-[inset_0_-2px_0_hsl(var(--border))] transition-[transform,border-color,box-shadow,color] duration-200 ease-out",
  isActive && status === "idle" &&
    "-translate-y-0.5 border-ring shadow-[inset_0_-2px_0_hsl(var(--ring))] ring-2 ring-ring/25",
  status === "verifying" && "border-foreground/30 text-foreground/70",
  status === "error" &&
    "border-destructive text-destructive shadow-[inset_0_-2px_0_hsl(var(--destructive))]",
  status === "success" &&
    "border-primary text-primary shadow-[inset_0_-2px_0_hsl(var(--primary))]",
  !isActive && status === "idle" && "border-border",
)}
```

- Dígito: `<span key={char} className="code-pop">` (a `key` refaz a animação a cada troca). Caret falso: `h-6 w-px bg-foreground` com `animate-caret-blink` só no tile ativo em `idle`.
- Borda inferior interna de 2 px (`inset 0 -2px 0`) é a "borda tátil": muda de cor com o estado (border → ring → destructive → primary).

### 6.2 Login por código de e-mail

1. `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origem>/api/auth/callback[?return_to=…], captchaToken? } })`. O **mesmo e-mail traz link e código de 6 dígitos** (template com `{{ .Token }}`). Configuração do Supabase usada: `mailer_otp_length = 6`, validade 15 min (`mailer_otp_exp`), templates gerados em código.
2. Validação de e-mail com zod (`.email()`) e recusa de `+` no endereço (política anti-alias do Valerium; opcional para o Routify, que pode precisar de aliases de teste).
3. Passo do código → `verifyOtpAction` (Server Action): consulta bloqueio → `verifyOtp({ email, token, type: "email" })` → `getUser()` (confirma que há sessão; `getSession()` só leria o cookie) → grava a tentativa → define o cookie de preferência → `redirect(sanitizeRedirectPath(redirectTo))`.
4. **Não há estado de sucesso visual** no login por código (o servidor redireciona). O selo de sucesso só existe no MFA e no convite.

### 6.3 Cadastro do TOTP (`components/auth/mfa-enroll-dialog.tsx`, `mfa-qr-code.tsx`, `mfa-settings.tsx`)

Quatro estados: `begin → verify → backup`, com `error` voltando ao início. Usado após o cadastro por senha (`/mfa?enroll=1`) e em Configurações → Segurança (dentro de `Dialog`).

1. **begin**: título, descrição, "por que é obrigatório" (NIST 800-63B: senha de 8 caracteres só é aceitável com MFA) e botão "Continuar". O servidor remove fatores `unverified` abandonados antes (o Supabase recusa nome repetido com 422) e cria o fator `totp` com `friendly_name` e `issuer` (nome mostrado no app autenticador).
2. **verify**: QR de 256 px em cartão **sempre branco** (`rounded-2xl bg-white p-3 text-black ring-1 ring-border`, entra com `animate-in fade-in-0 zoom-in-95 duration-300`); `<details>` "Não consegue escanear?" com a chave em grupos de 4 (`select-all`, mono); campo de 6 dígitos (`Input` comum, filtra `\D`) e botão "Verificar e ativar" desabilitado até 6 dígitos. **Sem auto-envio e sem `CodeEntry` aqui** (inconsistência do Valerium; o Routify deve usar o mesmo componente em tudo).
3. Depois do verify o navegador chama `refreshSession()` para carregar `aal2` já (no Valerium a verificação passa pelo servidor com o JWT do usuário; com `supabase-js` direto no cliente isso não é necessário).
4. **backup**: 10 códigos em grade de 2 colunas (`bg-muted rounded-md p-3 font-mono text-sm`), aviso em vermelho "não serão mostrados novamente", botão "Baixar como .txt" (Blob com cabeçalho e nota), "Concluir". Se já existem códigos não usados, **não gera novos** e avisa que continuam válidos.
5. **QR próprio** (`mfa-qr-code.tsx`): gerado da URI `otpauth://` com a lib `qrcode` (`QRCode.create`, correção de erro **H**); módulos como quadradinhos de 0,5 com traço 0,5 e junta redonda; "olhos" (finders) com cantos arredondados (raios 2,2 e 1,4, miolo 3×3 rx 1); zona de silêncio de 4 módulos; buraco central de 22 % com a marca (≈ 5 % do símbolo); desenhado em `currentColor` sem fundo (o contêiner dá o contraste). Motivo: o SVG que o Supabase devolve não tem zona de silêncio e tem fundo transparente, e a câmera do celular falha no tema escuro. Comentário no código: pontos redondos foram descartados porque derrubaram a taxa de leitura do jsQR de 20/31 para 14/31.
6. **Códigos de recuperação**: 10 por usuário, formato `XXXXX-XXXXX`, alfabeto Crockford base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 10 caracteres de `randomBytes(10) & 0x1f` (50 bits cada). Servidor guarda `SHA-256` (índice único no hash; tabela `user_mfa_backup_codes` com RLS ligada e **sem políticas**: só service-role). Uso único (`used_at`). Validação por regex `^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$`.

### 6.4 Desafio no login (`/mfa/verify`)

Arquivos: `app/[locale]/(app)/mfa/verify/page.tsx` (layout dividido igual ao login, cena `verify`) e `components/verify-mfa.tsx`. (A página `app/[locale]/(public)/mfa/` só serve para o cadastro forçado; o ramo de desafio dela é legado, com `Input` simples.)

- Entrada escalonada `auth-rise`: eyebrow `--i:0`, título `--i:1`, lead `--i:2`, cartão `--i:3`, "Entrar com outra conta" `--i:4`. Cartão: `rounded-2xl border border-border bg-card p-6 sm:p-8` com a mesma sombra longa do login.
- `CodeEntry` envia sozinho no 6º dígito. A verificação lista os fatores TOTP `verified` e **tenta cada um** (`challenge` + `verify`), porque o código só vale para o autenticador de origem; o primeiro que passa vale.
- Sucesso: `status="success"` (selo + "Código confirmado") e **navegação completa** com `window.location.assign(returnTo)`. Motivo documentado: em produção o Next faz prefetch da rota de destino com o cookie pré-MFA (aal1), o proxy responde com redirect de volta ao `/mfa/verify`, e um `router.push()` repete esse redirect em cache (spinner eterno até F5). Específico do Next; no Expo o equivalente é reler a sessão antes de navegar.
- Modo recuperação (link "Sem acesso ao app? Use um código de recuperação"): campo mono maiúsculo `h-14 text-center text-lg uppercase tracking-[0.25em]`, `maxLength=11`, `TactileButton` "Verificar" (desabilitado com < 11 caracteres). O servidor consome o código e **apaga todos os fatores TOTP** do usuário pela Admin API (a sessão cai para aal1 = MFA desativado até reativar); depois `refreshSession()` e redireciona. Texto avisa isso antes.
- Sem acesso a nada: "Entrar com outra conta" faz `signOut` e vai ao login. Prefetch do link da marca é desligado (`prefetch={false}`) pelo mesmo motivo.

### 6.5 Onde o AAL2 é exigido

1. **Proxy do dashboard** (`apps/dashboard/src/proxy.ts`), para toda requisição autenticada que passa pelo matcher (exclui estáticos e `/api`):

   ```ts
   const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
   if (
     mfaData &&
     mfaData.nextLevel === "aal2" &&
     mfaData.nextLevel !== mfaData.currentLevel &&
     newUrl.pathname !== "/mfa/verify"
   ) {
     const mfaUrl = new URL("/mfa/verify", ORIGIN);
     if (encodedSearchParams) mfaUrl.searchParams.append("return_to", encodedSearchParams);
     return NextResponse.redirect(mfaUrl);
   }
   ```

   `nextLevel === "aal2"` só ocorre quando existe fator verificado: quem **não** tem MFA nunca é barrado aqui.
2. **API** (`apps/api/src/utils/auth.ts`): o JWT é verificado com JWKS e o claim `aal` vai para a sessão. Só o `platformProcedure` (console de desenvolvedores da própria Grovic) exige:

   ```ts
   // apps/api/src/trpc/init.ts
   if (!userId || !(await isPlatformStaff(db, userId))) {
     throw new TRPCError({ code: "NOT_FOUND", message: `No procedure found on path "${opts.path}"` });
   }
   if (session.aal !== "aal2") {
     throw new TRPCError({ code: "PRECONDITION_FAILED", message: "mfa_required" });
   }
   ```

3. **Layout do console** repete a checagem com `getAuthenticatorAssuranceLevel()` e mostra um cartão (ícone de escudo, texto, botão): "confirmar agora" (`/mfa/verify`) se há fator, "ativar" (Configurações → Segurança) se não há.
4. **Lacuna (não copiar):** o `protectedProcedure` comum **não checa `aal`**. Quem tem MFA ativo e só passou a senha (aal1) é barrado pela navegação do Next, mas um token aal1 chamando a API direto passa. Pela própria "regra zero" do Valerium (não confiar no frontend) isso é um buraco. Não há RLS por `aal` também.

### 6.6 Usuário sem MFA numa área protegida

- Área comum: nada acontece. MFA é "empurrado" apenas após o cadastro por senha (`/mfa?enroll=1`), sem trava depois: a pessoa pode sair da tela.
- Console da plataforma: o cartão do layout manda para Configurações → Segurança; a API responde `PRECONDITION_FAILED mfa_required` (e `NOT_FOUND`, indistinguível de rota inexistente, para quem nem é staff).

---

## 7. Práticas de segurança de auth

Fontes: `Docs/core/global-rules.md` §1, `Docs/security/*`, `SECURITY.md`, código citado. Valerium usa Supabase Auth com JWT verificado por JWKS; **não faz hash de senha** (tudo delegado ao Supabase).

| Prática | Valor / regra | Onde |
|---|---|---|
| Política de senha | mínimo **8** (recomendado 15, só informativo), máximo 512; **sem regra de composição**; colar, Unicode e espaços permitidos; senha em vazamento é **recusada**; padrões comuns penalizados; pontuação 0–4 só informativa; MFA obrigatório no cadastro por senha (NIST 800-63B Rev 4 aceita 8 caracteres com MFA) | `packages/utils/src/password-policy.ts` |
| Vazamento (HIBP) | SHA-1 da senha, só os **5 primeiros hex** vão à API (k-anonimato); timeout 4 s; cache 24 h / 2000 entradas; **falha aberta** com aviso suave ("vazamentos não verificados"); roda no servidor, com limite de 30 / min por IP para não servir de proxy grátis | `packages/utils/src/hibp.ts`, `trpc/routers/auth.ts` |
| Medidor | 5 segmentos `h-1.5`; critérios **visíveis** de propósito (esconder seria segurança por obscuridade); checagem de vazamento com debounce de 800 ms | `components/auth/password-meter.tsx` |
| Limite de taxa | contador Redis por janela. Baldes: avaliar senha 30 / 60 s por IP; verificar TOTP **10 / 600 s por usuário, fail-closed**; código de recuperação **10 / 600 s por usuário, fail-closed**; esqueci a senha 10 / h por IP + 3 / h por e-mail; registrar tentativa 60 / min por IP; geral de tRPC 2000 / 10 min por usuário e 300 / 10 min por IP anônimo. Falha aberta nos demais (para não travar pagamento por falha de cache) | `apps/api/src/trpc/middleware/rate-limit.ts`, `trpc/init.ts` |
| Bloqueio de conta | 5 falhas em 15 min → 1 h, **por (e-mail, IP)**; 20 falhas em 15 min por IP → 1 h; sucesso não zera o contador. Escopo (e-mail, IP) porque o endpoint de registro é afirmado pelo cliente: um bloqueio só por e-mail deixaria qualquer um trancar a vítima com 5 falhas forjadas. IP vindo de fora só vale em chamada servidor-a-servidor com chave interna. Tentativa "sucesso" só é gravada com sessão verificada do mesmo e-mail. **É auxiliar:** o bloqueio de fato é o Turnstile e o limite do Supabase | `packages/utils/src/auth-lockout.ts`, `trpc/helpers/lockout-ip.ts`, `Docs/security/honeypot-and-public-routes.md` |
| CAPTCHA | Cloudflare Turnstile, `appearance: "interaction-only"`, `size: "flexible"`, tema do app; token enviado como `captchaToken` ao Supabase; reset a cada tentativa; botão desabilitado sem token quando configurado | `components/captcha-widget.tsx` |
| Sessão / cookies | cookies do `@supabase/ssr` com as opções **padrão do pacote** (conferido na versão 0.12.7: `path "/"`, `SameSite=Lax`, `HttpOnly=false`, 400 dias). Proxy usa `getClaims()` (valida a assinatura via JWKS) e código de servidor usa `getUser()`, nunca `getSession()`. Erro terminal do Auth (refresh token inexistente/usado, sessão expirada, 400/401/403) apaga os cookies `sb-*-auth-token`; falha **transitória** (rede, 5xx) mantém a sessão para não deslogar em deploy | `packages/supabase/src/client/middleware.ts` |
| Timeout por inatividade | **30 min**; aviso aos 25 com contagem regressiva ("Continuar conectado" / "Sair agora"); atividade = `pointerdown`, `pointermove`, `keydown`, `wheel`, `scroll`, `touchstart`, compartilhada entre abas por `localStorage`; ping ≤ 1 / min. Camada do servidor: cookie `httpOnly; Secure; SameSite=Lax; 60 dias` com `session_id.timestamp` (hora do **servidor**, amarrado à sessão); só o ping renova (prefetch nunca); rota do ping recusa `Sec-Fetch-Site` ≠ `same-origin`; expirado → `signOut({ scope: "local" })`, limpa cookies e vai a `/login?reason=idle`. Protege **dispositivo abandonado**, não sessão roubada | `lib/idle-session.ts`, `components/idle-session-guard.tsx`, `Docs/security/session-idle-timeout.md` |
| CSRF | cookie `SameSite=Lax`; chamadas tRPC com `Authorization: Bearer` (não cookie) → sem CSRF por construção; Server Actions com checagem de origem do Next; rota de ping com `Sec-Fetch-Site`; CORS com **lista de origens** e `credentials`, nunca `*`. "CSRF de login/logout" é declarado fora de escopo no `SECURITY.md` | `apps/api/src/index.ts` |
| Open redirect | `return_to` chega sem a barra inicial; normaliza para caminho absoluto e passa por `sanitizeRedirectPath`: decodifica, exige **uma** `/` inicial, rejeita `//`, resolve contra uma base fictícia e confere que a origem não mudou; senão `/` | `utils/return-to.ts`, `packages/utils/src/sanitize-redirect.ts` |
| Cabeçalhos (app) | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`; `Cross-Origin-Opener-Policy: same-origin-allow-popups`; `poweredByHeader: false` | `apps/dashboard/next.config.ts` |
| CSP | começa em **`Content-Security-Policy-Report-Only`** e vira bloqueio com `CSP_ENFORCE=true` (aí entra `upgrade-insecure-requests`, ignorado em report-only): `default-src 'self'`; `script-src 'self' 'unsafe-inline' 'unsafe-eval'` + Turnstile e Stripe; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `connect-src` com API, Supabase (https e wss) e analytics; `frame-src` só Turnstile e Stripe; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. API: `secureHeaders` com `default-src 'none'` | `next.config.ts`, `apps/api/src/index.ts` |
| Logs | nunca registrar payload bruto com PII, token, token de captcha ou JWT (`redactSensitive`); `removeConsole` no bundle de produção (mantém `error` e `warn`); erros de provedor externo passam por `sanitizeProviderError`; as iscas (honeypot) guardam só **hash do IP + prefixo**, nunca o IP inteiro nem a senha digitada | `Docs/core/global-rules.md` §1.1 e §1.7, `Docs/security/honeypot-and-public-routes.md` |
| Anti-enumeração | "esqueci a senha" responde sucesso sempre; rotas inexistentes e rotas restritas respondem igual (`NOT_FOUND`); scanners em `/admin`, `/wp-admin`, `.env`… recebem 404 liso (antes redirecionava ao login, o que revelava um app) | `trpc/routers/auth.ts`, `proxy.ts` |
| Zod | `.strict()` em toda mutation; nunca aceitar `userId`, `role`, `teamId` do corpo | `global-rules.md` §1.1 |
| Chaves de OTP próprias | o OTP do portal do cliente não usa o do Supabase: **HMAC-SHA256 com segredo próprio**, comparação em tempo constante, validade 10 min, 5 tentativas | `apps/api/src/services/customer-portal-otp.ts` |
| Auditoria | pentests (6 relatórios) + 9 suítes de teste de segurança; matriz SOC 2 | `tests/pentest-reports/`, `Docs/security/soc2-readiness.md` |

**Configuração do Supabase Auth de que o fluxo depende** (no painel, não no código): OTP com 6 dígitos e validade 15 min; templates com `{{ .Token }}`; confirmação de e-mail ligada em produção; SMTP próprio; **Site URL de produção correta** (o GoTrue ignora o `redirectTo` quando há erro e manda para o Site URL: um valor de desenvolvimento esquecido levou erros de OAuth para o localhost em produção); lista de redirecionamentos permitidos; CAPTCHA (Turnstile) ligado; MFA TOTP habilitado.

**Incidente a evitar:** com OAuth da Microsoft o `@supabase/ssr` gravou `provider_token` (vários KB) no cookie e a resposta estourou o limite de cabeçalho da borda (erro 500 cru). O callback do Valerium regrava a sessão só com `access_token` e `refresh_token` logo após o `exchangeCodeForSession`. Vale para o Routify se ligar OAuth na web (cookie do `createBrowserClient`).

**Lacunas do Valerium que o Routify não deve copiar:**

1. `protectedProcedure` sem checagem de `aal` (seção 6.5).
2. Hash dos códigos de recuperação com **SHA-256 sem segredo**: 50 bits de entropia aguentam enquanto só há acesso por API com limite, mas um vazamento da tabela permitiria quebra offline. Usar **HMAC-SHA256 com segredo do servidor**, como o próprio Valerium já faz no OTP do portal.
3. Mensagem crua do Supabase no login por senha.
4. Dois componentes de código diferentes (`CodeEntry` e `Input` simples) no mesmo fluxo de MFA.
5. Reenvio de código sem cronômetro (o Supabase limita reenvio a cerca de 1 por minuto por usuário; conferir no painel). Mostrar contagem de 60 s na UI.
6. `Input`/`Button` com `border-white/25` ilegíveis no tema claro; `*:focus { outline: none }` global.

---

## 8. Notas de porte para o Routify

Pontos de partida lidos: `apps/mobile/package.json`, `src/constants/Theme.ts`, `src/components/{ui,Button,Input,Toast}.tsx`, `src/screens/{Login,Register}Screen.tsx`, `src/context/AuthContext.tsx`, `src/lib/supabase.ts`, `docs/core/design-system.md`, `apps/admin/{package.json,next.config.ts}`, `src/app/globals.css`, `src/proxy.ts`, `src/lib/auth.ts`, `apps/api/seguranca.py`, `supabase/migrations/20260923010000_usage_tracking_admin.sql`.

### 8.1 O que já bate

| Item | Valerium | Routify hoje | Veredito |
|---|---|---|---|
| Tokens semânticos claro/escuro, espelhados entre app e painel | `tokens.css` | `Theme.ts` ↔ `globals.css` do admin | igual em estrutura; cores próprias (paleta da logo) |
| Raios | 8 / 12 / 16 | 8 / 12 / 16 (`radius.lg`) | igual |
| Sombra de cartão e hover | `0 1px 3px` + anel 1 px; hover `0 4px 16px` | `0 1px 3px` + anel 1 px; hover `0 6px 20px` | igual (alfa e blur ligeiramente diferentes) |
| Fontes | Geist + Geist Mono | Geist + Geist Mono (+ **Kalam** nos títulos) | Kalam diverge (seção 2) |
| Curva e entrada | ease-out-expo; `auth-rise` 480/10/70; materialize 800/14 | ease-out-expo; `Surgir` 760/12/60 | `Surgir` = estilo "materialize"; falta a variante de auth |
| Pressão e hover | `scale .98`, 200 ms | `scale .98` (`motion.pressScale`), 160 ms | igual |
| Indicador deslizante | spring bounce 0,2 / 0,5 s | `Segmentado` com `timing` 240 ms ease-out-expo | trocar por spring é opcional |
| Skeleton | **2,5 s linear** | app: 1,4 s **ease-out-expo** (acelera e para); admin: 2,5 s linear | alinhar o app |
| Toast | 1 por vez; 3/4/5/6 s por variante | até 3; 5 s; barra de tempo | aceitável; alinhar durações se quiser |
| Reduced-motion | classes só sob `no-preference` | `useMenosMovimento()` + CSS global `.01ms` | igual em efeito |
| Grão de papel 2 % | em `:root` (provavelmente coberto pelo body) | admin: `body::before` fixo (funciona); app web: não tem | levar o do admin ao app web |
| Login dividido | cena de papel + cartão | painel da marca (gradiente + motivo de rota animado + grade de pontos) + formulário | equivalente; **manter a cena do Routify** |
| Mensagens | cruas do Supabase | genéricas ("E-mail ou senha inválidos."), sem duplo envio, "Esqueci a senha" neutro | Routify melhor |
| Cabeçalhos / CSP | HSTS preload, XFO, nosniff, COOP, CSP report-only | admin idem (HSTS sem `preload`); API: nosniff, XFO, `Referrer-Policy: no-referrer` | já espelha |
| Sessão e admin | `getUser()`/`getClaims()`; papel no JWT | cookie `@supabase/ssr` na web, AsyncStorage no nativo; `app_metadata.role` + `getUser()`; FastAPI valida o token a cada chamada | alinhado |
| LGPD | banner de cookies | aceite do aviso de privacidade no cadastro | alinhado |

### 8.2 Tokens: Valerium → Routify

Recomendação: **manter a paleta da logo** e portar estrutura, forma e motion (nada na especificação exige trocar cor). Se o dono quiser o "paper" quente, o mapa abaixo mostra o que mudaria.

| Papel | Valerium (claro) | Routify hoje (claro) |
|---|---|---|
| fundo | #FAF9F6 | #F6F8FB |
| cartão | #F5F3EE (mais escuro que o fundo) | #FFFFFF |
| texto | #21201D | #0F1F44 (navy da logo) |
| texto secundário | #6E6B63 | #4A5872 |
| borda | #E9E6DD | #DCE3EC |
| ação / acento | #003ADD | #026BF8 |
| destrutivo | `0 75% 45%` (#C81C1C) | #D92D20 |
| foco | acento 100 % | `ring` = acento a 35 % |
| fundo escuro | #171717 | #0A0F1D |

Tokens **a acrescentar** em `Theme.ts` (valores do Valerium; o resto já existe):

```ts
// motion
auth: { entrada: 480, passo: 70, subida: 10 },                 // .auth-rise
codigo: { pop: 220, shake: 420, varredura: 1100, caret: 1250 }, // .code-*
// forma
sombraAuth: '0 24px 70px -40px rgba(0,0,0,0.45)',               // cartão de login
```

### 8.3 Como reproduzir, item a item

| Item | App (Expo / react-native-web) | Admin (Next 16 + Tailwind 4) | Dependência nova | Vale? |
|---|---|---|---|---|
| Entrada `auth-rise` | `Surgir` ganha `variante="auth"` (480 ms, 70 ms por item, 10 px) | classe `.auth-rise` em `globals.css`, dentro de `@media (prefers-reduced-motion: no-preference)`, com `animation-delay: calc(var(--i, 0) * 70ms)` | não | sim |
| Campo de código | componente novo `CodigoOtp`: **um `TextInput` invisível por cima + 6 `View`** (é o que o `input-otp` faz por baixo): `keyboardType="number-pad"`, `inputMode="numeric"`, `maxLength={6}`, `textContentType="oneTimeCode"`, `autoComplete="one-time-code"` (conferir nos tipos do RN 0.81; no Android o valor é `sms-otp`), filtra `\D` e `slice(0, 6)` (cobre colar), chama `onCompleto` no 6º dígito | sem tela própria: login e MFA moram no app (login único) | não (**não usar `input-otp` no nativo**) | **sim, é a peça central** |
| Shake, pop, varredura, caret | `Animated` (esboço 8.4-b); respeitar `useMenosMovimento()` | n/a | não | sim |
| Cartão de login e abas em pílula | `Cartao` (`padding` 32, raio 16, `sombraAuth`) + `Segmentado` com `variante="pilula"` (raio total, padding 4, abas de 36 px); troca de título com fade ± 6 px em 180 ms | n/a | não | sim |
| Spring da pílula | `Animated.spring(pos, { stiffness: 158, damping: 20, mass: 1, useNativeDriver })` ≈ `bounce .2 / .5 s` do framer (aproximação, calibrar a olho) | n/a | não | opcional |
| Sociais redondos | `BotaoSocial` 48 px; ponto "último usado" em `AsyncStorage`/`localStorage`; só web até configurar Google (nativo exige `expo-auth-session`/`expo-web-browser`, não instalados) | n/a | não (web) | sim, quando ligar o Google |
| Flip 3D de Entrar/Criar conta | **não portar**: sem empilhamento por `grid-area` no RN, e o `Segmentado` já resolve | n/a | n/a | não |
| Botão tátil | 2 `View` (base + face): face desce 2 px no hover (web) e 5 px no press; 150 ms `Easing.bezier(0.23, 1, 0.32, 1)` | classes CSS do `tactile-button` (usa `color-mix(in oklab, …)`) | não | opcional (CTA do MFA / recuperação) |
| Cena de papel (ticket + selo) | só ≥ 900 px (web): `clipPath` e `filter: drop-shadow` rodam no react-native-web, mas não estão nos tipos do RN (cast); **manter a cena de rota do Routify** e, se quiser a moldura, copiar só o "poço" (18 / 13, borda inferior 2 px) e a grade de pontos 22 px a `foreground / .06` | n/a | não | só a moldura |
| Grão de papel | acrescentar um `body::before` à CSS injetada em `App.tsx` (`injetarCssWeb`), alfa 0,02, só no claro | já existe | não | sim (barato) |
| Skeleton | trocar `1400 ms + easeOutExpo` por `2500 ms + Easing.linear` | já certo | não | sim |
| QR do TOTP | `react-native-qrcode-svg` (`ecl="H"`, zona de silêncio, logo central ≈ 22 %) sobre cartão **branco fixo**; no celular **somar** botão "Abrir no app autenticador" (`Linking.openURL` da URI `otpauth://`) e chave manual copiável: quem cadastra no próprio aparelho não consegue escanear a própria tela (o Valerium só tem QR + chave) | n/a | `react-native-svg` + `react-native-qrcode-svg` (**conferir compatibilidade com Expo SDK 54**) | sim, para o MFA |
| Códigos de recuperação | geração e consumo no **FastAPI com service_role**, nunca no cliente; tabela com RLS e sem política; **HMAC-SHA256 com segredo do servidor**; 10 códigos `XXXXX-XXXXX`; limite 10 / 10 min por usuário; consumir apaga os fatores TOTP (Admin API); download `.txt` na web e `Share.share` no nativo | n/a | não | sim |
| Gate de MFA no admin | telas de cadastro e desafio no app; o app lê a sessão depois de `mfa.verify` (o `supabase-js` do cliente já atualiza o token, não precisa de `refreshSession()` extra) | `proxy.ts` (8.4-c) + `is_admin()` (8.4-d) | não | **sim, é o ganho de segurança real** |
| Login por código de e-mail | `signInWithOtp` e `verifyOtp({ email, token, type: 'email' })` direto no cliente (sem Server Action); template com `{{ .Token }}`; **SMTP próprio (Resend)**; validade 15 min; cronômetro de reenvio de 60 s | n/a | não | se o dono quiser (8.7-3) |
| Política de senha | tamanho ≥ 8 + checagem HIBP (k-anonimato) e **remover** "letras e números" (composição); `fetch` direto ao endpoint `range` ou via FastAPI; o bloqueio nativo de senha vazada do Supabase é recurso de plano pago (conferir) | n/a | não | sim |
| CAPTCHA | ligar no Supabase; web: `@marsidev/react-turnstile` em arquivo `.web.tsx`; **nativo: sem** (exige WebView), confiar no limite do Supabase | n/a | só web | opcional |
| Timeout por inatividade | só web: hook com `pointerdown`, `keydown`, `scroll`…, `localStorage` compartilhado entre abas, aviso aos 25 min, `signOut({ scope: 'local' })` | cookie de servidor opcional | não | baixa prioridade |
| Cabeçalhos | já alinhados; `preload` no HSTS só quando o domínio estiver definitivo (difícil de reverter); virar CSP para bloqueio (`CSP_ENFORCE=1`) depois de conferir o console; API sem HSTS/CSP (conferir `deploy.md`) | idem | não | baixa prioridade |
| Haptics (extra, não existe no Valerium) | `expo-haptics` no erro do código (equivalente nativo do shake) | n/a | `expo-haptics` | opcional |
| Lottie, NumberFlow, Radix, `tailwindcss-animate`, framer-motion | **não adotar**. Número animado: `Animated.Value` + `addListener` (≈ 15 linhas) se algum KPI pedir. `react-native-reanimated`: **não adicionar** para isto (`Animated` cobre tudo acima) | `tailwindcss-animate` é para Tailwind 3; no Tailwind 4 escrever os keyframes à mão | não | n/a |

### 8.4 Esboços (não executados)

**a) Shake, pop e varredura em React Native.**

```tsx
// valores de styles/app.css (.code-shake, .code-pop, .code-sweep)
const SHAKE = [-2, 4, -6, 6, -6, 6, -6, 4, -2, 0]; // 10 passos de 42 ms = 420 ms

export function sacudir(x: Animated.Value, nativo: boolean) {
  Animated.sequence(
    SHAKE.map((toValue) =>
      Animated.timing(x, { toValue, duration: 42, easing: Easing.bezier(0.36, 0.07, 0.19, 0.97), useNativeDriver: nativo }),
    ),
  ).start();
}

// pop: a escala tem curva por trecho no CSS (0→60 % e 60→100 %), então são duas animações em sequência
export function pop(escala: Animated.Value, opac: Animated.Value, nativo: boolean) {
  const e = Easing.bezier(0.16, 1, 0.3, 1);
  escala.setValue(0.55);
  opac.setValue(0);
  Animated.parallel([
    Animated.timing(opac, { toValue: 1, duration: 220, easing: e, useNativeDriver: nativo }),
    Animated.sequence([
      Animated.timing(escala, { toValue: 1.08, duration: 132, easing: e, useNativeDriver: nativo }),
      Animated.timing(escala, { toValue: 1, duration: 88, easing: e, useNativeDriver: nativo }),
    ]),
  ]).start();
}
// varredura: barra de 1/3 da trilha, translateX de -larguraBarra a +larguraBarra,
// Animated.loop(timing 1100 ms, Easing.bezier(0.4, 0, 0.2, 1)); some/aparece em 300 ms de opacidade.
// caret: opacidade por interpolação [0, .2, .5, .7, 1] → [1, 0, 0, 1, 1] em 1250 ms, em loop.
```

**b) Gate de MFA no admin** (`apps/admin/src/proxy.ts`, depois do `getUser()`; só para quem é admin, para não mandar usuário comum ao cadastro de MFA):

```ts
if (user.app_metadata?.role === 'admin') {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') {
    // login e MFA moram no app (login único): mesmo destino do "sem sessão", sem return_to
    const rota = aal?.nextLevel === 'aal2' ? '/mfa' : '/mfa?cadastrar=1';
    return NextResponse.redirect(new URL(rota, APP_URL));
  }
}
```

**c) `is_admin()` exigindo `aal2`** (migration nova versionada em `supabase/migrations/`; o dono cola no SQL Editor, conforme `CLAUDE.md` §6). **Aplicar só depois que todo admin tiver TOTP**, ou o próprio dono perde o painel:

```sql
create or replace function public.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
```

**d) `exigir_admin` no FastAPI** (`apps/api/seguranca.py`). O `get_user` já validou o token no Auth, então ler o claim `aal` do payload sem verificar assinatura de novo é seguro aqui:

```python
import base64, json

def _aal(jwt: str) -> str:
    try:
        p = jwt.split('.')[1]
        p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get('aal', 'aal1')
    except Exception:
        return 'aal1'

# em exigir_admin, depois da checagem de papel:
if _aal(auth[7:].strip()) != 'aal2':
    raise HTTPException(status_code=403, detail='Confirme a verificação em duas etapas.')
```

### 8.5 Riscos e incompatibilidades

1. **Bibliotecas só-DOM** (`input-otp`, `framer-motion`, `@number-flow/react`, `lottie-react`, Radix, `qrcode` em modo canvas): quebram ou não existem no nativo. Dentro do Expo web dá para usá-las em arquivos `.web.tsx`, mas aí cada peça passa a ter duas implementações; para os poucos componentes aqui (OTP, pílula, QR) é menos trabalho escrever uma versão única com `Animated`.
2. **`react-native-svg` não está instalado** no app: o QR (e qualquer SVG) depende dele (`npx expo install react-native-svg`; confirmar se o Expo Go do SDK 54 já o inclui).
3. **`useNativeDriver: true` não existe na web.** O padrão `NATIVO = Platform.OS !== 'web'` já usado em `ui.tsx` deve ser repetido em todo `Animated` novo.
4. **Estilos CSS-only no nativo:** `clipPath`, `filter: drop-shadow` e o flip com `backfaceVisibility` ficam restritos à cena do painel (web, ≥ 900 px). `boxShadow` com `inset` (borda tátil dos tiles): conferir no Android; plano B = `View` absoluta de 2 px no rodapé do tile.
5. **Autofill de código:** `textContentType="oneTimeCode"` (iOS) e `autoComplete` (web e Android) precisam ser testados em aparelho; no Android o valor é `sms-otp`.
6. **Turnstile no nativo** exige WebView (`react-native-webview`, não instalado): ficar sem.
7. **E-mail do Supabase:** o SMTP padrão tem limite baixo e entrega restrita; login por código sem SMTP próprio falha com poucos usuários.
8. **Hard navigation do Valerium** (`window.location.assign` depois do MFA) é um contorno de cache do roteador do Next; no Expo o equivalente é reler `getSession()` antes de navegar.
9. **MFA no admin sem rollout em ordem tranca o dono**: cadastro e códigos de recuperação primeiro, gate depois (8.6).
10. **Tailwind 4 no admin**: `tailwindcss-animate` é do Tailwind 3 (conferir se há equivalente antes de depender de `animate-in`); manter os keyframes à mão em `globals.css`, como o admin já faz com `.surgir`.

### 8.6 Ordem sugerida (estimativas grosseiras, ± 50 %)

| Etapa | Entrega | Esforço |
|---|---|---|
| 1 | tokens de motion de auth; `Surgir` com variante; `.auth-rise` no admin; skeleton do app em 2,5 s linear; decisão sobre Kalam | 1–2 h |
| 2 | `CodigoOtp` com todos os estados (ocioso, ativo, verificando, erro, sucesso), shake, pop, varredura, caret, `aria-live`, reduced-motion | 3–4 h |
| 3 | cartão de login (raio 16, sombra longa), abas em pílula, troca de título, divisor, botão social (web) | 2–3 h |
| 4 | MFA TOTP: cadastro em 3 passos, desafio, recuperação; endpoints do FastAPI para os códigos; testes (IDOR, limite, uso único) | 6–8 h |
| 5 | gate AAL2 do admin: proxy, `exigir_admin`, migration de `is_admin()` (**só depois que os admins cadastrarem o TOTP**) | 1–2 h |
| 6 | senha por tamanho + HIBP; CAPTCHA web; timeout de inatividade web | 3–4 h |
| 7 | login por código de e-mail (SMTP Resend, templates, cronômetro de reenvio) | 3–4 h |

Ao implementar: atualizar `docs/core/design-system.md` (motion de auth, tipografia), `CLAUDE.md` §5 (MFA) e `.planning/STATE.md`; migration nova passa pelo dono (o MCP recusa escrita fora de sessão interativa).

### 8.7 Decisões que dependem do dono

1. **Paleta:** manter a da logo (azul → ciano → teal, recomendado) ou adotar o "paper" quente do Valerium?
2. **Kalam:** sair, como no Valerium (títulos em Geist 400 com tracking negativo), ou ficar? Se sair, mexer em `Theme.ts` (`fonts.display`), no `--font-display` do admin e em `docs/core/design-system.md`.
3. **Método principal de login:** senha (hoje) ou código por e-mail com senha como alternativa (Valerium)? Muda SMTP e copy.
4. **MFA:** obrigatório só para admin (recomendado) ou para todos (o Valerium força depois do cadastro por senha)?
5. **Google OAuth:** ligar agora (a UI já existe escondida em `LOGIN_GOOGLE_ATIVO`)?
6. **Timeout de inatividade de 30 min** no app web?

---

## 9. Fontes e limites

**Lido (Valerium, somente leitura):** `Docs/core/design-system.md`, `Docs/core/global-rules.md`, `Docs/marketing/marketing-site.md`, `Docs/security/{auth-setup,auth-password-hashing,session-idle-timeout,honeypot-and-public-routes,access-control-policy,soc2-readiness}.md`, `SECURITY.md`; `packages/ui/src/{tokens.css,globals.css}`, `packages/ui/tailwind.config.ts`, `packages/ui/src/components/{input,button,submit-button,submit-button-morph,spinner,skeleton,text-shimmer,text-morph,animated-size-container,card,dialog,sheet,toast,toaster,progress,input-otp}.tsx`, `packages/ui/src/components/kitchen/*`; `apps/dashboard/src/{proxy.ts,styles/{base,app,marketing}.css}`, `next.config.ts`, `tailwind.config.ts`, `app/[locale]/{layout,providers}.tsx`, `app/[locale]/(public)/{login,mfa}/*`, `app/[locale]/(app)/mfa/verify/page.tsx`, `app/api/auth/callback/route.ts`, `components/{auth/*,auth-showcase,otp-sign-in,password-sign-in,verify-mfa,mfa-settings,captcha-widget,route-progress,route-transition,animated-number,saving-bar,idle-session-guard,marketing/{reveal,use-count-up,marketing-route-transition}}.tsx`, `hooks/use-oauth-sign-in.ts`, `actions/{verify-otp-action,unenroll-mfa-action,safe-action}.ts`, `lib/idle-session.ts`, `locales/pt-BR.ts` (blocos de auth); `apps/api/src/{index.ts,trpc/init.ts,trpc/routers/auth.ts,trpc/middleware/rate-limit.ts,trpc/helpers/lockout-ip.ts,services/{supabase-mfa,customer-portal-otp}.ts,utils/auth.ts}`; `packages/utils/src/{auth-lockout,password-policy,hibp,sanitize-redirect}.ts`; `packages/supabase/src/client/*`; `packages/db/migrations/0120_mfa_backup_codes.sql`. Do `Grovic-Components` só o `directory.md` (a pasta é insumo; o código final está no Portal).

**Não lido, por regra:** `secrets/`, qualquer `.env*`, chaves e credenciais. `Docs/security/auth-setup.md` contém identificadores de projeto de infraestrutura que **não foram copiados**.

**Limites:**

- O app não foi executado: sem captura de tela; os valores de CSS são os do código.
- Pontos a validar no navegador ou aparelho: grão de papel (cobertura pelo `body`), foco do `Input` do Valerium no tema claro, autofill de OTP no Android, `boxShadow` inset no Android, QR com `react-native-qrcode-svg` no SDK 54.
- Afirmações sobre o Supabase e o RN (SMTP padrão, limite de reenvio, TOTP gratuito, senha vazada em plano pago, atualização automática da sessão depois de `mfa.verify` no `supabase-js`, tipos de `autoComplete` do RN 0.81) vêm de conhecimento geral e **precisam de conferência** no painel ou na documentação antes de virarem decisão.
- O `framer-motion` do Valerium não usa `MotionConfig reducedMotion="user"` em lugar nenhum (busca no dashboard e no pacote de UI), por isso as animações em framer ficam sem guarda de reduced-motion.
- As estimativas de esforço são grosseiras.
