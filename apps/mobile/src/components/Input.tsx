import React, { forwardRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  iconLeft?: string;
  password?: boolean;
}

const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, iconLeft, password, style, ...rest },
  ref
) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [secure, setSecure] = useState(!!password);
  const [focused, setFocused] = useState(false);

  const webOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null;

  return (
    <View style={{ marginBottom: 14 }}>
      {label ? (
        <Text style={{ color: c.textMuted, marginBottom: 6, fontSize: 13, fontWeight: '500' }}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.wrap,
          {
            backgroundColor: c.surface,
            borderColor: error ? c.danger : focused ? c.text : c.border,
            borderWidth: focused || error ? 1.5 : 1,
          },
        ]}
      >
        {iconLeft ? (
          <Icon name={iconLeft} size={18} color={focused ? c.text : c.textSubtle} />
        ) : null}

        <TextInput
          ref={ref}
          {...rest}
          secureTextEntry={secure}
          onFocus={(e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={c.textSubtle}
          style={[
            styles.input,
            { color: c.text, marginLeft: iconLeft ? 8 : 0 },
            webOutline,
            style,
          ]}
        />

        {password ? (
          <TouchableOpacity onPress={() => setSecure((s) => !s)} style={{ padding: 4 }}>
            <Icon
              name={secure ? 'ion:eye-outline' : 'ion:eye-off-outline'}
              size={18}
              color={c.textSubtle}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <Text style={{ color: c.danger, fontSize: 12, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 50,
    borderRadius: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
});
