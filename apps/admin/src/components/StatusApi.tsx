'use client';

import { Selo } from './ui';
import { useSaude } from './useSaude';

export function StatusApi() {
  const { saude, offline } = useSaude();
  if (offline) return <Selo tom="erro">API offline</Selo>;
  if (!saude) return <Selo tom="neutro">verificando API…</Selo>;
  const livres = saude.tomtom.disponiveis.fluxo;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Selo tom="ok">API no ar · {saude.modelo_ativo}</Selo>
      <Selo tom={!saude.tomtom.ativo ? 'alerta' : livres === 0 ? 'erro' : livres < saude.tomtom.chaves ? 'alerta' : 'ok'}>
        TomTom {livres}/{saude.tomtom.chaves} chaves
      </Selo>
      <Selo tom={saude.vias_monitoradas ? 'ok' : 'alerta'}>{saude.vias_monitoradas ?? 0} vias vinculadas</Selo>
    </div>
  );
}
