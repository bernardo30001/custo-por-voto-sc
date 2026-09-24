import { CARGO_NOME, FLAG_NOME, METRICA_NOME, ORIGEM_NOME, SITUACAO_NOME, type Candidato, type Cargo, type Origens, type Situacao } from '../data';
import { cpv, cpvAjustado, dataset, fator, flags, medianaCpv, naMedia, state, ultimoEleito, update, valor, type SortKey } from '../state';
import { css, renderChart } from '../charts';
import { esc, fmtBRL, fmtBRLShort, fmtInt, fmtIntShort, fmtPct, fmtVotos, norm } from '../format';

const PAGE = 50;
let shown = PAGE;
let compOnlyEleitos = false;

const SIT_COLOR: Record<Situacao, string> = {
  eleito: '--series-1',
  suplente: '--series-2',
  nao_eleito: '--series-3',
  outro: '--muted',
};

export function renderPainel(root: HTMLElement, fresh: boolean) {
  if (fresh || !root.querySelector('#painel')) {
    shown = PAGE;
    root.innerHTML = layout();
    bindFilters(root);
  }
  refreshPartidos(root);
  updateAll(root);
}

function layout() {
  const ds = dataset();
  const anos = ds.meta.anos.map((a) => `<option value="${a}" ${a === state.ano ? 'selected' : ''}>${a}</option>`).join('');
  const sits = (Object.keys(SITUACAO_NOME) as Situacao[])
    .map((s) => `<option value="${s}" ${state.situacao === s ? 'selected' : ''}>${SITUACAO_NOME[s]}</option>`)
    .join('');
  return `
  <div id="painel">
    <header class="page-head">
      <h1>Quanto custou cada voto?</h1>
      <p class="lede">Gasto declarado ao TSE dividido pelos votos nominais de cada candidato a deputado em Santa Catarina. Use os filtros para explorar por ano, cargo, partido e situação.</p>
    </header>

    <div class="filters" role="search" aria-label="Filtros do painel">
      <label class="ctl"><span class="ctl-label">Ano</span><select id="f-ano">${anos}</select></label>
      <label class="ctl"><span class="ctl-label">Cargo</span>
        <select id="f-cargo">
          <option value="6" ${state.cargo === 6 ? 'selected' : ''}>Deputado Federal</option>
          <option value="7" ${state.cargo === 7 ? 'selected' : ''}>Deputado Estadual</option>
        </select></label>
      <label class="ctl"><span class="ctl-label">Partido</span><select id="f-partido"></select></label>
      <label class="ctl"><span class="ctl-label">Situação</span>
        <select id="f-sit"><option value="">Todas</option>${sits}</select></label>
      <label class="ctl ctl-grow"><span class="ctl-label">Buscar candidato</span>
        <input type="search" id="f-busca" placeholder="Nome ou nome de urna" value="${esc(state.busca)}" autocomplete="off" /></label>
    </div>

    <section class="cards" id="cards" aria-label="Indicadores"></section>

    <section class="panel">
      <div class="panel-head">
        <h2>Gasto × votos</h2>
        <p class="panel-sub" id="scatter-sub"></p>
      </div>
      <div class="legend" id="scatter-legend"></div>
      <div class="chart-box chart-scatter"><canvas id="scatter" role="img" aria-label="Gráfico de dispersão de gasto declarado por votos, em escala logarítmica"></canvas></div>
      <p class="note" id="scatter-note"></p>
    </section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h2>CPV mediano por eleição</h2>
          <div class="seg seg-sm" role="group" aria-label="Universo">
            <button type="button" data-comp="0" aria-pressed="${!compOnlyEleitos}">Todos</button>
            <button type="button" data-comp="1" aria-pressed="${compOnlyEleitos}">Só eleitos</button>
          </div>
        </div>
        <p class="panel-sub">Mediana do custo por voto, sempre corrigida pelo IPCA para comparar os anos.</p>
        <div class="chart-box chart-bars"><canvas id="anos" role="img" aria-label="Barras com o custo por voto mediano por ano e cargo"></canvas></div>
        <div class="table-mini" id="anos-table"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>De onde veio o dinheiro</h2></div>
        <p class="panel-sub" id="comp-sub"></p>
        <div class="legend" id="comp-legend"></div>
        <div class="chart-box chart-bars"><canvas id="comp" role="img" aria-label="Composição das receitas por origem em cada eleição"></canvas></div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>Candidatos</h2>
        <p class="panel-sub" id="table-sub"></p>
      </div>
      <div class="table-wrap"><table class="data-table" id="tabela"></table></div>
      <div class="table-foot" id="table-foot"></div>
    </section>
  </div>`;
}

