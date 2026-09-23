/**
 * Button — linguagem Valerium com a paleta da logo.
 *  - primary: azul sólido (CTA). Glow colorido só no tema claro.
 *  - secondary: contorno azul que preenche no hover.
 *  - chip: fundo neutro (filtros, ações leves).
 *  - ghost: sem fundo.
 *  - danger: contorno vermelho (ações destrutivas).
 * Raio 8, escala 0,98 ao pressionar.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

type Variant = 'primary' | 'secondary' | 'chip' | 'ghost' | 'danger';

interface Props {
  label?: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  iconRight?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  iconRight,
  fullWidth,
  size = 'md',
  style,
}: Props) {
  const { theme, mode } = useTheme();
  const c = theme.colors;

  const altura = { sm: 34, md: 42, lg: 50 }[size];
  const padH = { sm: 12, md: 16, lg: 22 }[size];
  const fonte = { sm: 13, md: 14, lg: 15 }[size];

  const paleta = {
    primary: { bg: c.accent, bgHover: c.accent, fg: c.onAccent, fgHover: c.onAccent, borda: c.accent },
    secondary: { bg: 'transparent', bgHover: c.accent, fg: c.accent, fgHover: c.onAccent, borda: c.accent },
    chip: { bg: c.surfaceAlt, bgHover: c.surfaceMuted, fg: c.text, fgHover: c.text, borda: c.border },
    ghost: { bg: 'transparent', bgHover: c.surfaceAlt, fg: c.text, fgHover: c.text, borda: 'transparent' },
    danger: { bg: 'transparent', bgHover: c.danger, fg: c.danger, fgHover: c.onAccent, borda: c.danger },
  }[variant];

  const glow = variant === 'primary' && mode === 'light';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={(estado) => {
        const { hovered, pressed } = estado as { hovered?: boolean; pressed: boolean };
        const ativo = hovered && !disabled;
        return [
          styles.base,
          {
            height: altura,
            paddingHorizontal: padH,
            backgroundColor: ativo ? paleta.bgHover : paleta.bg,
            borderColor: paleta.borda,
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
            opacity: disabled ? 0.45 : 1,
            transform: [{ scale: pressed ? theme.motion.pressScale : 1 }],
          },
          glow && { boxShadow: ativo ? '0 6px 20px rgba(2,107,248,0.30)' : '0 4px 14px rgba(2,107,248,0.25)' },
          style,
        ];
      }}
    >
      {(estado) => {
        const { hovered } = estado as { hovered?: boolean };
        const fg = hovered && !disabled ? paleta.fgHover : paleta.fg;
        if (loading) return <ActivityIndicator color={fg} />;
        return (
          <View style={styles.row}>
            {icon ? <Icon name={icon} size={fonte + 3} color={fg} /> : null}
            {label ? (
              <Text style={[theme.typography.bodyMd, { color: fg, fontSize: fonte }]} numberOfLines={1}>
                {label}
              </Text>
            ) : null}
            {iconRight ? <Icon name={iconRight} size={fonte + 3} color={fg} /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
