import { CARGO_NOME, METRICA_NOME, type Cargo, type Metrica } from '../data';
import { dataset, state } from '../state';
import { criarIndice, referencia, type Indice, type Referencia } from '../estimativa';
import { ativa, carregarLive, iniciarLive, live, liquido, LIVE_SITE, onLive, variacao, type Candidato2026 } from '../live';
import { css, renderChart } from '../charts';
import { esc, fmtBRL, fmtBRL0, fmtBRLShort, fmtInt, fmtPct, norm } from '../format';

type Ordem = 'valor' | 'variacao' | 'nome' | 'fundos';

const ui = {
  cargo: 7 as Cargo,
  ref: '2022' as string,
  partido: '',
  busca: '',
  soAtivas: true,
  ordem: 'valor' as Ordem,
  mostrados: 50,
};

const METRICA_2026: Record<Metrica, string> = {
  despesas: 'Despesas contratadas até agora',
  receitas: 'Arrecadação líquida até agora',
  receitas_fin: 'Receitas financeiras até agora',
};

function valor2026(c: Candidato2026, m: Metrica = state.metrica): number {
  if (m === 'despesas') return c.despesas?.contratadas ?? 0;
  if (m === 'receitas') return liquido(c);
  return Math.max(0, c.financeiro - (c.devolvido ?? 0));
}

const fundos = (c: Candidato2026) => (c.origem?.fundoEspecial ?? 0) + (c.origem?.fundoPartidario ?? 0);

let root: HTMLElement | null = null;
let unsub: (() => void) | null = null;
let relogio: number | undefined;

export function renderAoVivo(el: HTMLElement, fresh: boolean) {
  root = el;
  iniciarLive();
  if (!unsub) unsub = onLive(() => root?.querySelector('#aovivo') && atualizar());
  if (relogio === undefined) relogio = window.setInterval(() => root?.querySelector('#aovivo') && renderStatus(), 15_000);
  if (fresh || !el.querySelector('#aovivo')) {
    ui.mostrados = 50;
    el.innerHTML = layout();
    bind(el);
  }
  atualizar();
}

function layout() {
  const anos = dataset().meta.anos;
  const refs = [
    ...anos.map((a) => `<option value="${a}" ${ui.ref === String(a) ? 'selected' : ''}>${a}</option>`),
    `<option value="todos" ${ui.ref === 'todos' ? 'selected' : ''}>${anos.join(', ')} combinados</option>`,
  ].join('');
  return `
  <div id="aovivo">
    <header class="page-head">
      <h1>Campanha 2026 ao vivo</h1>
      <p class="lede">Quanto cada candidatura de Santa Catarina já declarou ao TSE em 2026 e quantos votos esse valor costumou render nas eleições anteriores, pelo custo histórico do voto.</p>
    </header>

    <div class="live-status" id="live-status" role="status" aria-live="polite"></div>

    <div class="callout callout-warn" role="note">
      <strong>A campanha está em andamento.</strong> Os valores de 2026 são parciais e crescem a cada prestação de contas; os de 2014, 2018 e 2022 são os totais finais. Comparar um valor parcial com gastos finais tende a subestimar o que a campanha ainda vai movimentar. A referência histórica mostra o que aconteceu com quem gastou parecido, sem prever o resultado: mandato, base eleitoral, notoriedade e a votação do partido pesam tanto quanto o dinheiro.
    </div>

    <div class="filters" role="search" aria-label="Filtros da campanha 2026">
      <label class="ctl"><span class="ctl-label">Cargo</span>
        <select id="v-cargo">
          <option value="6" ${ui.cargo === 6 ? 'selected' : ''}>Deputado Federal</option>
          <option value="7" ${ui.cargo === 7 ? 'selected' : ''}>Deputado Estadual</option>
        </select></label>
      <label class="ctl"><span class="ctl-label">Comparar com</span><select id="v-ref">${refs}</select></label>
      <label class="ctl"><span class="ctl-label">Partido</span><select id="v-partido"></select></label>
      <label class="ctl ctl-grow"><span class="ctl-label">Buscar candidato</span>
        <input type="search" id="v-busca" placeholder="Nome ou número" value="${esc(ui.busca)}" autocomplete="off" /></label>
      <label class="ctl ctl-check"><input type="checkbox" id="v-ativas" ${ui.soAtivas ? 'checked' : ''} /> <span>Só candidaturas ativas</span></label>
    </div>

    <section class="cards" id="v-cards" aria-label="Indicadores de 2026"></section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Arrecadação acumulada</h2></div>
        <p class="panel-sub" id="v-hist-sub"></p>
        <div class="chart-box chart-bars"><canvas id="v-hist" role="img" aria-label="Arrecadação acumulada ao longo das coletas de 2026"></canvas></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Onde estão as campanhas</h2></div>
        <p class="panel-sub" id="v-dist-sub"></p>
        <div class="legend" id="v-dist-legend"></div>
        <div class="chart-box chart-bars"><canvas id="v-dist" role="img" aria-label="Distribuição do valor atual das campanhas de 2026 comparada ao gasto final dos eleitos"></canvas></div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>Candidaturas</h2>
        <label class="ctl ctl-inline"><span class="ctl-label">Ordenar por</span>
          <select id="v-ordem">
            <option value="valor">Valor atual</option>
            <option value="variacao">Variação recente</option>
            <option value="fundos">Fundos públicos</option>
            <option value="nome">Nome</option>
          </select></label>
        <p class="panel-sub" id="v-table-sub"></p>
      </div>
      <div class="table-wrap"><table class="data-table" id="v-tabela"></table></div>
      <div class="table-foot" id="v-foot"></div>
    </section>

    <p class="note">Fonte de 2026: <a href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noopener" target="_blank">DivulgaCandContas (TSE)</a>, coletado de hora em hora pelo <a href="${LIVE_SITE}" rel="noopener" target="_blank">Ranking de Doações · SC 2026</a>. Os valores são os declarados pelas campanhas e podem ser retificados.</p>
  </div>`;
}

