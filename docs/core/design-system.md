# Design system — Routify

**Última revisão:** 2026-09-23

Duas fontes de verdade, que precisam ficar espelhadas:
- app (Expo): [apps/mobile/src/constants/Theme.ts](../../apps/mobile/src/constants/Theme.ts);
- painel (Next): [apps/admin/src/app/globals.css](../../apps/admin/src/app/globals.css).

Mudou um token num lugar → muda no outro no mesmo PR.

## Princípio

- **Paleta = logo.** Azul → ciano → teal no gradiente e navy no wordmark.
- **Forma, tipografia e motion = linguagem Valerium:** superfícies calmas, bordas finas, sombras discretas, um único acento forte.
- **Mapa em primeiro plano:** a interface não compete com as cores do mapa.

## Paleta

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `background` | `#F6F8FB` | `#0A0F1D` | fundo da página (neutro frio / tinta navy) |
| `surface` | `#FFFFFF` | `#111829` | cartões, painéis |
| `surfaceAlt` | `#EEF2F7` | `#182238` | chips, hover, trilho do segmentado |
| `text` | `#0F1F44` (navy da logo) | `#F1F5FB` | texto principal |
| `textMuted` | `#4A5872` | `#A7B2C6` | secundário |
| `accent` | `#026BF8` | `#3D8BFF` | CTA, rota, foco, item ativo |
| `teal` | `#09C6A4` | `#1FD3B1` | preenchimento da marca (eco, "LIA venceu") |
| `cyan` | `#059BC2` | `#1FB5DB` | info, tráfego |
| `success` / `warning` / `danger` | `#078A73` / `#B86E00` / `#D92D20` | `#2BD4B4` / `#F5B544` / `#FF6B5E` | semânticas, seguras para texto |
| `border` | `#DCE3EC` | `#222E47` | bordas de 1 px |
| `gradient` | azul → ciano → teal | versões claras | faixa da marca, hero, loading de rota |

- **Teal e ciano puros não servem para texto pequeno sobre branco** (contraste < 3:1). Para texto, usar `success`.
- **Gráficos:**
  - série principal = `accent`, segunda = `teal`, neutro = cinza;
  - terceira série só se precisar: âmbar (`warning`), nunca um terceiro azul;
  - status só com as cores semânticas.

## Tipografia

| Papel | Fonte |
| --- | --- |
| UI e texto | **Geist Sans** (400/500/600/700) |
| Números (tempo, km, RMSE, contagens) | **Geist Mono**, sempre com alinhamento tabular |
| Títulos de página e de cartão | **Kalam** 700 — **nunca** em números ou em texto corrido |

- **Escala (px):** display 40 · h1 32 · h2 26 · h3 21 · h4 16 · corpo 15 · legenda 13 · micro 11 (caixa-alta, +0,6 de espaçamento).
- **Carregamento:** app via `@expo-google-fonts/*` (em `App.tsx`); painel via `next/font`.

## Forma

- **Raio:** 8 em botão/input, 12 em cartão, 16 em painel flutuante; pílula só em selo.
- **Borda:** 1 px `border`.
- **Sombra de cartão:** `0 1px 3px` + anel de 1 px, tingida de navy no claro.
- **Hover:** borda `borderStrong` + `0 6px 20px`.
- **Espaço:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48.
  - Seção nova = 32 acima do rótulo.
  - Conteúdo com largura máxima de **1040 px**, centralizado, com 16 px de margem no celular e 32 px na web.
- **Botões:**
  - `primary` = azul sólido, com glow só no claro;
  - `secondary` = contorno azul que preenche no hover;
  - `chip` / `ghost` / `danger`.
- **Segmentado** no lugar de pílulas de largura total.

## Motion

| Momento | Duração | Curva |
| --- | --- | --- |
| hover / press | 160 ms | ease-out; escala **0,98** ao pressionar |
| troca de estado | 240 ms | ease-out-expo `cubic-bezier(.16,1,.3,1)` |
| entrada de tela e cartões | 760 ms | ease-out-expo; sobe 12 px + opacidade, escalonado em 60 ms por item |
| carregamento | loop de 1,4 s | skeleton com brilho deslizante (nunca spinner solto em lista) |

- Blur só em entrada, nunca em hover (custo de GPU).
- `prefers-reduced-motion` desliga entradas e loops (`useMenosMovimento`).

## Peças prontas (app)

[apps/mobile/src/components/ui.tsx](../../apps/mobile/src/components/ui.tsx):
- `Container`, `Surgir`, `Cartao`, `TituloPagina`, `RotuloSecao`;
- `Selo`, `Kpi` + `GradeKpi`, `Segmentado`, `Skeleton`, `FaixaMarca`;
- mais o [`Button`](../../apps/mobile/src/components/Button.tsx).

Tela nova monta com elas. Estilo solto só para o que é específico da tela.

## Regras

- Zero hex em componente: sempre o token do tema.
- Toda superfície legível nos dois temas.
- Foco visível por teclado na web (anel azul, `:focus-visible`).
- Nada de `dangerouslySetInnerHTML`. Texto vindo do usuário ou da API é renderizado como texto.
