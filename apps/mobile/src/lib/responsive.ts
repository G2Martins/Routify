import { Platform, useWindowDimensions } from 'react-native';

const DESKTOP_BREAKPOINT = 900;
/** Abaixo disto a tela é celular; entre isto e o desktop, tablet (painéis do mapa com largura limitada). */
const TABLET_BREAKPOINT = 600;

// Toque na web: tablet em paisagem passa do breakpoint de desktop e continua sem mouse.
const PONTEIRO_GROSSO =
  Platform.OS !== 'web' || (typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);

export function useDesktopLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

/** Tablet ou maior: dá para limitar a largura dos painéis e deixar o mapa aparecer ao lado. */
export function useTelaLarga(): boolean {
  return useWindowDimensions().width >= TABLET_BREAKPOINT;
}

/** Alvo mínimo de clique: 44 px em tudo que é toque, 34 px no desktop com mouse (botão pequeno, denso). */
export function useAlvo(): number {
  return useDesktopLayout() && !PONTEIRO_GROSSO ? 34 : 44;
}

/** Fonte de campo de texto: abaixo de 16 px o Safari do iPhone dá zoom na página ao focar. */
export function useFonteCampo(): number {
  return PONTEIRO_GROSSO ? 16 : 15;
}
