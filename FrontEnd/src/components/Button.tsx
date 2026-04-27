/**
 * Button — Uber-style pill (radius 999) com 3 variantes:
 *  - primary: bg inverse, text onInverse  (CTA principal)
 *  - secondary: bg surface, border, text  (CTA leve)
 *  - chip: bg surfaceAlt (hover/filter)
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

type Variant = 'primary' | 'secondary' | 'chip' | 'ghost';

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
  const { theme } = useTheme();
  const c = theme.colors;

  const heightMap = { sm: 36, md: 44, lg: 52 };
  const padHMap = { sm: 14, md: 18, lg: 24 };
  const fontMap = { sm: 14, md: 16, lg: 16 };

  const palette = {
    primary: { bg: c.inverse, fg: c.onInverse, border: 'transparent' },
    secondary: { bg: c.surface, fg: c.text, border: c.text },
    chip: { bg: c.surfaceAlt, fg: c.text, border: 'transparent' },
    ghost: { bg: 'transparent', fg: c.text, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }: { pressed: boolean }) => [
        styles.base,
        {
          height: heightMap[size],
          paddingHorizontal: padHMap[size],
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <View style={{ marginRight: label ? 8 : 0 }}>
              <Icon name={icon} size={fontMap[size] + 4} color={palette.fg} />
            </View>
          ) : null}
          {label ? (
            <Text
              style={{
                color: palette.fg,
                fontSize: fontMap[size],
                fontWeight: '500',
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
          ) : null}
          {iconRight ? (
            <View style={{ marginLeft: label ? 8 : 0 }}>
              <Icon name={iconRight} size={fontMap[size] + 4} color={palette.fg} />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
