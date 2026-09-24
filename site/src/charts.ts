import {
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  LineController,
  LineElement,
  Chart,
  Legend,
  LinearScale,
  LogarithmicScale,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

Chart.register(ScatterController, BarController, LineController, LineElement, Filler, LinearScale, LogarithmicScale, CategoryScale, PointElement, BarElement, Tooltip, Legend);

export function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function applyChartDefaults() {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--text-2');
  Chart.defaults.borderColor = css('--grid');
  Chart.defaults.locale = 'pt-BR';
  Chart.defaults.animation = false;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = css('--tooltip-bg');
  tt.titleColor = css('--text-1');
  tt.bodyColor = css('--text-1');
  tt.borderColor = css('--border-strong');
  tt.borderWidth = 1;
  tt.padding = 10;
  tt.cornerRadius = 6;
  tt.boxPadding = 4;
  tt.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.color = css('--text-2');
}

const registry = new Map<string, Chart>();

export function renderChart(key: string, canvas: HTMLCanvasElement, config: ChartConfiguration) {
  registry.get(key)?.destroy();
  const ch = new Chart(canvas, config);
  registry.set(key, ch);
  return ch;
}

export function destroyAll() {
  registry.forEach((c) => c.destroy());
  registry.clear();
}

export { Chart };
