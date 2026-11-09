/**
 * Etapa 2 do login: quem ativou a verificação em duas etapas (TOTP) e entrou só com a senha (sessão
 * aal1) para aqui até digitar o código do app autenticador. O banco e a API também exigem aal2 dessa
 * pessoa (supabase/migrations/20261102020000_mfa_aal2.sql, seguranca.exigir_admin): esta tela é a
 * porta, não a tranca.
 *
 * Sem o celular: um dos códigos de recuperação (Perfil → Segurança) vai para POST /mfa/recuperar, que remove
 * o 2º fator. O Supabase encerra as sessões da conta nessa hora, então a pessoa entra de novo só com a senha.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Text } from 'react-native';
import Button from '../components/Button';
import CodigoOtp, { StatusCodigo } from '../components/CodigoOtp';
import Input from '../components/Input';
import { Surgir } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { postApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { AuthShell, LinkTexto } from './LoginScreen';

const PAUSA_S = 30; // depois de 5 códigos errados seguidos

function avisar(titulo: string, texto: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${titulo}\n\n${texto}`);
    return Promise.resolve();
  }
  return new Promise((ok) => Alert.alert(titulo, texto, [{ text: 'Entendi', onPress: () => ok() }]));
}

export default function MfaVerificarScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signOut, atualizarAal } = useAuth();
  const [status, setStatus] = useState<StatusCodigo>('ocioso');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pausa, setPausa] = useState(0);
  const falhas = useRef(0);
  const [recuperando, setRecuperando] = useState(false);
  const [codigoRec, setCodigoRec] = useState('');
  const [erroRec, setErroRec] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (pausa <= 0) return;
    const t = setTimeout(() => setPausa((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [pausa]);

  const verificar = async (codigo: string) => {
    if (pausa > 0) {
      setMensagem(`Muitas tentativas. Aguarde ${pausa} s e tente de novo.`);
      setStatus('erro');
      return;
    }
    setStatus('verificando');
    setMensagem(null);
    const { data, error } = await supabase.auth.mfa.listFactors();
    // O código só vale para o autenticador de origem: tenta cada fator verificado.
    for (const fator of (data?.totp ?? []).filter((f) => f.status === 'verified')) {
      const r = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
      if (!r.error) {
        setStatus('sucesso');
        setTimeout(() => atualizarAal(), 700); // o selo aparece antes de trocar de tela
        return;
      }
    }
    falhas.current += 1;
    if (falhas.current >= 5) {
      falhas.current = 0;
      setPausa(PAUSA_S);
    }
    setMensagem(
      error ? 'Sem conexão com o servidor. Tente de novo.' : 'Código inválido ou expirado. Espere o próximo código no app e tente de novo.'
    );
    setStatus('erro');
  };

  const usarCodigoRecuperacao = async () => {
    if (ocupado) return;
    setErroRec(null);
    setOcupado(true);
    try {
      const { status: s } = await postApi('/mfa/recuperar', { codigo: codigoRec.trim() });
      if (s === 200) {
        await avisar(
          'Verificação em duas etapas desativada',
          'O código foi aceito. Entre de novo só com a senha e, em Perfil → Segurança, ative a verificação outra vez.'
        );
        await signOut();
        return;
      }
      setErroRec(
        s === 429
          ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
          : s === 400 || s === 422
            ? 'Código inválido ou já usado. Confira e tente de novo.'
            : 'Não foi possível conferir agora. Tente de novo em instantes.'
      );
    } catch {
      setErroRec('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <AuthShell>
      <Surgir auth ordem={0}>
        <Text style={[theme.typography.eyebrow, { color: c.textSubtle }]}>Etapa 2 de 2 · Verificação</Text>
      </Surgir>
      <Surgir auth ordem={1} style={{ marginTop: 10 }}>
        <Text style={[theme.typography.h2, { color: c.text }]}>Confirme que é você.</Text>
      </Surgir>
      <Surgir auth ordem={2} style={{ marginTop: 8 }}>
        <Text style={[theme.typography.body, { color: c.textMuted }]}>
          {recuperando
            ? 'Digite um dos códigos de recuperação que você guardou. Ele desativa a verificação para você entrar de novo.'
            : 'Digite o código de 6 dígitos do seu app autenticador.'}
        </Text>
      </Surgir>
      {recuperando ? (
        <Surgir auth ordem={3} style={{ marginTop: 28, gap: 16 }}>
          <Input
            label="Código de recuperação"
            iconLeft="ion:key-outline"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={24}
            value={codigoRec}
            onChangeText={setCodigoRec}
            onSubmitEditing={usarCodigoRecuperacao}
            error={erroRec}
          />
          <Button
            label="Usar código"
            loading={ocupado}
            disabled={codigoRec.replace(/[^A-Za-z0-9]/g, '').length < 16}
            onPress={usarCodigoRecuperacao}
          />
        </Surgir>
      ) : (
        <Surgir auth ordem={3} style={{ marginTop: 28 }}>
          <CodigoOtp onCompleto={verificar} status={status} mensagem={mensagem} />
        </Surgir>
      )}
      <Surgir auth ordem={4} style={{ marginTop: 18, gap: 14, alignItems: 'center' }}>
        {recuperando ? null : (
          <Text style={[theme.typography.caption, { color: c.textSubtle, textAlign: 'center' }]}>
            O código muda a cada 30 segundos. Se não passar, confira se o horário do celular está no automático.
          </Text>
        )}
        <LinkTexto
          onPress={() => {
            setRecuperando((r) => !r);
            setErroRec(null);
          }}
        >
          {recuperando ? 'Voltar ao código do app' : 'Perdi o acesso ao app autenticador'}
        </LinkTexto>
        <LinkTexto onPress={() => signOut()}>Entrar com outra conta</LinkTexto>
      </Surgir>
    </AuthShell>
  );
}
