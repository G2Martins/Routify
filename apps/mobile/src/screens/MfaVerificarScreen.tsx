/**
 * Etapa 2 do login: quem ativou a verificação em duas etapas (TOTP) e entrou só com a senha (sessão
 * aal1) para aqui até digitar o código do app autenticador. O banco e a API também exigem aal2 dessa
 * pessoa (supabase/migrations/20261102020000_mfa_aal2.sql, seguranca.exigir_admin): esta tela é a
 * porta, não a tranca.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import CodigoOtp, { StatusCodigo } from '../components/CodigoOtp';
import { Surgir } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { AuthShell, LinkTexto } from './LoginScreen';

const PAUSA_S = 30; // depois de 5 códigos errados seguidos

export default function MfaVerificarScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { signOut, atualizarAal } = useAuth();
  const [status, setStatus] = useState<StatusCodigo>('ocioso');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pausa, setPausa] = useState(0);
  const falhas = useRef(0);

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
          Digite o código de 6 dígitos do seu app autenticador (Google Authenticator, Microsoft Authenticator, 1Password).
        </Text>
      </Surgir>
      <Surgir auth ordem={3} style={{ marginTop: 28 }}>
        <CodigoOtp onCompleto={verificar} status={status} mensagem={mensagem} />
      </Surgir>
      <Surgir auth ordem={4} style={{ marginTop: 18, gap: 14, alignItems: 'center' }}>
        <Text style={[theme.typography.caption, { color: c.textSubtle, textAlign: 'center' }]}>
          O código muda a cada 30 segundos. Se não passar, confira se o horário do celular está no automático.
        </Text>
        <LinkTexto onPress={() => signOut()}>Entrar com outra conta</LinkTexto>
      </Surgir>
    </AuthShell>
  );
}
