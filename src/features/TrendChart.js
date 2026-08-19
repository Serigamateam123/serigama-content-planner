import { html } from '../lib/html.js';
import { compact } from '../lib/metrics.js';
import { shortMonth, parse } from '../lib/date.js';

// A lightweight, dependency-free SVG line chart for the views trend.
// `data` is [{ key, value }] already sorted; `grain` controls x-axis labels.
export function TrendChart({ data, grain }) {
  const W = 720;
  const H = 260;
  const padL = 48;
  const padR = 16;
  const padT = 18;
  const padB = 34;

  if (!data || data.length === 0) {
    return html`<div class="empty" style=${{ padding: '60px' }}>No published content in this range yet.</div>`;
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const niceMax = niceCeil(max);
  const n = data.length;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => padT + innerH - (v / niceMax) * innerH;

  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${padL},${padT + innerH} ${linePts} ${x(n - 1)},${padT + innerH}`;
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => (niceMax / ticks) * i);

  const xLabel = (key) => {
    if (grain === 'monthly') {
      const [yy, mm] = key.split('-');
      return shortMonth(new Date(Number(yy), Number(mm) - 1, 1));
    }
    const d = parse(key);
    return d ? `${d.getDate()}/${d.getMonth() + 1}` : key;
  };

  return html`<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style=${{ minWidth: '520px' }}>
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(75,87,245,.18)" />
          <stop offset="100%" stop-color="rgba(75,87,245,0)" />
        </linearGradient>
      </defs>
      ${gridVals.map((v) => {
        const gy = y(v);
        return html`<g>
          <line x1=${padL} y1=${gy} x2=${W - padR} y2=${gy} stroke="#eef1f8" stroke-width="1" />
          <text x=${padL - 8} y=${gy + 4} text-anchor="end" font-size="11" fill="#9aa2b1">${compact(v)}</text>
        </g>`;
      })}
      <polygon points=${areaPts} fill="url(#tg)" />
      <polyline points=${linePts} fill="none" stroke="#4b57f5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${data.map((d, i) => html`<g>
        <circle cx=${x(i)} cy=${y(d.value)} r="4" fill="#fff" stroke="#4b57f5" stroke-width="2.5" />
        ${(n <= 12 || i % Math.ceil(n / 12) === 0)
          ? html`<text x=${x(i)} y=${H - 12} text-anchor="middle" font-size="11" fill="#9aa2b1">${xLabel(d.key)}</text>`
          : null}
      </g>`)}
    </svg>
  </div>`;
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
