/** Contrato de GET /trafego/agora e /trafego/ponto/{id} e os textos que dependem só deles (tests/trafego.test.mjs). */

export const NIVEIS = ['livre', 'moderado', 'lento', 'parado'] as const;
export const ROTULO_NIVEL: Record<(typeof NIVEIS)[number], string> = { livre: 'Livre', moderado: 'Moderado', lento: 'Lento', parado: 'Parado' };

export type Ponto = { id: number; lat: number; lon: number; nome: string | null; razao: number; nivel: number; leitura_ha_min: number | null };
export type RespostaAgora = { atualizado_em: string; pontos: Ponto[]; resumo: Record<(typeof NIVEIS)[number], number> };

export interface DetalhePonto {
  id: number;
  nome: string | null;
  lat: number;
  lon: number;
  vel_livre_kmh: number | null;
  agora: { razao: number; nivel: number; leitura_ha_min: number | null } | null;
  historico: {
    n_leituras: number;
    primeira_leitura: string | null;
    ultima_leitura: string | null;
    por_hora: { hora: number; razao: number | null; n: number }[];
    por_dia_semana: { dia: number; razao: number | null; n: number }[]; // 0 = segunda
    ultimos_dias: { dia: string; razao: number; vel_kmh: number; n: number }[];
    ultimas: { em: string; vel_kmh: number; vel_livre_kmh: number; razao: number; tempo_s: number }[];
  };
}

export const DIA_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** "0,62": a razão com vírgula, duas casas. */
export const razaoTxt = (r: number): string => r.toFixed(2).replace('.', ',');

export const nomeDoPonto = (p: { nome: string | null; id: number }): string => p.nome ?? `Via monitorada ${p.id}`;

/** Há quanto tempo veio a última leitura, na maior unidade que faz sentido. */
export function idadeLeitura(min: number | null): string {
  if (min == null) return 'Sem leitura recente';
  if (min < 60) return `Há ${Math.max(0, Math.round(min))} min`;
  if (min < 48 * 60) return `Há ${Math.round(min / 60)} h`;
  return `Há ${Math.round(min / 1440)} dias`;
}

/** "07/03/2026" no fuso de Brasília; "07/03" sem o ano. */
const dataFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const diaHoraFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const dataTxt = (iso: string): string => dataFmt.format(new Date(iso));
export const diaHoraTxt = (iso: string): string => diaHoraFmt.format(new Date(iso)).replace(', ', ' ');
/** "2026-11-08" (dia já em Brasília, sem hora) → "dom 08/11". */
export function diaCurto(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const semana = DIA_SEMANA[(new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7];
  return `${semana} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Texto para a resposta de erro do detalhe de um ponto. */
export function erroDoPonto(status: number): string {
  if (status === 429) return 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.';
  if (status === 404) return 'Este ponto não existe mais.';
  return 'Não foi possível ler este ponto agora.';
}

/** Hora e dia da semana (0 = segunda) em Brasília agora: marcam a coluna inicial dos gráficos. */
export function horaEDiaAgora(agora: Date): { hora: number; dia: number } {
  // ponytail: UTC-3 fixo, como em lib/planejar.ts.
  const b = new Date(agora.getTime() - 3 * 3600_000);
  return { hora: b.getUTCHours(), dia: (b.getUTCDay() + 6) % 7 };
}
