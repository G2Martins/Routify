import Form from 'next/form';
import Link from 'next/link';
import { Aviso, BTN_SECUNDARIO, CAMPO, Cabecalho, Cartao, ErroConsulta, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtInt, nomeUsuario } from '@/lib/formato';
import type { Auditoria, Usuario } from '@/lib/tipos';

const POR_PAGINA = 50;
const ACOES: Record<string, string> = {
  papel: 'Papel alterado',
  bloqueio: 'Bloqueio',
  encerrar_sessoes: 'Sessões encerradas',
  exportar_dados: 'Exportação (LGPD)',
  apagar_dados: 'Exclusão (LGPD)',
  config: 'Configuração da API',
  tomtom_zerar_cooldowns: 'Cooldowns TomTom zerados',
  tomtom_testar_chave: 'Chave TomTom testada',
  aviso_salvar: 'Aviso salvo',
  aviso_remover: 'Aviso removido',
  feedback_excluir: 'Outlier de feedback',
  recalcular_qualidade: 'Qualidade recalculada',
  expurgar_uso: 'Expurgo de uso',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Detalhes({ d }: { d: Record<string, unknown> | null }) {
  const entradas = Object.entries(d ?? {});
  if (!entradas.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entradas.map(([k, v]) => {
        const texto = typeof v === 'string' ? v : JSON.stringify(v);
        return (
          <span key={k} title={texto.length > 60 ? texto : undefined} className="num rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px]">
            <span className="text-muted-foreground">{k}:</span> {texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}
          </span>
        );
      })}
    </div>
  );
}

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<{ pagina?: string; acao?: string; ator?: string }> }) {
  const p = await searchParams;
  const pagina = Math.max(1, Math.floor(Number(p.pagina)) || 1);
  const acao = p.acao && Object.hasOwn(ACOES, p.acao) ? p.acao : '';
  const ator = p.ator && UUID.test(p.ator) ? p.ator : '';
  const { sb } = await exigirAdmin();

  let consulta = sb
    .from('admin_auditoria')
    .select('id, criado_em, ator, acao, alvo, detalhes', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (acao) consulta = consulta.eq('acao', acao);
  if (ator) consulta = consulta.eq('ator', ator);
  const [resultado, usuarios] = await Promise.all([consulta, sb.rpc('admin_usuarios')]);

  // PGRST103 = página além do fim: lista vazia, não erro.
  const erro = resultado.error?.code === 'PGRST103' ? null : resultado.error;
  const linhas = (erro ? [] : (resultado.data ?? [])) as Auditoria[];
  const total = resultado.count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const contas = (usuarios.data ?? []) as Usuario[];
  const emails = Object.fromEntries(contas.map((u) => [u.id, u.email]));
  const admins = contas.filter((u) => u.papel === 'admin' || u.id === ator);

  const link = (n: number) => {
    const q = new URLSearchParams();
    if (acao) q.set('acao', acao);
    if (ator) q.set('ator', ator);
    if (n > 1) q.set('pagina', String(n));
    const s = q.toString();
    return s ? `/admin/auditoria?${s}` : '/admin/auditoria';
  };

  return (
    <>
      <Cabecalho
        titulo="Auditoria"
        sobre="Trilha append-only de toda ação administrativa: gravada na mesma transação da ação (banco) ou pela API. Nem o service_role altera ou apaga um registro."
      />
      <div className="space-y-5">
        <ErroConsulta erro={erro} acoes />
        <Cartao atraso={40}>
          <Form action="/admin/auditoria" className="mb-5 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              Ação
              <select name="acao" defaultValue={acao} className={`${CAMPO} mt-1 w-56`}>
                <option value="">Todas</option>
                {Object.entries(ACOES).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Quem fez
              <select name="ator" defaultValue={ator} className={`${CAMPO} mt-1 w-64`}>
                <option value="">Todos os admins</option>
                {admins.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={BTN_SECUNDARIO}>
              Filtrar
            </button>
            {acao || ator ? (
              <Link href="/admin/auditoria" className="text-xs font-medium underline-offset-4 hover:underline">
                Limpar filtros
              </Link>
            ) : null}
          </Form>

          {linhas.length ? (
            <Tabela cabecalho={['Quando', 'Quem', 'Ação', 'Alvo', 'Detalhes']}>
              {linhas.map((l) => (
                <tr key={l.id}>
                  <td className="num whitespace-nowrap text-xs">{fmtData(l.criado_em)}</td>
                  <td className="num text-xs" title={l.ator}>
                    {nomeUsuario(l.ator, emails)}
                  </td>
                  <td>
                    <span className="text-sm">{ACOES[l.acao] ?? l.acao}</span>
                    <span className="num ml-1.5 text-[10px] text-muted-foreground">{l.acao}</span>
                  </td>
                  <td className="num text-xs" title={l.alvo ?? undefined}>
                    {l.alvo && UUID.test(l.alvo) ? nomeUsuario(l.alvo, emails) : (l.alvo ?? '—')}
                  </td>
                  <td>
                    <Detalhes d={l.detalhes} />
                  </td>
                </tr>
              ))}
            </Tabela>
          ) : !erro ? (
            <Aviso titulo={acao || ator ? 'Nenhum registro com esses filtros' : 'Nenhuma ação registrada ainda'} />
          ) : null}

          {total > POR_PAGINA ? (
            <nav aria-label="Paginação" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="num text-xs text-muted-foreground">
                página {fmtInt(pagina)} de {fmtInt(paginas)} · {fmtInt(total)} registros
              </span>
              <div className="flex gap-2">
                {pagina > 1 ? (
                  <Link href={link(pagina - 1)} className={BTN_SECUNDARIO}>
                    ← Mais recentes
                  </Link>
                ) : null}
                {pagina < paginas ? (
                  <Link href={link(pagina + 1)} className={BTN_SECUNDARIO}>
                    Mais antigas →
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </Cartao>
      </div>
    </>
  );
}
