'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ConfirmarDialog, Interruptor, MensagemRetorno, useAcao } from '@/components/acoes';
import { BTN_PRIMARIO, BTN_SECUNDARIO, CAMPO, Cartao, Selo } from '@/components/ui';
import { fmtData } from '@/lib/formato';
import { clienteNavegador } from '@/lib/supabase-navegador';
import type { AvisoApp, NivelAviso } from '@/lib/tipos';

const NIVEIS: { valor: NivelAviso; rotulo: string; tom: 'neutro' | 'alerta' | 'erro' }[] = [
  { valor: 'info', rotulo: 'Informação', tom: 'neutro' },
  { valor: 'alerta', rotulo: 'Alerta', tom: 'alerta' },
  { valor: 'manutencao', rotulo: 'Manutenção', tom: 'erro' },
];
const MAX = 280;

/** ISO → valor de <input type="datetime-local"> no fuso do navegador (e volta). */
const paraCampo = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const paraIso = (v: string) => (v ? new Date(v).toISOString() : null);

type Rascunho = { id: string | null; mensagem: string; nivel: NivelAviso; ativo: boolean; inicio: string; fim: string };
const VAZIO: Rascunho = { id: null, mensagem: '', nivel: 'info', ativo: true, inicio: '', fim: '' };

function situacao(a: AvisoApp, agora: number): { tom: 'ok' | 'alerta' | 'neutro'; texto: string } {
  if (!a.ativo) return { tom: 'neutro', texto: 'desativado' };
  if (new Date(a.inicio).getTime() > agora) return { tom: 'alerta', texto: 'agendado' };
  if (a.fim && new Date(a.fim).getTime() <= agora) return { tom: 'neutro', texto: 'expirado' };
  return { tom: 'ok', texto: 'no ar' };
}

