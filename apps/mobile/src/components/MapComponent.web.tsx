/**
 * Mapa (web): vetorial (MapLibre + OpenFreeMap, mapa/MapaVetorial.web.tsx) quando o navegador tem
 * WebGL; senão, ou se o estilo vetorial não carregar, o Leaflet de reserva (MapaLeaflet.web.tsx).
 * Os dois expõem a mesma API imperativa: centerOnUser, showRoute, clearRoute, startFollow, stopFollow.
 */
import React, { forwardRef, useState } from 'react';
import MapaVetorial from './mapa/MapaVetorial.web';
import MapaLeaflet from './MapaLeaflet.web';

function temWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const MapComponent = forwardRef((_props, ref) => {
  const [vetorial, setVetorial] = useState(temWebGL);
  return vetorial ? <MapaVetorial ref={ref} onFalha={() => setVetorial(false)} /> : <MapaLeaflet ref={ref} />;
});

MapComponent.displayName = 'MapComponent';

export default MapComponent;
