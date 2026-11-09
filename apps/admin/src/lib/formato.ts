const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export const fmtInt = (v: unknown) => {
  const n = num(v);
  return n === null ? 'n/d' : inteiro.format(n);
};

export const fmtDec = (v: unknown, casas = 1) => {
  const n = num(v);
  if (n === null) return 'n/d';
  return casas === 1 ? decimal.format(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
};

export const fmtPct = (v: unknown) => {
  const n = num(v);
  return n === null ? 'n/d' : `${decimal.format(n)}%`;
};

/** 634 → "10 min 34 s" */
export const fmtDuracao = (seg: unknown) => {
  const n = num(seg);
  if (n === null) return 'n/d';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
};

export const fmtData = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return 'n/d';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'n/d' : dataHora.format(d);
};

export const fmtBytes = (v: unknown) => {
  const n = num(v);
  if (n === null) return 'n/d';
  if (n >= 1024 ** 2) return `${decimal.format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${decimal.format(n / 1024)} kB`;
  return `${inteiro.format(n)} B`;
};

/** Ator/alvo da auditoria: e-mail quando resolvível, senão uuid curto. */
export const nomeUsuario = (id: string | null | undefined, emails: Record<string, string>) =>
  !id ? 'n/d' : (emails[id] ?? `${id.slice(0, 8)}…`);

const soDia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** "2026-03-07 19:26:09-03:00" → "07/03/2026" (horário de Brasília). Data sem hora não passa por fuso. */
export const fmtDia = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return 'n/d';
  const so = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'n/d' : soDia.format(d);
};

/** Viés com sinal: +8,2% / −12,3%. Usa o menos tipográfico; o que arredonda para zero vira "0,0%". */
export const fmtPctSinal = (v: unknown) => {
  const n = num(v);
  if (n === null) return 'n/d';
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${decimal.format(Math.abs(r))}%`;
};

/** 754 → "12,6 min" */
export const fmtMin = (seg: unknown) => {
  const n = num(seg);
  return n === null ? 'n/d' : `${decimal.format(n / 60)} min`;
};

/** lia_2.1_retreino_20260923 → "LIA 2.1 re-treino 23/09"; lia_2.2 → "LIA 2.2". Outro formato volta como veio. */
export function rotuloVersao(versao: string) {
  const m = versao.match(/^lia_([\d.]+)(?:_retreino_(\d{4})(\d{2})(\d{2}))?$/);
  if (!m) return versao;
  return m[2] ? `LIA ${m[1]} re-treino ${m[4]}/${m[3]}` : `LIA ${m[1]}`;
}

/** Texto vindo do dado (artefato, RPC) sem travessão: " — " vira ": ". */
export const semTravessao = (s: string) => s.replace(/\s+—\s+/g, ': ');
