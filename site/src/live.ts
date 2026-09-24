// Dados ao vivo da campanha de 2026, publicados pelo painel "Ranking de Doações · SC 2026"
// (bernardo30001/ranking-doacoes-novo-sc), que coleta o DivulgaCandContas de hora em hora.

export const LIVE_SITE = 'https://bernardo30001.github.io/ranking-doacoes-novo-sc/';
// Em desenvolvimento dá para apontar para outra cópia: ?live=http://localhost:8000/
const LIVE_BASE = new URLSearchParams(location.search).get('live') || LIVE_SITE;
const POLL_MS = 60_000;

export interface Candidato2026 {
  id: string;
  nome: string;
  nomeCompleto: string;
  numero: number;
  cargo: 6 | 7;
  partido: string;
  situacao: string;
  totalizacao: string;
  urlTse: string;
  temContas: boolean;
  contasAtualizadas?: string;
  total: number;
  devolvido?: number;
  liquido?: number;
  financeiro: number;
  estimado: number;
  limiteGasto?: number;
  origem: { fundoEspecial: number; fundoPartidario: number; outros: number; roni: number; estimavel: number };
  despesas: { contratadas: number; pagas: number };
  qtdDoacoes?: number;
}

export interface Dados2026 {
  atualizadoEm: string;
  eleicao: { id: string; ano: number; uf: string };
  candidatos: Candidato2026[];
  ultimaTentativa?: { em?: string; ok?: boolean; mensagem?: string } | null;
}

export interface Historico2026Item {
  data: string; // AAAA-MM-DD
  hora: string; // HH:MM
  total: number;
  porCandidato: Record<string, number>;
}

export interface LiveState {
  dados: Dados2026 | null;
  historico: Historico2026Item[];
  erro: string | null;
  verificadoEm: Date | null; // última vez que a página consultou
  novidadeEm: Date | null; // última vez que chegou uma coleta nova
}

export const live: LiveState = { dados: null, historico: [], erro: null, verificadoEm: null, novidadeEm: null };

const listeners = new Set<() => void>();
export function onLive(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${LIVE_BASE}${path}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  return r.json() as Promise<T>;
}

let carregando = false;
export async function carregarLive(): Promise<void> {
  if (carregando) return;
  carregando = true;
  try {
    const dados = await getJson<Dados2026>('dados.json');
    if (!Array.isArray(dados.candidatos) || dados.candidatos.length === 0) throw new Error('coleta sem candidatos');
    const mudou = dados.atualizadoEm !== live.dados?.atualizadoEm;
    if (mudou) {
      live.historico = await getJson<Historico2026Item[]>('historico.json').catch(() => live.historico);
      live.dados = dados;
      live.novidadeEm = new Date();
    }
    live.erro = null;
    live.verificadoEm = new Date();
    emit();
  } catch (err) {
    live.erro = String(err instanceof Error ? err.message : err);
    live.verificadoEm = new Date();
    emit();
  } finally {
    carregando = false;
  }
}

let timer: number | undefined;
/** Começa a consultar novas coletas a cada minuto enquanto a aba do navegador estiver visível. */
export function iniciarLive() {
  if (timer !== undefined) return;
  carregarLive();
  timer = window.setInterval(() => {
    if (!document.hidden) carregarLive();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) carregarLive();
  });
}

/** Candidatura que ainda disputa a eleição (exclui renúncia, indeferimento definitivo e pedido não conhecido). */
export function ativa(c: Candidato2026): boolean {
  const s = c.situacao.toLowerCase();
  return !(s.startsWith('renúncia') || s === 'indeferido' || s.startsWith('pedido não conhecido') || s.startsWith('cancelado') || s.startsWith('falecido'));
}

/** Valor líquido recebido (total menos devoluções). */
export function liquido(c: Candidato2026): number {
  return c.liquido ?? c.total - (c.devolvido ?? 0);
}

/** Variação desde a última coleta registrada antes de hoje (em valores brutos, como o histórico). */
export function variacao(c: Candidato2026): { delta: number; desde: string } | null {
  const h = live.historico;
  if (!h.length || !live.dados) return null;
  const hoje = live.dados.atualizadoEm.slice(0, 10);
  const anteriores = h.filter((x) => x.data < hoje);
  const ref = anteriores[anteriores.length - 1];
  if (!ref || !(c.id in ref.porCandidato)) return null;
  const [, m, d] = ref.data.split('-');
  return { delta: c.total - ref.porCandidato[c.id], desde: `${d}/${m} ${ref.hora}` };
}
