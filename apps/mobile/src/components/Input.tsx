/**
 * Input — linguagem Valerium: raio 8, borda 1 px, altura 44, rótulo acima.
 * Foco = borda `accent` + anel `ring`; erro = borda e texto `danger`.
 * `password` liga o olho de mostrar/ocultar; `right` aceita outro acessório.
 */
import React, { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  iconLeft?: string;
  password?: boolean;
  /** Acessório à direita (ex.: unidade "min"). Com `password`, o olho vem depois dele. */
  right?: React.ReactNode;
}

const WEB_SEM_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, iconLeft, password, right, style, editable, ...rest },
  ref
) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [secure, setSecure] = useState(!!password);
  const [focused, setFocused] = useState(false);
  const desabilitado = editable === false;

  return (
    <View style={styles.bloco}>
      {label ? <Text style={[theme.typography.captionMd, { color: c.text, marginBottom: 6 }]}>{label}</Text> : null}

      <View
        style={[
          styles.caixa,
          {
            backgroundColor: desabilitado ? c.surfaceAlt : c.surface,
            borderColor: error ? c.danger : focused ? c.accent : c.border,
            borderRadius: theme.radius.sm,
          },
          focused && !error && { boxShadow: `0 0 0 3px ${c.ring}` },
        ]}
      >
        {iconLeft ? <Icon name={iconLeft} size={18} color={focused ? c.accent : c.textSubtle} /> : null}

        <TextInput
          ref={ref}
          {...rest}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          editable={editable}
          secureTextEntry={secure}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={c.textSubtle}
          style={[
            theme.typography.body,
            styles.campo,
            { color: c.text, marginLeft: iconLeft ? 10 : 0 },
            WEB_SEM_OUTLINE,
            style,
          ]}
        />

        {right}

        {password ? (
          <Pressable
            onPress={() => setSecure((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={secure ? 'Mostrar senha' : 'Ocultar senha'}
            hitSlop={8}
            style={styles.olho}
          >
            <Icon name={secure ? 'ion:eye-outline' : 'ion:eye-off-outline'} size={18} color={c.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: c.danger, marginTop: 6 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  bloco: { marginBottom: 16 },
  caixa: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12, borderWidth: 1 },
  campo: { flex: 1, height: '100%', paddingVertical: 0 },
  olho: { marginLeft: 8, padding: 2 },
});
