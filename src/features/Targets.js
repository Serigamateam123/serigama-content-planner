import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Kpi, Modal } from '../components/ui.js';
import { readKV, writeKV } from '../lib/kv.js';
import { compact, withThousands, periodMetrics } from '../lib/metrics.js';
import { startOfMonth, shortMonth } from '../lib/date.js';

// Targets — a monthly "views in the month" target vs actual, like a sales target
// chart. The target starts at a set month and grows by a fixed % each month; any
// single month can be overridden. Stored in app_kv `serigama.targets`.
// "Views in the month" = every view the account got during the month, from all
// videos (TikTok Studio → Overview → Video views), captured into `serigama.monthly`.
const KEY = 'serigama.targets';

// Agreed starting plan: 563K in October 2026, then +5% every month.
const DEFAULT_VIEWS_TARGET = { startMonth: '2026-10', start: 563000, growthPct: 5, overrides: {} };
const MIN_DAYS_FOR_FORECAST = 3;
// A month's actual this many times above the chart's other values is drawn
// clipped at the top (with its real number), so one viral month can't squash the rest.
const OUTLIER_FACTOR = 2;

// --- month helpers ("YYYY-MM" keys) ------------------------------------------
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymDate = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1); };
const addMonths = (ym, n) => { const d = ymDate(ym); d.setMonth(d.getMonth() + n); return ymOf(d); };
const monthsBetween = (a, b) => { const da = ymDate(a), db = ymDate(b); return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth(); };
const ymLabel = (ym) => { const d = ymDate(ym); return `${shortMonth(d)} ${d.getFullYear()}`; };
const daysIn = (ym) => { const d = ymDate(ym); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

export function readTargets() {
  const saved = readKV(KEY, null);
  return { views: { ...DEFAULT_VIEWS_TARGET, ...((saved && saved.views) || {}) } };
}

// Target for a month: the override if one is set (any month, even before the
// plan started), else start × (1 + growth)^n from the start month on.
export function targetFor(cfg, ym) {
  if (cfg.overrides && cfg.overrides[ym] != null) return Number(cfg.overrides[ym]);
  const n = monthsBetween(cfg.startMonth, ym);
  if (n < 0) return null;
  return Math.round(Number(cfg.start) * Math.pow(1 + Number(cfg.growthPct) / 100, n));
}

export function Targets({ contents, metricsHistory }) {
  const [targets, setTargets] = useState(readTargets);
  const [editing, setEditing] = useState(false);
  const [rowEdit, setRowEdit] = useState(null); // { ym, value }
  const [err, setErr] = useState('');
  const cfg = targets.views;

  const now = new Date();
  const curYm = ymOf(now);
  const [year, setYear] = useState(now.getFullYear()); // the calendar year shown
  const studio = (readKV('serigama.monthly', {}) || {}).months || {};

  // This month before it's captured from Studio: estimate from the daily sync's
  // snapshots (views gained by every video since the 1st).
  const live = (() => {
    if (!metricsHistory || !metricsHistory.length) return null;
    const published = (contents || []).filter((c) => c.status === 'published');
    const pm = periodMetrics(published, metricsHistory, startOfMonth(now), now);
    return pm.views > 0 ? pm.views : null;
  })();

  const actualFor = (ym) => {
    const m = studio[ym];
    if (m && m.views != null) {
      const days = m.complete ? daysIn(ym) : Number(m.days) || null;
      return { value: Number(m.views), days, complete: !!m.complete, source: 'studio' };
    }
    if (ym === curYm && live != null) return { value: live, days: now.getDate(), complete: false, source: 'sync' };
    return null;
  };

  const buildRow = (ym) => {
    const target = targetFor(cfg, ym);
    const actual = actualFor(ym);
    const isPast = ym < curYm, isCur = ym === curYm;
    let forecast = null;
    if (isCur && actual && !actual.complete && actual.days >= MIN_DAYS_FOR_FORECAST) {
      forecast = Math.round((actual.value / actual.days) * daysIn(ym));
    }
    let status;
    if (target == null) status = 'notarget';
    else if (!isPast && !isCur) status = 'upcoming';
    else if (isCur) status = 'current';
    else if (!actual) status = 'nodata';
    else if (!actual.complete && actual.days && actual.days < daysIn(ym)) status = actual.value >= target ? 'hit' : 'partial';
    else status = actual.value >= target ? 'hit' : 'miss';
    return { ym, target, actual, forecast, status, overridden: cfg.overrides && cfg.overrides[ym] != null };
  };

  // The chart and table show one calendar year, January to December.
  const rows = Array.from({ length: 12 }, (_, i) => buildRow(`${year}-${String(i + 1).padStart(2, '0')}`));

  // Years worth browsing: from the first month with data or a target, to a year past the plan start.
  const firstYm = [...Object.keys(studio), cfg.startMonth, ...Object.keys(cfg.overrides || {})].sort()[0];
  const minYear = Math.min(Number(firstYm.slice(0, 4)), now.getFullYear());
  const maxYear = Math.max(Number(cfg.startMonth.slice(0, 4)), now.getFullYear()) + 1;

  // Hit/miss record across every finished month that has a target (all years).
  const judged = [];
  const firstTargetYm = [cfg.startMonth, ...Object.keys(cfg.overrides || {})].sort()[0];
  for (let ym = firstTargetYm; ym < curYm; ym = addMonths(ym, 1)) {
    const r = buildRow(ym);
    if (r.status === 'hit' || r.status === 'miss') judged.push(r);
  }
  const cur = buildRow(curYm >= cfg.startMonth ? curYm : cfg.startMonth);
  const hits = judged.filter((r) => r.status === 'hit').length;
  const last3 = judged.slice(-3);
  const holdHint = last3.length === 3 && last3.every((r) => r.status === 'miss');

  const save = async (next) => {
    setErr('');
    try {
      await writeKV(KEY, next);
      setTargets(next);
      return true;
    } catch (e) {
      setErr('Could not save to the cloud — check your connection and try again.');
      return false;
    }
  };
  const saveRow = async () => {
    const v = Math.round(Number(rowEdit.value));
    if (!v || v < 0) { setErr('Enter a target above 0.'); return; }
    const overrides = { ...(cfg.overrides || {}), [rowEdit.ym]: v };
    if (await save({ ...targets, views: { ...cfg, overrides } })) setRowEdit(null);
  };
  const resetRow = async (ym) => {
    const overrides = { ...(cfg.overrides || {}) };
    delete overrides[ym];
    if (await save({ ...targets, views: { ...cfg, overrides } })) setRowEdit(null);
  };

  const pct = (a, t) => (a != null && t ? Math.round((a / t) * 100) : null);
  const curPct = cur ? pct(cur.forecast != null ? cur.forecast : cur.actual && cur.actual.complete ? cur.actual.value : null, cur.target) : null;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Report</div>
        <h1 class="page-title">Targets</h1>
        <div class="page-sub">Monthly <strong>views in the month</strong> target vs actual — starts at ${compact(cfg.start)} in ${ymLabel(cfg.startMonth)}, +${cfg.growthPct}% every month</div>
      </div>
      <div class="page-actions">
        <button class="btn" onClick=${() => window.print()}><${Icon} name="print" size=${15} /> Print / PDF</button>
        <button class="btn btn-gold" onClick=${() => { setErr(''); setEditing(true); }}><${Icon} name="pencil" size=${15} /> Edit target</button>
      </div>
    </div>

    ${err && !editing ? html`<div class="toast toast-err no-print" style=${{ marginBottom: '14px' }}>${err}</div>` : ''}

    ${cur ? html`<div class="kpi-row">
      <${Kpi} label=${'Target · ' + ymLabel(cur.ym)} value=${compact(cur.target)} sub=${cur.overridden ? 'set by hand for this month' : `+${cfg.growthPct}% each month`} />
      <${Kpi} label="Actual so far" value=${cur.actual ? compact(cur.actual.value) : '—'}
        sub=${!cur.actual ? (cur.status === 'upcoming' ? 'month not started' : 'not captured yet')
          : cur.actual.source === 'sync' ? `estimate from daily sync · day ${cur.actual.days}`
          : cur.actual.complete ? 'final · TikTok Studio' : `TikTok Studio · to day ${cur.actual.days}`} />
      <${Kpi} label="Forecast" value=${cur.forecast != null ? compact(cur.forecast) : '—'}
        sub=${cur.forecast != null ? `${curPct}% of target at this pace` : cur.status === 'current' ? `from day ${MIN_DAYS_FOR_FORECAST} of the month` : '—'} />
      <${Kpi} label="Months on target" value=${judged.length ? `${hits} of ${judged.length}` : '—'} sub=${judged.length ? `since ${ymLabel(firstTargetYm)}` : 'first result after this month'} />
    </div>` : ''}

    ${holdHint ? html`<div class="alert section-gap">
      <div class="alert-dot"><${Icon} name="alert" size=${15} /></div>
      <div class="alert-text"><b>3 months below target in a row.</b> Consider holding next month's target flat (click its ✏️ in the table) and reviewing the content plan before adding another ${cfg.growthPct}%.</div>
    </div>` : ''}

    <div class="card card-pad section-gap">
      <div class="chart-head" style=${{ marginBottom: '4px' }}>
        <div class="card-title">Views in the month — target vs actual · ${year}</div>
        <div class="cal-nav no-print">
          <button class="icon-btn" disabled=${year <= minYear} onClick=${() => setYear(year - 1)} aria-label="Previous year"><${Icon} name="chevronLeft" size=${16} /></button>
          <button class="btn btn-sm" onClick=${() => setYear(now.getFullYear())}>${year}</button>
          <button class="icon-btn" disabled=${year >= maxYear} onClick=${() => setYear(year + 1)} aria-label="Next year"><${Icon} name="chevronRight" size=${16} /></button>
        </div>
      </div>
      <div class="tgt-legend">
        <span><i style=${{ borderTop: '2.5px solid #4b57f5' }}></i>Actual</span>
        <span><i style=${{ borderTop: '2px dashed #9aa2b1' }}></i>Target</span>
        <span><i style=${{ borderTop: '2px dotted #4b57f5' }}></i>Forecast (this month)</span>
      </div>
      <${TargetChart} rows=${rows} curYm=${curYm} />
    </div>

    <div class="card card-pad section-gap">
      <div class="card-title" style=${{ marginBottom: '6px' }}>Month by month · ${year}</div>
      <div style=${{ overflowX: 'auto' }}>
        <table class="atable">
          <thead><tr><th>Month</th><th>Target</th><th>Actual</th><th>% of target</th><th>Status</th><th class="no-print"></th></tr></thead>
          <tbody>
            ${rows.map((r) => {
              const p = pct(r.status === 'current' ? r.forecast : r.actual && r.actual.value, r.target);
              const editingRow = rowEdit && rowEdit.ym === r.ym;
              return html`<tr class=${r.status === 'notarget' ? 'muted' : ''} style=${r.status === 'current' ? { background: '#fff7e6' } : {}}>
                <td><strong>${ymLabel(r.ym)}</strong></td>
                <td>${editingRow
                  ? html`<span class="tgt-edit">
                      <input type="number" min="0" step="1000" value=${rowEdit.value} onInput=${(e) => setRowEdit({ ...rowEdit, value: e.target.value })} />
                      <button class="btn btn-sm btn-gold" onClick=${saveRow}>Save</button>
                      ${r.overridden ? html`<button class="btn btn-sm" onClick=${() => resetRow(r.ym)} title="Go back to the +${cfg.growthPct}% plan">Reset</button>` : ''}
                      <button class="btn btn-sm btn-ghost" onClick=${() => setRowEdit(null)}>Cancel</button>
                    </span>`
                  : r.target == null ? html`<span class="muted">—</span>`
                  : html`${compact(r.target)}${r.overridden ? html` <span class="muted" title="Set by hand for this month">✱</span>` : ''}`}</td>
                <td>${r.actual
                  ? html`${compact(r.actual.value)}${!r.actual.complete ? html`<span class="muted" style=${{ display: 'block', fontSize: '11px' }}>${r.actual.source === 'sync' ? 'estimate, ' : ''}to day ${r.actual.days}</span>` : ''}`
                  : html`<span class="muted">—</span>`}</td>
                <td>${p != null ? html`<span style=${{ color: p >= 100 ? '#0f7a4d' : '#b4232a', fontWeight: 600 }}>${p}%${r.status === 'current' ? html`<span class="muted" style=${{ display: 'block', fontSize: '11px', fontWeight: 400 }}>forecast</span>` : ''}</span>` : html`<span class="muted">—</span>`}</td>
                <td>${statusChip(r.status)}</td>
                <td class="no-print">${!editingRow
                  ? html`<button class="btn btn-ghost btn-sm" title=${r.target != null ? "Change this month's target" : 'Add a target for this month'} onClick=${() => { setErr(''); setRowEdit({ ym: r.ym, value: r.target != null ? r.target : '' }); }}><${Icon} name="pencil" size=${13} /></button>`
                  : ''}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      ${err && rowEdit ? html`<div class="toast toast-err">${err}</div>` : ''}
    </div>

    <div class="card card-pad section-gap">
      <div class="eng-notes" style=${{ marginTop: 0 }}>
        <div class="note">📺 <strong>Views in the month</strong> — every view your account got during the month, from <em>all</em> videos (new and old). Same number as TikTok Studio → Analytics → Overview → <em>Video views</em> for that month.</div>
        <div class="note">📥 <strong>Where “actual” comes from:</strong> the weekly TikTok Studio capture. Before this month is captured, it's estimated from the daily auto-sync (marked “estimate”). A month is judged once its full-month Studio figure is in.</div>
        <div class="note">🔮 <strong>Forecast</strong> = views so far ÷ days so far × days in the month — where this month will land if the pace holds.</div>
        <div class="note">🔁 <strong>Review every 3 months.</strong> Views swing a lot (one viral video can make a month), so judge the trend over a quarter, not a single month.</div>
      </div>
    </div>

    ${editing ? html`<${TargetModal} cfg=${cfg} err=${err} onClose=${() => setEditing(false)}
      onSave=${async (next) => { if (await save({ ...targets, views: { ...cfg, ...next } })) setEditing(false); }} />` : ''}
  </div>`;
}

function statusChip(status) {
  const map = {
    hit: ['✅ Hit', 'tgt-hit'],
    miss: ['Missed', 'tgt-miss'],
    partial: ['Partial data', 'tgt-muted'],
    nodata: ['Capture from Studio', 'tgt-muted'],
    current: ['In progress', 'tgt-cur'],
    upcoming: ['Upcoming', 'tgt-muted'],
    notarget: ['No target set', 'tgt-muted'],
  };
  const [label, cls] = map[status] || [status, 'tgt-muted'];
  return html`<span class=${'tgt-chip ' + cls}>${label}</span>`;
}

function TargetModal({ cfg, err, onClose, onSave }) {
  const [startMonth, setStartMonth] = useState(cfg.startMonth);
  const [start, setStart] = useState(cfg.start);
  const [growth, setGrowth] = useState(cfg.growthPct);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const preview = [0, 1, 2, 3, 4, 5].map((n) => ({ ym: addMonths(startMonth || cfg.startMonth, n), v: Math.round((Number(start) || 0) * Math.pow(1 + (Number(growth) || 0) / 100, n)) }));
  const submit = async () => {
    if (!/^\d{4}-\d{2}$/.test(startMonth)) { setMsg('Pick a starting month.'); return; }
    if (!(Number(start) > 0)) { setMsg('Enter a starting target above 0.'); return; }
    if (!(Number(growth) >= 0)) { setMsg('Enter a growth % of 0 or more.'); return; }
    setMsg('');
    setBusy(true);
    await onSave({ startMonth, start: Math.round(Number(start)), growthPct: Math.round(Number(growth) * 10) / 10 });
    setBusy(false);
  };

  const footer = html`<div></div>
    <div style=${{ display: 'flex', gap: '8px' }}>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-gold" onClick=${submit} disabled=${busy}>${busy ? 'Saving…' : 'Save target'}</button>
    </div>`;

  return html`<${Modal} title="Views-in-the-month target" onClose=${onClose} footer=${footer}>
    ${msg || err ? html`<div class="toast toast-err" style=${{ marginTop: 0, marginBottom: '12px' }}>${msg || err}</div>` : ''}
    <div class="field-row">
      <div class="field">
        <label>Starting month</label>
        <input type="month" value=${startMonth} onInput=${(e) => setStartMonth(e.target.value)} />
      </div>
      <div class="field">
        <label>Target for that month (views)</label>
        <input type="number" min="0" step="1000" value=${start} onInput=${(e) => setStart(e.target.value)} />
      </div>
    </div>
    <div class="field">
      <label>Increase every month (%)</label>
      <input type="number" min="0" step="0.5" value=${growth} onInput=${(e) => setGrowth(e.target.value)} />
      <div class="help">Each month's target = the month before × (1 + this %). Months you've set by hand keep their own number.</div>
    </div>
    <div class="muted" style=${{ fontSize: '12.5px' }}>
      <strong>Preview:</strong> ${preview.map((p, i) => html`${i ? ' → ' : ''}${ymLabel(p.ym).split(' ')[0]} ${compact(p.v)}`)}
    </div>
  <//>`;
}

// Target (dashed) vs actual (solid) line chart with this month's forecast (dotted).
// Dependency-free SVG, same look as TrendChart; hover a month for the numbers.
function TargetChart({ rows, curYm }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 290, padL = 52, padR = 16, padT = 30, padB = 34;
  const n = rows.length;
  if (!n) return '';
  // The current month's partial actual would dip the line, so it's drawn as the forecast instead.
  const actualPt = (r) => (r.actual && r.ym !== curYm ? r.actual.value : null);
  // Scale to the targets, forecast and normal months; a viral month far above them
  // is clipped at the top (shown with its real number) instead of squashing the chart.
  const base = rows.flatMap((r) => [r.target, r.forecast]).filter((v) => v != null);
  const acts = rows.map(actualPt).filter((v) => v != null).sort((a, b) => a - b);
  const median = acts.length ? acts[Math.floor(acts.length / 2)] : 0;
  const ref = Math.max(...base, median, 1);
  const normal = acts.filter((v) => v <= ref * OUTLIER_FACTOR);
  const niceMax = niceCeil(Math.max(...base, ...normal, 1) * 1.08);
  const clipped = (v) => v > niceMax;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => padT + innerH - (Math.min(v, niceMax) / niceMax) * innerH;
  const band = n > 1 ? innerW / (n - 1) : innerW;
  const gridVals = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);

  // Polyline points for a series, split into runs wherever a value is missing.
  const runs = (get) => {
    const out = [];
    let cur = [];
    rows.forEach((r, i) => { const v = get(r); if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(`${x(i)},${y(v)}`); });
    if (cur.length) out.push(cur);
    return out.map((pts) => pts.join(' '));
  };
  const ci = rows.findIndex((r) => r.ym === curYm);
  const cur = ci >= 0 ? rows[ci] : null;
  const prevActual = ci > 0 ? actualPt(rows[ci - 1]) : null;

  let tip = null;
  if (hover != null) {
    const r = rows[hover];
    const lines = [ymLabel(r.ym)];
    if (r.target != null) lines.push(`Target  ${withThousands(r.target)}`);
    if (r.actual) lines.push(`Actual  ${withThousands(r.actual.value)}${r.actual.complete ? '' : ` (to day ${r.actual.days})`}`);
    if (r.forecast != null) lines.push(`Forecast  ${withThousands(r.forecast)}`);
    const v = r.ym === curYm ? r.forecast : r.actual && r.actual.value;
    if (v != null && r.target) lines.push(`${Math.round((v / r.target) * 100)}% of target${r.ym === curYm ? ' (forecast)' : ''}`);
    const boxW = Math.max(...lines.map((l) => l.length)) * 6 + 18;
    const boxH = lines.length * 14 + 10;
    let bx = x(hover) + 12;
    if (bx + boxW > W - padR) bx = x(hover) - boxW - 12;
    tip = { lines, boxW, boxH, bx, by: padT + 4 };
  }

  return html`<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style=${{ minWidth: '520px' }}
      role="img" aria-label="Line chart of monthly views target versus actual">
      ${gridVals.map((v) => html`<g>
        <line x1=${padL} y1=${y(v)} x2=${W - padR} y2=${y(v)} stroke="#eef1f8" stroke-width="1" />
        <text x=${padL - 8} y=${y(v) + 4} text-anchor="end" font-size="11" fill="#9aa2b1">${compact(v)}</text>
      </g>`)}
      ${rows.map((r, i) => html`<text x=${x(i)} y=${H - 12} text-anchor="middle" font-size="11" fill=${r.ym === curYm ? '#1f2430' : '#9aa2b1'} font-weight=${r.ym === curYm ? 700 : 400}>${ymLabel(r.ym).split(' ')[0]}</text>`)}
      ${ci >= 0 ? html`<rect x=${x(ci) - band / 2} y=${padT} width=${band} height=${innerH} fill="#fff7e6" />` : ''}

      ${runs((r) => r.target).map((pts) => html`<polyline points=${pts} fill="none" stroke="#9aa2b1" stroke-width="2" stroke-dasharray="6 5" />`)}
      ${runs(actualPt).map((pts) => html`<polyline points=${pts} fill="none" stroke="#4b57f5" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />`)}
      ${cur && cur.forecast != null && prevActual != null
        ? html`<line x1=${x(ci - 1)} y1=${y(prevActual)} x2=${x(ci)} y2=${y(cur.forecast)} stroke="#4b57f5" stroke-width="2" stroke-dasharray="2 4" />`
        : ''}
      ${rows.map((r, i) => actualPt(r) == null ? ''
        : clipped(actualPt(r))
        ? html`<g>
            <path d=${`M${x(i) - 5},${padT + 1} L${x(i)},${padT - 6} L${x(i) + 5},${padT + 1} Z`} fill="#4b57f5" />
            <text x=${x(i)} y=${padT - 10} text-anchor="middle" font-size="10.5" font-weight="700" fill="#4b57f5">${compact(actualPt(r))} ↑</text>
          </g>`
        : html`<circle cx=${x(i)} cy=${y(actualPt(r))} r="3.5" fill=${r.target != null && actualPt(r) >= r.target ? '#0f9d58' : '#fff'} stroke="#4b57f5" stroke-width="1.8" />`)}
      ${cur && cur.forecast != null ? html`<circle cx=${x(ci)} cy=${y(cur.forecast)} r="4" fill="#fff" stroke="#4b57f5" stroke-width="1.8" stroke-dasharray="2 2" />` : ''}

      ${hover != null ? html`<g>
        <line x1=${x(hover)} y1=${padT} x2=${x(hover)} y2=${padT + innerH} stroke="#c7ccf7" stroke-width="1" stroke-dasharray="3 3" />
        <rect x=${tip.bx} y=${tip.by} width=${tip.boxW} height=${tip.boxH} rx="6" fill="#1f2430" opacity="0.96" />
        ${tip.lines.map((l, i) => html`<text x=${tip.bx + 9} y=${tip.by + 17 + i * 14} font-size=${i ? 10.5 : 10} font-weight=${i ? 600 : 400} fill=${i ? '#fff' : '#c7ccf7'}>${l}</text>`)}
      </g>` : ''}

      ${rows.map((r, i) => html`<rect x=${x(i) - band / 2} y=${padT} width=${band} height=${innerH} fill="transparent"
        style=${{ cursor: 'pointer' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
    </svg>
  </div>`;
}

// Round an axis maximum up to a tidy number (finer steps than TrendChart's so a
// 1.2M peak gets a 1.2M–1.5M axis, not 2M).
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => norm <= s);
  return step * mag;
}
