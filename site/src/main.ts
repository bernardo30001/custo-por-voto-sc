import './style.css';
import { loadDataset, METRICA_NOME, type Metrica } from './data';
import { setDataset, state, subscribe, update, dataset } from './state';
import { applyChartDefaults, destroyAll } from './charts';
import { renderPainel } from './views/painel';
import { renderSimulador } from './views/simulador';
import { renderMetodologia } from './views/metodologia';
import { renderAoVivo } from './views/aovivo';
import { esc, fmtPct } from './format';

type Route = 'painel' | 'simulador' | 'aovivo' | 'metodologia';
const main = document.getElementById('main')!;
const controls = document.getElementById('global-controls')!;

function currentRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '').split(/[?#]/)[0];
  if (r === '2026') return 'aovivo';
  return r === 'simulador' || r === 'metodologia' ? r : 'painel';
}

function renderControls() {
  const metricas = (Object.keys(METRICA_NOME) as Metrica[])
    .map((m) => `<option value="${m}" ${state.metrica === m ? 'selected' : ''}>${esc(METRICA_NOME[m])}</option>`)
    .join('');
  controls.innerHTML = `
    <label class="ctl">
      <span class="ctl-label">Métrica de gasto</span>
      <select id="g-metrica">${metricas}</select>
    </label>
    <div class="ctl" data-ctl="valores" role="group" aria-labelledby="lbl-valores">
      <span class="ctl-label" id="lbl-valores">Valores</span>
      <div class="seg">
        <button type="button" data-corr="1" aria-pressed="${state.corrigido}">Corrigidos (IPCA)</button>
        <button type="button" data-corr="0" aria-pressed="${!state.corrigido}">Nominais</button>
      </div>
    </div>
    <div class="ctl ctl-slider">
      <label class="ctl-label" for="g-p">Cenário: gasto não declarado <a href="#/metodologia#cenario" class="help" title="O que é este cenário?">?</a></label>
      <div class="slider-row">
        <input type="range" id="g-p" min="0" max="100" step="5" value="${Math.round(state.p * 100)}" aria-describedby="g-p-desc" />
        <output id="g-p-out" for="g-p">${fmtPct(state.p)}</output>
      </div>
      <span class="ctl-hint" id="g-p-desc">Hipotético, aplicado igualmente a todos os candidatos.</span>
    </div>`;

  controls.querySelector<HTMLSelectElement>('#g-metrica')!.addEventListener('change', (e) =>
    update({ metrica: (e.target as HTMLSelectElement).value as Metrica }),
  );
  controls.querySelectorAll<HTMLButtonElement>('[data-corr]').forEach((b) =>
    b.addEventListener('click', () => update({ corrigido: b.dataset.corr === '1' })),
  );
  const slider = controls.querySelector<HTMLInputElement>('#g-p')!;
  const out = controls.querySelector<HTMLOutputElement>('#g-p-out')!;
  slider.addEventListener('input', () => {
    const p = Number(slider.value) / 100;
    out.textContent = fmtPct(p);
    update({ p });
  });
}

function syncControls() {
  controls.querySelectorAll<HTMLButtonElement>('[data-corr]').forEach((b) =>
    b.setAttribute('aria-pressed', String((b.dataset.corr === '1') === state.corrigido)),
  );
  const sel = controls.querySelector<HTMLSelectElement>('#g-metrica');
  if (sel) sel.value = state.metrica;
}

let lastRoute: Route | null = null;
function render() {
  const route = currentRoute();
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.dataset.route = route;
  const changedRoute = route !== lastRoute;
  if (changedRoute) destroyAll();
  lastRoute = route;
  syncControls();
  if (route === 'painel') renderPainel(main, changedRoute);
  else if (route === 'simulador') renderSimulador(main, changedRoute);
  else if (route === 'aovivo') renderAoVivo(main, changedRoute);
  else renderMetodologia(main);
  const anchor = location.hash.split('#')[2];
  if (anchor && anchor !== lastAnchor) document.getElementById(anchor)?.scrollIntoView();
  else if (changedRoute) window.scrollTo(0, 0);
  lastAnchor = anchor;
}
let lastAnchor: string | undefined;

function setupTheme() {
  const btn = document.getElementById('theme-toggle')!;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : media.matches);
  const refresh = () => {
    btn.setAttribute('aria-pressed', String(isDark()));
    applyChartDefaults();
    lastRoute = null; // força recriar gráficos com as cores novas
    if (dataset()) render();
  };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cpv-theme', next);
    } catch {
      /* armazenamento indisponível */
    }
    refresh();
  });
  media.addEventListener('change', refresh);
  btn.setAttribute('aria-pressed', String(isDark()));
}

async function init() {
  setupTheme();
  applyChartDefaults();
  main.innerHTML = '<p class="loading">Carregando dados…</p>';
  try {
    const ds = await loadDataset();
    setDataset(ds);
    const anos = ds.meta.anos;
    if (!anos.includes(state.ano)) state.ano = anos[anos.length - 1];
    document.getElementById('footer-meta')!.textContent =
      `Base gerada em ${new Date(ds.meta.gerado_em).toLocaleDateString('pt-BR')}. IPCA até ${ds.meta.ipca.ate}.`;
  } catch (err) {
    main.innerHTML = `<p class="error">Não foi possível carregar os dados: ${esc(String(err))}</p>`;
    return;
  }
  renderControls();
  subscribe(render);
  window.addEventListener('hashchange', render);
  render();
}

init();
