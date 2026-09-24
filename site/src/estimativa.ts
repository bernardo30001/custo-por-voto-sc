// Referência histórica para um valor de campanha: candidatos que gastaram algo parecido (corrigido
// pelo IPCA e, se houver, multiplicado pelo cenário de gasto não declarado) e quantos votos tiveram.
import type { Cargo, Metrica } from './data';
import { dataset, naMedia, ultimoEleito, valor } from './state';
import { quantile } from './stats';

export interface Referencia {
  n: number;
  janela: number;
  p25: number;
  mediana: number;
  p75: number;
  eleitos: number;
}

interface Ponto {
  x: number; // gasto histórico real (corrigido × (1 + p))
  v: number;
  eleito: boolean;
}

export interface Indice {
  cargo: Cargo;
  anos: number[];
  pontos: Ponto[]; // ordenados por x
  gastoEleitos: { p25: number; mediana: number; p75: number };
  ultimo: { ano: number; votos: number; nome: string }[];
}

export function criarIndice(cargo: Cargo, anos: number[], metrica: Metrica, p: number): Indice {
  const ds = dataset();
  const pontos = ds.candidatos
    .filter((c) => c.c === cargo && anos.includes(c.a) && naMedia(c, metrica))
    .map((c) => ({ x: valor(c, metrica, true) * (1 + p), v: c.v, eleito: c.s === 'eleito' }))
    .sort((a, b) => a.x - b.x);
  const ge = pontos.filter((q) => q.eleito).map((q) => q.x);
  return {
    cargo,
    anos,
    pontos,
    gastoEleitos: { p25: quantile(ge, 0.25), mediana: quantile(ge, 0.5), p75: quantile(ge, 0.75) },
    ultimo: anos
      .map((a) => {
        const u = ultimoEleito(a, cargo);
        return u ? { ano: a, votos: u.v, nome: u.u } : null;
      })
      .filter((x): x is { ano: number; votos: number; nome: string } => x !== null),
  };
}

function lowerBound(pts: Ponto[], x: number) {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Faixa de votos (p25 a p75) dos candidatos históricos com gasto entre −20% e +20% do valor (ampliando até ±50%). */
export function referencia(idx: Indice, valorAtual: number): Referencia | null {
  if (!(valorAtual > 0)) return null;
  for (const w of [0.2, 0.3, 0.4, 0.5]) {
    const i0 = lowerBound(idx.pontos, valorAtual * (1 - w));
    const i1 = lowerBound(idx.pontos, valorAtual * (1 + w) + 1e-9);
    const grupo = idx.pontos.slice(i0, i1);
    if (grupo.length >= 5 || w === 0.5) {
      if (!grupo.length) return null;
      const votos = grupo.map((g) => g.v);
      return {
        n: grupo.length,
        janela: w,
        p25: quantile(votos, 0.25),
        mediana: quantile(votos, 0.5),
        p75: quantile(votos, 0.75),
        eleitos: grupo.filter((g) => g.eleito).length,
      };
    }
  }
  return null;
}
