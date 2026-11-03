// Cookie da sessão (auditoria de 2026-11-03, B4): Secure fora do dev e 30 dias sem uso (o padrão do @supabase/ssr é
// 400). Mesmas opções nos 3 clientes do painel e no app (apps/mobile/src/lib/supabase.ts), que dividem o cookie.
export const OPCOES_COOKIE = { secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30 };
