import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

// Deploy (scripts/empacotar-front.sh): o export web do Expo vai para public/ e a
// raiz passa a servir o app — mesmo domínio, um cookie de sessão só.
const comApp = existsSync(join(process.cwd(), 'public', 'index.html'));

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
// Terceiros do app web: mapa vetorial (MapLibre: estilo, tiles, fontes e sprite da OpenFreeMap; satélite
// da Esri buscado por fetch; CSS do jsDelivr), tiles do Leaflet de reserva, ícones Iconify e o fallback
// de localização por IP (components/mapa/geolocalizacao.ts).
const tiles = 'https://tiles.openfreemap.org https://tile.openstreetmap.org https://server.arcgisonline.com';
const jsdelivr = 'https://cdn.jsdelivr.net';
const iconify = 'https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com';
const ipGeo = 'https://ipapi.co';

// CSP no padrão do Valerium: começa em Report-Only (não quebra nada) e vira
// bloqueio com CSP_ENFORCE=1 depois de conferir o console em produção.
// Duas políticas (auditoria de 2026-11-03, M5): o app em / (export do Expo) não tem script inline e roda com
// script-src 'self'; o painel em /admin precisa de 'unsafe-inline' (hidratação do Next sem nonce).
// Atenção: a borda LiteSpeed da Hostinger pode sobrescrever o header — conferir
// com `curl -I` no domínio depois do deploy.
const politica = (scriptExtra: string) => [
  "default-src 'self'",
  `script-src 'self'${scriptExtra}${dev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline' ${jsdelivr}`,
  `img-src 'self' data: blob: ${tiles} ${jsdelivr}`,
  "font-src 'self' data:",
  `connect-src 'self' ${[supabase, supabase.replace('https://', 'wss://'), api, iconify, ipGeo, tiles].filter(Boolean).join(' ')}`,
  // O MapLibre roda o worker de um blob: (build padrão, sem o CSP build separado).
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const cspApp = politica('');
const cspPainel = politica(" 'unsafe-inline'");
const cabecalhoCsp = process.env.CSP_ENFORCE === '1' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Sem o otimizador de imagens (/_next/image): o painel não usa e o sharp tinha alertas críticos (auditoria M8).
  images: { unoptimized: true },
  // A Hostinger roda o servidor pronto (sem build lá): ver scripts/montar-front-linux.sh.
  output: 'standalone',
  async rewrites() {
    return comApp ? { beforeFiles: [{ source: '/', destination: '/index.html' }], afterFiles: [], fallback: [] } : [];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: cabecalhoCsp, value: cspApp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()' },
          // Popups permitidos: o login com Google (backlog) abre janela de OAuth.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      // Por último: no mesmo cabeçalho, a regra que vem depois vence (docs do Next).
      {
        source: '/admin/:path*',
        headers: [
          { key: cabecalhoCsp, value: cspPainel },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
