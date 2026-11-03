import { test, expect } from '@playwright/test';
import { API_URL, nota } from './helpers';

test.describe('6. API', () => {
  test('GET /health -> status ok', async ({ request }) => {
    const r = await request.get(`${API_URL}/health`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    nota('health', `modelo_ativo=${j.modelo_ativo} cv_rmse_seg=${j.cv_rmse_seg} vias_monitoradas=${j.vias_monitoradas}`);
    expect(j.status).toBe('ok');
    expect(j.tomtom?.chaves, 'tamanho do pool só no /admin/saude (auditoria B2)').toBeUndefined();
  });

  // Um único POST /route por execução: o limite é 20/min por IP e cada rota gasta cota da TomTom.
  test('POST /route Brasal -> Park Shopping Guará: 200, 3,5-7 km, < 10 s', async ({ request }) => {
    const t0 = Date.now();
    const r = await request.post(`${API_URL}/route`, {
      data: {
        origem: { lat: -15.80627, lon: -47.95787 }, // Brasal
        destino: { lat: -15.83377, lon: -47.95606 }, // Park Shopping (Guará)
      },
      timeout: 15_000,
    });
    const ms = Date.now() - t0;
    expect(r.status()).toBe(200);
    const j = await r.json();
    nota('route', `${ms} ms; ${j.distancia_km} km; ${j.tempo_total_seg} s; via=${j.via_principal}; fonte=${j.fonte_rota}; modelo=${j.modelo_utilizado}`);

    expect(j.distancia_km).toBeGreaterThanOrEqual(3.5);
    expect(j.distancia_km).toBeLessThanOrEqual(7);
    expect(j.tempo_total_seg).toBeGreaterThan(0);
    expect(Array.isArray(j.polyline) && j.polyline.length > 1, 'polyline com pontos').toBe(true);
    expect(ms, 'tempo de resposta').toBeLessThan(10_000);
    expect(r.headers()['server-timing'], 'tempo por fase só em chamada interna (auditoria B8)').toBeUndefined();
  });
});