function bindFilters(root: HTMLElement) {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  $('#f-ano').addEventListener('change', (e) => {
    shown = PAGE;
    update({ ano: Number((e.target as HTMLSelectElement).value) });
  });
  $('#f-cargo').addEventListener('change', (e) => {
    shown = PAGE;
    update({ cargo: Number((e.target as HTMLSelectElement).value) as Cargo });
  });
  $('#f-partido').addEventListener('change', (e) => {
    shown = PAGE;
    update({ partido: (e.target as HTMLSelectElement).value });
  });
  $('#f-sit').addEventListener('change', (e) => {
    shown = PAGE;
    update({ situacao: (e.target as HTMLSelectElement).value as Situacao | '' });
  });
  let t: number | undefined;
  $('#f-busca').addEventListener('input', (e) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      shown = PAGE;
      update({ busca: (e.target as HTMLInputElement).value });
    }, 150);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach((b) =>
    b.addEventListener('click', () => {
      compOnlyEleitos = b.dataset.comp === '1';
      root.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderAnos(root);
    }),
  );
}

function refreshPartidos(root: HTMLElement) {
  const sel = root.querySelector<HTMLSelectElement>('#f-partido')!;
  const partidos = [...new Set(base().map((c) => c.p))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (state.partido && !partidos.includes(state.partido)) state.partido = '';
  sel.innerHTML =
    `<option value="">Todos</option>` +
    partidos.map((p) => `<option value="${esc(p)}" ${p === state.partido ? 'selected' : ''}>${esc(p)}</option>`).join('');
}

/** Candidatos do ano e cargo selecionados. */
function base(): Candidato[] {
  return dataset().candidatos.filter((c) => c.a === state.ano && c.c === state.cargo);
}
function comPartido(): Candidato[] {
  return base().filter((c) => !state.partido || c.p === state.partido);
}
function filtrados(): Candidato[] {
  const q = norm(state.busca.trim());
  return comPartido().filter(
    (c) => (!state.situacao || c.s === state.situacao) && (!q || norm(c.u).includes(q) || norm(c.n).includes(q) || c.num === q),
  );
}

function updateAll(root: HTMLElement) {
  renderCards(root);
  renderScatter(root);
  renderAnos(root);
  renderComp(root);
  renderTable(root);
}

function ajusteLinha(v: number) {
  return state.p > 0 && Number.isFinite(v)
    ? `<p class="adj">Ajustado (+${fmtPct(state.p)}): <strong>${fmtBRL(v * (1 + state.p))}</strong></p>`
    : '';
}

function renderCards(root: HTMLElement) {
  const list = comPartido();
  const eleitos = list.filter((c) => c.s === 'eleito');
  const mEleitos = medianaCpv(eleitos);
  const mGeral = medianaCpv(list);
  const eleitosValidos = eleitos.filter((c) => naMedia(c)).sort((a, b) => cpv(a) - cpv(b));
  const menor = eleitosValidos[0];
  const maior = eleitosValidos[eleitosValidos.length - 1];
  const ult = ultimoEleito(state.ano, state.cargo);
  const corr = state.corrigido ? 'corrigido pelo IPCA' : 'valor nominal';
  const filtroP = state.partido ? ` · ${esc(state.partido)}` : '';
  const cand = (c?: Candidato) => (c ? `${esc(c.u)} <span class="muted">(${esc(c.p)})</span>` : '—');

  root.querySelector('#cards')!.innerHTML = `
    <article class="card">
      <h3>CPV mediano dos eleitos${filtroP}</h3>
      <p class="big">${fmtBRL(mEleitos.mediana)}</p>
      ${ajusteLinha(mEleitos.mediana)}
      <p class="card-foot">${mEleitos.n} eleitos na conta · ${corr}</p>
    </article>
    <article class="card">
      <h3>CPV mediano geral${filtroP}</h3>
      <p class="big">${fmtBRL(mGeral.mediana)}</p>
      ${ajusteLinha(mGeral.mediana)}
      <p class="card-foot">${mGeral.n} candidatos na conta · ${corr}</p>
    </article>
    <article class="card">
      <h3>Maior CPV entre eleitos${filtroP}</h3>
      <p class="big">${maior ? fmtBRL(cpv(maior)) : '—'}</p>
      ${maior ? ajusteLinha(cpv(maior)) : ''}
      <p class="card-foot">${cand(maior)}</p>
    </article>
    <article class="card">
      <h3>Menor CPV entre eleitos${filtroP}</h3>
      <p class="big">${menor ? fmtBRL(cpv(menor)) : '—'}</p>
      ${menor ? ajusteLinha(cpv(menor)) : ''}
      <p class="card-foot">${cand(menor)}</p>
    </article>
    <article class="card">
      <h3>Votação do último eleito</h3>
      <p class="big">${ult ? fmtVotos(ult.v) : '—'}</p>
      <p class="card-foot">${cand(ult)} · menor votação entre os eleitos para ${CARGO_NOME[state.cargo]} em ${state.ano}</p>
    </article>`;
}

function logTick(fmt: (v: number) => string) {
  return (value: string | number) => {
    const v = Number(value);
    const m = v / 10 ** Math.floor(Math.log10(v) + 1e-9);
    return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6) ? fmt(v) : '';
  };
}

