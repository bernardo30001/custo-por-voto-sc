import type { Plugin } from 'chart.js';
import { CARGO_NOME, METRICA_NOME, SITUACAO_NOME, type Candidato, type Cargo } from '../data';
import { cpv, dataset, naMedia, state, ultimoEleito, valor } from '../state';
import { fitLogLog, predictLogLog, quantile } from '../stats';
import { css, renderChart } from '../charts';
import { esc, fmtBRL, fmtBRLShort, fmtInt, fmtIntShort, fmtPct, parseBRL } from '../format';

interface SimInput {
  cargo: Cargo;
  investimento: number;
  ref: number | 'todos';
}

const sim: SimInput = { cargo: 7, investimento: 500_000, ref: 'todos' };

export interface SimResult {
  ref: Candidato[];
  janela: number; // meia-largura da janela usada (0,2 = ±20%)
  parecidos: Candidato[];
  votos: { p25: number; mediana: number; p75: number };
  regressao: null | {
    b: number;
    r2: number;
    n: number;
    mid: number;
    lo50: number;
    hi50: number;
    lo90: number;
    hi90: number;
    extrapola: boolean;
  };
  pelaCpv: { lo: number; mid: number; hi: number; cpvP25: number; cpvMed: number; cpvP75: number };
  eleitos: number;
  ultimos: { ano: number; c: Candidato }[];
}

/** Núcleo do simulador (exportado para testes). Valores sempre corrigidos pelo IPCA. */
export function simular(input: SimInput, p = state.p): SimResult {
  const ds = dataset();
  const anos = input.ref === 'todos' ? ds.meta.anos : [input.ref];
  const ref = ds.candidatos.filter((c) => c.c === input.cargo && anos.includes(c.a) && naMedia(c));
  const gastoReal = (c: Candidato) => valor(c, state.metrica, true) * (1 + p);
  const I = input.investimento;

  let janela = 0.2;
  let parecidos: Candidato[] = [];
  for (const w of [0.2, 0.3, 0.4, 0.5]) {
    janela = w;
    parecidos = ref.filter((c) => Math.abs(gastoReal(c) - I) <= w * I);
    if (parecidos.length >= 5) break;
  }
  const votos = parecidos.map((c) => c.v);
  const cpvs = parecidos.map((c) => cpv(c, state.metrica, true));

  const fit = fitLogLog(ref.map((c) => ({ x: gastoReal(c), y: c.v })));
  let regressao: SimResult['regressao'] = null;
  if (fit) {
    const p50 = predictLogLog(fit, I, 0.674);
    const p90 = predictLogLog(fit, I, 1.645);
    const xs = ref.map(gastoReal);
    regressao = {
      b: fit.b,
      r2: fit.r2,
      n: fit.n,
      mid: p50.mid,
      lo50: p50.lo,
      hi50: p50.hi,
      lo90: p90.lo,
      hi90: p90.hi,
      extrapola: I < Math.min(...xs) || I > Math.max(...xs),
    };
  }

  const cpvP25 = quantile(cpvs, 0.25);
  const cpvMed = quantile(cpvs, 0.5);
  const cpvP75 = quantile(cpvs, 0.75);
  return {
    ref,
    janela,
    parecidos,
    votos: { p25: quantile(votos, 0.25), mediana: quantile(votos, 0.5), p75: quantile(votos, 0.75) },
    regressao,
    pelaCpv: {
      cpvP25,
      cpvMed,
      cpvP75,
      lo: I / (cpvP75 * (1 + p)),
      mid: I / (cpvMed * (1 + p)),
      hi: I / (cpvP25 * (1 + p)),
    },
    eleitos: parecidos.filter((c) => c.s === 'eleito').length,
    ultimos: anos.map((a) => ({ ano: a, c: ultimoEleito(a, input.cargo)! })).filter((x) => x.c),
  };
}

export function renderSimulador(root: HTMLElement, fresh: boolean) {
  if (fresh || !root.querySelector('#simulador')) {
    root.innerHTML = layout();
    bind(root);
  }
  renderResultado(root);
}

