/** Erro de RPC (PostgrestError: code/message) ou da API FastAPI (status/detail). */
export type ErroBruto = { code?: string; message?: string; status?: number; retryAfter?: string | null };

export const MIGRACAO_ACOES = '20260923020000_admin_actions.sql';

// Função/tabela/coluna inexistente = migration das ações ainda não aplicada.
const FALTA_OBJETO = new Set(['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703']);

export const faltaMigracao = (e?: { code?: string } | null) => !!e?.code && FALTA_OBJETO.has(e.code);

/** "ação repetida" → "Ação repetida." */
const frase = (s: string | undefined, padrao: string) => {
  const t = (s || padrao).trim();
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
};

export function mensagemErro(e: ErroBruto): string {
  if (faltaMigracao(e)) return `Aplique a migration ${MIGRACAO_ACOES} (ver docs/core/rodar-local.md).`;
  switch (e.code) {
    case '42501':
      return 'Acesso negado.';
    case 'P0001':
    case '22023':
      return frase(e.message, 'ação recusada');
    case 'P0002':
      return frase(e.message, 'não encontrado');
    case '23514':
      return 'Valor recusado pelas regras do banco — confira os campos (ex.: fim depois do início).';
    case 'PGRST301':
    case 'PGRST303':
      return 'Sessão expirada — recarregue a página.';
  }
  if (e.status !== undefined) {
    switch (e.status) {
      case 0:
        return 'API fora do ar ou NEXT_PUBLIC_API_URL incorreta.';
      case 401:
        return 'Sessão expirada — recarregue a página.';
      case 403:
        return 'Acesso negado pela API.';
      case 429:
        return `${e.message ?? 'Muitas requisições.'}${e.retryAfter ? ` Tente de novo em ${e.retryAfter} s.` : ' Aguarde cerca de 1 minuto.'}`;
      default:
        return e.message ?? `Erro ${e.status} da API.`;
    }
  }
  return frase(e.message, 'erro inesperado');
}
