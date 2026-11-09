/**
 * Camada de radares nos mapas, com o botão de ligar e desligar lembrado por conta. Sem o arquivo (404, rede) ou no
 * nativo, o botão não aparece e o mapa segue igual.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { carregarRadares, guardarRadares, Radar, radaresLigados } from '../lib/radares';
import { BotaoMapa } from './MapStyleToggle';

export default function BotaoRadares({ mapa }: { mapa: React.RefObject<{ mostrarRadares?: (r: Radar[] | null) => void } | null> }) {
  const { user } = useAuth();
  const [radares, setRadares] = useState<Radar[]>([]);
  const [ligado, setLigado] = useState(() => radaresLigados(user?.id));

  useEffect(() => {
    let vivo = true;
    carregarRadares().then((r) => vivo && setRadares(r));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (radares.length) mapa.current?.mostrarRadares?.(ligado ? radares : null);
  }, [radares, ligado, mapa]);

  if (!radares.length) return null;
  return (
    <BotaoMapa
      icone="mdi:cctv"
      rotulo={ligado ? 'Ocultar radares' : 'Mostrar radares'}
      ligado={ligado}
      onPress={() => {
        guardarRadares(user?.id, !ligado);
        setLigado(!ligado);
      }}
    />
  );
}