function layout() {
  const ds = dataset();
  const refs = ds.meta.anos
    .map((a) => `<option value="${a}" ${sim.ref === a ? 'selected' : ''}>${a}</option>`)
    .join('');
  return `
  <div id="simulador">
    <header class="page-head">
      <h1>Quanto rende o investimento?</h1>
      <p class="lede">Compare um valor de campanha com o que candidatos de Santa Catarina que gastaram algo parecido conseguiram de votos. O resultado é sempre uma faixa, nunca um número exato.</p>
    </header>

    <div class="callout callout-warn" role="note">
      <strong>Leia antes:</strong> gasto e votos são correlacionados, mas o dinheiro sozinho não garante votos. Candidatos com mandato, base eleitoral consolidada e notoriedade distorcem essa relação: muitas vezes gastam mais <em>porque</em> já são competitivos. Use as faixas abaixo como referência histórica, não como previsão.
    </div>

    <form class="sim-form" id="sim-form" onsubmit="return false">
      <label class="ctl"><span class="ctl-label">Cargo</span>
        <select id="s-cargo">
          <option value="6" ${sim.cargo === 6 ? 'selected' : ''}>Deputado Federal</option>
          <option value="7" ${sim.cargo === 7 ? 'selected' : ''}>Deputado Estadual</option>
        </select></label>
      <label class="ctl ctl-grow"><span class="ctl-label">Valor a investir (R$)</span>
        <input id="s-valor" inputmode="decimal" autocomplete="off" value="${fmtInt(sim.investimento)}" aria-describedby="s-valor-hint" />
        <span class="ctl-hint" id="s-valor-hint">Ex.: 500.000, 500 mil ou 1,5 mi</span></label>
      <label class="ctl"><span class="ctl-label">Referência</span>
        <select id="s-ref">${refs}<option value="todos" ${sim.ref === 'todos' ? 'selected' : ''}>Média dos três anos</option></select></label>
      <div class="ctl quick" role="group" aria-label="Valores rápidos">
        <span class="ctl-label">Atalhos</span>
        <div class="seg seg-sm">
          <button type="button" data-v="100000">R$ 100 mil</button>
          <button type="button" data-v="500000">R$ 500 mil</button>
          <button type="button" data-v="2000000">R$ 2 mi</button>
        </div>
      </div>
    </form>

    <div id="sim-out"></div>
  </div>`;
}

function bind(root: HTMLElement) {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  $('#s-cargo').addEventListener('change', (e) => {
    sim.cargo = Number((e.target as HTMLSelectElement).value) as Cargo;
    renderResultado(root);
  });
  $('#s-ref').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    sim.ref = v === 'todos' ? 'todos' : Number(v);
    renderResultado(root);
  });
  const input = $<HTMLInputElement>('#s-valor');
  input.addEventListener('input', () => {
    const v = parseBRL(input.value);
    if (Number.isFinite(v) && v > 0) {
      sim.investimento = v;
      input.removeAttribute('aria-invalid');
      renderResultado(root);
    } else input.setAttribute('aria-invalid', 'true');
  });
  input.addEventListener('blur', () => (input.value = fmtInt(sim.investimento)));
  root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
    b.addEventListener('click', () => {
      sim.investimento = Number(b.dataset.v);
      input.value = fmtInt(sim.investimento);
      renderResultado(root);
    }),
  );
}

function faixa(lo: number, hi: number) {
  return `${fmtInt(lo)} a ${fmtInt(hi)} votos`;
}