function renderScatter(root: HTMLElement) {
  const list = filtrados();
  const plot = list.filter((c) => naMedia(c));
  const fora = list.length - plot.length;
  const sits: Situacao[] = ['eleito', 'suplente', 'nao_eleito', 'outro'];
  const surface = css('--surface');
  const datasets = sits
    .map((s) => {
      const pts = plot.filter((c) => c.s === s);
      return {
        label: SITUACAO_NOME[s],
        data: pts.map((c) => ({ x: valor(c), y: c.v, c })),
        backgroundColor: css(SIT_COLOR[s]),
        borderColor: surface,
        borderWidth: 1,
        pointRadius: s === 'eleito' ? 5 : 4,
        pointHoverRadius: 7,
        pointHitRadius: 6,
        order: s === 'eleito' ? 0 : s === 'suplente' ? 1 : 2,
      };
    })
    .filter((d) => d.data.length > 0);

  root.querySelector('#scatter-sub')!.textContent =
    `${METRICA_NOME[state.metrica]} (${state.corrigido ? 'corrigidas pelo IPCA' : 'valores nominais'}) × votos nominais · ${CARGO_NOME[state.cargo]} ${state.ano} · eixos em escala logarítmica`;
  root.querySelector('#scatter-legend')!.innerHTML = datasets
    .map((d) => `<span class="key"><i style="background:${d.backgroundColor}"></i>${esc(d.label)} <span class="muted">(${d.data.length})</span></span>`)
    .join('');
  root.querySelector('#scatter-note')!.textContent = fora
    ? `${fora} candidato(s) do filtro ficaram fora do gráfico por não terem votos válidos, prestação de contas ou valor positivo na métrica (a escala log não comporta zero). Eles continuam na tabela.`
    : '';

  const canvas = root.querySelector<HTMLCanvasElement>('#scatter')!;
  renderChart('scatter', canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: `${METRICA_NOME[state.metrica]} (R$)`, color: css('--text-2') },
          ticks: { callback: logTick(fmtBRLShort), autoSkip: true, maxRotation: 0, color: css('--muted') },
          grid: { color: css('--grid') },
          border: { color: css('--axis') },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Votos nominais', color: css('--text-2') },
          ticks: { callback: logTick(fmtIntShort), color: css('--muted') },
          grid: { color: css('--grid') },
          border: { color: css('--axis') },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const c = (items[0].raw as { c: Candidato }).c;
              return `${c.u} (${c.p})`;
            },
            label: (item) => {
              const c = (item.raw as { c: Candidato }).c;
              const lines = [`Votos: ${fmtInt(c.v)}`, `Gasto: ${fmtBRL(valor(c))}`, `CPV: ${fmtBRL(cpv(c))}`];
              if (state.p > 0) lines.push(`CPV ajustado: ${fmtBRL(cpvAjustado(c))}`);
              lines.push(SITUACAO_NOME[c.s]);
              return lines;
            },
          },
        },
      },
    },
  });
}

