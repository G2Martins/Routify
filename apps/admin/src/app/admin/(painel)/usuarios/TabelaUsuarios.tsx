'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { ConfirmarDialog, MensagemRetorno, useAcao } from '@/components/acoes';
import { BTN_SECUNDARIO, CAMPO, Selo, Tabela } from '@/components/ui';
import { fmtData, fmtInt } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { Usuario } from '@/lib/tipos';

type Acao = 'promover' | 'rebaixar' | 'bloquear' | 'desbloquear' | 'sessoes' | 'apagar';
type Contagem = { historico_rotas: number; rotas_calculadas: number; eventos: number; requisicoes: number; conta_apagada: boolean };

const TOKEN = 'O acesso já emitido vale até o token expirar (até 1 h).';

const DIALOGO: Record<Exclude<Acao, 'apagar'>, { titulo: (e: string) => string; texto: string; botao: string; perigo: boolean }> = {
  promover: {
    titulo: (e) => `Promover ${e} a administrador?`,
    texto: 'Ganha acesso total a este painel e às ações. O papel só vale depois que a pessoa sair e entrar de novo.',
    botao: 'Promover',
    perigo: false,
  },
  rebaixar: {
    titulo: (e) => `Rebaixar ${e} a usuário?`,
    texto: `Perde o papel de admin e todas as sessões são encerradas. ${TOKEN}`,
    botao: 'Rebaixar',
    perigo: true,
  },
  bloquear: {
    titulo: (e) => `Bloquear ${e}?`,
    texto: `Não consegue mais entrar e as sessões são encerradas agora. Os dados continuam guardados. ${TOKEN}`,
    botao: 'Bloquear',
    perigo: true,
  },
  desbloquear: {
    titulo: (e) => `Desbloquear ${e}?`,
    texto: 'A pessoa volta a conseguir entrar com a mesma senha.',
    botao: 'Desbloquear',
    perigo: false,
  },
  sessoes: {
    titulo: (e) => `Encerrar as sessões de ${e}?`,
    texto: `Vai precisar entrar de novo em todos os dispositivos. ${TOKEN}`,
    botao: 'Encerrar sessões',
    perigo: true,
  },
};

