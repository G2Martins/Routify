/**
 * Versão da LIA que a API está servindo agora (GET /health, público). Chamada do servidor,
 * com cache de 60 s. null = API fora do ar: a tela avisa em vez de adivinhar a versão.
 */
export async function modeloAtivo(): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) return null;
  try {
    const r = await fetch(`${base}/health`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const versao = ((await r.json()) as { modelo_ativo?: unknown }).modelo_ativo;
    return typeof versao === 'string' && versao ? versao : null;
  } catch {
    return null;
  }
}
