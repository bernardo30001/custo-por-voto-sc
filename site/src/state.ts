import type { Candidato, Cargo, Dataset, Metrica, Situacao } from './data';
import { median } from './stats';

export interface State {
  metrica: Metrica;
  corrigido: boolean;
  p: number; // gasto não declarado, fração do declarado (0 a 1)
  ano: number;
  cargo: Cargo;
  partido: string;
  situacao: '' | Situacao;
  busca: string;
  sort: { key: SortKey; dir: 1 | -1 };
}

export type SortKey = 'u' | 'p' | 'v' | 'valor' | 'cpv' | 's';

export const state: State = {
  metrica: 'despesas',
  corrigido: true,
  p: 0,
  ano: 2022,
  cargo: 6,
  partido: '',
  situacao: '',
  busca: '',
  sort: { key: 'v', dir: -1 },
};

let ds: Dataset;
export function setDataset(d: Dataset) {
  ds = d;
}
export function dataset() {
  return ds;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function update(patch: Partial<State>) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn());
}

export function fator(ano: number, corrigido = state.corrigido): number {
  return corrigido ? ds.meta.ipca.fatores[String(ano)] ?? 1 : 1;
}

/** Valor da métrica escolhida (declarado), já corrigido se for o caso. */
export function valor(c: Candidato, metrica: Metrica = state.metrica, corrigido = state.corrigido): number {
  const raw = metrica === 'despesas' ? c.g : metrica === 'receitas' ? c.rt : c.rf;
  return raw * fator(c.a, corrigido);
}

export function flags(c: Candidato, metrica: Metrica = state.metrica): string[] {
  const f = [...c.f];
  const raw = metrica === 'despesas' ? c.g : metrica === 'receitas' ? c.rt : c.rf;
  if (!f.includes('sem_contas') && raw <= 0) f.push('sem_valor');
  return f;
}

/** Entra nas médias/medianas: tem votos válidos, prestou contas e tem valor positivo na métrica. */
export function naMedia(c: Candidato, metrica: Metrica = state.metrica): boolean {
  return flags(c, metrica).length === 0 && c.v > 0;
}

export function cpv(c: Candidato, metrica: Metrica = state.metrica, corrigido = state.corrigido): number {
  if (c.v <= 0) return NaN;
  const v = valor(c, metrica, corrigido);
  return v > 0 ? v / c.v : NaN;
}

export function cpvAjustado(c: Candidato, p = state.p, metrica: Metrica = state.metrica, corrigido = state.corrigido) {
  return cpv(c, metrica, corrigido) * (1 + p);
}

export function doCargoAno(ano: number, cargo: Cargo) {
  return ds.candidatos.filter((c) => c.a === ano && c.c === cargo);
}

/** Menor votação entre os eleitos (o "último eleito" pela votação nominal). */
export function ultimoEleito(ano: number, cargo: Cargo): Candidato | undefined {
  const eleitos = doCargoAno(ano, cargo).filter((c) => c.s === 'eleito' && c.v > 0);
  return eleitos.sort((a, b) => a.v - b.v)[0];
}

export function medianaCpv(list: Candidato[], metrica: Metrica = state.metrica, corrigido = state.corrigido) {
  const vals = list.filter((c) => naMedia(c, metrica)).map((c) => cpv(c, metrica, corrigido));
  return { mediana: median(vals), n: vals.length };
}
