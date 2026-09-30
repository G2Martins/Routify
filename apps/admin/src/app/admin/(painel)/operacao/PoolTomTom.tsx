'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chamarApi, ConfirmarDialog, Giro, Interruptor, MensagemRetorno, useAcao } from '@/components/acoes';
import { Aviso, BTN_SECUNDARIO, Cartao, Selo, Tabela } from '@/components/ui';
import { mensagemErro, type ErroBruto } from '@/lib/erros';
import { fmtInt } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { EstadoTomTom, ServicoTomTom, TesteChave } from '@/lib/tipos';

const SERVICOS: { chave: ServicoTomTom; rotulo: string }[] = [
  { chave: 'fluxo', rotulo: 'Fluxo' },
  { chave: 'incidentes', rotulo: 'Incidentes' },
  { chave: 'busca', rotulo: 'Busca' },
  { chave: 'rota', rotulo: 'Rota' },
];
const INTERVALO_MS = 15000;

const espera = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`);
const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });

type Teste = { rodando: boolean; resultado?: TesteChave; erro?: string };

export function PoolTomTom({ pausadas: pausadasServidor }: { pausadas: string[] }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [estado, setEstado] = useState<EstadoTomTom | null>(null);
  const [erroEstado, setErroEstado] = useState<ErroBruto | null>(null);
  const [atualizado, setAtualizado] = useState<Date | null>(null);
  const [testes, setTestes] = useState<Record<string, Teste>>({});
  const testando = useRef(new Set<string>());
  const [zerar, setZerar] = useState(false);

  // Fonte da verdade das pausas = config_runtime (o que gravamos). A API só aplica em até 30 s.
  const assinatura = pausadasServidor.join('|');
  const [pausadas, setPausadas] = useState(pausadasServidor);
  useEffect(() => setPausadas(assinatura ? assinatura.split('|') : []), [assinatura]);

  const carregar = useCallback(async () => {
    const { data, error } = await chamarApi<EstadoTomTom>('/admin/tomtom');
    if (error || !data) {
      setErroEstado(error ?? { status: 0 });
      return;
    }
    setEstado(data);
    setErroEstado(null);
    setAtualizado(new Date());
  }, []);

  // Atualiza a cada 15 s só com a aba visível (e na hora em que ela volta a ficar visível).
  useEffect(() => {
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

  const testar = async (id: string) => {
    if (testando.current.has(id)) return;
    testando.current.add(id);
    setTestes((t) => ({ ...t, [id]: { rodando: true } }));
    const { data, error } = await chamarApi<TesteChave>(`/admin/tomtom/chaves/${encodeURIComponent(id)}/testar`, 'POST');
    testando.current.delete(id);
    const erro =
      error?.status === 429
        ? `Limite de 6 testes/min. ${error.retryAfter ? `Tente em ${error.retryAfter} s.` : 'Aguarde ~1 min.'}`
        : error
          ? mensagemErro(error)
          : undefined;
    setTestes((t) => ({ ...t, [id]: { rodando: false, resultado: data ?? undefined, erro } }));
    if (!error) carregar();
  };

  const alternarPausa = async (id: string, pausar: boolean) => {
    // RPC atômica por chave (lock de linha no banco): dois admins ao mesmo tempo não se atropelam.
    const r = await executar(
      `pausa:${id}`,
      () => clienteNavegador().rpc('admin_tomtom_pausar', { p_id: id, p_pausada: pausar }),
      `Chave ${id} ${pausar ? 'pausada' : 'de volta ao rodízio'}. A API aplica em até 30 s.`,
    );
    if (r.ok) {
      setPausadas(Array.isArray(r.data) ? (r.data as unknown[]).map(String) : pausadas);
      router.refresh();
    }
  };

  const zerarCooldowns = async () => {
    const r = await executar('zerar', () => clienteNavegador().rpc('admin_tomtom_zerar_cooldowns'), 'Cooldowns zerados. A API aplica em até 30 s.');
    setZerar(false);
    if (r.ok) carregar();
  };

  const chaves = estado?.chaves ?? [];
  const livres = (s: ServicoTomTom) => chaves.filter((c) => !c.pausada && c.servicos[s]?.livre).length;

  const acoesTopo = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="num text-[11px] text-muted-foreground">
        {atualizado ? `atualizado ${hora.format(atualizado)} · a cada 15 s` : 'carregando…'}
      </span>
      <button type="button" onClick={carregar} className={BTN_SECUNDARIO}>
        Atualizar
      </button>
      <button type="button" onClick={() => setZerar(true)} disabled={ocupado !== null || !estado} className={BTN_SECUNDARIO}>
        {ocupado === 'zerar' ? 'Zerando…' : 'Zerar cooldowns'}
      </button>
    </div>
  );

  return (
    <Cartao
      titulo="Pool TomTom"
      atraso={80}
      nota="Só ids de chave — o valor nunca sai da API. Testar gasta 1 requisição de Flow da chave (limite: 6 testes por minuto por admin)."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {estado ? (
              estado.habilitado ? (
                <Selo tom="ok">TomTom habilitada na API</Selo>
              ) : (
                <Selo tom="alerta">TomTom desligada na API (kill switch ou modo só LIA)</Selo>
              )
            ) : null}
            {estado && estado.config === null ? <Selo tom="alerta">API sem Supabase: não lê config_runtime</Selo> : null}
          </div>
          {acoesTopo}
        </div>

        <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />

        {erroEstado && !estado ? (
          <Aviso titulo="Não foi possível ler o pool da API">
            {erroEstado.status === 404
              ? 'A API em execução não tem /admin/tomtom — atualize e reinicie a API.'
              : mensagemErro(erroEstado)}
          </Aviso>
        ) : null}
        {erroEstado && estado ? (
          <p className="text-xs text-destructive">Última atualização falhou: {mensagemErro(erroEstado)} Mostrando o estado anterior.</p>
        ) : null}

        {!estado && !erroEstado ? (
          <div className="space-y-2" aria-hidden>
            <div className="skeleton h-16" />
            <div className="skeleton h-40" />
          </div>
        ) : null}

        {estado ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {SERVICOS.map((s) => {
                const n = livres(s.chave);
                return (
                  <div key={s.chave} className="rounded-lg border border-border px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{s.rotulo} · livres</p>
                    <p className={`num mt-1 text-2xl font-medium ${n === 0 ? 'text-destructive' : ''}`}>
                      {n}
                      <span className="text-sm text-muted-foreground">/{chaves.length}</span>
                    </p>
                  </div>
                );
              })}
              <div className="col-span-2 rounded-lg border border-border px-4 py-3 md:col-span-1">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Último minuto</p>
                <p
                  className={`num mt-1 text-2xl font-medium ${estado.chamadas_ultimo_min >= estado.orcamento_min ? 'text-destructive' : ''}`}
                >
                  {fmtInt(estado.chamadas_ultimo_min)}
                  <span className="text-sm text-muted-foreground">/{fmtInt(estado.orcamento_min)}</span>
                </p>
              </div>
            </div>

            {chaves.length ? (
              <Tabela cabecalho={['Chave', ...SERVICOS.map((s) => s.rotulo), 'Chamadas', 'Falhas', 'Pausada', 'Teste']}>
                {chaves.map((c) => {
                  const pausada = pausadas.includes(c.id);
                  const teste = testes[c.id];
                  return (
                    <tr key={c.id}>
                      <td className="num text-xs font-medium">{c.id}</td>
                      {SERVICOS.map((s) => {
                        const sv = c.servicos[s.chave];
                        return (
                          <td key={s.chave} title={sv?.strikes ? `${sv.strikes} respostas 429 seguidas` : undefined}>
                            {c.pausada || pausada ? (
                              <Selo tom="neutro">pausada</Selo>
                            ) : !sv || sv.livre ? (
                              <Selo tom="ok">livre</Selo>
                            ) : (
                              <Selo tom={sv.volta_em_s > 3600 ? 'erro' : 'alerta'}>volta em {espera(sv.volta_em_s)}</Selo>
                            )}
                          </td>
                        );
                      })}
                      <td className="num">{fmtInt(c.chamadas)}</td>
                      <td className={`num ${c.falhas ? 'text-destructive' : ''}`}>{fmtInt(c.falhas)}</td>
                      <td>
                        <Interruptor
                          ligado={pausada}
                          rotulo={`Pausar chave ${c.id}`}
                          desabilitado={ocupado !== null}
                          onMudar={(v) => alternarPausa(c.id, v)}
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => testar(c.id)}
                            disabled={teste?.rodando}
                            className={`${BTN_SECUNDARIO} px-2.5 py-1 text-xs`}
                            aria-label={`Testar chave ${c.id}`}
                          >
                            {teste?.rodando ? <Giro /> : null}
                            Testar
                          </button>
                          {teste && !teste.rodando ? (
                            teste.erro ? (
                              <span className="max-w-48 text-[11px] leading-tight text-destructive">{teste.erro}</span>
                            ) : teste.resultado ? (
                              <Selo tom={teste.resultado.ok ? 'ok' : 'erro'}>
                                {teste.resultado.status ?? 'rede'}
                                {teste.resultado.motivo ? ` · ${teste.resultado.motivo}` : ''}
                                {teste.resultado.latencia_ms !== null ? ` · ${fmtInt(teste.resultado.latencia_ms)} ms` : ''}
                              </Selo>
                            ) : null
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Tabela>
            ) : (
              <Aviso titulo="Nenhuma chave carregada na API">
                Configure <span className="num">TOMTOM_API_KEYS</span> ou <span className="num">tomtom_keys.json</span> e reinicie a API.
              </Aviso>
            )}
          </>
        ) : null}
      </div>
      <ConfirmarDialog
        aberto={zerar}
        titulo="Zerar os cooldowns?"
        rotuloConfirmar="Zerar"
        ocupado={ocupado !== null}
        onFechar={() => setZerar(false)}
        onConfirmar={zerarCooldowns}
      >
        <p>
          Todas as chaves voltam ao rodízio em todos os serviços. Se uma chave estiver mesmo sem cota, ela volta ao cooldown depois de 3
          respostas 429 — isso gasta algumas chamadas.
        </p>
      </ConfirmarDialog>
    </Cartao>
  );
}
