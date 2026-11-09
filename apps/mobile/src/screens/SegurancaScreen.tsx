/**
 * Perfil → Segurança: verificação em duas etapas (TOTP do Supabase Auth).
 *
 * Ativar: remove fatores abandonados (não verificados), cadastra um novo e mostra o QR (web) ou o botão
 * "Abrir no app autenticador" (celular: não dá para escanear a própria tela), mais a chave para digitar.
 * O primeiro código confirma o cadastro e já sobe a sessão para aal2. Desativar exige sessão aal2
 * (regra do Supabase): quem acabou de passar pela verificação pode.
 *
 * Códigos de recuperação (POST /mfa/codigos-recuperacao, exige aal2): 10 códigos de uso único, mostrados uma vez.
 * Sem o celular, um deles desativa a verificação na etapa 2 do login (MfaVerificarScreen).
 */
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import CodigoOtp, { StatusCodigo } from '../components/CodigoOtp';
import Icon from '../components/Icon';
import { Cartao, Skeleton, Surgir, Tela, TituloPagina } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { qrFundo } from '../constants/Theme';
import { useTheme } from '../context/ThemeContext';
import { postApi } from '../lib/api';
import { supabase } from '../lib/supabase';

type Estado = 'carregando' | 'inativo' | 'cadastrando' | 'ativo';
type Cadastro = { id: string; qr: string; segredo: string; uri: string };

const WEB = Platform.OS === 'web';

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": mais fácil de ler e digitar. */
const emGrupos = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

function confirmar(titulo: string, texto: string, acao = 'Desativar'): Promise<boolean> {
  if (WEB) return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${titulo}\n\n${texto}`));
  return new Promise((ok) =>
    Alert.alert(titulo, texto, [
      { text: 'Cancelar', style: 'cancel', onPress: () => ok(false) },
      { text: acao, style: 'destructive', onPress: () => ok(true) },
    ])
  );
}

export default function SegurancaScreen({ navigation }: any) {
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
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroCodigos, setErroCodigos] = useState<string | null>(null);
  const [copiados, setCopiados] = useState(false);

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

  const gerarCodigos = async () => {
    const ok = await confirmar(
      'Gerar códigos de recuperação?',
      'Se você gerou códigos antes, eles deixam de valer. Os novos aparecem uma única vez.',
      'Gerar'
    );
    if (!ok) return;
    setErroCodigos(null);
    setGerando(true);
    try {
      const { status: s, dados } = await postApi<{ codigos: string[] }>('/mfa/codigos-recuperacao');
      if (s === 200 && dados?.codigos?.length) {
        setCopiados(false);
        setCodigos(dados.codigos);
      } else {
        setErroCodigos(
          s === 403
            ? 'Saia e entre de novo confirmando o código do app para gerar os códigos.'
            : s === 429
              ? 'Muitas gerações em pouco tempo. Tente de novo mais tarde.'
              : 'Não foi possível gerar agora. Tente de novo em instantes.'
        );
      }
    } catch {
      setErroCodigos('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setGerando(false);
    }
  };

  // Web: área de transferência. Celular: folha de compartilhar do sistema (notas, gerenciador de senhas).
  const guardarCodigos = async () => {
    if (!codigos) return;
    const texto = `Routify · códigos de recuperação (cada um vale uma vez)\n${codigos.join('\n')}`;
    try {
      if (WEB) {
        await navigator.clipboard.writeText(texto);
        setCopiados(true);
      } else {
        await Share.share({ message: texto });
      }
    } catch {
      setErroCodigos('Não deu para copiar: selecione os códigos e copie à mão.');
    }
  };

  return (
    <Tela voltar={() => navigation.goBack()}>
        <TituloPagina titulo="Segurança" />

        {estado === 'carregando' ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Carregando" style={{ marginTop: 20 }}>
            <Cartao padding={24}>
              <Skeleton altura={18} largura="60%" />
              <View style={{ height: 14 }} />
              <Skeleton altura={14} />
              <View style={{ height: 8 }} />
              <Skeleton altura={14} largura="80%" />
            </Cartao>
          </View>
        ) : null}

        {estado === 'inativo' || estado === 'ativo' ? (
          <Surgir auth ordem={1} style={{ marginTop: 20 }}>
            <Cartao elevado padding={20}>
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
                  : 'Ao entrar, além da senha, peça um código do seu app autenticador.'}
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

        {estado === 'ativo' ? (
          <Surgir auth ordem={2} style={{ marginTop: 16 }}>
            <Cartao elevado padding={20}>
              <View style={styles.cabecalho}>
                <View style={[styles.icone, { backgroundColor: c.surfaceAlt }]}>
                  <Icon name="ion:key-outline" size={22} color={c.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.h4, { color: c.text }]}>Códigos de recuperação</Text>
                  <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]}>Para quando o celular não estiver à mão</Text>
                </View>
              </View>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 16 }]}>
                Se perder o celular, um destes códigos desativa a verificação para você entrar de novo. Cada um vale uma vez.
              </Text>
              {erroCodigos ? <Text style={[theme.typography.captionMd, { color: c.danger, marginTop: 12 }]}>{erroCodigos}</Text> : null}
              {codigos ? (
                <View style={{ marginTop: 16 }}>
                  <View style={[styles.codigos, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
                    {codigos.map((cod) => (
                      <Text key={cod} selectable style={[styles.codigo, { color: c.text, fontFamily: theme.fonts.mono }]}>
                        {cod}
                      </Text>
                    ))}
                  </View>
                  <Text style={[theme.typography.captionMd, { color: c.warning, marginTop: 10 }]}>
                    Guarde agora: eles não aparecem de novo.
                  </Text>
                  <View style={styles.acoes}>
                    <Button
                      label={WEB ? (copiados ? 'Copiados' : 'Copiar') : 'Compartilhar'}
                      variant="secondary"
                      icon={WEB ? (copiados ? 'ion:checkmark' : 'ion:copy-outline') : 'ion:share-outline'}
                      onPress={guardarCodigos}
                    />
                    <Button label="Já guardei" variant="ghost" onPress={() => setCodigos(null)} />
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: 20 }}>
                  <Button label="Gerar códigos" variant="secondary" loading={gerando} onPress={gerarCodigos} />
                </View>
              )}
            </Cartao>
          </Surgir>
        ) : null}

        {estado === 'cadastrando' && cadastro ? (
          <Surgir auth ordem={1} style={{ marginTop: 20 }}>
            <Cartao elevado padding={20}>
              <Text style={[theme.typography.eyebrow, { color: c.textSubtle }]}>Passo 1 de 2 · Adicione ao app</Text>
              <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 8 }]}>
                {WEB
                  ? 'Escaneie o QR com o app autenticador (Google Authenticator, por exemplo).'
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
    </Tela>
  );
}

const styles = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icone: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  qr: { alignSelf: 'center', marginTop: 18, padding: 14, borderRadius: 16, borderWidth: 1 },
  qrImagem: { width: 196, height: 196 },
  segredo: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, fontSize: 15, letterSpacing: 1 },
  codigos: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, padding: 16, borderRadius: 12, borderWidth: 1 },
  // Duas colunas só quando cabe: o código tem 19 caracteres e não pode quebrar no meio.
  codigo: { flexGrow: 1, flexBasis: 190, fontSize: 15, letterSpacing: 0.5 },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
});
