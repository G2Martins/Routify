'use client';

import { useCallback, useState } from 'react';
import { chamarApi } from '@/components/acoes';
import { API, usePolling, useSaude } from '@/components/useSaude';
import { Cartao, Mini, Selo, Tabela } from '@/components/ui';
import { fmtBytes, fmtInt } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { ProvedorExterno, SistemaApi, StatusDados } from '@/lib/tipos';

/**
 * Status ao vivo: cada sonda roda no navegador do admin (a API e o Supabase já estão na CSP), menos as páginas de
 * status dos provedores, que o servidor do painel lê (./externo). Atualiza a cada 30 s com a aba visível.
 * Limiares: coleta a cada ~43 min; comparador com até 5 h entre rodadas (22:00 → 03:00); banco grátis = 500 MB.
 */
const INTERVALO_MS = 30_000;
const LIMITE_BANCO = 500 * 1024 * 1024;
type Tom = 'ok' | 'alerta' | 'erro' | 'neutro';
type Sonda<T> = { dados: T | null; ms: number | null; erro: string | null };

const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const vazio = <T,>(): Sonda<T> => ({ dados: null, ms: null, erro: null });

async function medir<T>(f: () => Promise<{ dados: T | null; erro: string | null }>): Promise<Sonda<T>> {
  const t0 = performance.now();
  try {
    const r = await f();
    return { ...r, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { dados: null, ms: null, erro: e instanceof Error ? e.message : 'sem resposta' };
  }
}

const minutosDesde = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : null);
const idade = (min: number | null) =>
  min === null ? '—' : min < 1 ? 'agora' : min < 60 ? `há ${Math.round(min)} min` : `há ${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`);
const ROTULO: Record<Tom, string> = { ok: 'No ar', alerta: 'Atenção', erro: 'Fora do ar', neutro: 'Sem dado' };
const TOM_EXTERNO: Record<ProvedorExterno['indicador'], Tom> = { ok: 'ok', menor: 'alerta', maior: 'erro', critico: 'erro', desconhecido: 'neutro' };

type Health = { status?: string; modelo_ativo?: string; recencia?: { mais_recente?: string | null }; tomtom?: { ativo?: boolean } };

