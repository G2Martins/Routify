/**
 * Geolocalização no navegador, comum aos dois mapas web (vetorial e Leaflet).
 *
 * Exige origem segura (HTTPS ou localhost) e permissão do usuário. Tenta GPS (alta precisão), depois
 * rede (baixa precisão, PC sem GPS) e, por último, a posição aproximada por IP (só para centralizar).
 */

/**
 * Centraliza em quem usa. `colocar(lat, lon, zoom)` recebe a posição; `onError` recebe a mensagem
 * para o usuário quando nada funcionou ou a posição é aproximada.
 */
export function localizarUsuario(colocar: (lat: number, lon: number, zoom: number) => void, onError?: (msg: string) => void) {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    onError?.('Geolocalização não suportada neste navegador.');
    return;
  }
  if (!window.isSecureContext) {
    onError?.('Geolocalização requer HTTPS ou localhost. Acesse via https:// ou http://localhost:8081');
    return;
  }

  // O Edge usa só o serviço de Localização do Windows (lfsvc): sem ele, alta e baixa precisão falham
  // pelo mesmo motivo, então não adianta tentar a baixa.
  const edge = /\bEdg\//.test(navigator.userAgent);
  const tentar = (alta: boolean): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: alta,
        timeout: edge ? (alta ? 4000 : 6000) : alta ? 8000 : 12000,
        maximumAge: 60_000,
      });
    });

  const porIp = async () => {
    // CORS liberado; precisão de cidade, só para centralizar.
    // ponytail: um provedor só; se o ipapi.co cair ou limitar, volte com ipwho.is e api.bigdatacloud.net (CSP em apps/admin/next.config.ts).
    try {
      const r = await fetch('https://ipapi.co/json/');
      if (!r.ok) return false;
      const j = await r.json();
      const lat = parseFloat(j.latitude);
      const lon = parseFloat(j.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        colocar(lat, lon, 12);
        return true;
      }
    } catch {
      // sem rede ou bloqueado: fica sem posição por IP
    }
    return false;
  };

  (async () => {
    try {
      const { latitude, longitude } = (await tentar(true)).coords;
      colocar(latitude, longitude, 15);
      return;
    } catch (err) {
      const codigo = (err as GeolocationPositionError).code;
      if (codigo === 1) {
        onError?.('Permissão negada. Cadeado da URL → permitir localização.');
        return;
      }
      if (edge && codigo === 2) {
        const ok = await porIp();
        onError?.(
          ok
            ? 'Edge sem acesso à Localização do Windows. Usando IP. Ative o serviço lfsvc ou use Chrome.'
            : 'Edge não tem acesso ao serviço de Localização do Windows. Ative em Configurações → Privacidade → Localização, ou abra no Chrome.'
        );
        return;
      }
    }
    try {
      const { latitude, longitude } = (await tentar(false)).coords;
      colocar(latitude, longitude, 14);
      return;
    } catch {
      // segue para o IP
    }
    if (await porIp()) {
      onError?.('Localização aproximada por IP (PC sem GPS).');
      return;
    }
    onError?.('Localização indisponível em todos os métodos.');
  })();
}

/** Acompanha a posição (navegação). Devolve a função que para de acompanhar. */
export function acompanhar(
  aoMover: (lat: number, lon: number, rumo: number | null) => void,
  onError?: (msg: string) => void
): (() => void) | null {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    onError?.('Geolocalização indisponível.');
    return null;
  }
  if (!window.isSecureContext) {
    onError?.('Geolocalização requer HTTPS ou localhost.');
    return null;
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => aoMover(pos.coords.latitude, pos.coords.longitude, Number.isFinite(pos.coords.heading as number) ? (pos.coords.heading as number) : null),
    (err) => onError?.(err.code === err.PERMISSION_DENIED ? 'Permissão negada. Cadeado da URL → permitir localização.' : 'Localização indisponível no momento.'),
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}
