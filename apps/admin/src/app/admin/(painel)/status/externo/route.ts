import { NextResponse } from 'next/server';
import { souAdmin } from '@/lib/auth';
import type { ProvedorExterno } from '@/lib/tipos';

/**
 * Páginas de status públicas dos provedores de que o Routify depende, lidas pelo servidor do painel (fora da CSP do
 * navegador), com cache de 60 s. URLs fixas: nada vem da requisição (sem SSRF). Texto externo sai truncado e o
 * React escapa na tela.
 */
const STATUSPAGE = [
  { nome: 'Supabase (banco e login)', url: 'https://status.supabase.com', api: 'https://status.supabase.com/api/v2/summary.json' },
  { nome: 'Hostinger (site e painel)', url: 'https://statuspage.hostinger.com', api: 'https://statuspage.hostinger.com/api/v2/summary.json' },
  { nome: 'GitHub (código e CI)', url: 'https://www.githubstatus.com', api: 'https://www.githubstatus.com/api/v2/summary.json' },
];
const AWS = { nome: 'AWS us-east-1 (API da LIA)', url: 'https://health.aws.amazon.com/health/status', api: 'https://health.aws.amazon.com/public/currentevents' };
const INDICADOR: Record<string, ProvedorExterno['indicador']> = { none: 'ok', minor: 'menor', major: 'maior', critical: 'critico' };

const curto = (s: unknown, n = 140) => String(s ?? '').slice(0, n);

async function statuspage(p: (typeof STATUSPAGE)[number]): Promise<ProvedorExterno> {
  try {
    const r = await fetch(p.api, { next: { revalidate: 60 }, signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    const abertos = (Array.isArray(j?.incidents) ? j.incidents : []).filter((i: { status?: string }) => i?.status !== 'resolved');
    return {
      nome: p.nome, url: p.url, indicador: INDICADOR[j?.status?.indicator] ?? 'desconhecido',
      descricao: curto(j?.status?.description), incidentes: abertos.slice(0, 3).map((i: { name?: string }) => curto(i?.name)),
    };
  } catch {
    return { nome: p.nome, url: p.url, indicador: 'desconhecido', descricao: 'A página de status não respondeu.', incidentes: [] };
  }
}

async function aws(): Promise<ProvedorExterno> {
  try {
    const r = await fetch(AWS.api, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    const eventos: { region_name?: string; arn?: string; service_name?: string; summary?: string }[] =
      JSON.parse(new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes).replace(/^﻿/, ''));
    const nossos = eventos.filter((e) => /us-east-1|N\. Virginia/i.test(`${e.region_name ?? ''} ${e.arn ?? ''}`));
    return {
      nome: AWS.nome, url: AWS.url, indicador: nossos.length ? 'maior' : 'ok',
      descricao: nossos.length ? `${nossos.length} evento(s) ativo(s) na região` : 'Sem eventos ativos na região',
      incidentes: nossos.slice(0, 3).map((e) => curto(`${e.service_name ?? ''}: ${e.summary ?? ''}`)),
    };
  } catch {
    return { nome: AWS.nome, url: AWS.url, indicador: 'desconhecido', descricao: 'O painel de saúde da AWS não respondeu.', incidentes: [] };
  }
}

export async function GET() {
  if (!(await souAdmin())) return new NextResponse(null, { status: 404 });  // como qualquer endereço inexistente
  const provedores = await Promise.all([...STATUSPAGE.map(statuspage), aws()]);
  return NextResponse.json({ provedores, verificado_em: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
