/**
 * Login — layout dividido (Valerium). Desktop: painel da marca à esquerda
 * (gradiente da logo sobre navy + motivo de rota animado) e formulário à
 * direita. Celular: só o formulário, com a logo no topo.
 *
 * Segurança: mensagens genéricas (nunca revelam se a conta existe), e-mail
 * com trim, sem duplo envio. Quem valida de verdade é o Supabase Auth.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useDesktopLayout } from '../lib/responsive';
import Button from '../components/Button';
import Input from '../components/Input';
import Icon from '../components/Icon';
import { Cartao, FaixaMarca, Surgir, useMenosMovimento } from '../components/ui';

// Backlog: login com Google. Pronto na UI, escondido até configurar o provedor no Supabase.
const LOGIN_GOOGLE_ATIVO = false;

const NATIVO = Platform.OS !== 'web';
const MSG_INVALIDO = 'E-mail ou senha inválidos.';
const LOGO_ICONE = require('../../assets/Logo_Routify_icon.png'); // eslint-disable-line @typescript-eslint/no-require-imports

const PROVAS = [
  { icone: 'ion:analytics-outline', titulo: 'LIA prevê o congestionamento', texto: 'Modelo treinado com o histórico de tráfego do DF.' },
  { icone: 'ion:navigate-outline', titulo: 'TomTom ao vivo no seu trajeto', texto: 'Leitura em tempo real só no corredor da rota.' },
  { icone: 'ion:shield-checkmark-outline', titulo: 'Seus dados arredondados e protegidos', texto: 'Análises agregadas; o histórico é só seu.' },
];

// ------------------------------------------------------------ motivo de rota
// Coordenadas normalizadas (0..1) numa caixa. Só segmentos retos (horizontal/vertical).
const ROTA_CURTA: [number, number][] = [[0.04, 0.8], [0.8, 0.8], [0.8, 0.18]];
const ROTA_LIA: [number, number][] = [[0.04, 0.8], [0.3, 0.8], [0.3, 0.38], [0.62, 0.38], [0.62, 0.6], [0.8, 0.6], [0.8, 0.18]];
const MOTIVO_ALTURA = 170;
const TRACO = 3;

function Segmento({ a, b, cores, opacidade = 1 }: { a: [number, number]; b: [number, number]; cores: [string, string]; opacidade?: number }) {
  const horizontal = a[1] === b[1];
  const left = Math.min(a[0], b[0]) - TRACO / 2;
  const top = Math.min(a[1], b[1]) - TRACO / 2;
  const style = {
    position: 'absolute' as const,
    left,
    top,
    width: horizontal ? Math.abs(b[0] - a[0]) + TRACO : TRACO,
    height: horizontal ? TRACO : Math.abs(b[1] - a[1]) + TRACO,
    borderRadius: TRACO,
    opacity: opacidade,
  };
  const inicio = { x: a[0] <= b[0] ? 0 : 1, y: a[1] <= b[1] ? 0 : 1 };
  const fim = { x: horizontal ? 1 - inicio.x : 0.5, y: horizontal ? 0.5 : 1 - inicio.y };
  return <LinearGradient colors={cores} start={horizontal ? { x: inicio.x, y: 0.5 } : { x: 0.5, y: inicio.y }} end={fim} style={style} />;
}

/** Duas rotas: a mais curta (apagada, com trecho congestionado) e a da LIA, com um ponto percorrendo. */
function MotivoRota() {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const [w, setW] = useState(0);
  const t = useRef(new Animated.Value(0)).current;
  const pulso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduzir || w === 0) return;
    const viagem = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVO }),
        Animated.delay(900),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: NATIVO }),
      ])
    );
    const onda = Animated.loop(
      Animated.timing(pulso, { toValue: 1, duration: 1800, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO })
    );
    viagem.start();
    onda.start();
    return () => {
      viagem.stop();
      onda.stop();
    };
  }, [reduzir, w]); // eslint-disable-line react-hooks/exhaustive-deps

  const px = (p: [number, number]): [number, number] => [p[0] * w, p[1] * MOTIVO_ALTURA];
  const lia = ROTA_LIA.map(px);
  const curta = ROTA_CURTA.map(px);

  // Interpolação por comprimento acumulado: o ponto anda com velocidade constante.
  const acum = [0];
  for (let i = 1; i < lia.length; i++) {
    acum.push(acum[i - 1] + Math.abs(lia[i][0] - lia[i - 1][0]) + Math.abs(lia[i][1] - lia[i - 1][1]));
  }
  const total = acum[acum.length - 1] || 1;
  const inputRange = acum.map((d) => d / total);
  const [g0, g1, g2] = c.gradient;
  const coresLia: [string, string][] = [[g0, g0], [g0, g1], [g1, g1], [g1, g2], [g2, g2], [g2, g2]];
  const destino = lia[lia.length - 1];

  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: MOTIVO_ALTURA }} accessible={false}>
      {w > 0 ? (
        <>
          <Segmento a={curta[0]} b={curta[1]} cores={[c.railText, c.railText]} opacidade={0.28} />
          <Segmento a={curta[1]} b={curta[2]} cores={[c.railText, c.railText]} opacidade={0.28} />
          {/* trecho congestionado da rota mais curta */}
          <Segmento a={[w * 0.44, curta[0][1]]} b={[w * 0.68, curta[0][1]]} cores={[c.warning, c.danger]} />
          {lia.slice(1).map((p, i) => (
            <Segmento key={i} a={lia[i]} b={p} cores={coresLia[i]} />
          ))}

          <View style={[styles.origem, { left: lia[0][0] - 6, top: lia[0][1] - 6, borderColor: c.onAccent, backgroundColor: c.rail }]} />

          {!reduzir ? (
            <Animated.View
              style={[
                styles.pulso,
                {
                  left: destino[0] - 10,
                  top: destino[1] - 10,
                  backgroundColor: g2,
                  opacity: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                  transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
                },
              ]}
            />
          ) : null}
          <View style={[styles.destino, { left: destino[0] - 6, top: destino[1] - 6, backgroundColor: g2, borderColor: c.onAccent }]} />

          {!reduzir ? (
            <Animated.View
              style={[
                styles.carro,
                {
                  backgroundColor: c.onAccent,
                  borderColor: g1,
                  transform: [
                    { translateX: t.interpolate({ inputRange, outputRange: lia.map((p) => p[0] - 6) }) },
                    { translateY: t.interpolate({ inputRange, outputRange: lia.map((p) => p[1] - 6) }) },
                  ],
                },
              ]}
            />
          ) : null}

          <Text style={[theme.typography.micro, styles.rotulo, { color: c.onAccent, left: lia[2][0] + 8, top: lia[2][1] - 22 }]}>LIA</Text>
          <Text style={[theme.typography.micro, styles.rotulo, { color: c.warning, left: w * 0.44, top: curta[0][1] + 10 }]}>
            MAIS CURTA · CONGESTIONADA
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** Grade de pontos que some a partir do canto superior direito. */
function GradePontos() {
  const { theme } = useTheme();
  const cols = 14;
  const linhas = 12;
  const max = Math.hypot(cols, linhas);
  const pontos = [];
  for (let l = 0; l < linhas; l++) {
    for (let k = 0; k < cols; k++) {
      const alpha = Math.max(0, 1 - Math.hypot(cols - 1 - k, l) / (max * 0.75)) * 0.45;
      if (alpha > 0.02) pontos.push(<View key={`${l}-${k}`} style={[styles.ponto, { left: k * 24, top: l * 24, opacity: alpha, backgroundColor: theme.colors.railText }]} />);
    }
  }
  return <View pointerEvents="none" style={[styles.grade, { width: cols * 24, height: linhas * 24 }]}>{pontos}</View>;
}

function PainelMarca() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.painel, { backgroundColor: c.rail }]}>
      <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { opacity: 0.2 }]} />
      <LinearGradient colors={['transparent', c.rail]} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <GradePontos />

      <Surgir ordem={0} style={styles.marcaLinha}>
        <Image source={LOGO_ICONE} style={styles.marcaIcone} resizeMode="contain" />
        <Text style={[styles.marcaNome, { color: c.onAccent, fontFamily: theme.fonts.sansBold }]}>Routify</Text>
      </Surgir>

      <View style={{ flex: 1, justifyContent: 'center', maxWidth: 520, width: '100%' }}>
        <Surgir ordem={1}>
          <MotivoRota />
        </Surgir>
        <Surgir ordem={2} style={{ marginTop: 32 }}>
          <Text style={[theme.typography.h1, { color: c.onAccent, fontSize: 36, lineHeight: 44 }]}>
            Rotas que aprendem com o trânsito de Brasília
          </Text>
          <Text style={[theme.typography.body, { color: c.railText, marginTop: 12 }]}>
            Previsão de congestionamento por IA, trânsito ao vivo e privacidade por padrão.
          </Text>
        </Surgir>
        <View style={{ marginTop: 32, gap: 16 }}>
          {PROVAS.map((p, i) => (
            <Surgir key={p.titulo} ordem={3 + i} style={styles.prova}>
              <View style={[styles.provaIcone, { backgroundColor: c.accentSoft }]}>
                <Icon name={p.icone} size={18} color={c.gradient[2]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.bodyMd, { color: c.onAccent }]}>{p.titulo}</Text>
                <Text style={[theme.typography.caption, { color: c.railText, marginTop: 2 }]}>{p.texto}</Text>
              </View>
            </Surgir>
          ))}
        </View>
      </View>

      <Text style={[theme.typography.micro, { color: c.railText, opacity: 0.7, textTransform: 'uppercase' }]}>TCC 2026 · Brasília/DF</Text>
    </View>
  );
}

