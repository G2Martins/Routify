/** Planejar saída: contrato do POST /route/horarios e os textos da tela (puro: tests/planejar.test.mjs). */

export interface Horario {
  saida: string; // ISO com o fuso de Brasília (-03:00)
  tempo_seg: number;
}

export interface Horarios {
  horarios: Horario[];
  melhor: number; // índice da saída mais rápida
  distancia_km: number;
  tempo_livre_seg: number; // mesmo trajeto sem congestionamento
  lia_cobertura_pct: number;
  mesmo_trajeto: boolean;
  modelo_utilizado: string;
}

/** "07:30" direto do ISO da API (hora de Brasília), sem passar pelo fuso do aparelho. */
export const hhmm = (iso: string): string => iso.slice(11, 16);

export const minutos = (seg: number): number => Math.round(seg / 60);

const pior = (r: Horarios): Horario =>
  r.horarios.reduce((a, h) => (h.tempo_seg > a.tempo_seg ? h : a), r.horarios[r.melhor]);

/** Minutos ganhos saindo na melhor hora em vez da pior. Abaixo de 1, o horário quase não importa (sem destaque). */
export const ganhoMin = (r: Horarios): number => minutos(pior(r).tempo_seg - r.horarios[r.melhor].tempo_seg);

/** A frase do resultado: a saída mais rápida contra a mais lenta da janela. */
export function resumoMelhor(r: Horarios): string {
  const melhor = r.horarios[r.melhor];
  const ganho = ganhoMin(r);
  if (ganho < 1) return `O horário quase não muda o tempo nesta janela: ~${minutos(melhor.tempo_seg)} min em qualquer saída.`;
  return `Saindo às ${hhmm(melhor.saida)} você gasta ~${ganho} min a menos que às ${hhmm(pior(r).saida)}.`;
}

/** Mensagem da tela para uma resposta de erro da API (o detalhe só aparece quando é texto nosso). */
export function mensagemDeErro(status: number, dados: unknown): string {
  if (status === 429) return 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.';
  const detalhe = (dados as { detail?: unknown } | null)?.detail;
  if (status === 422) return typeof detalhe === 'string' ? detalhe : 'Escolha origem e destino dentro do Distrito Federal.';
  return 'A previsão não respondeu agora. Tente de novo em instantes.';
}
