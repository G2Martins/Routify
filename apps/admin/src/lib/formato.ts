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
  return n === null ? '—' : inteiro.format(n);
};

export const fmtDec = (v: unknown, casas = 1) => {
  const n = num(v);
  if (n === null) return '—';
  return casas === 1 ? decimal.format(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
};

export const fmtPct = (v: unknown) => {
  const n = num(v);
  return n === null ? '—' : `${decimal.format(n)}%`;
};

/** 634 → "10 min 34 s" */
export const fmtDuracao = (seg: unknown) => {
  const n = num(seg);
  if (n === null) return '—';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
};

export const fmtData = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataHora.format(d);
};

export const fmtBytes = (v: unknown) => {
  const n = num(v);
  if (n === null) return '—';
  if (n >= 1024 ** 2) return `${decimal.format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${decimal.format(n / 1024)} kB`;
  return `${inteiro.format(n)} B`;
};

/** Ator/alvo da auditoria: e-mail quando resolvível, senão uuid curto. */
export const nomeUsuario = (id: string | null | undefined, emails: Record<string, string>) =>
  !id ? '—' : (emails[id] ?? `${id.slice(0, 8)}…`);