function renderResultado(root: HTMLElement) {
  const out = root.querySelector('#sim-out')!;
  root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === sim.investimento)),
  );
  const r = simular(sim);
  const I = sim.investimento;
  const p = state.p;
  const refNome = sim.ref === 'todos' ? '2014, 2018 e 2022 combinados' : String(sim.ref);
  const limite = dataset().meta.limites_2026.find((l) => l.cargo === sim.cargo);
  const n = r.parecidos.length;
  const cenario =
    p > 0
      ? `<div class="callout callout-scenario" role="note"><strong>Cenário hipotético ativo: +${fmtPct(p)} de gasto não declarado.</strong> O custo histórico de cada voto é tratado como ${fmtPct(
          p,
        )} maior que o declarado, para todos os candidatos igualmente. Isso reduz os votos esperados para o mesmo investimento. Não é uma afirmação sobre nenhum candidato.</div>`
      : '';

  const limiteBox = limite
    ? `<div class="limit ${I > limite.valor ? 'limit-over' : ''}">
        <span>Limite de gastos 2026 para ${CARGO_NOME[sim.cargo]} em SC: <strong>${fmtBRL(limite.valor)}</strong></span>
        <span class="muted small">${esc(limite.fonte)} · <a href="${esc(limite.url)}" rel="noopener" target="_blank">fonte oficial</a></span>
        ${I > limite.valor ? `<span class="warn-text">O valor informado passa do limite legal de gastos para o cargo.</span>` : ''}
      </div>`
    : '';

  if (n === 0) {
    out.innerHTML = `${cenario}${limiteBox}<div class="callout">Nenhum candidato de ${esc(refNome)} gastou um valor próximo de ${fmtBRL(
      I,
    )} (nem com janela de ±50%). Tente outro valor ou outra referência.</div>`;
    return;
  }

  const janelaTxt = `±${fmtPct(r.janela)}`;
  const ampliou = r.janela > 0.2 ? `<p class="note">Poucos casos em ±20%; a janela foi ampliada para ${janelaTxt}.</p>` : '';
  const reg = r.regressao;
  const ultLinhas = r.ultimos
    .map(({ ano, c }) => {
      const rel = r.votos.mediana / c.v;
      return `<li><strong>${ano}:</strong> ${fmtInt(c.v)} votos (${esc(c.u)}, ${esc(c.p)}). A mediana dos parecidos equivale a ${fmtPct(rel)} disso.</li>`;
    })
    .join('');
  const ultMin = Math.min(...r.ultimos.map((u) => u.c.v));
  const acima = r.parecidos.filter((c) => c.v >= ultMin).length;

  out.innerHTML = `
    ${cenario}
    <p class="sim-ctx">Investimento de <strong>${fmtBRL(I)}</strong> para <strong>${CARGO_NOME[sim.cargo]}</strong>, referência <strong>${esc(
      refNome,
    )}</strong>. Gasto histórico = ${METRICA_NOME[state.metrica].toLowerCase()} corrigidas pelo IPCA${
      p > 0 ? `, multiplicadas por ${(1 + p).toLocaleString('pt-BR')} (cenário)` : ''
    }.</p>

    <div class="sim-grid">
      <article class="card sim-card">
        <h3><span class="step">1</span> Candidatos com gasto parecido</h3>
        <p class="big">${faixa(r.votos.p25, r.votos.p75)}</p>
        <p>Mediana de <strong>${fmtInt(r.votos.mediana)} votos</strong>. Faixa do 1º ao 3º quartil entre ${fmtInt(n)} candidato(s) que gastaram entre ${fmtBRL(
          I * (1 - r.janela),
        )} e ${fmtBRL(I * (1 + r.janela))}${p > 0 ? ' (gasto já ajustado pelo cenário)' : ''}.</p>
        ${ampliou}
        ${n < 8 ? `<p class="note">Amostra pequena: trate a faixa com cautela.</p>` : ''}
      </article>

      <article class="card sim-card">
        <h3><span class="step">2</span> Estimativa por regressão</h3>
        ${
          reg
            ? `<p class="big">${faixa(reg.lo50, reg.hi50)}</p>
               <p>Intervalo de 50% de uma regressão log-log de votos sobre gasto (${fmtInt(reg.n)} candidatos). Intervalo de 90%: ${faixa(
                 reg.lo90,
                 reg.hi90,
               )}. Valor central ${fmtInt(reg.mid)}.</p>
               <p class="note">Elasticidade ${reg.b.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}: em média, 10% a mais de gasto se associam a ${fmtPct(
                 1.1 ** reg.b - 1,
               )} a mais de votos. R² = ${reg.r2.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}.${
                 reg.extrapola ? ' <strong>O valor está fora da faixa observada: a estimativa é uma extrapolação.</strong>' : ''
               }</p>`
            : '<p>Dados insuficientes para a regressão.</p>'
        }
      </article>

      <article class="card sim-card">
        <h3><span class="step">3</span> Quantos se elegeram</h3>
        <p class="big">${fmtInt(r.eleitos)} de ${fmtInt(n)}</p>
        <p>${fmtPct(r.eleitos / n)} dos candidatos com gasto parecido foram eleitos. ${fmtInt(acima)} de ${fmtInt(
          n,
        )} tiveram votação igual ou maior que a do último eleito${r.ultimos.length > 1 ? ' (no ano de menor corte)' : ''}.</p>
        <p class="note">Em eleição proporcional, a vaga depende também dos votos do partido ou federação; votação alta não garante cadeira.</p>
      </article>

      <article class="card sim-card">
        <h3><span class="step">4</span> Comparação com o último eleito</h3>
        <ul class="plain">${ultLinhas}</ul>
      </article>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Pelo custo por voto</h2></div>
      <p>Votos ≈ investimento ÷ (CPV histórico × ${(1 + p).toLocaleString('pt-BR')}). Com os CPVs dos candidatos com gasto parecido
      (1º quartil ${fmtBRL(r.pelaCpv.cpvP25)}, mediana ${fmtBRL(r.pelaCpv.cpvMed)}, 3º quartil ${fmtBRL(r.pelaCpv.cpvP75)}):
      <strong>${faixa(r.pelaCpv.lo, r.pelaCpv.hi)}</strong>, com valor central de ${fmtInt(r.pelaCpv.mid)}.</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Onde o valor cai na distribuição</h2>
        <p class="panel-sub">Cada ponto é um candidato de ${esc(refNome)} (${CARGO_NOME[sim.cargo]}). Faixa vertical: janela de gasto parecido. Linha: regressão log-log com intervalo de 50%. Tracejado: votação do último eleito.</p>
      </div>
      <div class="legend">
        <span class="key"><i style="background:${css('--series-1')}"></i>Eleito</span>
        <span class="key"><i style="background:${css('--series-3')}"></i>Não eleito / suplente</span>
        <span class="key"><i class="line" style="background:${css('--text-2')}"></i>Regressão</span>
      </div>
      <div class="chart-box chart-scatter"><canvas id="sim-chart" role="img" aria-label="Dispersão de gasto e votos com a janela do valor simulado"></canvas></div>
    </section>

    ${limiteBox}

    <details class="panel details">
      <summary>Ver os ${fmtInt(n)} candidatos com gasto parecido</summary>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Candidato</th><th>Ano</th><th class="num">Gasto (corrigido)</th><th class="num">Votos</th><th>Situação</th></tr></thead>
        <tbody>${[...r.parecidos]
          .sort((a, b) => b.v - a.v)
          .map(
            (c) =>
              `<tr><td class="cand"><strong>${esc(c.u)}</strong><span class="muted small">${esc(c.p)}</span></td><td>${c.a}</td><td class="num">${fmtBRL(
                valor(c, state.metrica, true),
              )}</td><td class="num">${fmtInt(c.v)}</td><td><span class="sit sit-${c.s}"><i aria-hidden="true"></i>${SITUACAO_NOME[c.s]}</span></td></tr>`,
          )
          .join('')}</tbody></table></div>
    </details>`;

  renderSimChart(root, r);
}