// ------------------------------------------------------------ peças compartilhadas (Login + Cadastro)

/** Casca das telas de auth: painel da marca (desktop) + coluna do formulário. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();

  const form = (
    <View style={styles.formCol}>
      {desktop ? (
        <Cartao padding={32}>{children}</Cartao>
      ) : (
        <>
          <Surgir ordem={0} style={styles.logoMobile}>
            <Image source={LOGO_ICONE} style={{ width: 56, height: 56 }} resizeMode="contain" />
            <Text style={[styles.marcaNome, { color: c.text, fontFamily: theme.fonts.sansBold, fontSize: 26, marginTop: 8 }]}>Routify</Text>
            <FaixaMarca altura={3} style={{ width: 48, marginTop: 12 }} />
          </Surgir>
          {children}
        </>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {desktop ? <PainelMarca /> : null}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: desktop ? 48 : insets.top + 32, paddingBottom: desktop ? 48 : insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {form}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Aviso inline: erro (borda danger) ou informação neutra. */
export function Aviso({ tom, children, detalhe }: { tom: 'erro' | 'info'; children: string; detalhe?: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const cor = tom === 'erro' ? c.danger : c.accent;
  return (
    <View
      accessibilityRole={tom === 'erro' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.aviso, { backgroundColor: c.surfaceAlt, borderColor: tom === 'erro' ? c.danger : c.border, borderRadius: theme.radius.sm }]}
    >
      <Icon name={tom === 'erro' ? 'ion:alert-circle-outline' : 'ion:mail-outline'} size={18} color={cor} />
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.captionMd, { color: tom === 'erro' ? c.danger : c.text }]}>{children}</Text>
        {detalhe ? <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]}>{detalhe}</Text> : null}
      </View>
    </View>
  );
}