export function Avisos({ avisos }: { avisos: AvisoApp[] }) {
  const router = useRouter();
  const { executar, ocupado, retorno, setRetorno } = useAcao();
  const [r, setR] = useState<Rascunho>(VAZIO);
  const [remover, setRemover] = useState<AvisoApp | null>(null);
  const [agora] = useState(() => Date.now());

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const mensagem = r.mensagem.trim();
    const inicio = paraIso(r.inicio);
    const fim = paraIso(r.fim);
    if (mensagem.length < 3) return setRetorno({ tom: 'erro', texto: 'A mensagem precisa de pelo menos 3 caracteres.' });
    if (fim && fim <= (inicio ?? new Date().toISOString())) return setRetorno({ tom: 'erro', texto: 'O fim precisa ser depois do início.' });
    const res = await executar(
      'salvar',
      () => clienteNavegador().rpc('admin_aviso_salvar', { p_id: r.id, p_mensagem: mensagem, p_nivel: r.nivel, p_ativo: r.ativo, p_inicio: inicio, p_fim: fim }),
      r.id ? 'Aviso atualizado.' : 'Aviso publicado.',
    );
    if (res.ok) {
      setR(VAZIO);
      router.refresh();
    }
  };

  const alternar = async (a: AvisoApp, ativo: boolean) => {
    const res = await executar(
      `ativo:${a.id}`,
      () => clienteNavegador().rpc('admin_aviso_salvar', { p_id: a.id, p_mensagem: a.mensagem, p_nivel: a.nivel, p_ativo: ativo, p_inicio: a.inicio, p_fim: a.fim }),
      ativo ? 'Aviso ativado.' : 'Aviso desativado.',
    );
    if (res.ok) router.refresh();
  };

  const confirmarRemocao = async () => {
    if (!remover) return;
    const res = await executar('remover', () => clienteNavegador().rpc('admin_aviso_remover', { p_id: remover.id }), 'Aviso removido.');
    setRemover(null);
    if (res.ok) {
      if (r.id === remover.id) setR(VAZIO);
      router.refresh();
    }
  };

  return (
    <Cartao
      titulo="Avisos do app"
      atraso={120}
      nota="Banner no app para todos (inclusive sem login) enquanto ativo e dentro da janela. Texto puro — nada de HTML."
    >
      <div className="space-y-4">
        <MensagemRetorno retorno={retorno} onFechar={() => setRetorno(null)} />
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            {avisos.length ? (
              <ul className="space-y-3">
                {avisos.map((a) => {
                  const nivel = NIVEIS.find((n) => n.valor === a.nivel) ?? NIVEIS[0];
                  const s = situacao(a, agora);
                  return (
                    <li
                      key={a.id}
                      className={`rounded-lg border p-4 transition-shadow duration-150 hover:shadow-card ${
                        r.id === a.id ? 'border-accent' : 'border-border'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Selo tom={nivel.tom}>{nivel.rotulo}</Selo>
                          <Selo tom={s.tom}>{s.texto}</Selo>
                        </div>
                        <Interruptor
                          ligado={a.ativo}
                          rotulo={`Aviso ativo: ${a.mensagem.slice(0, 40)}`}
                          desabilitado={ocupado !== null}
                          onMudar={(v) => alternar(a, v)}
                        />
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{a.mensagem}</p>
                      <p className="num mt-2 text-[11px] text-muted-foreground">
                        {fmtData(a.inicio)} → {a.fim ? fmtData(a.fim) : 'sem fim'}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className={`${BTN_SECUNDARIO} px-2.5 py-1 text-xs`}
                          onClick={() =>
                            setR({ id: a.id, mensagem: a.mensagem, nivel: a.nivel, ativo: a.ativo, inicio: paraCampo(a.inicio), fim: paraCampo(a.fim) })
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className={`${BTN_SECUNDARIO} px-2.5 py-1 text-xs text-destructive`}
                          disabled={ocupado !== null}
                          onClick={() => setRemover(a)}
                        >
                          Remover
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum aviso cadastrado.</p>
            )}
          </div>

          <form onSubmit={salvar} className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium">{r.id ? 'Editar aviso' : 'Novo aviso'}</p>
            <div>
              <label htmlFor="aviso-msg" className="text-xs text-muted-foreground">
                Mensagem
              </label>
              <textarea
                id="aviso-msg"
                required
                minLength={3}
                maxLength={MAX}
                rows={3}
                value={r.mensagem}
                onChange={(e) => setR({ ...r, mensagem: e.target.value })}
                aria-describedby="aviso-contador"
                className={`${CAMPO} mt-1 resize-y`}
                placeholder="Ex.: Manutenção programada hoje às 23h — rotas podem ficar só com a LIA."
              />
              <p id="aviso-contador" className={`num mt-1 text-right text-[11px] ${r.mensagem.length >= MAX ? 'text-alerta' : 'text-muted-foreground'}`}>
                {r.mensagem.length}/{MAX}
              </p>
            </div>
            <fieldset>
              <legend className="text-xs text-muted-foreground">Nível</legend>
              <div className="mt-1 inline-flex rounded-lg border border-border bg-muted p-0.5">
                {NIVEIS.map((n) => (
                  <label
                    key={n.valor}
                    className="cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground transition-all duration-150 ease-out has-checked:bg-card has-checked:text-foreground has-checked:shadow-card has-focus-visible:ring-2 has-focus-visible:ring-accent/60"
                  >
                    <input
                      type="radio"
                      name="aviso-nivel"
                      value={n.valor}
                      checked={r.nivel === n.valor}
                      onChange={() => setR({ ...r, nivel: n.valor })}
                      className="sr-only"
                    />
                    {n.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="aviso-inicio" className="text-xs text-muted-foreground">
                  Início <span className="opacity-70">(vazio = agora)</span>
                </label>
                <input
                  id="aviso-inicio"
                  type="datetime-local"
                  value={r.inicio}
                  onChange={(e) => setR({ ...r, inicio: e.target.value })}
                  className={`${CAMPO} num mt-1`}
                />
              </div>
              <div>
                <label htmlFor="aviso-fim" className="text-xs text-muted-foreground">
                  Fim <span className="opacity-70">(vazio = sem fim)</span>
                </label>
                <input
                  id="aviso-fim"
                  type="datetime-local"
                  value={r.fim}
                  min={r.inicio || undefined}
                  onChange={(e) => setR({ ...r, fim: e.target.value })}
                  className={`${CAMPO} num mt-1`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.ativo} onChange={(e) => setR({ ...r, ativo: e.target.checked })} className="size-4 accent-accent" />
              Ativo
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={ocupado !== null || r.mensagem.trim().length < 3} className={BTN_PRIMARIO}>
                {ocupado === 'salvar' ? 'Salvando…' : r.id ? 'Salvar alterações' : 'Publicar aviso'}
              </button>
              {r.id || r.mensagem ? (
                <button type="button" onClick={() => setR(VAZIO)} className={BTN_SECUNDARIO}>
                  {r.id ? 'Cancelar edição' : 'Limpar'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
      <ConfirmarDialog
        aberto={remover !== null}
        titulo="Remover este aviso?"
        rotuloConfirmar="Remover"
        perigo
        ocupado={ocupado !== null}
        onFechar={() => setRemover(null)}
        onConfirmar={confirmarRemocao}
      >
        <p className="whitespace-pre-wrap break-words text-foreground">“{remover?.mensagem}”</p>
        <p>Some do app na hora. Para só tirar do ar e guardar, desative em vez de remover.</p>
      </ConfirmarDialog>
    </Cartao>
  );
}
