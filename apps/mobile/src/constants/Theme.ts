/**
 * Theme tokens — Uber-inspired (confident minimalism) + paleta brand Routify
 *
 * Brand:
 *   #09C6A4  teal (saúde/eco)
 *   #026BF8  azul vivo (ação/CTA)
 *   #0F1F44  navy (autoridade/header)
 *   #059BC2  cyan (info/tráfego)
 */
export const brand = {
  teal: '#09C6A4',
  blue: '#026BF8',
  navy: '#0F1F44',
  cyan: '#059BC2',
};

export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
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
  section: 64,
};

export const typography = {
  display: { fontSize: 52, fontWeight: '700' as const, lineHeight: 64 },
  h1: { fontSize: 36, fontWeight: '700' as const, lineHeight: 44 },
  h2: { fontSize: 32, fontWeight: '700' as const, lineHeight: 40 },
  h3: { fontSize: 24, fontWeight: '700' as const, lineHeight: 32 },
  h4: { fontSize: 20, fontWeight: '700' as const, lineHeight: 28 },
  navLg: { fontSize: 18, fontWeight: '500' as const, lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyMd: { fontSize: 16, fontWeight: '500' as const, lineHeight: 24 },
  caption: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  captionMd: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  micro: { fontSize: 12, fontWeight: '400' as const, lineHeight: 18 },
};

export interface ThemeColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceAlt: string;     // chip / hover bg
  surfaceMuted: string;   // dividers, light fills
  // Text
  text: string;
  textMuted: string;
  textSubtle: string;
  // Inverse
  inverse: string;        // ink que destaca em surface (bg do botão primário)
  onInverse: string;      // texto sobre inverse
  // Accents
  accent: string;         // azul Routify (manter identidade — link blue Uber é #0000ee)
  success: string;
  danger: string;
  warning: string;
  // Borders
  border: string;
  borderStrong: string;
  // Shadows
  shadowLight: string;
  shadowMedium: string;
}

export const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#efefef',
  surfaceMuted: '#f3f3f3',
  text: '#000000',
  textMuted: '#4b4b4b',
  textSubtle: '#afafaf',
  inverse: brand.navy,
  onInverse: '#ffffff',
  accent: brand.blue,      // CTA — azul brand
  success: brand.teal,     // teal brand (eco/economia)
  danger: '#E11900',
  warning: '#FFC043',
  border: brand.navy,
  borderStrong: brand.navy,
  shadowLight: 'rgba(0,0,0,0.12)',
  shadowMedium: 'rgba(0,0,0,0.16)',
};

export const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#0d0d0d',
  surfaceAlt: '#1a1a1a',
  surfaceMuted: '#272727',
  text: '#ffffff',
  textMuted: '#c2c2c2',
  textSubtle: '#7a7a7a',
  inverse: '#ffffff',
  onInverse: brand.navy,
  accent: brand.cyan,      // cyan brand (legível em fundo escuro)
  success: brand.teal,
  danger: '#FF5043',
  warning: '#FFC043',
  border: '#272727',
  borderStrong: '#3a3a3a',
  shadowLight: 'rgba(0,0,0,0.5)',
  shadowMedium: 'rgba(0,0,0,0.65)',
};

export type ThemeMode = 'light' | 'dark';

export const buildTheme = (mode: ThemeMode) => ({
  mode,
  colors: mode === 'dark' ? darkColors : lightColors,
  radius,
  spacing,
  typography,
});

export type Theme = ReturnType<typeof buildTheme>;

// Map styles disponíveis no app
export const MAP_STYLES = ['dark', 'street', 'satellite'] as const;
export type MapStyle = typeof MAP_STYLES[number];

export const MAP_TILE_URLS: Record<MapStyle, { url: string; attribution: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap · © CARTO',
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