function bind(el: HTMLElement) {
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  $<HTMLSelectElement>('#v-ordem').value = ui.ordem;
  $('#v-cargo').addEventListener('change', (e) => {
    ui.cargo = Number((e.target as HTMLSelectElement).value) as Cargo;
    ui.mostrados = 50;
    atualizar();
  });
  $('#v-ref').addEventListener('change', (e) => {
    ui.ref = (e.target as HTMLSelectElement).value;
    atualizar();
  });
  $('#v-partido').addEventListener('change', (e) => {
    ui.partido = (e.target as HTMLSelectElement).value;
    ui.mostrados = 50;
    atualizar();
  });
  $('#v-ativas').addEventListener('change', (e) => {
    ui.soAtivas = (e.target as HTMLInputElement).checked;
    atualizar();
  });
  $('#v-ordem').addEventListener('change', (e) => {
    ui.ordem = (e.target as HTMLSelectElement).value as Ordem;
    renderTabela();
  });
  let t: number | undefined;
  $('#v-busca').addEventListener('input', (e) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      ui.busca = (e.target as HTMLInputElement).value;
      ui.mostrados = 50;
      renderTabela();
    }, 150);
  });
}

function anosRef(): number[] {
  return ui.ref === 'todos' ? dataset().meta.anos : [Number(ui.ref)];
}

let indiceCache: { chave: string; idx: Indice } | null = null;
function indice(): Indice {
  const chave = [ui.cargo, ui.ref, state.metrica, state.p].join('|');
  if (indiceCache?.chave !== chave) indiceCache = { chave, idx: criarIndice(ui.cargo, anosRef(), state.metrica, state.p) };
  return indiceCache.idx;
}

function doCargo(): Candidato2026[] {
  return (live.dados?.candidatos ?? []).filter((c) => c.cargo === ui.cargo && (!ui.soAtivas || ativa(c)));
}
function comPartido(): Candidato2026[] {
  return doCargo().filter((c) => !ui.partido || c.partido === ui.partido);
}

