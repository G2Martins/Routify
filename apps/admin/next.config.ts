import type { NextConfig } from 'next';

const origem = (url?: string) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};

const supabase = origem(process.env.NEXT_PUBLIC_SUPABASE_URL);
const api = origem(process.env.NEXT_PUBLIC_API_URL);
const dev = process.env.NODE_ENV !== 'production';

// CSP no padrão do Valerium: começa em Report-Only (não quebra nada) e vira
// bloqueio com CSP_ENFORCE=1 depois de conferir o console em produção.
// 'unsafe-inline' em script é exigência da hidratação do Next sem nonce.
// Atenção: a borda LiteSpeed da Hostinger pode sobrescrever o header — conferir
// com `curl -I` no domínio depois do deploy.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${[supabase, supabase.replace('https://', 'wss://'), api].filter(Boolean).join(' ')}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: process.env.CSP_ENFORCE === '1' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // Popups permitidos: o login com Google (backlog) abre janela de OAuth.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
