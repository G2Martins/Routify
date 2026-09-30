'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { faltaMigracao, mensagemErro, MIGRACAO_ACOES, type ErroBruto } from '@/lib/erros';
import { clienteNavegador } from '@/lib/supabase-navegador';
import { Aviso, BTN_PERIGO, BTN_PRIMARIO, BTN_SECUNDARIO } from './ui';
import { API } from './useSaude';

type Resposta<T> = { data: T | null; error: ErroBruto | null };
export type Retorno = { tom: 'ok' | 'erro'; texto: string; migracao?: boolean };

/**
 * Chamada à API FastAPI com o JWT da sessão (Authorization: Bearer). O token
 * nunca é logado nem guardado fora do cliente Supabase.
 */
export async function chamarApi<T>(caminho: string, metodo: 'GET' | 'POST' = 'GET'): Promise<Resposta<T>> {
  const {
    data: { session },
  } = await clienteNavegador().auth.getSession();
  if (!session) return { data: null, error: { status: 401 } };
  try {
    const r = await fetch(`${API}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok) {
      const detalhe = typeof corpo?.detail === 'string' ? corpo.detail : undefined;
      // ponytail: Retry-After só chega se a API expuser o header no CORS; sem ele, "~1 min".
      return { data: null, error: { status: r.status, message: detalhe, retryAfter: r.headers.get('Retry-After') } };
    }
    return { data: corpo as T, error: null };
  } catch {
    return { data: null, error: { status: 0 } };
  }
}

/**
 * Executa uma ação (RPC ou API) com trava contra duplo envio, mapeando o erro
 * para uma mensagem legível. Sem UI otimista: quem chama decide o que fazer
 * depois do `ok` (ex.: router.refresh()).
 * `ocupado` = chave da ação em andamento (para o botão certo mostrar "Aguarde…").
 */
export function useAcao() {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [retorno, setRetorno] = useState<Retorno | null>(null);
  const trava = useRef(false);

  useEffect(() => {
    if (retorno?.tom !== 'ok') return;
    const t = setTimeout(() => setRetorno(null), 10000);
    return () => clearTimeout(t);
  }, [retorno]);

  const executar = useCallback(
    async <T,>(
      chave: string,
      fn: () => PromiseLike<Resposta<T>>,
      sucesso?: string | ((dados: T) => string),
    ): Promise<{ ok: true; data: T } | { ok: false }> => {
      if (trava.current) return { ok: false };
      trava.current = true;
      setOcupado(chave);
      setRetorno(null);
      try {
        const { data, error } = await fn();
        if (error) {
          setRetorno({ tom: 'erro', texto: mensagemErro(error), migracao: faltaMigracao(error) });
          return { ok: false };
        }
        if (sucesso) setRetorno({ tom: 'ok', texto: typeof sucesso === 'function' ? sucesso(data as T) : sucesso });
        return { ok: true, data: data as T };
      } catch {
        setRetorno({ tom: 'erro', texto: 'Falha de rede — tente de novo.' });
        return { ok: false };
      } finally {
        trava.current = false;
        setOcupado(null);
      }
    },
    [],
  );

  return { executar, ocupado, retorno, setRetorno };
}

/** Resultado da última ação, em linha (status para sucesso, alert para erro). */
export function MensagemRetorno({ retorno, onFechar }: { retorno: Retorno | null; onFechar: () => void }) {
  if (!retorno) return null;
  if (retorno.migracao) {
    return (
      <div role="alert" className="surgir">
        <Aviso titulo="Migration pendente">
          Aplique a migration <span className="num">{MIGRACAO_ACOES}</span> (ver docs/core/rodar-local.md).
        </Aviso>
      </div>
    );
  }
  const erro = retorno.tom === 'erro';
  return (
    <div
      role={erro ? 'alert' : 'status'}
      className={`surgir flex items-start justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
        erro ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-ok/40 bg-ok/5 text-ok'
      }`}
      style={{ animationDuration: '240ms' }}
    >
      <span>{retorno.texto}</span>
      <button type="button" onClick={onFechar} aria-label="Fechar mensagem" className="shrink-0 opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

/**
 * Diálogo de confirmação sobre <dialog> nativo: showModal() já prende o foco e
 * deixa o resto da página inerte; Esc fecha (evento cancel). Clique no fundo
 * também fecha. Enquanto `ocupado`, não fecha.
 */
export function ConfirmarDialog({
  aberto,
  titulo,
  children,
  rotuloConfirmar = 'Confirmar',
  perigo = false,
  ocupado = false,
  podeConfirmar = true,
  onConfirmar,
  onFechar,
}: {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  rotuloConfirmar?: string;
  perigo?: boolean;
  ocupado?: boolean;
  podeConfirmar?: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    else if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={tituloId}
      onCancel={(e) => {
        e.preventDefault();
        if (!ocupado) onFechar();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !ocupado) onFechar();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground shadow-card-hover backdrop:bg-foreground/40"
    >
      {aberto ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (podeConfirmar && !ocupado) onConfirmar();
          }}
          className="p-6"
        >
          <h2 id={tituloId} className="font-display text-2xl leading-tight">
            {titulo}
          </h2>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onFechar} disabled={ocupado} className={BTN_SECUNDARIO}>
              Cancelar
            </button>
            <button type="submit" disabled={!podeConfirmar || ocupado} className={perigo ? BTN_PERIGO : BTN_PRIMARIO}>
              {ocupado ? 'Aguarde…' : rotuloConfirmar}
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

/** Interruptor acessível (role=switch). */
export function Interruptor({
  ligado,
  onMudar,
  rotulo,
  desabilitado = false,
}: {
  ligado: boolean;
  onMudar: (novo: boolean) => void;
  rotulo: string;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => onMudar(!ligado)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out active:scale-[0.98] disabled:opacity-50 ${
        ligado ? 'border-accent bg-accent' : 'border-border-strong bg-muted'
      }`}
    >
      <span
        aria-hidden
        className={`size-4.5 rounded-full bg-card shadow-card transition-transform duration-240 ease-out-expo ${
          ligado ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Giro() {
  return (
    <span
      aria-hidden
      className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

