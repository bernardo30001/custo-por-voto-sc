// Estatísticas simples usadas no painel e no simulador.

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (v: number[]) => quantile(v, 0.5);

export interface LogLogFit {
  a: number; // intercepto (ln votos)
  b: number; // elasticidade votos/gasto
  sigma: number; // desvio-padrão dos resíduos (escala ln)
  n: number;
  xbar: number;
  sxx: number;
  r2: number;
}

/** Regressão OLS de ln(votos) sobre ln(gasto). */
export function fitLogLog(pairs: { x: number; y: number }[]): LogLogFit | null {
  const pts = pairs.filter((p) => p.x > 0 && p.y > 0).map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) }));
  const n = pts.length;
  if (n < 8) return null;
  const xbar = pts.reduce((s, p) => s + p.x, 0) / n;
  const ybar = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - xbar) ** 2;
    sxy += (p.x - xbar) * (p.y - ybar);
    syy += (p.y - ybar) ** 2;
  }
  const b = sxy / sxx;
  const a = ybar - b * xbar;
  let sse = 0;
  for (const p of pts) sse += (p.y - (a + b * p.x)) ** 2;
  const sigma = Math.sqrt(sse / (n - 2));
  return { a, b, sigma, n, xbar, sxx, r2: 1 - sse / syy };
}

/** Previsão pontual (mediana condicional) e intervalo de previsão para um gasto x. */
export function predictLogLog(fit: LogLogFit, x: number, z: number) {
  const lx = Math.log(x);
  const yhat = fit.a + fit.b * lx;
  const se = fit.sigma * Math.sqrt(1 + 1 / fit.n + (lx - fit.xbar) ** 2 / fit.sxx);
  return { mid: Math.exp(yhat), lo: Math.exp(yhat - z * se), hi: Math.exp(yhat + z * se) };
}