/** Link de texto (sublinha no hover da web). */
export function LinkTexto({ children, onPress, disabled }: { children: string; onPress: () => void; disabled?: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="link" hitSlop={6}>
      {(estado) => {
        const { hovered } = estado as { hovered?: boolean };
        return (
          <Text
            style={[
              theme.typography.captionMd,
              { color: theme.colors.accent, opacity: disabled ? 0.5 : 1, textDecorationLine: hovered ? 'underline' : 'none' },
            ]}
          >
            {children}
          </Text>
        );
      }}
    </Pressable>
  );
}

// ------------------------------------------------------------ tela

export default function LoginScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [enviandoReset, setEnviandoReset] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const enviando = useRef(false);
  const senhaRef = useRef<TextInput>(null);

  const entrar = async () => {
    if (enviando.current) return; // sem duplo envio (o botão só desabilita no próximo render)
    const alvo = email.trim();
    setAviso(null);
    if (!alvo || !password) {
      setErro('Preencha e-mail e senha.');
      return;
    }
    enviando.current = true;
    setLoading(true);
    setErro(null);
    const { error } = await signIn(alvo, password);
    enviando.current = false;
    setLoading(false);
    if (!error) return;
    // Nunca repassar o texto do servidor: ele pode revelar se a conta existe.
    setErro(/fetch|network|timeout/i.test(error) ? 'Sem conexão com o servidor. Tente de novo.' : MSG_INVALIDO);
  };

  const esqueciSenha = async () => {
    const alvo = email.trim();
    setErro(null);
    setAviso(null);
    if (!alvo) {
      setErro('Informe seu e-mail acima para receber o link.');
      return;
    }
    setEnviandoReset(true);
    const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
    try {
      await supabase.auth.resetPasswordForEmail(alvo, redirectTo ? { redirectTo } : undefined);
    } catch {
      // resposta neutra de qualquer jeito
    }
    setEnviandoReset(false);
    setAviso('Se o e-mail existir, enviaremos um link para redefinir a senha.');
  };

  return (
    <AuthShell>
      <Surgir ordem={1}>
        <Text style={[theme.typography.h2, { color: c.text }]}>Bem-vindo de volta</Text>
        <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 4 }]}>Entre para ver suas rotas e o histórico.</Text>
      </Surgir>

      <Surgir ordem={2} style={{ marginTop: 24 }}>
        <Input
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

        <View style={styles.rotuloLinha}>
          <Text style={[theme.typography.captionMd, { color: c.text }]}>Senha</Text>
          <LinkTexto onPress={esqueciSenha} disabled={enviandoReset}>
            {enviandoReset ? 'Enviando…' : 'Esqueci a senha'}
          </LinkTexto>
        </View>
        <Input
          ref={senhaRef}
          accessibilityLabel="Senha"
          iconLeft="ion:lock-closed-outline"
          placeholder="Sua senha"
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={entrar}
          value={password}
          onChangeText={setPassword}
        />
      </Surgir>

      <Surgir ordem={3} style={{ gap: 16 }}>
        {erro ? (
          <Aviso tom="erro" detalhe={erro === MSG_INVALIDO ? 'Acabou de criar a conta? Confirme o e-mail antes de entrar.' : undefined}>
            {erro}
          </Aviso>
        ) : null}
        {aviso ? <Aviso tom="info">{aviso}</Aviso> : null}

        <Button label="Entrar" size="lg" fullWidth loading={loading} onPress={entrar} iconRight="ion:arrow-forward" />

        {LOGIN_GOOGLE_ATIVO ? (
          <>
            <View style={styles.ouLinha}>
              <View style={[styles.ouTraco, { backgroundColor: c.border }]} />
              <Text style={[theme.typography.micro, { color: c.textSubtle }]}>OU</Text>
              <View style={[styles.ouTraco, { backgroundColor: c.border }]} />
            </View>
            <Button label="Continuar com Google" variant="secondary" size="lg" fullWidth icon="ion:logo-google" />
          </>
        ) : null}
      </Surgir>

      <Surgir ordem={4} style={[styles.rodape, { borderTopColor: c.border }]}>
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>Não tem conta?</Text>
        <LinkTexto onPress={() => navigation.navigate('Register')}>Criar conta</LinkTexto>
      </Surgir>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  painel: { flex: 1, padding: 48, overflow: 'hidden', justifyContent: 'space-between' },
  grade: { position: 'absolute', top: 24, right: 24 },
  ponto: { position: 'absolute', width: 2, height: 2, borderRadius: 1 },
  marcaLinha: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  marcaIcone: { width: 36, height: 36 },
  marcaNome: { fontSize: 22, letterSpacing: -0.4 },
  prova: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  provaIcone: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  origem: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  destino: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  pulso: { position: 'absolute', width: 20, height: 20, borderRadius: 10 },
  carro: { position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  rotulo: { position: 'absolute' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  formCol: { width: '100%', maxWidth: 400, alignSelf: 'center' },
  logoMobile: { alignItems: 'center', marginBottom: 32 },
  rotuloLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  ouLinha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ouTraco: { flex: 1, height: 1 },
  aviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderWidth: 1 },
  rodape: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24, paddingTop: 20, borderTopWidth: 1 },
});
