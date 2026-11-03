'use client';

import { useEffect, useState } from 'react';
import type { Saude } from '@/lib/tipos';
import { chamarApi } from './acoes';

export { API } from './acoes';

/** Saúde da API a cada `intervaloMs`: o /health com o pool TomTom, que só sai para admin (/admin/saude). */
export function useSaude(intervaloMs = 15000) {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [offline, setOffline] = useState(false);
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const { data: dados, error } = await chamarApi<Saude>('/admin/saude');
        if (error || !dados) throw new Error(String(error?.status));
        if (vivo) {
          setSaude(dados);
          setOffline(false);
          setAtualizado(new Date());
        }
      } catch {
        if (vivo) setOffline(true);
      }
    };
    consultar();
    const id = setInterval(consultar, intervaloMs);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [intervaloMs]);

  return { saude, offline, atualizado };
}
