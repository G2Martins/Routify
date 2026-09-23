'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmarDialog, Interruptor, MensagemRetorno, useAcao } from '@/components/acoes';
import { BTN_PRIMARIO, BTN_SECUNDARIO, CAMPO, Cartao } from '@/components/ui';
import { fmtData, nomeUsuario } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { Auditoria, ChaveConfig, LinhaConfig } from '@/lib/tipos';

type Emails = Record<string, string>;

const MODOS: { chave: ChaveConfig; titulo: string; texto: string; padrao: boolean; degradaQuando: boolean }[] = [
  {
    chave: 'tomtom_ativo',
    titulo: 'TomTom ligada',
    texto: 'Kill switch geral. Desligada, a API não faz nenhuma chamada à TomTom (fluxo, incidentes, busca e rota).',
    padrao: true,
    degradaQuando: false,
  },
  {
    chave: 'modo_so_lia',
    titulo: 'Modo só LIA',
    texto: 'Rotas só com a previsão da LIA, sem leitura ao vivo, incidentes nem rota de referência. Para demonstrar a LIA isolada.',
    padrao: false,
    degradaQuando: true,
  },
  {
    chave: 'referencia_tomtom_ativa',
    titulo: 'Rota da TomTom na fusão',
    texto: 'Pede a rota de referência da TomTom (Routing) para comparar e fundir com a da LIA. Desligada, poupa a cota de Routing.',
    padrao: true,
    degradaQuando: false,
  },
];

function Atualizado({ linha, emails }: { linha?: LinhaConfig; emails: Emails }) {
  if (!linha?.atualizado_por) return <p className="mt-1 text-[11px] text-muted-foreground">valor padrão da migration</p>;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      atualizado em <span className="num">{fmtData(linha.atualizado_em)}</span> por {nomeUsuario(linha.atualizado_por, emails)}
    </p>
  );
}

export function Modos({ config, emails }: { config: Record<string, LinhaConfig>; emails: Emails }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [confirmar, setConfirmar] = useState<{ chave: ChaveConfig; valor: boolean; titulo: string } | null>(null);
  const orcamentoAtual = Number(config.tomtom_orcamento_min?.valor ?? 120);
  const [orcamento, setOrcamento] = useState(String(orcamentoAtual));
  const orcamentoN = Number(orcamento);
  const orcamentoValido = Number.isInteger(orcamentoN) && orcamentoN >= 1 && orcamentoN <= 600;

  const salvar = async (chave: ChaveConfig, valor: unknown, rotulo: string) => {
    const r = await executar(chave, () => clienteNavegador().rpc('admin_definir_config', { p_chave: chave, p_valor: valor }), `${rotulo} salvo. A API aplica em até 30 s.`);
    setConfirmar(null);
    if (r.ok) router.refresh();
  };

  const mudar = (m: (typeof MODOS)[number], valor: boolean) => {
    if (valor === m.degradaQuando) setConfirmar({ chave: m.chave, valor, titulo: m.titulo });
    else salvar(m.chave, valor, m.titulo);
  };

  return (
    <Cartao titulo="Modos da API" atraso={40} nota="Gravado em config_runtime (auditado). A API relê a configuração a cada 30 s — sem redeploy.">
      <div className="space-y-4">
        <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />
        <ul className="divide-y divide-border/60">
          {MODOS.map((m) => {
            const linha = config[m.chave];
            const ligado = typeof linha?.valor === 'boolean' ? linha.valor : m.padrao;
            return (
              <li key={m.chave} className="flex items-start justify-between gap-6 py-3 first:pt-0">
                <div>
                  <p className="text-sm font-medium">{m.titulo}</p>
                  <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{m.texto}</p>
                  <Atualizado linha={linha} emails={emails} />
                </div>
                <Interruptor ligado={ligado} rotulo={m.titulo} desabilitado={ocupado !== null} onMudar={(v) => mudar(m, v)} />
              </li>
            );
          })}
          <li className="py-3 last:pb-0">
            <form
              className="flex flex-wrap items-end justify-between gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (orcamentoValido) salvar('tomtom_orcamento_min', orcamentoN, 'Orçamento');
              }}
            >
              <div>
                <label htmlFor="orcamento" className="text-sm font-medium">
                  Orçamento TomTom por minuto
                </label>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  Teto global de chamadas por minuto (todas as chaves). Estourou, a rota segue só com a LIA.
                </p>
                <Atualizado linha={config.tomtom_orcamento_min} emails={emails} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="orcamento"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  step={1}
                  required
                  value={orcamento}
                  onChange={(e) => setOrcamento(e.target.value)}
                  aria-invalid={!orcamentoValido}
                  className={`${CAMPO} num w-24`}
                />
                <span className="text-xs text-muted-foreground">/min</span>
                <button
                  type="submit"
                  disabled={!orcamentoValido || orcamentoN === orcamentoAtual || ocupado !== null}
                  className={BTN_PRIMARIO}
                >
                  {ocupado === 'tomtom_orcamento_min' ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </li>
        </ul>
      </div>
      <ConfirmarDialog
        aberto={confirmar !== null}
        titulo={confirmar?.chave === 'tomtom_ativo' ? 'Desligar a TomTom?' : 'Ligar o modo só LIA?'}
        rotuloConfirmar={confirmar?.chave === 'tomtom_ativo' ? 'Desligar' : 'Ligar'}
        perigo
        ocupado={ocupado !== null}
        onFechar={() => setConfirmar(null)}
        onConfirmar={() => confirmar && salvar(confirmar.chave, confirmar.valor, confirmar.titulo)}
      >
        <p>
          As rotas passam a usar só a previsão da LIA, sem trânsito ao vivo nem incidentes. O app continua funcionando, e dá para
          reverter a qualquer momento.
        </p>
      </ConfirmarDialog>
    </Cartao>
  );
}