function atualizar() {
  if (!root) return;
  renderStatus();
  if (!live.dados) {
    root.querySelector('#v-cards')!.innerHTML = live.erro
      ? `<p class="error">Não foi possível carregar os dados de 2026 (${esc(live.erro)}). Nova tentativa em 1 minuto.</p>`
      : '<p class="loading">Carregando dados de 2026…</p>';
    return;
  }
  const sel = root.querySelector<HTMLSelectElement>('#v-partido')!;
  const partidos = [...new Set(doCargo().map((c) => c.partido))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (ui.partido && !partidos.includes(ui.partido)) ui.partido = '';
  sel.innerHTML =
    '<option value="">Todos</option>' +
    partidos.map((p) => `<option value="${esc(p)}" ${p === ui.partido ? 'selected' : ''}>${esc(p)}</option>`).join('');
  renderCards();
  renderHist();
  renderDist();
  renderTabela();
}

function tempoRelativo(d: Date) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'agora há pouco';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h} h ${m % 60} min`;
}

function renderStatus() {
  const el = root?.querySelector('#live-status');
  if (!el) return;
  if (!live.dados) {
    el.innerHTML = `<span class="dot dot-wait" aria-hidden="true"></span> ${live.erro ? 'Sem conexão com a fonte de 2026' : 'Conectando…'}`;
    return;
  }
  const coleta = new Date(live.dados.atualizadoEm);
  const quando = coleta.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const velho = Date.now() - coleta.getTime() > 6 * 3600_000;
  el.innerHTML = `<span class="dot ${velho ? 'dot-wait' : ''}" aria-hidden="true"></span>
    <span><strong>Ao vivo.</strong> Coleta do TSE de ${quando} (${tempoRelativo(coleta)}). A fonte agenda uma coleta por hora (o GitHub pode atrasar esse agendamento); esta página confere a cada minuto${
      live.verificadoEm ? `, última conferência ${tempoRelativo(live.verificadoEm)}` : ''
    }.${live.erro ? ` <span class="warn-text">Falha na última conferência: ${esc(live.erro)}.</span>` : ''}${
      velho ? ' <span class="warn-text">A última coleta tem mais de 6 horas.</span>' : ''
    }</span>
    <button type="button" class="btn btn-sm" id="v-recarregar">Conferir agora</button>`;
  el.querySelector('#v-recarregar')?.addEventListener('click', () => carregarLive());
}

function somaVariacao(list: Candidato2026[]) {
  let delta = 0;
  let desde = '';
  let n = 0;
  for (const c of list) {
    const v = variacao(c);
    if (v) {
      delta += v.delta;
      desde = v.desde;
      n++;
    }
  }
  return n ? { delta, desde } : null;
}

function renderCards() {
  const list = comPartido();
  const idx = indice();
  const m = state.metrica;
  const tot = list.reduce((s, c) => s + liquido(c), 0);
  const desp = list.reduce((s, c) => s + (c.despesas?.contratadas ?? 0), 0);
  const fund = list.reduce((s, c) => s + fundos(c), 0);
  const varr = somaVariacao(list);
  const ref = idx.gastoEleitos.mediana;
  const acima = list.filter((c) => valor2026(c, m) >= ref).length;
  const comValor = list.filter((c) => valor2026(c, m) > 0).length;
  const refNome = ui.ref === 'todos' ? dataset().meta.anos.join(', ') : ui.ref;
  const filtroP = ui.partido ? ` · ${esc(ui.partido)}` : '';
  root!.querySelector('#v-cards')!.innerHTML = `
    <article class="card">
      <h3>Arrecadação líquida 2026${filtroP}</h3>
      <p class="big">${fmtBRL0(tot)}</p>
      ${varr ? `<p class="delta ${varr.delta >= 0 ? 'up' : 'down'}">${varr.delta >= 0 ? '+' : '−'}${fmtBRL0(Math.abs(varr.delta))} desde ${esc(varr.desde)}</p>` : ''}
      <p class="card-foot">${fmtInt(comValor)} de ${fmtInt(list.length)} candidaturas com valor declarado · ${fmtPct(tot ? fund / tot : NaN)} de fundos públicos</p>
    </article>
    <article class="card">
      <h3>Despesas contratadas 2026${filtroP}</h3>
      <p class="big">${fmtBRL0(desp)}</p>
      <p class="card-foot">${fmtPct(tot ? desp / tot : NaN)} do que foi arrecadado</p>
    </article>
    <article class="card">
      <h3>Gasto mediano dos eleitos (${esc(refNome)})</h3>
      <p class="big">${fmtBRL0(ref)}</p>
      <p class="card-foot">${METRICA_NOME[m].toLowerCase()}, corrigido pelo IPCA${state.p > 0 ? `, com cenário de +${fmtPct(state.p)}` : ''} · metade dos eleitos entre ${fmtBRL0(idx.gastoEleitos.p25)} e ${fmtBRL0(idx.gastoEleitos.p75)}</p>
    </article>
    <article class="card">
      <h3>Já passaram dessa referência</h3>
      <p class="big">${fmtInt(acima)} <span class="big-sub">de ${fmtInt(list.length)}</span></p>
      <p class="card-foot">candidaturas a ${CARGO_NOME[ui.cargo].toLowerCase()}${filtroP} com ${METRICA_2026[m].toLowerCase()} acima do gasto mediano dos eleitos</p>
    </article>
    <article class="card">
      <h3>Votação do último eleito</h3>
      <p class="big">${idx.ultimo.map((u) => fmtInt(u.votos)).join(' · ')}</p>
      <p class="card-foot">${idx.ultimo.map((u) => `${u.ano}: ${esc(u.nome)}`).join(' · ')}</p>
    </article>`;
}

function renderHist() {
  const ids = new Set(comPartido().map((c) => c.id));
  const pontos = live.historico
    .map((h) => ({ rot: `${h.data.slice(8, 10)}/${h.data.slice(5, 7)} ${h.hora}`, v: Object.entries(h.porCandidato).reduce((s, [id, v]) => s + (ids.has(id) ? v : 0), 0) }))
    .filter((p) => p.v > 0);
  root!.querySelector('#v-hist-sub')!.textContent = pontos.length
    ? `Soma do valor bruto recebido pelas candidaturas a ${CARGO_NOME[ui.cargo].toLowerCase()}${ui.partido ? ` do ${ui.partido}` : ''}, em cada coleta registrada (${pontos.length} pontos).`
    : 'O histórico de coletas ainda não está disponível.';
  renderChart('v-hist', root!.querySelector<HTMLCanvasElement>('#v-hist')!, {
    type: 'line',
    data: {
      labels: pontos.map((p) => p.rot),
      datasets: [
        {
          label: 'Arrecadação acumulada',
          data: pontos.map((p) => p.v),
          borderColor: css('--series-1'),
          backgroundColor: css('--band'),
          fill: 'origin',
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 10,
          tension: 0.15,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, ticks: { color: css('--muted'), callback: (v) => fmtBRLShort(Number(v)) }, grid: { color: css('--grid') }, border: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => fmtBRL(Number(i.raw)) } } },
    },
  });
}

const FAIXAS = [0, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, Infinity];
const faixaNome = (i: number) =>
  FAIXAS[i + 1] === Infinity ? `${fmtBRLShort(FAIXAS[i])}+` : i === 0 ? `até ${fmtBRLShort(FAIXAS[1])}` : `${fmtBRLShort(FAIXAS[i])}–${fmtBRLShort(FAIXAS[i + 1])}`;

function renderDist() {
  const list = comPartido();
  const idx = indice();
  const m = state.metrica;
  const cont = (vals: number[]) => {
    const n = FAIXAS.slice(0, -1).map(() => 0);
    for (const v of vals) {
      const i = FAIXAS.findIndex((f, k) => v >= f && v < FAIXAS[k + 1]);
      if (i >= 0) n[i]++;
    }
    return n.map((x) => (vals.length ? x / vals.length : 0));
  };
  const atual = cont(list.map((c) => valor2026(c, m)));
  const eleitos = cont(idx.pontos.filter((p) => p.eleito).map((p) => p.x));
  const refNome = ui.ref === 'todos' ? dataset().meta.anos.join(', ') : ui.ref;
  root!.querySelector('#v-dist-sub')!.textContent = `% das candidaturas em cada faixa de valor: 2026 até agora (${METRICA_2026[m].toLowerCase()}) × gasto final dos eleitos em ${refNome}, corrigido pelo IPCA.`;
  const cores = [css('--series-1'), css('--series-2')];
  const nomes = ['2026 até agora', `Eleitos em ${refNome} (final)`];
  root!.querySelector('#v-dist-legend')!.innerHTML = nomes.map((n, i) => `<span class="key"><i style="background:${cores[i]}"></i>${esc(n)}</span>`).join('');
  renderChart('v-dist', root!.querySelector<HTMLCanvasElement>('#v-dist')!, {
    type: 'bar',
    data: {
      labels: FAIXAS.slice(0, -1).map((_, i) => faixaNome(i)),
      datasets: [atual, eleitos].map((d, i) => ({ label: nomes[i], data: d, backgroundColor: cores[i], borderRadius: 3, maxBarThickness: 22 })),
    },
    options: {
      maintainAspectRatio: false,
      datasets: { bar: { categoryPercentage: 0.75, barPercentage: 0.9 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--muted'), maxRotation: 45, autoSkip: false, font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { color: css('--muted'), callback: (v) => fmtPct(Number(v)) }, grid: { color: css('--grid') }, border: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtPct(Number(i.raw))}` } } },
    },
  });
}

