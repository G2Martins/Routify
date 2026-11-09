/** Planejar saída: contrato do POST /route/horarios, janelas úteis e os textos da tela (puro: tests/planejar.test.mjs). */

export interface Horario {
  saida: string; // ISO com o fuso de Brasília (-03:00)
  tempo_seg: number;
  trafego?: (number | null)[] | null; // nível por trecho da polyline, no formato do /route
}

export interface Horarios {
  horarios: Horario[];
  melhor: number; // índice da saída mais rápida
  distancia_km: number;
  tempo_livre_seg: number; // mesmo trajeto sem congestionamento
  lia_cobertura_pct: number;
  mesmo_trajeto: boolean;
  modelo_utilizado: string;
  polyline?: [number, number][] | null; // geometria real das vias
}

export type Periodo = 'manha' | 'tarde' | 'noite';

const PASSO_MIN = 30;

/** Horas úteis de cada período, em minutos do dia. A madrugada fica de fora: nela o horário nunca muda nada. */
export const PERIODOS: Record<Periodo, { rotulo: string; ini: number; fim: number }> = {
  manha: { rotulo: 'Manhã', ini: 6 * 60, fim: 12 * 60 },
  tarde: { rotulo: 'Tarde', ini: 12 * 60, fim: 18 * 60 },
  noite: { rotulo: 'Noite', ini: 18 * 60, fim: 23 * 60 },
};
const ORDEM: Periodo[] = ['manha', 'tarde', 'noite'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_A_FRENTE = 7; // a API aceita até 7 dias à frente

// ponytail: UTC-3 fixo, o Brasil não tem horário de verão desde 2019. Se voltar, trocar por Intl com timeZone.
const brasilia = (agora: Date): Date => new Date(agora.getTime() - 3 * 3600_000);
const chaveDe = (d: Date): string => d.toISOString().slice(0, 10);
const doisDigitos = (n: number): string => String(n).padStart(2, '0');

/** Hoje, amanhã e os dias seguintes, para escolher a saída. */
export function proximosDias(agora: Date): { chave: string; rotulo: string }[] {
  const base = brasilia(agora);
  return Array.from({ length: DIAS_A_FRENTE }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000);
    const rotulo = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : `${SEMANA[d.getUTCDay()]} ${d.getUTCDate()}`;
    return { chave: chaveDe(d), rotulo };
  });
}

/** Primeira saída e quantas saídas pedir à API para o dia e o período; null se o período já passou (ou quase). */
export function janelaDe(dia: string, periodo: Periodo, agora: Date): { inicio: string; janelas: number } | null {
  const p = PERIODOS[periodo];
  let ini = p.ini;
  const b = brasilia(agora);
  if (dia === chaveDe(b)) {
    const minutoAtual = b.getUTCHours() * 60 + b.getUTCMinutes();
    ini = Math.max(ini, (Math.floor(minutoAtual / PASSO_MIN) + 1) * PASSO_MIN);
  }
  const janelas = Math.floor((p.fim - ini) / PASSO_MIN);
  if (janelas < 2) return null;
  return { inicio: `${dia}T${doisDigitos(Math.floor(ini / 60))}:${doisDigitos(ini % 60)}:00-03:00`, janelas };
}

/** Começa no próximo período útil de hoje; tarde da noite, na manhã seguinte. Nunca na madrugada. */
export function escolhaPadrao(agora: Date): { dia: string; periodo: Periodo } {
  const [hoje, amanha] = proximosDias(agora);
  const periodo = ORDEM.find((p) => janelaDe(hoje.chave, p, agora));
  return periodo ? { dia: hoje.chave, periodo } : { dia: amanha.chave, periodo: 'manha' };
}

/** Primeiro período que ainda dá para escolher nesse dia, mantendo o atual se ele valer. */
export function periodoValido(dia: string, atual: Periodo, agora: Date): Periodo {
  if (janelaDe(dia, atual, agora)) return atual;
  return ORDEM.find((p) => janelaDe(dia, p, agora)) ?? 'manha';
}

/** "07:30" direto do ISO da API (hora de Brasília), sem passar pelo fuso do aparelho. */
export const hhmm = (iso: string): string => iso.slice(11, 16);

export const minutos = (seg: number): number => Math.round(seg / 60);

const pior = (r: Horarios): Horario =>
  r.horarios.reduce((a, h) => (h.tempo_seg > a.tempo_seg ? h : a), r.horarios[r.melhor]);

/** Minutos ganhos saindo na melhor hora em vez da pior. */
export const ganhoMin = (r: Horarios): number => minutos(pior(r).tempo_seg - r.horarios[r.melhor].tempo_seg);

/** Abaixo de 2 min de diferença ninguém muda a hora de sair: a tela diz em uma linha e não mostra gráfico. */
export const horarioImporta = (r: Horarios): boolean => ganhoMin(r) >= 2;

/** A frase do resultado: a saída mais rápida contra a mais lenta da janela. */
export function resumoMelhor(r: Horarios): string {
  const melhor = r.horarios[r.melhor];
  if (!horarioImporta(r)) {
    const fim = r.horarios[r.horarios.length - 1];
    return `Tanto faz o horário: ~${minutos(melhor.tempo_seg)} min saindo entre ${hhmm(r.horarios[0].saida)} e ${hhmm(fim.saida)}.`;
  }
  return `${ganhoMin(r)} min a menos que às ${hhmm(pior(r).saida)}.`;
}

/** Mensagem da tela para uma resposta de erro da API (o detalhe só aparece quando é texto nosso). */
export function mensagemDeErro(status: number, dados: unknown): string {
  if (status === 429) return 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.';
  const detalhe = (dados as { detail?: unknown } | null)?.detail;
  if (status === 422) return typeof detalhe === 'string' ? detalhe : 'Escolha origem e destino dentro do Distrito Federal.';
  return 'A previsão não respondeu agora. Tente de novo em instantes.';
}