function baixarJson(dados: unknown, nome: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Menu por linha em popover nativo (camada de topo: não corta no overflow da tabela; Esc e clique fora fecham). */
function MenuAcoes({
  u,
  proprio,
  bloqueado,
  desabilitado,
  onEscolher,
  onExportar,
}: {
  u: Usuario;
  proprio: boolean;
  bloqueado: boolean;
  desabilitado: boolean;
  onEscolher: (a: Acao) => void;
  onExportar: () => void;
}) {
  const id = `menu-${useId().replace(/:/g, '')}`;
  const menu = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  // ponytail: posição calculada ao abrir; rolar a página com o menu aberto não o acompanha.
  const posicionar = () => {
    const b = botao.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const altura = 260;
    m.style.top = `${b.bottom + altura > window.innerHeight ? Math.max(8, b.top - altura - 4) : b.bottom + 4}px`;
    m.style.left = `${Math.max(8, b.right - 224)}px`;
  };
  const escolher = (fn: () => void) => {
    menu.current?.hidePopover();
    fn();
  };
  const item = (rotulo: string, fn: () => void, { perigo = false, bloqueiaProprio = true } = {}) => (
    <button
      type="button"
      disabled={bloqueiaProprio && proprio}
      title={bloqueiaProprio && proprio ? 'Não é permitido na própria conta' : undefined}
      onClick={() => escolher(fn)}
      className={`flex w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted disabled:pointer-events-none disabled:opacity-40 ${
        perigo ? 'text-destructive' : ''
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <>
      <button
        ref={botao}
        type="button"
        popoverTarget={id}
        onClick={posicionar}
        disabled={desabilitado}
        aria-label={`Ações para ${u.email}`}
        className={`${BTN_SECUNDARIO} px-2.5 py-1 text-xs`}
      >
        Ações <span aria-hidden>▾</span>
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="inset-auto m-0 w-56 rounded-lg border border-border bg-card p-1 text-foreground shadow-card-hover"
      >
        {u.papel === 'admin' ? item('Rebaixar a usuário', () => onEscolher('rebaixar')) : item('Promover a admin', () => onEscolher('promover'))}
        {bloqueado ? item('Desbloquear', () => onEscolher('desbloquear')) : item('Bloquear', () => onEscolher('bloquear'), { perigo: true })}
        {item('Encerrar sessões', () => onEscolher('sessoes'))}
        <hr className="my-1 border-border" />
        {item('Exportar dados (JSON)', onExportar, { bloqueiaProprio: false })}
        {item('Apagar dados…', () => onEscolher('apagar'), { perigo: true })}
      </div>
    </>
  );
}

export function TabelaUsuarios({ usuarios, bloqueados, eu }: { usuarios: Usuario[]; bloqueados: string[]; eu: string }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [dialogo, setDialogo] = useState<{ acao: Acao; u: Usuario } | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [apagarConta, setApagarConta] = useState(false);
  const sb = () => clienteNavegador();

  const abrir = (acao: Acao, u: Usuario) => {
    setConfirmacao('');
    setApagarConta(false);
    setDialogo({ acao, u });
  };

  const exportar = async (u: Usuario) => {
    const r = await executar('exportar', () => sb().rpc('admin_exportar_dados', { p_alvo: u.id }), 'Cópia dos dados gerada (auditado).');
    if (r.ok) baixarJson(r.data, `routify-titular-${u.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const confirmar = async () => {
    if (!dialogo) return;
    const { acao, u } = dialogo;
    const alvo = { p_alvo: u.id };
    const r =
      acao === 'promover' || acao === 'rebaixar'
        ? await executar(acao, () => sb().rpc('admin_definir_papel', { ...alvo, p_papel: acao === 'promover' ? 'admin' : 'usuario' }),
            acao === 'promover' ? `${u.email} agora é admin (vale no próximo login).` : `${u.email} agora é usuário.`)
        : acao === 'bloquear' || acao === 'desbloquear'
          ? await executar(acao, () => sb().rpc('admin_definir_bloqueio', { ...alvo, p_bloqueado: acao === 'bloquear' }),
              acao === 'bloquear' ? `${u.email} bloqueado.` : `${u.email} desbloqueado.`)
          : acao === 'sessoes'
            ? await executar<number>(acao, () => sb().rpc('admin_encerrar_sessoes', alvo), (n) => `${fmtInt(n)} sessão(ões) de ${u.email} encerrada(s).`)
            : await executar<Contagem>(
                acao,
                () => sb().rpc('admin_apagar_dados', { ...alvo, p_confirmacao: confirmacao, p_apagar_conta: apagarConta }),
                (c) =>
                  `Apagados: ${fmtInt(c.historico_rotas)} rotas do histórico, ${fmtInt(c.rotas_calculadas)} rotas calculadas, ${fmtInt(c.eventos)} eventos e ${fmtInt(c.requisicoes)} requisições${c.conta_apagada ? '; conta excluída' : ''}.`,
              );
    setDialogo(null);
    if (r.ok) router.refresh();
  };

  const d = dialogo && dialogo.acao !== 'apagar' ? DIALOGO[dialogo.acao] : null;
  const emailConfere = !!dialogo && confirmacao.trim().toLowerCase() === dialogo.u.email.toLowerCase();

  return (
    <div className="space-y-4">
      <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />
      <Tabela cabecalho={['Nome', 'E-mail', 'Papel', 'Situação', 'Cadastro', 'Último login', 'Rotas', 'Ações']}>
        {usuarios.map((u) => {
          const proprio = u.id === eu;
          const bloqueado = bloqueados.includes(u.id);
          return (
            <tr key={u.id}>
              <td className="font-medium">
                {u.nome ?? '—'}
                {proprio ? <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span> : null}
              </td>
              <td className="num text-xs">{u.email}</td>
              <td>{u.papel === 'admin' ? <Selo tom="ok">admin</Selo> : <Selo tom="neutro">usuário</Selo>}</td>
              <td>{bloqueado ? <Selo tom="erro">bloqueado</Selo> : <Selo tom="neutro">ativo</Selo>}</td>
              <td className="num text-xs">{fmtData(u.criado_em)}</td>
              <td className="num text-xs">{fmtData(u.ultimo_login)}</td>
              <td className="num">{fmtInt(u.rotas)}</td>
              <td>
                <MenuAcoes
                  u={u}
                  proprio={proprio}
                  bloqueado={bloqueado}
                  desabilitado={ocupado !== null}
                  onEscolher={(a) => abrir(a, u)}
                  onExportar={() => exportar(u)}
                />
              </td>
            </tr>
          );
        })}
      </Tabela>

      <ConfirmarDialog
        aberto={d !== null}
        titulo={d && dialogo ? d.titulo(dialogo.u.email) : ''}
        rotuloConfirmar={d?.botao}
        perigo={d?.perigo}
        ocupado={ocupado !== null}
        onFechar={() => setDialogo(null)}
        onConfirmar={confirmar}
      >
        <p>{d?.texto}</p>
      </ConfirmarDialog>

      <ConfirmarDialog
        aberto={dialogo?.acao === 'apagar'}
        titulo="Apagar dados do titular"
        rotuloConfirmar={apagarConta ? 'Apagar dados e conta' : 'Apagar dados'}
        perigo
        ocupado={ocupado !== null}
        podeConfirmar={emailConfere}
        onFechar={() => setDialogo(null)}
        onConfirmar={confirmar}
      >
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive">
          Pedido de exclusão (LGPD, art. 18). <strong>Irreversível:</strong> apaga o histórico de rotas, as rotas calculadas, os eventos e as
          requisições desta pessoa. Exporte antes se ela pediu uma cópia.
        </p>
        <p>
          O dataset do TCC não é afetado. A auditoria guarda que a exclusão aconteceu (quem, quando), mas não os dados apagados.
        </p>
        <div>
          <label htmlFor="confirma-email" className="text-xs">
            Digite <span className="num text-foreground">{dialogo?.u.email}</span> para confirmar
          </label>
          <input
            id="confirma-email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            className={`${CAMPO} num mt-1`}
          />
        </div>
        <label className="flex items-center gap-2 text-foreground">
          <input type="checkbox" checked={apagarConta} onChange={(e) => setApagarConta(e.target.checked)} className="size-4 accent-destructive" />
          Apagar também a conta (o login deixa de existir)
        </label>
      </ConfirmarDialog>
    </div>
  );
}
