'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Barra fina no topo: aparece no clique em link interno do painel e some quando a nova página chega
 * (pathname ou query mudam). Se nada chegar em 20 s, some sozinha. Sem movimento com prefers-reduced-motion.
 */
export function BarraProgresso() {
  const rota = usePathname();
  const busca = useSearchParams().toString();
  const [ativa, setAtiva] = useState(false);

  useEffect(() => setAtiva(false), [rota, busca]);

  useEffect(() => {
    const clique = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setAtiva(true);
    };
    document.addEventListener('click', clique, true);
    return () => document.removeEventListener('click', clique, true);
  }, []);

  useEffect(() => {
    if (!ativa) return;
    const t = setTimeout(() => setAtiva(false), 20000);
    return () => clearTimeout(t);
  }, [ativa]);

  return (
    <div
      role="progressbar"
      aria-label="Carregando página"
      aria-hidden={!ativa}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.75 overflow-hidden transition-opacity duration-200 ${ativa ? 'opacity-100' : 'opacity-0'}`}
    >
      {ativa ? <div className="barra-progresso faixa-marca h-full" /> : null}
    </div>
  );
}