function renderAnos(root: HTMLElement) {
  const ds = dataset();
  const anos = ds.meta.anos;
  const cargos: Cargo[] = [6, 7];
  const med = (a: number, cg: Cargo) => {
    let list = ds.candidatos.filter((c) => c.a === a && c.c === cg);
    if (compOnlyEleitos) list = list.filter((c) => c.s === 'eleito');
    return medianaCpv(list, state.metrica, true);
  };
  const series = cargos.map((cg, i) => ({
    label: CARGO_NOME[cg],
    data: anos.map((a) => med(a, cg).mediana),
    backgroundColor: css(i === 0 ? '--series-1' : '--series-2'),
    borderRadius: 4,
    borderSkipped: 'start' as const,
    maxBarThickness: 36,
  }));
  renderChart('anos', root.querySelector<HTMLCanvasElement>('#anos')!, {
    type: 'bar',
    data: { labels: anos.map(String), datasets: series },
    options: {
      maintainAspectRatio: false,
      datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
      scales: {
        x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--text-2') } },
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => fmtBRL(Number(v)), color: css('--muted') },
          grid: { color: css('--grid') },
          border: { display: false },
        },
      },
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${fmtBRL(Number(i.raw))}` } },
      },
    },
  });
  const rows = anos
    .map((a) => {
      const cells = cargos.map((cg) => {
        const m = med(a, cg);
        return `<td class="num">${fmtBRL(m.mediana)}${
          state.p > 0 ? `<br><span class="adj">${fmtBRL(m.mediana * (1 + state.p))}</span>` : ''
        }<br><span class="muted small">n = ${m.n}</span></td>`;
      });
      return `<tr><th scope="row">${a}</th>${cells.join('')}</tr>`;
    })
    .join('');
  root.querySelector('#anos-table')!.innerHTML = `<table><thead><tr><th>Ano</th><th class="num">Dep. Federal</th><th class="num">Dep. Estadual</th></tr></thead><tbody>${rows}</tbody></table>${
    state.p > 0 ? `<p class="note">Em destaque: CPV ajustado pelo cenário de +${fmtPct(state.p)} de gasto não declarado.</p>` : ''
  }`;
}

const COMP_KEYS: (keyof Origens)[] = ['fefc', 'fp', 'pf', 'pj', 'rp', 'part', 'cand', 'out'];

function renderComp(root: HTMLElement) {
  const ds = dataset();
  const anos = ds.meta.anos;
  const totals = anos.map((a) => {
    const list = ds.candidatos.filter((c) => c.a === a && c.c === state.cargo && (!state.partido || c.p === state.partido));
    const t: Record<string, number> = {};
    for (const k of COMP_KEYS) t[k] = 0;
    for (const c of list) {
      for (const k of COMP_KEYS) t[k] += c.o[k] ?? 0;
      t.out += c.o.fc ?? 0;
    }
    const sum = COMP_KEYS.reduce((s, k) => s + t[k], 0);
    return { t, sum };
  });
  const used = COMP_KEYS.filter((k) => totals.some((x) => x.t[k] > 0));
  const surface = css('--surface');
  const datasets = used.map((k) => ({
    label: ORIGEM_NOME[k] + (k === 'out' ? ' (inclui financ. coletivo)' : ''),
    data: totals.map((x) => (x.sum > 0 ? x.t[k] / x.sum : 0)),
    backgroundColor: css(`--series-${COMP_KEYS.indexOf(k) + 1}`),
    borderColor: surface,
    borderWidth: { top: 0, bottom: 0, left: 0, right: 2 },
    borderSkipped: false as const,
    maxBarThickness: 34,
  }));
  root.querySelector('#comp-sub')!.textContent = `Receitas de candidatos a ${CARGO_NOME[state.cargo].toLowerCase()}${
    state.partido ? ` (${state.partido})` : ''
  } por origem, em % do total de cada eleição. Fundo Partidário e FEFC contam como tal mesmo quando repassados pelo partido.`;
  root.querySelector('#comp-legend')!.innerHTML = datasets
    .map((d) => `<span class="key"><i style="background:${d.backgroundColor}"></i>${esc(d.label)}</span>`)
    .join('');
  renderChart('comp', root.querySelector<HTMLCanvasElement>('#comp')!, {
    type: 'bar',
    data: { labels: anos.map(String), datasets },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          max: 1,
          ticks: { callback: (v) => fmtPct(Number(v)), color: css('--muted') },
          grid: { color: css('--grid') },
          border: { display: false },
        },
        y: { stacked: true, grid: { display: false }, ticks: { color: css('--text-2') }, border: { color: css('--axis') } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (i) => {
              const val = totals[i.dataIndex].t[used[i.datasetIndex]];
              return `${i.dataset.label}: ${fmtPct(Number(i.raw))} (${fmtBRL(val)} nominais)`;
            },
          },
        },
      },
    },
  });
}

const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'u', label: 'Candidato' },
  { key: 'p', label: 'Partido' },
  { key: 'v', label: 'Votos', num: true },
  { key: 'valor', label: 'Gasto', num: true },
  { key: 'cpv', label: 'CPV', num: true },
  { key: 's', label: 'Situação' },
];

function sortValue(c: Candidato, k: SortKey): number | string {
  switch (k) {
    case 'u':
      return norm(c.u);
    case 'p':
      return c.p;
    case 'v':
      return c.v;
    case 'valor':
      return valor(c);
    case 'cpv': {
      const x = cpv(c);
      return Number.isFinite(x) ? x : -1;
    }
    case 's':
      return ['eleito', 'suplente', 'nao_eleito', 'outro'].indexOf(c.s);
  }
}

function renderTable(root: HTMLElement) {
  const list = filtrados();
  const { key, dir } = state.sort;
  list.sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (key === 'cpv') {
      // candidatos sem CPV ficam sempre no fim
      if (x === -1 && y !== -1) return 1;
      if (y === -1 && x !== -1) return -1;
    }
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  const showAdj = state.p > 0;

  const th = (col: (typeof COLS)[number]) => {
    const active = col.key === key;
    const aria = active ? (dir === 1 ? 'ascending' : 'descending') : 'none';
    const arrow = active ? (dir === 1 ? '↑' : '↓') : '';
    return `<th scope="col" class="${col.num ? 'num' : ''}" aria-sort="${aria}"><button type="button" data-sort="${col.key}">${esc(
      col.label,
    )} <span aria-hidden="true">${arrow}</span></button></th>`;
  };
  const head =
    COLS.slice(0, 5).map(th).join('') +
    (showAdj ? `<th scope="col" class="num">CPV ajustado<br><span class="muted small">+${fmtPct(state.p)}</span></th>` : '') +
    th(COLS[5]);

  const rows = list
    .slice(0, shown)
    .map((c) => {
      const fl = flags(c);
      const badges = fl.map((f) => `<span class="badge">${esc(FLAG_NOME[f] ?? f)}</span>`).join('');
      const cp = cpv(c);
      const va = valor(c);
      const f = fator(c.a);
      const extra =
        state.metrica !== 'despesas'
          ? `<span class="muted small">financeiras ${fmtBRL(c.rf * f)} · estimáveis ${fmtBRL(c.re * f)}</span>`
          : c.gt > 0
            ? `<span class="muted small">+ ${fmtBRL(c.gt * f)} repassados a outros candidatos/partidos (excluídos)</span>`
            : '';
      return `<tr>
        <td class="cand"><strong>${esc(c.u)}</strong><span class="muted small">${esc(c.n)} · nº ${esc(c.num)}</span>${badges}</td>
        <td>${esc(c.p)}</td>
        <td class="num">${fmtInt(c.v)}</td>
        <td class="num">${fmtBRL(va)}${extra ? `<br>${extra}` : ''}</td>
        <td class="num">${fmtBRL(cp)}</td>
        ${showAdj ? `<td class="num adj-col">${fmtBRL(cp * (1 + state.p))}</td>` : ''}
        <td><span class="sit sit-${c.s}"><i aria-hidden="true"></i>${SITUACAO_NOME[c.s]}</span>${
          c.s === 'outro' && c.sd ? `<span class="muted small">${esc(c.sd)}</span>` : ''
        }</td>
      </tr>`;
    })
    .join('');

  const ncols = showAdj ? 7 : 6;
  const table = root.querySelector<HTMLTableElement>('#tabela')!;
  table.innerHTML = `<caption class="sr-only">Candidatos filtrados</caption><thead><tr>${head}</tr></thead><tbody>${
    rows || `<tr><td colspan="${ncols}" class="empty">Nenhum candidato com esses filtros.</td></tr>`
  }</tbody>`;
  table.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sort as SortKey;
      const d: 1 | -1 = state.sort.key === k ? ((state.sort.dir * -1) as 1 | -1) : k === 'u' || k === 'p' || k === 's' ? 1 : -1;
      update({ sort: { key: k, dir: d } });
    }),
  );

  root.querySelector('#table-sub')!.textContent = `${fmtInt(list.length)} candidato(s) · gasto = ${METRICA_NOME[
    state.metrica
  ].toLowerCase()}, ${state.corrigido ? 'corrigido pelo IPCA' : 'nominal'}. Clique no cabeçalho para ordenar.`;
  const foot = root.querySelector('#table-foot')!;
  foot.innerHTML =
    list.length > shown
      ? `<button type="button" class="btn" id="mais">Mostrar mais ${fmtInt(Math.min(PAGE, list.length - shown))} (${fmtInt(
          list.length - shown,
        )} restantes)</button>`
      : '';
  foot.querySelector('#mais')?.addEventListener('click', () => {
    shown += PAGE;
    renderTable(root);
  });
}
