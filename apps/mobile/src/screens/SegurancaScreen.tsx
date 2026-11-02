/**
 * Perfil → Segurança: verificação em duas etapas (TOTP do Supabase Auth).
 *
 * Ativar: remove fatores abandonados (não verificados), cadastra um novo e mostra o QR (web) ou o botão
 * "Abrir no app autenticador" (celular: não dá para escanear a própria tela), mais a chave para digitar.
 * O primeiro código confirma o cadastro e já sobe a sessão para aal2. Desativar exige sessão aal2
 * (regra do Supabase): quem acabou de passar pela verificação pode.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import CodigoOtp, { StatusCodigo } from '../components/CodigoOtp';
import Icon from '../components/Icon';
import { Cartao, Container, Surgir, TituloPagina } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { qrFundo } from '../constants/Theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';

type Estado = 'carregando' | 'inativo' | 'cadastrando' | 'ativo';
type Cadastro = { id: string; qr: string; segredo: string; uri: string };

const WEB = Platform.OS === 'web';

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": mais fácil de ler e digitar. */
const emGrupos = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

function confirmar(titulo: string, texto: string): Promise<boolean> {
  if (WEB) return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${titulo}\n\n${texto}`));
  return new Promise((ok) =>
    Alert.alert(titulo, texto, [
      { text: 'Cancelar', style: 'cancel', onPress: () => ok(false) },
      { text: 'Desativar', style: 'destructive', onPress: () => ok(true) },
    ])
  );
}

export default function SegurancaScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { atualizarAal } = useAuth();
  const [estado, setEstado] = useState<Estado>('carregando');
  const [fatorAtivo, setFatorAtivo] = useState<string | null>(null);
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [status, setStatus] = useState<StatusCodigo>('ocioso');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setErro('Não foi possível ler suas configurações agora. Tente de novo.');
      setEstado('inativo');
      return;
    }
    const verificado = (data?.totp ?? []).find((f) => f.status === 'verified');
    setFatorAtivo(verificado?.id ?? null);
    setEstado(verificado ? 'ativo' : 'inativo');
  };

  useEffect(() => {
    carregar();
  }, []);

  const ativar = async () => {
    setErro(null);
    setOcupado(true);
    // Cadastro abandonado no meio fica como "não verificado" e bloqueia um novo com o mesmo nome.
    const { data: lista } = await supabase.auth.mfa.listFactors();
    for (const f of (lista?.all ?? []).filter((x) => x.status !== 'verified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Routify ${Date.now()}`, issuer: 'Routify' });
    setOcupado(false);
    if (error || !data) {
      setErro('Não foi possível iniciar a ativação. Tente de novo em instantes.');
      return;
    }
    setCadastro({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret, uri: data.totp.uri });
    setStatus('ocioso');
    setMensagem(null);
    setEstado('cadastrando');
  };

  const confirmarCodigo = async (codigo: string) => {
    if (!cadastro) return;
    setStatus('verificando');
    setMensagem(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: cadastro.id, code: codigo });
    if (error) {
      setMensagem('Código inválido. Confira se o horário do celular está no automático e use o próximo código.');
      setStatus('erro');
      return;
    }
    setStatus('sucesso');
    await atualizarAal();
    setTimeout(() => {
      setCadastro(null);
      setFatorAtivo(cadastro.id);
      setEstado('ativo');
    }, 900);
  };

  const desativar = async () => {
    if (!fatorAtivo) return;
    const ok = await confirmar(
      'Desativar a verificação em duas etapas?',
      'Sua conta volta a depender só da senha. Você pode ativar de novo quando quiser.'
    );
    if (!ok) return;
    setOcupado(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorAtivo });
    setOcupado(false);
    if (error) {
      setErro('Para desativar, saia e entre de novo confirmando o código do app.');
      return;
    }
    await supabase.auth.refreshSession();
    await atualizarAal();
    setFatorAtivo(null);
    setEstado('inativo');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ paddingBottom: 48 }}>
      <Container>
        <TituloPagina titulo="Segurança" sub="Verificação em duas etapas para a sua conta" />

        {estado === 'carregando' ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 32 }} />
        ) : null}

        {estado === 'inativo' || estado === 'ativo' ? (
          <Surgir auth ordem={1}>
            <Cartao elevado padding={24}>
              <View style={styles.cabecalho}>
                <View style={[styles.icone, { backgroundColor: estado === 'ativo' ? c.accentSoft : c.surfaceAlt }]}>
                  <Icon name="ion:shield-checkmark-outline" size={22} color={estado === 'ativo' ? c.accent : c.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.h4, { color: c.text }]}>Verificação em duas etapas</Text>
                  <Text style={[theme.typography.caption, { color: estado === 'ativo' ? c.success : c.textMuted, marginTop: 2 }]}>
                    {estado === 'ativo' ? 'Ativa: ao entrar, pedimos o código do app.' : 'Desativada'}
                  </Text>
                </View>
              </View>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 16 }]}>
                {estado === 'ativo'
                  ? 'Mesmo com a sua senha, ninguém entra sem o código que muda a cada 30 segundos no seu celular.'
                  : 'Além da senha, peça um código do seu app autenticador ao entrar. Protege seu histórico de rotas, que é dado de localização.'}
              </Text>
              {erro ? <Text style={[theme.typography.captionMd, { color: c.danger, marginTop: 12 }]}>{erro}</Text> : null}
              <View style={{ marginTop: 20 }}>
                {estado === 'ativo' ? (
                  <Button label="Desativar" variant="secondary" loading={ocupado} onPress={desativar} />
                ) : (
                  <Button label="Ativar" loading={ocupado} onPress={ativar} iconRight="ion:arrow-forward" />
                )}
              </View>
            </Cartao>
          </Surgir>
        ) : null}

        {estado === 'cadastrando' && cadastro ? (
          <Surgir auth ordem={1}>
            <Cartao elevado padding={24}>
              <Text style={[theme.typography.eyebrow, { color: c.textSubtle }]}>Passo 1 de 2 · Adicione ao app</Text>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 8 }]}>
                {WEB
                  ? 'Escaneie o QR com o app autenticador (Google Authenticator, Microsoft Authenticator, 1Password).'
                  : 'Toque para abrir no app autenticador ou digite a chave abaixo nele.'}
              </Text>
              {WEB ? (
                <View style={[styles.qr, { backgroundColor: qrFundo, borderColor: c.border }]}>
                  <Image source={{ uri: cadastro.qr }} style={styles.qrImagem} accessibilityLabel="QR da verificação em duas etapas" />
                </View>
              ) : (
                <View style={{ marginTop: 16 }}>
                  <Button label="Abrir no app autenticador" variant="secondary" icon="ion:open-outline" onPress={() => Linking.openURL(cadastro.uri)} />
                </View>
              )}
              <Text style={[theme.typography.caption, { color: c.textSubtle, marginTop: 16 }]}>Ou digite a chave:</Text>
              <Text selectable style={[styles.segredo, { color: c.text, backgroundColor: c.surfaceAlt, fontFamily: theme.fonts.mono }]}>
                {emGrupos(cadastro.segredo)}
              </Text>

              <Text style={[theme.typography.eyebrow, { color: c.textSubtle, marginTop: 24 }]}>Passo 2 de 2 · Confirme</Text>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 8, marginBottom: 16 }]}>
                Digite o código que aparece no app para concluir.
              </Text>
              <CodigoOtp onCompleto={confirmarCodigo} status={status} mensagem={mensagem} rotuloSucesso="Verificação ativada" />
              <View style={{ marginTop: 8, alignItems: 'center' }}>
                <Button label="Cancelar" variant="ghost" onPress={() => { setCadastro(null); carregar(); }} />
              </View>
            </Cartao>
          </Surgir>
        ) : null}
      </Container>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icone: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  qr: { alignSelf: 'center', marginTop: 18, padding: 14, borderRadius: 16, borderWidth: 1 },
  qrImagem: { width: 196, height: 196 },
  segredo: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, fontSize: 15, letterSpacing: 1 },
});
