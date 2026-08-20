import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { compact, withThousands } from '../lib/metrics.js';
import { shortMonth, parse } from '../lib/date.js';

// A lightweight, dependency-free SVG line chart for the views trend.
// `data` is [{ key, value }] already sorted; `grain` controls x-axis labels.
// Hovering (or moving the cursor across) the chart shows a tooltip with the
// exact date and number for the nearest point.
export function TrendChart({ data, grain }) {
  const [hover, setHover] = useState(null); // index of the highlighted point
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
  const band = n > 1 ? innerW / (n - 1) : innerW;

  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${padL},${padT + innerH} ${linePts} ${x(n - 1)},${padT + innerH}`;
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => (niceMax / ticks) * i);

  // Short label under the axis (kept terse so many can fit).
  const xLabel = (key) => {
    if (grain === 'monthly') {
      const [yy, mm] = key.split('-');
      return shortMonth(new Date(Number(yy), Number(mm) - 1, 1));
    }
    const d = parse(key);
    return d ? `${d.getDate()}/${d.getMonth() + 1}` : key;
  };

  // Fuller label shown inside the tooltip.
  const fullLabel = (key) => {
    if (grain === 'monthly') {
      const [yy, mm] = key.split('-');
      const d = new Date(Number(yy), Number(mm) - 1, 1);
      return `${shortMonth(d)} ${d.getFullYear()}`;
    }
    const d = parse(key);
    if (!d) return key;
    const base = `${d.getDate()} ${shortMonth(d)} ${d.getFullYear()}`;
    return grain === 'weekly' ? `Week of ${base}` : base;
  };

  // Only dot every point when there aren't too many (keeps dense daily clean).
  const showDots = n <= 45;

  // Tooltip geometry for the hovered point.
  let tip = null;
  if (hover != null && data[hover]) {
    const d = data[hover];
    const l1 = fullLabel(d.key);
    const l2 = `${withThousands(d.value)} views`;
    const boxW = Math.max(l1.length, l2.length) * 5.6 + 16;
    const boxH = 34;
    let bx = x(hover) - boxW / 2;
    bx = Math.max(padL, Math.min(W - padR - boxW, bx));
    let by = y(d.value) - boxH - 12;
    if (by < padT) by = y(d.value) + 14; // flip below if near the top
    tip = { l1, l2, boxW, boxH, bx, by, px: x(hover), py: y(d.value) };
  }

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
      <polyline points=${linePts} fill="none" stroke="#4b57f5" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />

      ${data.map((d, i) => html`<g>
        ${showDots ? html`<circle cx=${x(i)} cy=${y(d.value)} r="3" fill="#fff" stroke="#4b57f5" stroke-width="1.6" />` : null}
        ${(n <= 12 || i % Math.ceil(n / 12) === 0)
          ? html`<text x=${x(i)} y=${H - 12} text-anchor="middle" font-size="11" fill="#9aa2b1">${xLabel(d.key)}</text>`
          : null}
      </g>`)}

      ${tip ? html`<g>
        <line x1=${tip.px} y1=${padT} x2=${tip.px} y2=${padT + innerH} stroke="#c7ccf7" stroke-width="1" stroke-dasharray="3 3" />
        <circle cx=${tip.px} cy=${tip.py} r="5" fill="#4b57f5" stroke="#fff" stroke-width="2" />
        <rect x=${tip.bx} y=${tip.by} width=${tip.boxW} height=${tip.boxH} rx="6" fill="#1f2430" opacity="0.96" />
        <text x=${tip.bx + tip.boxW / 2} y=${tip.by + 13} text-anchor="middle" font-size="9.5" fill="#c7ccf7">${tip.l1}</text>
        <text x=${tip.bx + tip.boxW / 2} y=${tip.by + 26} text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff">${tip.l2}</text>
      </g>` : null}

      ${data.map((d, i) => html`<rect
        x=${x(i) - band / 2} y=${padT} width=${band} height=${innerH}
        fill="transparent" style=${{ cursor: 'pointer' }}
        onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
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