export function PainelStatus() {
  const [api, setApi] = useState<Sonda<Health>>(vazio);
  // O /health público só diz se a TomTom está ligada; o pool vem do /admin/saude.
  const { saude } = useSaude(30000);
  const [front, setFront] = useState<Sonda<number>>(vazio);
  const [banco, setBanco] = useState<Sonda<StatusDados>>(vazio);
  const [sistema, setSistema] = useState<Sonda<SistemaApi>>(vazio);
  const [externos, setExternos] = useState<ProvedorExterno[] | null>(null);
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    const [a, f, b, s] = await Promise.all([
      medir<Health>(async () => {
        const r = await fetch(`${API}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        return r.ok ? { dados: await r.json(), erro: null } : { dados: null, erro: `HTTP ${r.status}` };
      }),
      medir<number>(async () => {
        const r = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        return { dados: r.status, erro: r.ok ? null : `HTTP ${r.status}` };
      }),
      medir<StatusDados>(async () => {
        const { data, error } = await clienteNavegador().rpc('admin_status_dados');
        return { dados: (data as StatusDados) ?? null, erro: error ? error.message : null };
      }),
      medir<SistemaApi>(async () => {
        const { data, error } = await chamarApi<SistemaApi>('/admin/sistema');
        return { dados: data, erro: error ? `HTTP ${error.status}${error.message ? `: ${error.message}` : ''}` : null };
      }),
    ]);
    setApi(a);
    setFront(f);
    setBanco(b);
    setSistema(s);
    setAtualizado(new Date());
    try {
      const r = await fetch('/admin/status/externo', { cache: 'no-store' });
      if (r.ok) setExternos((await r.json()).provedores);
    } catch {
      // as sondas próprias seguem valendo sem as páginas de status
    }
  }, []);

  usePolling(carregar, INTERVALO_MS);

  // --- Avaliação de cada peça (texto sempre junto da cor) ---
  const tomApi: Tom = api.erro || api.dados?.status !== 'ok' ? (api.dados || api.erro ? 'erro' : 'neutro') : (api.ms ?? 0) > 1500 ? 'alerta' : 'ok';
  const d = banco.dados;
  const tomBanco: Tom = banco.erro ? 'erro' : !d ? 'neutro' : d.banco_bytes > 0.8 * LIMITE_BANCO ? 'alerta' : 'ok';
  const minColeta = minutosDesde(d?.coleta.ultima);
  const tomColeta: Tom = minColeta === null ? 'neutro' : minColeta <= 60 ? 'ok' : minColeta <= 120 ? 'alerta' : 'erro';
  const minComp = minutosDesde(d?.comparador.ultima_rodada);
  const tomComp: Tom = minComp === null ? 'neutro' : minComp <= 330 ? 'ok' : minComp <= 480 ? 'alerta' : 'erro';
  const tomFront: Tom = front.erro ? 'erro' : front.dados ? ((front.ms ?? 0) > 2000 ? 'alerta' : 'ok') : 'neutro';
  const s = sistema.dados;
  const swapMb = s?.memoria_mb.swap_usado ?? 0;
  const tomMaquina: Tom = sistema.erro
    ? 'erro'
    : !s
      ? 'neutro'
      : (s.cpu?.roubada_pct ?? 0) > 20 || s.disco_gb.livre < 1
        ? 'erro'
        : (s.cpu?.roubada_pct ?? 0) > 5 || swapMb > 500 || s.disco_gb.livre < 3
          ? 'alerta'
          : 'ok';
  const pecas: Tom[] = [tomApi, tomBanco, tomColeta, tomComp, tomFront, tomMaquina];
  const geral: Tom = pecas.includes('erro') ? 'erro' : pecas.includes('alerta') ? 'alerta' : pecas.every((t) => t === 'neutro') ? 'neutro' : 'ok';
  const disponiveis = saude?.tomtom?.disponiveis ?? {};
  const minRecencia = minutosDesde(api.dados?.recencia?.mais_recente);

  return (
    <div className="space-y-6">
      <div className="surgir flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
        <Selo tom={geral}>{geral === 'ok' ? 'Tudo no ar' : geral === 'alerta' ? 'Atenção em alguma peça' : geral === 'erro' ? 'Há peça fora do ar' : 'Verificando…'}</Selo>
        <p className="text-sm text-muted-foreground">
          {atualizado ? `Atualizado às ${hora.format(atualizado)} · próxima verificação em 30 s` : 'Verificando agora…'}
        </p>
        <button type="button" onClick={carregar} className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:border-border-strong">
          Verificar agora
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Cartao titulo="API da LIA (AWS EC2)" nota={api.erro ? `Erro: ${api.erro}` : 'GET /health, medido do seu navegador.'}>
          <Selo tom={tomApi}>{ROTULO[tomApi]}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="Resposta" valor={ms(api.ms)} />
            <Mini rotulo="Modelo" valor={api.dados?.modelo_ativo?.replace('lia_', 'LIA ') ?? '—'} />
            <Mini rotulo="Última leitura" valor={idade(minRecencia)} detalhe="recência que a LIA usa" />
            <Mini rotulo="Chaves TomTom" valor={!saude ? '—' : saude.tomtom.ativo ? fmtInt(saude.tomtom.chaves) : 'desligado'}
                  detalhe={Object.entries(disponiveis).map(([k, v]) => `${k} ${v}`).join(' · ') || undefined} />
          </div>
        </Cartao>

        <Cartao titulo="Banco (Supabase)" nota={banco.erro ? `Erro: ${banco.erro}` : 'RPC admin_status_dados, medida do seu navegador.'}>
          <Selo tom={tomBanco}>{ROTULO[tomBanco]}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="Resposta" valor={ms(banco.ms)} />
            <Mini rotulo="Tamanho" valor={d ? fmtBytes(d.banco_bytes) : '—'} detalhe={d ? `${Math.round((100 * d.banco_bytes) / LIMITE_BANCO)}% dos 500 MB do plano grátis` : undefined} />
            <Mini rotulo="Conexões" valor={d ? fmtInt(d.conexoes) : '—'} />
            <Mini rotulo="Relógio do banco" valor={d ? hora.format(new Date(d.agora)) : '—'} />
          </div>
        </Cartao>

        <Cartao titulo="Coleta (coletor na EC2)" nota="Um lote a cada ~43 min (cota mensal da TomTom). Alerta acima de 60 min sem lote.">
          <Selo tom={tomColeta}>{tomColeta === 'neutro' ? 'Sem dado' : tomColeta === 'ok' ? 'Coletando' : tomColeta === 'alerta' ? 'Atrasada' : 'Parada'}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="Último lote" valor={idade(minColeta)} detalhe={d?.coleta.ultima ? dataHora.format(new Date(d.coleta.ultima)) : undefined} />
            <Mini rotulo="Linhas na última hora" valor={d ? fmtInt(d.coleta.linhas_1h) : '—'} />
            <Mini rotulo="Linhas em 24 h" valor={d ? fmtInt(d.coleta.linhas_24h) : '—'} />
            <Mini rotulo="Pontos em 24 h" valor={d ? `${fmtInt(d.coleta.pontos_24h)} de 630` : '—'} />
          </div>
        </Cartao>

        <Cartao titulo="Comparador LIA × provedores" nota="8 rodadas por dia (picos inclusos); cada rodada dispara a rotina de validação.">
          <Selo tom={tomComp}>{tomComp === 'neutro' ? 'Sem dado' : tomComp === 'ok' ? 'Em dia' : tomComp === 'alerta' ? 'Atrasado' : 'Parado'}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="Última rodada" valor={idade(minComp)} detalhe={d?.comparador.ultima_rodada ? dataHora.format(new Date(d.comparador.ultima_rodada)) : undefined} />
            <Mini rotulo="Rodadas em 24 h" valor={d ? fmtInt(d.comparador.rodadas_24h) : '—'} />
          </div>
        </Cartao>

        <Cartao titulo="Site e painel (Hostinger)" nota={front.erro ? `Erro: ${front.erro}` : 'HEAD na página inicial, mesmo servidor deste painel.'}>
          <Selo tom={tomFront}>{ROTULO[tomFront]}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="Resposta" valor={ms(front.ms)} />
            <Mini rotulo="HTTP" valor={front.dados ? String(front.dados) : '—'} />
          </div>
        </Cartao>

        <Cartao titulo="Máquina da API (EC2 t3)" nota={sistema.erro ? `Erro: ${sistema.erro}` : 'CPU roubada alta = crédito de CPU da t3 esgotado (rotas lentas).'}>
          <Selo tom={tomMaquina}>{ROTULO[tomMaquina]}</Selo>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Mini rotulo="CPU ocupada / roubada" valor={s?.cpu ? `${s.cpu.ocupada_pct}% / ${s.cpu.roubada_pct}%` : '—'} />
            <Mini rotulo="Memória livre" valor={s?.memoria_mb.disponivel != null ? `${fmtInt(s.memoria_mb.disponivel)} MB` : '—'}
                  detalhe={s?.memoria_mb.api_rss != null ? `API usa ${fmtInt(s.memoria_mb.api_rss)} MB` : undefined} />
            <Mini rotulo="Swap em uso" valor={s?.memoria_mb.swap_usado != null ? `${fmtInt(s.memoria_mb.swap_usado)} MB` : '—'}
                  detalhe={s?.swappiness != null ? `swappiness ${s.swappiness}` : undefined} />
            <Mini rotulo="Disco livre" valor={s ? `${s.disco_gb.livre.toLocaleString('pt-BR')} GB` : '—'}
                  detalhe={s?.maquina_no_ar_h != null ? `máquina no ar há ${Math.round(s.maquina_no_ar_h / 24)} dias` : undefined} />
          </div>
          {s?.servicos ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(s.servicos).map(([nome, ativo]) => (
                <Selo key={nome} tom={ativo ? 'ok' : 'neutro'}>
                  {nome.replace('routify-', '')}
                  {ativo ? '' : ' (parado)'}
                </Selo>
              ))}
            </div>
          ) : null}
        </Cartao>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Cartao titulo="Uso da API nas últimas 24 h" nota="Só chamadas de fora (comparador e rotina, internos, não entram).">
          <div className="grid grid-cols-2 gap-3">
            <Mini rotulo="Requisições" valor={d ? fmtInt(d.api.requisicoes) : '—'} />
            <Mini rotulo="Erros 5xx / 429" valor={d ? `${fmtInt(d.api.erros_5xx)} / ${fmtInt(d.api.limitadas_429)}` : '—'} />
            <Mini rotulo="Rota p50" valor={ms(d?.api.rota_p50_ms)} />
            <Mini rotulo="Rota p95" valor={ms(d?.api.rota_p95_ms)} />
          </div>
        </Cartao>
        <Cartao titulo="Jobs do banco (pg_cron)">
          {d?.cron.length ? (
            <Tabela cabecalho={['Job', 'Agenda (UTC)', 'Última execução', 'Resultado']}>
              {d.cron.map((j) => (
                <tr key={j.job}>
                  <td>{j.job}</td>
                  <td className="font-mono text-xs">{j.agenda}</td>
                  <td>{j.inicio ? dataHora.format(new Date(j.inicio)) : '—'}</td>
                  <td>
                    <Selo tom={j.status === 'succeeded' ? 'ok' : j.status ? 'erro' : 'neutro'}>{j.status === 'succeeded' ? 'ok' : (j.status ?? 'nunca rodou')}</Selo>
                  </td>
                </tr>
              ))}
            </Tabela>
          ) : (
            <p className="text-sm text-muted-foreground">{banco.erro ? 'Sem acesso ao banco agora.' : 'Nenhum job agendado.'}</p>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Provedores (páginas de status oficiais)" nota="Lidas pelo servidor do painel, com cache de 60 s.">
        {externos ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {externos.map((p) => (
              <li key={p.nome} className="rounded-lg border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                    {p.nome}
                  </a>
                  <Selo tom={TOM_EXTERNO[p.indicador]}>{p.indicador === 'ok' ? 'Operando' : p.indicador === 'desconhecido' ? 'Sem resposta' : 'Incidente'}</Selo>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.descricao}</p>
                {p.incidentes.length ? (
                  <ul className="mt-2 list-disc pl-4 text-xs">
                    {p.incidentes.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Consultando as páginas de status…</p>
        )}
      </Cartao>
    </div>
  );
}
