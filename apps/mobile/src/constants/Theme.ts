/**
 * Tokens do Routify — espelho de docs/core/design-system.md.
 *
 * Paleta = logo (azul → ciano → teal, wordmark navy). Forma, tipografia e
 * motion = linguagem Valerium: Geist para UI e números, Kalam só em títulos,
 * raio 8/12, sombras de cartão tingidas de navy, entradas ease-out-expo.
 * Componentes consomem daqui — nunca hex solto em tela.
 */
import { Easing } from 'react-native';

export const brand = {
  blue: '#026BF8',
  cyan: '#059BC2',
  teal: '#09C6A4',
  navy: '#0F1F44',
};

export const radius = {
  none: 0,
  sm: 8, // botões, inputs
  md: 12, // cartões
  lg: 16, // painéis flutuantes
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  section: 64,
};

/** Largura máxima do conteúdo em telas largas (web). */
export const CONTEUDO_MAX = 1040;

export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemi: 'Geist_600SemiBold',
  sansBold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  monoBold: 'GeistMono_700Bold',
  display: 'Kalam_700Bold',
};

// Com fonte custom, o peso vem da família (fontWeight junto quebra no Android).
export const typography = {
  display: { fontFamily: fonts.sansBold, fontSize: 40, lineHeight: 46, letterSpacing: -1 },
  h1: { fontFamily: fonts.display, fontSize: 32, lineHeight: 40 },
  h2: { fontFamily: fonts.display, fontSize: 26, lineHeight: 34 },
  h3: { fontFamily: fonts.display, fontSize: 21, lineHeight: 28 },
  h4: { fontFamily: fonts.sansSemi, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  navLg: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  bodyMd: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  captionMd: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
  num: { fontFamily: fonts.monoBold, fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
};

export const motion = {
  rapido: 160, // hover, press
  medio: 240, // troca de estado
  entrada: 760, // revelação de tela/cartão
  passo: 60, // atraso entre itens de uma lista escalonada
  easeOutExpo: Easing.bezier(0.16, 1, 0.3, 1),
  pressScale: 0.98,
};

export interface ThemeColors {
  // Superfícies
  background: string;
  surface: string; // cartão
  surfaceAlt: string; // chip / hover
  surfaceMuted: string; // preenchimentos leves, trilhos
  // Texto
  text: string;
  textMuted: string;
  textSubtle: string;
  // Inverso (fundo escuro de destaque)
  inverse: string;
  onInverse: string;
  // Marca
  accent: string; // azul primário (CTA, rota, foco)
  accentSoft: string; // fundo translúcido do primário
  onAccent: string;
  teal: string; // preenchimento/ícone da marca (eco, LIA vencendo)
  cyan: string; // info / tráfego
  gradient: [string, string, string]; // assinatura da logo
  // Semânticas (seguras para texto sobre surface)
  success: string;
  danger: string;
  warning: string;
  // Bordas e foco
  border: string;
  borderStrong: string;
  ring: string;
  // Sombras (tingidas de navy)
  shadowLight: string;
  shadowMedium: string;
  // Rail lateral
  rail: string;
  railText: string;
  railActive: string;
}

export const lightColors: ThemeColors = {
  background: '#F6F8FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2F7',
  surfaceMuted: '#E6EBF2',
  text: brand.navy,
  textMuted: '#4A5872',
  textSubtle: '#8A96AB',
  inverse: brand.navy,
  onInverse: '#FFFFFF',
  accent: brand.blue,
  accentSoft: 'rgba(2,107,248,0.10)',
  onAccent: '#FFFFFF',
  teal: brand.teal,
  cyan: brand.cyan,
  gradient: [brand.blue, brand.cyan, brand.teal],
  success: '#078A73',
  danger: '#D92D20',
  warning: '#B86E00',
  border: '#DCE3EC',
  borderStrong: '#C5CFDC',
  ring: 'rgba(2,107,248,0.35)',
  shadowLight: 'rgba(15,31,68,0.08)',
  shadowMedium: 'rgba(15,31,68,0.16)',
  rail: brand.navy,
  railText: '#C9D3E6',
  railActive: brand.blue,
};

export const darkColors: ThemeColors = {
  background: '#0A0F1D',
  surface: '#111829',
  surfaceAlt: '#182238',
  surfaceMuted: '#1F2A42',
  text: '#F1F5FB',
  textMuted: '#A7B2C6',
  textSubtle: '#6B7890',
  inverse: '#F1F5FB',
  onInverse: brand.navy,
  accent: '#3D8BFF',
  accentSoft: 'rgba(61,139,255,0.14)',
  onAccent: '#FFFFFF',
  teal: '#1FD3B1',
  cyan: '#1FB5DB',
  gradient: ['#3D8BFF', '#1FB5DB', '#1FD3B1'],
  success: '#2BD4B4',
  danger: '#FF6B5E',
  warning: '#F5B544',
  border: '#222E47',
  borderStrong: '#2F3D5C',
  ring: 'rgba(61,139,255,0.45)',
  shadowLight: 'rgba(0,0,0,0.40)',
  shadowMedium: 'rgba(0,0,0,0.60)',
  rail: '#070B16',
  railText: '#A7B2C6',
  railActive: '#3D8BFF',
};

export type ThemeMode = 'light' | 'dark';

export const buildTheme = (mode: ThemeMode) => ({
  mode,
  colors: mode === 'dark' ? darkColors : lightColors,
  radius,
  spacing,
  typography,
  fonts,
  motion,
});

export type Theme = ReturnType<typeof buildTheme>;

// Map styles disponíveis no app
export const MAP_STYLES = ['dark', 'street', 'satellite'] as const;
export type MapStyle = typeof MAP_STYLES[number];

// ponytail: o CARTO passou a exigir API key (tiles com marca d'água), então o escuro
// usa os tiles do OSM invertidos por CSS. Teto: a política do tile.openstreetmap.org
// só aceita baixo volume + atribuição. Com tráfego real, trocar por provedor com chave
// (MapTiler/Stadia/CARTO).
export const MAP_TILE_URLS: Record<MapStyle, { url: string; attribution: string; filtro?: string }> = {
  dark: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    filtro: 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.5)',
  },
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri · World Imagery',
  },
};
