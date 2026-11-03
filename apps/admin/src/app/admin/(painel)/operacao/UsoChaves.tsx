'use client';

import { useCallback, useEffect, useState } from 'react';
import { chamarApi } from '@/components/acoes';
import { Cartao, Mini, Selo, Tabela } from '@/components/ui';
import { fmtInt } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';

/**
 * Uso REAL das chaves TomTom no mês (tomtom_uso_dia): o coletor na EC2 manda a cada ciclo e a API a cada minuto.
 * Cota grátis mensal POR CHAVE e por API (docs.tomtom.com/pricing). O pool em memória da API (acima) mostra o agora;
 * isto mostra o quanto da cota já foi e para onde vai até o fim do mês.
 */
const COTA: Record<string, number> = { fluxo: 20000, incidentes: 2500, busca: 2500, rota: 20000 };
const SERVICOS = [
  { chave: 'fluxo', rotulo: 'Flow (trânsito)' },
  { chave: 'incidentes', rotulo: 'Incidents' },
  { chave: 'busca', rotulo: 'Search' },
  { chave: 'rota', rotulo: 'Routing' },
];
const INTERVALO_MS = 60_000;
const hora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

type Linha = {
  chave_id: string;
  servico: string;
  origem: string;
  mes: number;
  hoje: number;
  falhas_mes: number;
  ultimo_status: number | null;
  cooldown_ate: string | null;
  atualizado_em: string;
};
type Uso = { hoje: string; dia_do_mes: number; dias_no_mes: number; linhas: Linha[] };

export function UsoChaves() {
  const [uso, setUso] = useState<Uso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nChaves, setNChaves] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await clienteNavegador().rpc('admin_tomtom_uso');
    if (error) {
      setErro(error.code === '42883' || error.code === 'PGRST202' ? 'Falta a migration 20261103010000_tomtom_uso.' : error.message);
      return;
    }
    setUso(data as Uso);
    setErro(null);
  }, []);

  useEffect(() => {
    chamarApi<{ tomtom?: { chaves?: number } }>('/admin/saude').then(({ data }) =>
      setNChaves(typeof data?.tomtom?.chaves === 'number' ? data.tomtom.chaves : null),
    );
    const tick = () => {
      if (document.visibilityState === 'visible') carregar();
    };
    tick();
    const id = setInterval(tick, INTERVALO_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [carregar]);

  if (erro) return <Cartao titulo="Uso real das chaves no mês"><p className="text-sm text-destructive">{erro}</p></Cartao>;
  if (!uso) return <Cartao titulo="Uso real das chaves no mês"><p className="text-sm text-muted-foreground">Carregando…</p></Cartao>;

  const linhas = uso.linhas;
  const chaves = Array.from(new Set(linhas.map((l) => l.chave_id))).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const total = nChaves ?? chaves.length;
  const soma = (f: (l: Linha) => boolean, campo: 'mes' | 'hoje' | 'falhas_mes' = 'mes') =>
    linhas.filter(f).reduce((s, l) => s + (l[campo] ?? 0), 0);
  const agora = Date.now();

  return (
    <Cartao
      titulo="Uso real das chaves no mês"
      nota={`Coletor (EC2, a cada ciclo) + API (a cada minuto). A contagem começou em 03/11/2026: antes disso o uso não era gravado. Comparador e A/B chamam a TomTom direto ~350 vezes por dia (Routing) e ficam de fora. Pool: ${total} chaves.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SERVICOS.map(({ chave, rotulo }) => {
          const mes = soma((l) => l.servico === chave);
          const cota = COTA[chave] * Math.max(total, 1);
          const projecao = uso.dia_do_mes ? (mes / uso.dia_do_mes) * uso.dias_no_mes : 0;
          const pct = (100 * projecao) / cota;
          const tom = pct > 100 ? 'erro' : pct > 85 ? 'alerta' : 'ok';
          return (
            <div key={chave} className="rounded-lg border border-border px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</p>
                <Selo tom={mes ? tom : 'neutro'}>{mes ? `projeção ${Math.round(pct)}%` : 'sem uso'}</Selo>
              </div>
              <p className="num mt-1 text-2xl font-medium leading-none">{fmtInt(mes)}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                de {fmtInt(cota)} no mês · hoje {fmtInt(soma((l) => l.servico === chave, 'hoje'))} · coletor{' '}
                {fmtInt(soma((l) => l.servico === chave && l.origem === 'coletor'))}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <Tabela cabecalho={['Chave', 'Flow coletor', 'Flow API', '% Flow', 'Incidents', 'Search', 'Routing', 'Falhas', 'Último', 'Situação', 'Atualizado']}>
          {chaves.map((id) => {
            const da = (s: string, o?: string) => soma((l) => l.chave_id === id && l.servico === s && (!o || l.origem === o));
            const fluxo = da('fluxo');
            const minhas = linhas.filter((l) => l.chave_id === id);
            const ultima = minhas.reduce<Linha | null>((u, l) => (!u || l.atualizado_em > u.atualizado_em ? l : u), null);
            const fora = minhas.filter((l) => l.cooldown_ate && new Date(l.cooldown_ate).getTime() > agora);
            return (
              <tr key={id}>
                <td className="font-mono text-xs">{id}</td>
                <td className="num">{fmtInt(da('fluxo', 'coletor'))}</td>
                <td className="num">{fmtInt(da('fluxo', 'api'))}</td>
                <td className="num">{Math.round((100 * fluxo) / COTA.fluxo)}%</td>
                <td className="num">{fmtInt(da('incidentes'))}</td>
                <td className="num">{fmtInt(da('busca'))}</td>
                <td className="num">{fmtInt(da('rota'))}</td>
                <td className="num">{fmtInt(soma((l) => l.chave_id === id, 'falhas_mes'))}</td>
                <td className="num">{ultima?.ultimo_status ?? '—'}</td>
                <td>
                  {fora.length ? (
                    <Selo tom="alerta">
                      {fora.map((l) => `${l.servico} (${l.origem})`).join(', ')} até {hora.format(new Date(fora[0].cooldown_ate as string))}
                    </Selo>
                  ) : (
                    <Selo tom="ok">no rodízio</Selo>
                  )}
                </td>
                <td className="text-xs">{ultima ? hora.format(new Date(ultima.atualizado_em)) : '—'}</td>
              </tr>
            );
          })}
        </Tabela>
        {!chaves.length ? <p className="mt-3 text-sm text-muted-foreground">Nenhum uso gravado ainda neste mês.</p> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini rotulo="Dia do mês" valor={`${uso.dia_do_mes} de ${uso.dias_no_mes}`} />
        <Mini rotulo="Chaves com uso" valor={`${chaves.length} de ${total}`} />
        <Mini rotulo="Falhas no mês" valor={fmtInt(soma(() => true, 'falhas_mes'))} />
        <Mini rotulo="Chamadas hoje" valor={fmtInt(soma(() => true, 'hoje'))} />
      </div>
    </Cartao>
  );
}
