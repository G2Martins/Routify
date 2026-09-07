import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import Input from '../components/Input';

export default function LoginScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Preencha email e senha.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signIn(email.trim(), password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerArt}>
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../assets/Logo_Routify_icon.png')}
            style={styles.brandLogo}
            resizeMode="contain"
          />
          <Text style={[styles.brandTitle, { color: c.text }]}>Routify</Text>
          <Text style={[styles.brandSub, { color: c.textMuted }]}>
            Logística inteligente com IA preditiva
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.formTitle, { color: c.text }]}>Bem-vindo de volta</Text>
          <Text style={[styles.formSub, { color: c.textMuted }]}>
            Entre para acessar suas rotas otimizadas
          </Text>

          <View style={{ marginTop: 28 }}>
            <Input
              iconLeft="ion:mail-outline"
              placeholder="seu@email.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              autoComplete="email"
            />
            <Input
              iconLeft="ion:lock-closed-outline"
              placeholder="Sua senha"
              password
              value={password}
              onChangeText={setPassword}
              error={error}
            />

            <Button
              label="Entrar"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              onPress={handleLogin}
              iconRight="ion:arrow-forward"
            />

            <View style={[styles.divider, { backgroundColor: c.surfaceMuted }]} />

            <View style={styles.footer}>
              <Text style={{ color: c.textMuted, fontSize: 14 }}>Não tem conta? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
                  Criar conta
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 80 },
  headerArt: { alignItems: 'center', marginBottom: 48 },
  brandLogo: {
    width: 80,
    height: 80,
    marginBottom: 16,
  },
  brandTitle: { fontSize: 38, fontWeight: '700', letterSpacing: -1 },
  brandSub: { fontSize: 14, marginTop: 6 },
  form: { width: '100%', maxWidth: 380, alignSelf: 'center' },
  formTitle: { fontSize: 28, fontWeight: '700' },
  formSub: { fontSize: 14, marginTop: 6 },
  divider: { height: 1, marginVertical: 24 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
