import { Platform } from 'react-native';
import { supabase } from './supabase';

export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8000';

/**
 * Cabeçalhos para a API com o JWT da sessão Supabase. A API valida o token no
 * servidor e associa o uso à conta (painel ADM). Sem sessão, segue anônimo.
 */
export async function apiHeaders(json = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type TipoEvento =
  | 'busca'
  | 'rota_solicitada'
  | 'navegacao_iniciada'
  | 'navegacao_concluida'
  | 'feedback';

/**
 * Evento de uso para o painel ADM. Fire-and-forget: nunca bloqueia nem quebra a
 * tela. Não enviar coordenadas nem texto digitado (a API recusa — LGPD).
 */
export function enviarEvento(
  tipo: TipoEvento,
  dados: Record<string, string | number | boolean | null> = {}
): void {
  void (async () => {
    try {
      const headers = await apiHeaders();
      if (!headers.Authorization) return; // evento exige login
      const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
      await fetch(`${API_URL}/eventos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tipo, plataforma, dados }),
      });
    } catch {
      // uso é best-effort
    }
  })();
}
