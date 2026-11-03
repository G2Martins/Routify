import { Platform } from 'react-native';
import { supabase } from './supabase';

export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8000';

/** Painel ADM (Next) no mesmo domínio em produção (`/admin`); em dev roda no :3000. */
export const ADMIN_URL =
  (process.env.EXPO_PUBLIC_ADMIN_URL as string | undefined) ?? 'http://localhost:3000/admin';

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

/** POST na API com o JWT da sessão. Devolve o status e o JSON (null sem corpo); erro de rede sobe. */
export async function postApi<T = unknown>(caminho: string, corpo?: unknown): Promise<{ status: number; dados: T | null }> {
  const r = await fetch(`${API_URL}${caminho}`, {
    method: 'POST',
    headers: await apiHeaders(corpo !== undefined),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados: T | null = null;
  try {
    dados = (await r.json()) as T;
  } catch {
    // resposta sem JSON
  }
  return { status: r.status, dados };
}
