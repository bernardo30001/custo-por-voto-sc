// Tipos e acesso aos dados gerados pelo pipeline (/pipeline/build.py).

export type Situacao = 'eleito' | 'suplente' | 'nao_eleito' | 'outro';
export type Cargo = 6 | 7;
export type Metrica = 'despesas' | 'receitas' | 'receitas_fin';

export interface Origens {
  fp: number; // Fundo Partidário
  fefc: number; // Fundo Especial de Financiamento de Campanha (2018+)
  pf: number; // pessoas físicas
  pj: number; // pessoas jurídicas (só 2014)
  rp: number; // recursos próprios
  part: number; // partido (outros recursos, sem FP/FEFC)
  cand: number; // outros candidatos
  fc: number; // financiamento coletivo
  out: number; // outros / não identificados / rendimentos
}

export interface Candidato {
  a: number; // ano
  c: Cargo;
  id: string; // SQ_CANDIDATO
  n: string; // nome completo
  u: string; // nome de urna
  num: string; // número
  p: string; // sigla do partido
  s: Situacao;
  sd: string; // DS_SIT_TOT_TURNO original
  v: number; // votos nominais (válidos)
  g: number; // despesas contratadas, sem transferências a candidatos/partidos
  gt: number; // transferências excluídas
  rt: number; // receita total
  rf: number; // receita financeira
  re: number; // receita estimável
  o: Origens;
  f: string[]; // flags
}

export interface Meta {
  gerado_em: string;
  anos: number[];
  ipca: { serie: number; ate: string; base: string; fatores: Record<string, number> };
  fontes: { nome: string; url: string; baixado_em: string }[];
  limites_2026: { cargo: Cargo; valor: number; fonte: string; url: string }[];
  validacao: {
    ano: number;
    cargo: Cargo;
    candidatos: number;
    sem_contas: number;
    sem_votos: number;
    votos_anulados: number;
    na_media: number;
    eleitos: number;
  }[];
}

export interface Dataset {
  meta: Meta;
  candidatos: Candidato[];
}

export const CARGO_NOME: Record<Cargo, string> = { 6: 'Deputado Federal', 7: 'Deputado Estadual' };
export const SITUACAO_NOME: Record<Situacao, string> = {
  eleito: 'Eleito',
  suplente: 'Suplente',
  nao_eleito: 'Não eleito',
  outro: 'Outra / indeferido',
};
export const FLAG_NOME: Record<string, string> = {
  sem_contas: 'sem prestação de contas',
  sem_votos: '0 votos',
  votos_anulados: 'votos anulados',
  sem_valor: 'sem valor na métrica',
};
export const ORIGEM_NOME: Record<keyof Origens, string> = {
  fefc: 'FEFC (Fundo Eleitoral)',
  fp: 'Fundo Partidário',
  pf: 'Pessoas físicas',
  pj: 'Pessoas jurídicas',
  rp: 'Recursos próprios',
  part: 'Partido (outros recursos)',
  cand: 'Outros candidatos',
  fc: 'Financiamento coletivo',
  out: 'Outros',
};

export const METRICA_NOME: Record<Metrica, string> = {
  despesas: 'Despesas contratadas',
  receitas: 'Receitas totais',
  receitas_fin: 'Receitas financeiras',
};

export async function loadDataset(): Promise<Dataset> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/candidatos.json`);
  if (!res.ok) throw new Error(`Falha ao carregar dados (${res.status})`);
  return res.json();
}
