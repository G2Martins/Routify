'use client';

import { useEffect, useRef, useState } from 'react';
import type { Saude } from '@/lib/tipos';
import { chamarApi } from './acoes';

export { API } from './acoes';

/** Chama `fn` agora, a cada `ms` e quando a aba volta a ficar visível; com a aba escondida, não chama. */
export function usePolling(fn: () => void, ms: number) {
  const atual = useRef(fn);
  atual.current = fn;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') atual.current();
    };
    tick();
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}

/** Saúde da API a cada `intervaloMs`: o /health com o pool TomTom, que só sai para admin (/admin/saude). */
export function useSaude(intervaloMs = 15000) {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [offline, setOffline] = useState(false);
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  usePolling(async () => {
    const { data, error } = await chamarApi<Saude>('/admin/saude');
    if (error || !data) {
      setOffline(true);
      return;
    }
    setSaude(data);
    setOffline(false);
    setAtualizado(new Date());
  }, intervaloMs);

  return { saude, offline, atualizado };
}