function faixaVotos(r: Referencia | null, v: number, idx: Indice) {
  const max = idx.pontos.length ? idx.pontos[idx.pontos.length - 1].x : 0;
  if (!r && v > max) return '<span class="muted small">acima de todos os gastos da referência</span>';
  if (!r) return v > 0 ? '<span class="muted small">sem casos parecidos</span>' : '<span class="muted">—</span>';
  return `${fmtInt(r.p25)} a ${fmtInt(r.p75)}<br><span class="muted small">mediana ${fmtInt(r.mediana)} · ${r.n} parecidos${r.janela > 0.2 ? ` (±${fmtPct(r.janela)})` : ''}</span>`;
}

function renderTabela() {
  if (!root || !live.dados) return;
  const idx = indice();
  const m = state.metrica;
  const q = norm(ui.busca.trim());
  const list = comPartido().filter((c) => !q || norm(c.nome).includes(q) || norm(c.nomeCompleto ?? '').includes(q) || String(c.numero) === q);
  const vari = new Map(list.map((c) => [c.id, variacao(c)]));
  list.sort((a, b) => {
    switch (ui.ordem) {
      case 'nome':
        return a.nome.localeCompare(b.nome, 'pt-BR');
      case 'variacao':
        return (vari.get(b.id)?.delta ?? -Infinity) - (vari.get(a.id)?.delta ?? -Infinity);
      case 'fundos':
        return fundos(b) - fundos(a);
      default:
        return valor2026(b, m) - valor2026(a, m);
    }
  });
  const ultimoMin = Math.min(...idx.ultimo.map((u) => u.votos));
  const rows = list
    .slice(0, ui.mostrados)
    .map((c) => {
      const v = valor2026(c, m);
      const r = referencia(idx, v);
      const va = vari.get(c.id);
      const fu = fundos(c);
      const liq = liquido(c);
      const sit = c.situacao !== 'Deferido' ? `<span class="badge">${esc(c.situacao)}</span>` : '';
      const deltaTxt = va
        ? va.delta === 0
          ? `<span class="muted small" title="desde ${esc(va.desde)}">sem variação</span>`
          : `<span class="delta small ${va.delta > 0 ? 'up' : 'down'}" title="Variação da receita bruta desde a coleta de ${esc(va.desde)}">${va.delta > 0 ? '+' : '−'}${fmtBRL0(Math.abs(va.delta))} desde ${esc(va.desde.slice(0, 5))}</span>`
        : '';
      const rel = r ? r.mediana / ultimoMin : NaN;
      return `<tr>
        <td class="cand"><a href="${esc(c.urlTse)}" rel="noopener" target="_blank"><strong>${esc(c.nome)}</strong></a><span class="muted small">${esc(c.partido)} · nº ${c.numero}</span>${sit}</td>
        <td class="num">${v > 0 ? fmtBRL0(v) : '<span class="muted">nada declarado</span>'}<br>${deltaTxt}</td>
        <td class="num">${liq > 0 ? fmtPct(fu / liq) : '—'}<br><span class="muted small">${fu > 0 ? fmtBRL0(fu) : ''}</span></td>
        <td class="num">${faixaVotos(r, v, idx)}</td>
        <td class="num">${r ? `${r.eleitos} de ${r.n}<br><span class="muted small">${fmtPct(r.eleitos / r.n)}</span>` : '—'}</td>
        <td class="num">${Number.isFinite(rel) ? fmtPct(rel) : '—'}</td>
      </tr>`;
    })
    .join('');
  const table = root.querySelector<HTMLTableElement>('#v-tabela')!;
  table.innerHTML = `<caption class="sr-only">Candidaturas de 2026 e referência histórica</caption>
    <thead><tr>
      <th scope="col">Candidatura</th>
      <th scope="col" class="num">${esc(METRICA_2026[m])}</th>
      <th scope="col" class="num">Fundos públicos</th>
      <th scope="col" class="num">Votos que esse valor rendeu<br><span class="muted small">p25 a p75 de quem gastou parecido</span></th>
      <th scope="col" class="num">Eleitos entre<br>os parecidos</th>
      <th scope="col" class="num">Mediana ÷ último<br>eleito</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty">Nenhuma candidatura com esses filtros.</td></tr>'}</tbody>`;
  const refNome = ui.ref === 'todos' ? dataset().meta.anos.join(', ') : ui.ref;
  root.querySelector('#v-table-sub')!.textContent = `${fmtInt(list.length)} candidatura(s) a ${CARGO_NOME[ui.cargo].toLowerCase()}. Referência: candidatos de ${refNome} com ${METRICA_NOME[m].toLowerCase()} entre −20% e +20% do valor atual (corrigido pelo IPCA${
    state.p > 0 ? `, com cenário hipotético de +${fmtPct(state.p)} aplicado a todos` : ''
  }). "Mediana ÷ último eleito" compara a mediana de votos dos parecidos com a menor votação entre os eleitos (${fmtInt(ultimoMin)} votos).`;
  const foot = root.querySelector('#v-foot')!;
  foot.innerHTML = list.length > ui.mostrados ? `<button type="button" class="btn" id="v-mais">Mostrar mais (${fmtInt(list.length - ui.mostrados)} restantes)</button>` : '';
  foot.querySelector('#v-mais')?.addEventListener('click', () => {
    ui.mostrados += 50;
    renderTabela();
  });
}
