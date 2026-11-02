/**
 * Trânsito na rota, comum ao mapa web e ao nativo. `trafego[i]` = nível do trecho do ponto i ao i+1
 * (0 livre, 1 moderado, 2 lento, 3 parado; null = sem dado), vindo da API.
 */

/** Trechos consecutivos com o mesmo nível (1–3) viram um intervalo [início, fim] de pontos. */
export function gruposTransito(nPontos: number, trafego: (number | null)[] | null | undefined): [number, number, number][] {
  const grupos: [number, number, number][] = [];
  if (!trafego) return grupos;
  let ini = -1;
  let nivel = 0;
  for (let i = 0; i < nPontos - 1; i++) {
    const n = Number(trafego[i] ?? 0);
    if (n >= 1 && n === nivel) continue;
    if (nivel >= 1) grupos.push([ini, i, nivel]);
    nivel = n;
    ini = i;
  }
  if (nivel >= 1) grupos.push([ini, nPontos - 1, nivel]);
  return grupos;
}