const MANUTENCAO = [
  {
    acao: 'recalcular_qualidade',
    rpc: 'admin_recalcular_qualidade',
    titulo: 'Recalcular qualidade agora',
    texto: 'Atualiza as views materializadas da página Qualidade dos dados. Roda sozinho todo dia às 03:30.',
    confirmar: 'Recalcular as agregações de qualidade? Pode levar alguns segundos no banco.',
    perigo: false,
  },
  {
    acao: 'expurgar_uso',
    rpc: 'admin_expurgar_uso',
    titulo: 'Rodar expurgo (90 dias)',
    texto: 'Apaga requisições, rotas calculadas e eventos com mais de 90 dias (retenção LGPD). Roda sozinho todo dia às 03:15.',
    confirmar: 'Apagar agora os dados de uso com mais de 90 dias? Não tem volta. O dataset do TCC não é afetado.',
    perigo: true,
  },
] as const;

export function Manutencao({ ultimas, emails }: { ultimas: Record<string, Auditoria | null>; emails: Emails }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [aberta, setAberta] = useState<(typeof MANUTENCAO)[number] | null>(null);

  const rodar = async (m: (typeof MANUTENCAO)[number]) => {
    const r = await executar(m.acao, () => clienteNavegador().rpc(m.rpc), `${m.titulo.replace(' agora', '')}: concluído.`);
    setAberta(null);
    if (r.ok) router.refresh();
  };

  return (
    <Cartao titulo="Dados e LIA" atraso={160} nota="Cada ação tem intervalo mínimo de 60 s entre execuções e fica na auditoria.">
      <div className="space-y-4">
        <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />
        <div className="grid gap-4 md:grid-cols-2">
          {MANUTENCAO.map((m) => {
            const u = ultimas[m.acao];
            return (
              <div key={m.acao} className="flex flex-col justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">{m.titulo}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.texto}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {u ? (
                      <>
                        última pelo painel: <span className="num">{fmtData(u.criado_em)}</span> por {nomeUsuario(u.ator, emails)}
                      </>
                    ) : (
                      'nenhuma execução manual registrada'
                    )}
                  </p>
                </div>
                <button type="button" onClick={() => setAberta(m)} disabled={ocupado !== null} className={`${BTN_SECUNDARIO} self-start`}>
                  {ocupado === m.acao ? 'Rodando…' : m.titulo}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmarDialog
        aberto={aberta !== null}
        titulo={aberta?.titulo ?? ''}
        rotuloConfirmar="Rodar"
        perigo={aberta?.perigo}
        ocupado={ocupado !== null}
        onFechar={() => setAberta(null)}
        onConfirmar={() => aberta && rodar(aberta)}
      >
        <p>{aberta?.confirmar}</p>
      </ConfirmarDialog>
    </Cartao>
  );
}
