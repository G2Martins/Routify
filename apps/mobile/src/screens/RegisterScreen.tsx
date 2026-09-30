/**
 * Cadastro — mesma casca do Login. Orientação de senha inline, confirmação e
 * aceite do aviso de privacidade (LGPD) obrigatório. Mensagens genéricas.
 * ponytail: a regra de senha aqui é só UX; a política real fica no Supabase Auth.
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import Input from '../components/Input';
import Icon from '../components/Icon';
import { Surgir } from '../components/ui';
import { AuthShell, Aviso, LinkTexto } from './LoginScreen';

export default function RegisterScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signUp } = useAuth();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [aceite, setAceite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const enviando = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const senhaRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const regras = [
    { ok: password.length >= 8, texto: 'Pelo menos 8 caracteres' },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), texto: 'Letras e números' },
  ];
  const senhaOk = regras.every((r) => r.ok);
  const confirmErro = confirm.length > 0 && confirm !== password ? 'As senhas não coincidem.' : null;

  const criar = async () => {
    if (enviando.current) return;
    setErro(null);
    const alvo = email.trim();
    if (!nome.trim() || !alvo || !password) return setErro('Preencha todos os campos.');
    if (!senhaOk) return setErro('A senha precisa ter 8 caracteres ou mais, com letras e números.');
    if (password !== confirm) return setErro('As senhas não coincidem.');
    if (!aceite) return setErro('Aceite o aviso de privacidade para continuar.');

    enviando.current = true;
    setLoading(true);
    const { error } = await signUp(alvo, password, nome.trim());
    enviando.current = false;
    setLoading(false);
    // Texto do servidor pode revelar se o e-mail já existe: sempre genérico.
    if (error) {
      setErro(
        /fetch|network|timeout/i.test(error)
          ? 'Sem conexão com o servidor. Tente de novo.'
          : 'Não foi possível criar a conta. Confira os dados e tente de novo.'
      );
    } else setDone(true);
  };

  if (done) {
    return (
      <AuthShell>
        <Surgir ordem={1} style={{ alignItems: 'center' }}>
          <View style={[styles.okIcone, { backgroundColor: c.accentSoft }]}>
            <Icon name="ion:mail-outline" size={28} color={c.accent} />
          </View>
          <Text style={[theme.typography.h2, { color: c.text, marginTop: 16, textAlign: 'center' }]}>Confira seu e-mail</Text>
          <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 8, textAlign: 'center' }]}>
            Enviamos o link de confirmação para {email.trim()}. Confirme e depois entre.
          </Text>
          <Button label="Voltar para o login" size="lg" fullWidth style={{ marginTop: 24 }} onPress={() => navigation.replace('Login')} />
        </Surgir>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Surgir ordem={1}>
        <Text style={[theme.typography.h2, { color: c.text }]}>Criar conta</Text>
        <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 4 }]}>Leva menos de um minuto.</Text>
      </Surgir>

      <Surgir ordem={2} style={{ marginTop: 24 }}>
        <Input
          label="Nome"
          iconLeft="ion:person-outline"
          placeholder="Como devemos te chamar"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          value={nome}
          onChangeText={setNome}
          maxLength={80}
        />
        <Input
          ref={emailRef}
          label="E-mail"
          iconLeft="ion:mail-outline"
          placeholder="seu@email.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => senhaRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
          maxLength={254}
        />
        <Input
          ref={senhaRef}
          label="Senha"
          iconLeft="ion:lock-closed-outline"
          placeholder="Crie uma senha"
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmRef.current?.focus()}
          value={password}
          onChangeText={setPassword}
        />
        <View style={styles.regras}>
          {regras.map((r) => (
            <View key={r.texto} style={styles.regra}>
              <Icon
                name={r.ok ? 'ion:checkmark-circle' : 'ion:ellipse-outline'}
                size={14}
                color={r.ok ? c.success : c.textSubtle}
              />
              <Text style={[theme.typography.caption, { color: r.ok ? c.success : c.textMuted }]}>{r.texto}</Text>
            </View>
          ))}
        </View>
        <Input
          ref={confirmRef}
          label="Confirmar senha"
          iconLeft="ion:lock-closed-outline"
          placeholder="Digite de novo"
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={criar}
          value={confirm}
          onChangeText={setConfirm}
          error={confirmErro}
        />

        <Pressable
          onPress={() => setAceite((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: aceite }}
          accessibilityLabel="Li e aceito o aviso de privacidade"
          style={styles.aceite}
        >
          <View
            style={[
              styles.caixa,
              { borderColor: aceite ? c.accent : c.borderStrong, backgroundColor: aceite ? c.accent : c.surface },
            ]}
          >
            {aceite ? <Icon name="ion:checkmark" size={14} color={c.onAccent} /> : null}
          </View>
          <View style={styles.aceiteTexto}>
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>Li e aceito o</Text>
            <LinkTexto onPress={() => navigation.navigate('Privacy')}>aviso de privacidade</LinkTexto>
          </View>
        </Pressable>
      </Surgir>

      <Surgir ordem={3} style={{ gap: 16, marginTop: 20 }}>
        {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
        <Button label="Criar minha conta" size="lg" fullWidth loading={loading} onPress={criar} iconRight="ion:arrow-forward" />
      </Surgir>

      <Surgir ordem={4} style={[styles.rodape, { borderTopColor: c.border }]}>
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>Já tem conta?</Text>
        <LinkTexto onPress={() => navigation.replace('Login')}>Entrar</LinkTexto>
      </Surgir>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  regras: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: -8, marginBottom: 16 },
  regra: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aceite: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  caixa: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  aceiteTexto: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, flex: 1 },
  okIcone: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rodape: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24, paddingTop: 20, borderTopWidth: 1 },
});
