import { Cabecalho, ErroConsulta } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import type { Auditoria, AvisoApp, LinhaConfig, Usuario } from '@/lib/tipos';
import { Avisos } from './Avisos';
import { Manutencao, Modos } from './Modos';
import { PoolTomTom } from './PoolTomTom';

const MANUTENCAO = ['recalcular_qualidade', 'expurgar_uso'];

export default async function OperacaoPage() {
  const { sb } = await exigirAdmin();
  const [config, avisos, auditoria, usuarios] = await Promise.all([
    sb.from('config_runtime').select('chave, valor, atualizado_em, atualizado_por'),
    sb.from('avisos_app').select('*').order('criado_em', { ascending: false }),
    sb
      .from('admin_auditoria')
      .select('id, criado_em, ator, acao, alvo, detalhes')
      .in('acao', MANUTENCAO)
      .order('criado_em', { ascending: false })
      .limit(20),
    sb.rpc('admin_usuarios'),
  ]);

  const linhas = (config.data ?? []) as LinhaConfig[];
  const cfg = Object.fromEntries(linhas.map((l) => [l.chave, l]));
  const execucoes = (auditoria.data ?? []) as Auditoria[];
  const ultimas = Object.fromEntries(MANUTENCAO.map((a) => [a, execucoes.find((e) => e.acao === a) ?? null]));
  const pausadas = Array.isArray(cfg.tomtom_chaves_pausadas?.valor) ? (cfg.tomtom_chaves_pausadas.valor as unknown[]).map(String) : [];

  // Só os e-mails que a página mostra (quem alterou), não a lista inteira de contas.
  const ids = new Set([...linhas.map((l) => l.atualizado_por), ...execucoes.map((e) => e.ator)].filter(Boolean));
  const emails = Object.fromEntries(((usuarios.data ?? []) as Usuario[]).filter((u) => ids.has(u.id)).map((u) => [u.id, u.email]));

  const erro = config.error ?? avisos.error ?? auditoria.error;

  return (
    <>
      <Cabecalho
        titulo="Operação"
        sobre="Modos da API, pool de chaves TomTom, avisos do app e rotinas de dados. Toda ação passa pelo banco (is_admin) ou pela API (JWT admin) e fica na auditoria."
      />
      <div className="space-y-5">
        <ErroConsulta erro={erro} acoes />
        {!config.error ? <Modos config={cfg} emails={emails} /> : null}
        <PoolTomTom pausadas={pausadas} />
        {!avisos.error ? <Avisos avisos={(avisos.data ?? []) as AvisoApp[]} /> : null}
        {!auditoria.error ? <Manutencao ultimas={ultimas} emails={emails} /> : null}
      </div>
    </>
  );
}
