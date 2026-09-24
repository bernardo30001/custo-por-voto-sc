const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

export const fmtBRL = (v: number) => (Number.isFinite(v) ? brl.format(v) : '—');
export const fmtBRL0 = (v: number) => (Number.isFinite(v) ? brl0.format(v) : '—');
export const fmtInt = (v: number) => (Number.isFinite(v) ? int.format(Math.round(v)) : '—');
export const fmtVotos = (v: number) => (Number.isFinite(v) ? `${int.format(Math.round(v))} ${Math.round(v) === 1 ? 'voto' : 'votos'}` : '—');
export const fmtPct = (v: number) => (Number.isFinite(v) ? pct.format(v) : '—');

/** Valor compacto para eixos: R$ 10 mil, R$ 1,2 mi. */
export function fmtBRLShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}
export function fmtIntShort(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Converte "500.000", "500 mil", "1,5 mi", "2000000" em número. */
export function parseBRL(input: string): number {
  let s = input.toLowerCase().replace(/r\$|\s/g, '');
  let mult = 1;
  if (/(mi|milh)/.test(s)) mult = 1e6;
  else if (/mil|k$/.test(s)) mult = 1e3;
  s = s.replace(/[a-zõãç]+/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * mult : NaN;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