function renderSimChart(root: HTMLElement, r: SimResult) {
  const I = sim.investimento;
  const p = state.p;
  const gastoReal = (c: Candidato) => valor(c, state.metrica, true) * (1 + p);
  const xs = r.ref.map(gastoReal);
  const xmin = Math.min(...xs, I) * 0.8;
  const xmax = Math.max(...xs, I) * 1.25;
  const fit = fitLogLog(r.ref.map((c) => ({ x: gastoReal(c), y: c.v })));
  const line: { x: number; y: number }[] = [];
  const lo: { x: number; y: number }[] = [];
  const hi: { x: number; y: number }[] = [];
  if (fit) {
    for (let i = 0; i <= 40; i++) {
      const x = xmin * (xmax / xmin) ** (i / 40);
      const pr = predictLogLog(fit, x, 0.674);
      line.push({ x, y: pr.mid });
      lo.push({ x, y: pr.lo });
      hi.push({ x, y: pr.hi });
    }
  }
  const ultV = r.ultimos.map((u) => u.c.v);
  const band = css('--band');
  const text2 = css('--text-2');
  const overlay: Plugin<'scatter'> = {
    id: 'simOverlay',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x0 = scales.x.getPixelForValue(I * (1 - r.janela));
      const x1 = scales.x.getPixelForValue(I * (1 + r.janela));
      ctx.save();
      ctx.fillStyle = band;
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = text2;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      for (const v of ultV) {
        const y = scales.y.getPixelForValue(v);
        if (y < chartArea.top || y > chartArea.bottom) continue;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
  const surface = css('--surface');
  renderChart('sim', root.querySelector<HTMLCanvasElement>('#sim-chart')!, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Eleito',
          data: r.ref.filter((c) => c.s === 'eleito').map((c) => ({ x: gastoReal(c), y: c.v, c })),
          backgroundColor: css('--series-1'),
          borderColor: surface,
          borderWidth: 1,
          pointRadius: 4,
          order: 1,
        },
        {
          label: 'Não eleito / suplente',
          data: r.ref.filter((c) => c.s !== 'eleito').map((c) => ({ x: gastoReal(c), y: c.v, c })),
          backgroundColor: css('--series-3-soft'),
          borderColor: surface,
          borderWidth: 1,
          pointRadius: 3.5,
          order: 2,
        },
        {
          type: 'line',
          label: 'lo',
          data: lo,
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          order: 3,
        },
        {
          type: 'line',
          label: 'Intervalo de 50%',
          data: hi,
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: css('--band-strong'),
          fill: '-1',
          order: 3,
        },
        {
          type: 'line',
          label: 'Regressão',
          data: line,
          borderColor: text2,
          borderWidth: 2,
          pointRadius: 0,
          order: 0,
        },
      ] as never,
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'logarithmic',
          min: xmin,
          max: xmax,
          title: { display: true, text: 'Gasto corrigido (R$)' + (p > 0 ? ' × cenário' : ''), color: text2 },
          ticks: {
            callback: (v) => {
              const n = Number(v);
              const m = n / 10 ** Math.floor(Math.log10(n) + 1e-9);
              return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6) ? fmtBRLShort(n) : '';
            },
            maxRotation: 0,
            color: css('--muted'),
          },
          grid: { color: css('--grid') },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Votos', color: text2 },
          ticks: {
            callback: (v) => {
              const n = Number(v);
              const m = n / 10 ** Math.floor(Math.log10(n) + 1e-9);
              return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6) ? fmtIntShort(n) : '';
            },
            color: css('--muted'),
          },
          grid: { color: css('--grid') },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => i.datasetIndex < 2,
          callbacks: {
            title: (items) => {
              const c = (items[0].raw as { c: Candidato }).c;
              return `${c.u} (${c.p}) · ${c.a}`;
            },
            label: (i) => {
              const c = (i.raw as { c: Candidato }).c;
              return [`Votos: ${fmtInt(c.v)}`, `Gasto corrigido: ${fmtBRL(valor(c, state.metrica, true))}`, SITUACAO_NOME[c.s]];
            },
          },
        },
      },
    },
    plugins: [overlay as never],
  });
}
