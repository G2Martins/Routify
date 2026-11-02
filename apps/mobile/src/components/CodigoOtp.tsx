/**
 * Campo de código de 6 dígitos (verificação em duas etapas), na linguagem de auth do Valerium.
 *
 * Um TextInput invisível por cima de 6 "tiles": colar, autopreenchimento (app autenticador, SMS) e
 * apagar funcionam nativamente, sem N campos. O dígito entra com pop; o tile ativo sobe 2 px com anel;
 * no erro, o conjunto treme 420 ms, limpa e refoca; enquanto verifica, uma barra varre embaixo; no
 * sucesso, um selo. Envia sozinho no último dígito (quem chama verifica). Só `Animated`: roda igual na
 * web e no celular; tudo para com "reduzir movimento".
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';
import { useMenosMovimento } from './ui';

export type StatusCodigo = 'ocioso' | 'verificando' | 'erro' | 'sucesso';

const NATIVO = Platform.OS !== 'web';

function Tile({ char, ativo, status, largo }: { char: string; ativo: boolean; status: StatusCodigo; largo: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const pop = useRef(new Animated.Value(1)).current;
  const pisca = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!char || reduzir) return;
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 220, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO }).start();
  }, [char]); // eslint-disable-line react-hooks/exhaustive-deps

  const caret = ativo && status === 'ocioso' && !char;
  useEffect(() => {
    if (!caret || reduzir) return;
    pisca.setValue(0);
    const loop = Animated.loop(Animated.timing(pisca, { toValue: 1, duration: 1250, easing: Easing.linear, useNativeDriver: NATIVO }));
    loop.start();
    return () => loop.stop();
  }, [caret, reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const cor =
    status === 'erro' ? c.danger : status === 'sucesso' ? c.accent : status === 'verificando' ? c.textMuted : c.text;
  const borda =
    status === 'erro' ? c.danger : status === 'sucesso' ? c.accent : ativo && status === 'ocioso' ? c.accent : c.border;
  const base =
    status === 'erro' ? c.danger : status === 'sucesso' || (ativo && status === 'ocioso') ? c.accent : c.borderStrong;

  return (
    <View
      style={[
        styles.tile,
        largo && styles.tileLargo,
        {
          backgroundColor: c.surface,
          borderColor: borda,
          borderBottomColor: base,
          transform: [{ translateY: ativo && status === 'ocioso' ? -2 : 0 }],
          boxShadow: ativo && status === 'ocioso' ? `0 0 0 3px ${c.ring}` : undefined,
        },
      ]}
    >
      {char ? (
        <Animated.Text
          style={[
            styles.digito,
            { color: cor, fontFamily: theme.fonts.mono },
            {
              opacity: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
              transform: [{ scale: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.55, 1.08, 1] }) }],
            },
          ]}
        >
          {char}
        </Animated.Text>
      ) : caret ? (
        <Animated.View
          style={[
            styles.caret,
            { backgroundColor: c.text, opacity: reduzir ? 1 : pisca.interpolate({ inputRange: [0, 0.2, 0.5, 0.7, 1], outputRange: [1, 0, 0, 1, 1] }) },
          ]}
        />
      ) : null}
    </View>
  );
}

export default function CodigoOtp({
  onCompleto,
  status,
  mensagem,
  rotulo = 'Código de verificação',
  rotuloVerificando = 'Verificando…',
  rotuloSucesso = 'Código confirmado',
  comprimento = 6,
  autoFocus = true,
}: {
  onCompleto: (codigo: string) => void;
  status: StatusCodigo;
  /** Texto da linha de status no erro (diga o que fazer, não só o que deu errado). */
  mensagem?: string | null;
  rotulo?: string;
  rotuloVerificando?: string;
  rotuloSucesso?: string;
  comprimento?: number;
  autoFocus?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const reduzir = useMenosMovimento();
  const [valor, setValor] = useState('');
  const [foco, setFoco] = useState(false);
  const [larguraTrilho, setLarguraTrilho] = useState(0);
  const [largo, setLargo] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const treme = useRef(new Animated.Value(0)).current;
  const varre = useRef(new Animated.Value(0)).current;
  const selo = useRef(new Animated.Value(0)).current;
  // Depois do erro, digitar de novo já mostra os tiles neutros (sem esperar o pai limpar o erro).
  const visivel: StatusCodigo = status === 'erro' && valor.length > 0 ? 'ocioso' : status;
  const travado = status === 'verificando' || status === 'sucesso';

  // Erro: treme, limpa e refoca (quem digita de novo já vê os tiles neutros).
  useEffect(() => {
    if (status !== 'erro') return;
    setValor('');
    if (!reduzir) {
      treme.setValue(0);
      Animated.timing(treme, { toValue: 1, duration: 420, easing: theme.motion.easeShake, useNativeDriver: NATIVO }).start();
    }
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verificando: barra varrendo; sucesso: selo com pop.
  useEffect(() => {
    if (status === 'sucesso') {
      selo.setValue(reduzir ? 1 : 0);
      if (!reduzir) Animated.timing(selo, { toValue: 1, duration: 220, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO }).start();
    }
    if (status !== 'verificando' || reduzir) return;
    varre.setValue(0);
    const loop = Animated.loop(
      Animated.timing(varre, { toValue: 1, duration: 1100, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: NATIVO })
    );
    loop.start();
    return () => loop.stop();
  }, [status, reduzir]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (texto: string) => {
    const so = texto.replace(/\D/g, '').slice(0, comprimento); // colar "123 456" ou "123-456" funciona
    setValor(so);
    if (so.length === comprimento && !travado) onCompleto(so);
  };

  const ativo = Math.min(valor.length, comprimento - 1);
  const meio = Math.floor(comprimento / 2);
  const tiles: React.ReactNode[] = [];
  for (let i = 0; i < comprimento; i++) {
    if (i === meio) {
      tiles.push(
        <Text key="sep" style={[styles.separador, { color: c.textSubtle }]} accessibilityElementsHidden importantForAccessibility="no">
          ·
        </Text>
      );
    }
    tiles.push(
      <Tile key={i} char={valor[i] ?? ''} ativo={foco && i === ativo && valor.length < comprimento} status={visivel} largo={largo} />
    );
  }

  const barra = larguraTrilho / 3;
  return (
    <View style={styles.raiz} onLayout={(e) => setLargo(e.nativeEvent.layout.width >= 400)}>
      <Animated.View
        style={[
          styles.linha,
          {
            transform: [
              {
                translateX: treme.interpolate({
                  inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
                  outputRange: [0, -2, 4, -6, 6, -6, 6, -6, 4, -2, 0],
                }),
              },
            ],
          },
        ]}
      >
        {tiles}
        <TextInput
          ref={inputRef}
          value={valor}
          onChangeText={mudar}
          onFocus={() => setFoco(true)}
          onBlur={() => setFoco(false)}
          editable={!travado}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          maxLength={comprimento}
          caretHidden
          contextMenuHidden={false}
          accessibilityLabel={rotulo}
          style={styles.entrada}
        />
      </Animated.View>

      <View
        style={[styles.trilho, { backgroundColor: c.border, opacity: status === 'verificando' ? 1 : 0 }]}
        onLayout={(e) => setLarguraTrilho(e.nativeEvent.layout.width)}
      >
        {status === 'verificando' && larguraTrilho > 0 ? (
          <Animated.View
            style={[
              styles.barra,
              {
                width: barra,
                backgroundColor: c.accent,
                transform: [{ translateX: varre.interpolate({ inputRange: [0, 1], outputRange: [-barra, larguraTrilho] }) }],
              },
            ]}
          />
        ) : null}
      </View>

      <View style={styles.status} accessibilityLiveRegion="polite" aria-live="polite">
        {status === 'verificando' ? (
          <>
            <ActivityIndicator size="small" color={c.textMuted} />
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>{rotuloVerificando}</Text>
          </>
        ) : visivel === 'erro' && mensagem ? (
          <Text style={[theme.typography.captionMd, { color: c.danger, textAlign: 'center' }]}>{mensagem}</Text>
        ) : status === 'sucesso' ? (
          <Animated.View
            style={[
              styles.sucesso,
              {
                opacity: selo,
                transform: [{ scale: selo.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.55, 1.08, 1] }) }],
              },
            ]}
          >
            <View style={[styles.selo, { backgroundColor: c.accent }]}>
              <Icon name="ion:checkmark" size={13} color={c.onAccent} />
            </View>
            <Text style={[theme.typography.captionMd, { color: c.text }]}>{rotuloSucesso}</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { alignItems: 'center', width: '100%' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, position: 'relative' },
  tile: {
    width: 44,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderBottomWidth: 2, // a "borda tátil" muda de cor com o estado
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLargo: { width: 48, height: 64 },
  digito: { fontSize: 24, fontVariant: ['tabular-nums'] },
  caret: { width: 1.5, height: 24, borderRadius: 1 },
  separador: { fontSize: 20, marginHorizontal: 2 },
  // Cobre os tiles: recebe toque, colar e autopreenchimento; invisível (cor e seleção transparentes).
  entrada: { ...StyleSheet.absoluteFillObject, opacity: 0.011, color: 'transparent', fontSize: 1 },
  trilho: { height: 2, width: '100%', maxWidth: 288, marginTop: 14, borderRadius: 1, overflow: 'hidden' },
  barra: { height: 2, borderRadius: 1 },
  status: { minHeight: 24, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sucesso: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
