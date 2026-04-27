/**
 * Colors legado — apenas para compatibilidade com código antigo.
 * Use `useTheme()` (ThemeContext) em código novo.
 */
import { lightColors } from './Theme';

export const Colors = {
  primary: lightColors.accent,
  background: lightColors.background,
  white: lightColors.surface,
  text: lightColors.text,
  gray: lightColors.textSubtle,
  success: lightColors.success,
  danger: lightColors.danger,
};
