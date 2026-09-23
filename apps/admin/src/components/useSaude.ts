'use client';

import { useEffect, useState } from 'react';
import type { Saude } from '@/lib/tipos';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Consulta o /health da API (público) a cada `intervaloMs`. */
export function useSaude(intervaloMs = 15000) {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [offline, setOffline] = useState(false);
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const r = await fetch(`${API}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as Saude;
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
