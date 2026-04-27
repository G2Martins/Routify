import React, { useState } from 'react';
import {
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
import Icon from '../components/Icon';

export default function RegisterScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signUp } = useAuth();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleRegister = async () => {
    setError(null);
    if (!nome.trim() || !email.trim() || !password) {
      setError('Preencha todos os campos.');
      return;
    }
    if (password.length < 6) {
      setError('Senha precisa ter ao menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    const { error: err } = await signUp(email.trim(), password, nome.trim());
    setLoading(false);
    if (err) setError(err);
    else setDone(true);
  };

  if (done) {
    return (
      <View style={[styles.container, { backgroundColor: c.background, padding: 24 }]}>
        <View style={[styles.successCard, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
          <Icon name="ion:checkmark-circle" size={56} color={c.success} />
          <Text style={{ color: c.text, fontSize: 24, fontWeight: '700', marginTop: 16 }}>
            Conta criada!
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 14, textAlign: 'center', marginTop: 10 }}>
            Confirme o email enviado para {email} e depois faça login.
          </Text>
          <Button
            label="Voltar para login"
            variant="primary"
            fullWidth
            style={{ marginTop: 24 }}
            onPress={() => navigation.replace('Login')}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Icon name="ion:arrow-back" size={22} color={c.text} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Criar conta</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            Sua jornada otimizada começa aqui.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Nome"
            iconLeft="ion:person-outline"
            placeholder="Como devemos te chamar"
            value={nome}
            onChangeText={setNome}
          />
          <Input
            label="Email"
            iconLeft="ion:mail-outline"
            placeholder="seu@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            label="Senha"
            iconLeft="ion:lock-closed-outline"
            placeholder="Mínimo 6 caracteres"
            password
            value={password}
            onChangeText={setPassword}
          />
          <Input
            label="Confirmar senha"
            iconLeft="ion:lock-closed-outline"
            placeholder="Digite novamente"
            password
            value={confirm}
            onChangeText={setConfirm}
            error={error}
          />

          <Button
            label="Criar minha conta"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            onPress={handleRegister}
            iconRight="ion:arrow-forward"
          />

          <View style={styles.footer}>
            <Text style={{ color: c.textMuted, fontSize: 14 }}>Já tem conta? </Text>
            <TouchableOpacity onPress={() => navigation.replace('Login')}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>Entrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 80 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  header: { marginBottom: 28 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  sub: { fontSize: 14, marginTop: 6 },
  form: { width: '100%', maxWidth: 380, alignSelf: 'center' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  successCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
