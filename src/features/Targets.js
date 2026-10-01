import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Modal } from '../components/ui.js';
import { readKV, writeKV } from '../lib/kv.js';
import { compact, withThousands, periodTrend } from '../lib/metrics.js';
import { shortMonth, dayKey, addDays, startOfWeek, startOfDay } from '../lib/date.js';

// Targets — a monthly "views in the month" target the whole team can follow.
//  • Year (main view): Jan–Dec, one bar per month (green hit / red missed /
//    amber in progress) vs the target line, with year arrows.
//  • This month — pace: views so far this month, added up day by day, against a
//    straight line from 0 to the target — ahead/behind and "needed per day".
//  • Weekly check: last week and this week vs their share of the target.
// The target starts at a set month and grows by a fixed % each month; any month
// can be overridden. Stored in app_kv `serigama.targets`.
// Daily numbers come from the daily TikTok sync snapshots (content_metrics); a
// month's final figure is the TikTok Studio capture in `serigama.monthly`.
const KEY = 'serigama.targets';

// Agreed plan: 563K in October 2026, then +5% every month from November.
// Months before the start have no target (unless one is set by hand).
const DEFAULT_VIEWS_TARGET = { startMonth: '2026-10', start: 563000, growthPct: 5, overrides: {} };
const OUTLIER_FACTOR = 2; // a bar this many × above the targets is drawn capped

// --- month helpers ("YYYY-MM" keys) ------------------------------------------
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymDate = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1); };
const addMonths = (ym, n) => { const d = ymDate(ym); d.setMonth(d.getMonth() + n); return ymOf(d); };
const monthsBetween = (a, b) => { const da = ymDate(a), db = ymDate(b); return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth(); };
const ymLabel = (ym) => { const d = ymDate(ym); return `${shortMonth(d)} ${d.getFullYear()}`; };
const daysIn = (ym) => { const d = ymDate(ym); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
const dayOf = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
const signed = (n) => (n >= 0 ? '+' : '−') + compact(Math.abs(Math.round(n)));

export function readTargets() {
  const saved = readKV(KEY, null);
  return { views: { ...DEFAULT_VIEWS_TARGET, ...((saved && saved.views) || {}) } };
}

// Target for a month: the override if one is set (any month), else
// start × (1 + growth)^n from the start month on.
export function targetFor(cfg, ym) {
  if (cfg.overrides && cfg.overrides[ym] != null) return Number(cfg.overrides[ym]);
  const n = monthsBetween(cfg.startMonth, ym);
  if (n < 0) return null;
  return Math.round(Number(cfg.start) * Math.pow(1 + Number(cfg.growthPct) / 100, n));
}


export function Targets({ contents, metricsHistory }) {
  const [targets, setTargets] = useState(readTargets);
  const [view, setView] = useState('months'); // 'months' (Jan–Dec, default) | 'pace'
  const [editing, setEditing] = useState(false);
  const [rowEdit, setRowEdit] = useState(null); // { ym, value }
  const [err, setErr] = useState('');
  const cfg = targets.views;

  const now = new Date();
  const curYm = ymOf(now);
  const studio = (readKV('serigama.monthly', {}) || {}).months || {};
  const firstTargetYm = [cfg.startMonth, ...Object.keys(cfg.overrides || {})].sort()[0];
  const latestPaceYm = curYm > firstTargetYm ? curYm : firstTargetYm;
  const [paceYm, setPaceYm] = useState(latestPaceYm);
  const [year, setYear] = useState(now.getFullYear()); // year shown in the Jan–Dec view

  // Views gained per day across all videos, from the daily sync snapshots.
  const published = (contents || []).filter((c) => c.status === 'published');
  const daily = new Map(periodTrend(metricsHistory || [], 'daily', published).map((p) => [p.key, p.value]));
  const lastSyncDay = [...daily.keys()].sort().pop() || null;
  // When the latest sync ran (~6am): today's numbers only cover up to then, so
  // "where should we be" uses the same cut-off instead of the whole day.
  const lastSnapAt = (metricsHistory || []).reduce((mx, m) => { const t = new Date(m.fetched_at); return t > mx ? t : mx; }, new Date(0));
  const DAY = 86400000;
  const dayShare = (d) => (dayKey(d) === dayKey(now) && lastSnapAt > startOfDay(now) ? Math.min(1, (Math.min(now, lastSnapAt) - startOfDay(now)) / DAY) : 1);

  // Everything about one month's progress toward its target.
  const progress = (ym) => {
    const n = daysIn(ym);
    const target = targetFor(cfg, ym);
    const isCur = ym === curYm, isPast = ym < curYm;
    let lastDay = 0, sum = 0;
    const perDay = [];
    for (let d = 1; d <= n; d++) {
      const k = dayOf(ym, d);
      const v = lastSyncDay && k <= lastSyncDay && (!isCur || d <= now.getDate()) ? daily.get(k) : undefined;
      perDay.push(v == null ? null : v);
      if (v != null) { lastDay = d; sum += v; }
    }
    let cum = 0;
    let series = lastDay ? perDay.slice(0, lastDay).map((v) => (cum += v || 0)) : null;
    const st = studio[ym];
    let done = null, asOfDay = 0, source = null;
    if (isPast && st && st.complete) {
      done = Number(st.views); asOfDay = n; source = 'studio';
      // Scale the daily curve so it ends on Studio's exact month total.
      if (series && lastDay === n && sum > 0) series = series.map((v) => (v * done) / sum);
    } else if (st && st.views != null && (!lastDay || Number(st.days) >= lastDay)) {
      // A part-month Studio capture that covers at least as many days as the sync.
      done = Number(st.views); asOfDay = Number(st.days) || 0; source = 'studio';
    } else if (lastDay) {
      done = sum; asOfDay = lastDay; source = 'sync';
    }
    // Only TikTok Studio's full-month figure is official. A finished month with just
    // the daily-sync estimate (or a part-month capture) is never judged hit/missed.
    const final = isPast && source === 'studio' && !!(st && st.complete);
    const needsStudio = isPast && done != null && !final;
    // Days of data so far: for this month's sync numbers, up to the last sync time.
    let elapsed = asOfDay;
    if (isCur && source === 'sync' && lastSnapAt > ymDate(ym)) elapsed = Math.min(n, Math.max(0, (Math.min(now, lastSnapAt) - ymDate(ym)) / DAY));
    const expected = target != null && elapsed ? Math.round((target * elapsed) / n) : null;
    const forecast = isCur && done != null && elapsed >= 3 ? Math.round((done / elapsed) * n) : null;
    return { ym, n, target, done, asOfDay, elapsed, source, final, needsStudio, series, expected, forecast, isCur, isPast,
      overridden: !!(cfg.overrides && cfg.overrides[ym] != null) };
  };

  const p = progress(paceYm);
  const paceMonths = [];
  for (let ym = firstTargetYm; ym <= latestPaceYm; ym = addMonths(ym, 1)) paceMonths.push(ym);
  const pi = paceMonths.indexOf(paceYm);

  // Year view: January to December of the chosen year.
  const months = Array.from({ length: 12 }, (_, i) => progress(`${year}-${String(i + 1).padStart(2, '0')}`));
  const minYear = Number(firstTargetYm.slice(0, 4));
  const maxYear = Math.max(Number(cfg.startMonth.slice(0, 4)), now.getFullYear()) + 1;
  // The official record counts every finished month from the plan's start (all years).
  const judged = [];
  for (let ym = cfg.startMonth; ym < curYm; ym = addMonths(ym, 1)) {
    const m = progress(ym);
    if (m.final && m.target != null) judged.push(m);
  }
  const hits = judged.filter((m) => m.done >= m.target).length;
  const last3 = judged.slice(-3);
  const holdHint = last3.length === 3 && last3.every((m) => m.done < m.target);

  // Weekly check (Mon–Sun): each day's share of its month's target vs that day's views.
  const dayTarget = (d) => { const ym = ymOf(d); const t = targetFor(cfg, ym); return t ? t / daysIn(ym) : 0; };
  const week = (monday, soFar) => {
    let target = 0, expected = 0, actual = 0, days = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const t = dayTarget(d);
      target += t;
      const k = dayKey(d);
      // Only days that have a target count, so a week that straddles the plan's
      // start isn't padded with views from untargeted days.
      if (t > 0 && lastSyncDay && k <= lastSyncDay && (!soFar || d <= now)) { expected += t * (soFar ? dayShare(d) : 1); actual += daily.get(k) || 0; days++; }
    }
    return { from: monday, to: addDays(monday, 6), target: Math.round(target), expected: Math.round(expected), actual: Math.round(actual), days };
  };
  const thisMon = startOfWeek(now);
  const lastWeek = week(addDays(thisMon, -7), false);
  const thisWeek = week(thisMon, true);

  const save = async (next) => {
    setErr('');
    try { await writeKV(KEY, next); setTargets(next); return true; }
    catch (e) { setErr('Could not save to the cloud — check your connection and try again.'); return false; }
  };
  const saveRow = async () => {
    const v = Math.round(Number(rowEdit.value));
    if (!v || v < 0) { setErr('Enter a target above 0.'); return; }
    if (await save({ ...targets, views: { ...cfg, overrides: { ...(cfg.overrides || {}), [rowEdit.ym]: v } } })) setRowEdit(null);
  };
  const resetRow = async (ym) => {
    const overrides = { ...(cfg.overrides || {}) };
    delete overrides[ym];
    if (await save({ ...targets, views: { ...cfg, overrides } })) setRowEdit(null);
  };

  // --- the four boxes, for the month shown in the pace view ---
  const pct = (a, t) => (a != null && t ? Math.round((a / t) * 100) : null);
  const diff = p.done != null && p.expected != null ? p.done - p.expected : null;
  const remaining = p.target != null && p.done != null ? p.target - p.done : null;
  const daysLeft = p.n - p.elapsed;
  const daysLeftShown = Math.max(1, Math.round(daysLeft));
  const asOfText = p.source === 'sync' && p.isCur && lastSnapAt > startOfDay(now)
    ? `as of today ${lastSnapAt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}` : `by day ${p.asOfDay}`;
  const mon = shortMonth(ymDate(p.ym));
  const cards = p.target == null ? null : p.needsStudio ? [
    { label: `Target · ${ymLabel(p.ym)}`, value: compact(p.target), sub: 'month finished' },
    { label: 'Estimated views', value: '≈' + compact(p.done),
      sub: p.source === 'sync' ? `daily-sync estimate · not official` : `TikTok Studio, 1–${p.asOfDay} ${mon} only` },
    { label: 'Result', value: 'Needs Studio total', sub: `capture 1–${p.n} ${mon} from TikTok Studio` },
    { label: 'Versus target', value: `≈${pct(p.done, p.target)}%`, sub: 'estimate — not counted' },
  ] : [
    { label: `Target · ${ymLabel(p.ym)}`, value: compact(p.target),
      sub: p.final ? 'month finished' : p.asOfDay ? `day ${p.asOfDay} of ${p.n}` : p.isCur || p.isPast ? 'no numbers yet' : 'starts soon' },
    { label: p.final ? 'Final views' : 'Done so far', value: p.done != null ? compact(p.done) : '—',
      sub: p.done != null ? `${pct(p.done, p.target)}% of target · ${p.source === 'sync' ? `daily sync, ${asOfText}` : 'TikTok Studio'}` : 'appears after the daily sync' },
    p.final
      ? { label: 'Result', value: p.done >= p.target ? '✅ Hit' : `${compact(p.target - p.done)} short`,
          sub: p.done >= p.target ? `${signed(p.done - p.target)} above target` : 'missed this month', tone: p.done >= p.target ? 'good' : 'bad' }
      : { label: 'Status', value: diff == null ? '—' : `${signed(diff)} ${diff >= 0 ? 'ahead' : 'behind'}`,
          sub: diff == null ? 'needs a few days of numbers' : `should be at ${compact(p.expected)} ${asOfText}`, tone: diff == null ? null : diff >= 0 ? 'good' : 'bad' },
    p.final
      ? { label: 'Versus target', value: `${pct(p.done, p.target)}%`, sub: p.source === 'studio' ? 'final · TikTok Studio' : 'daily sync estimate' }
      : remaining != null && remaining <= 0
      ? { label: 'Needed per day', value: '🎉 Done', sub: 'target already reached', tone: 'good' }
      : { label: 'Needed per day', value: remaining != null && daysLeft > 0 ? compact(Math.round(remaining / daysLeft)) : '—',
          sub: remaining != null && daysLeft > 0 ? `for the last ${daysLeftShown} ${daysLeftShown === 1 ? 'day' : 'days'}` : '—' },
  ];

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Report</div>
        <h1 class="page-title">Targets</h1>
        <div class="page-sub">Monthly <strong>views in the month</strong> — ${compact(cfg.start)} in ${ymLabel(cfg.startMonth)}, then +${cfg.growthPct}% every month</div>
      </div>
      <div class="page-actions">
        <button class="btn" onClick=${() => window.print()}><${Icon} name="print" size=${15} /> Print / PDF</button>
        <button class="btn btn-gold" onClick=${() => { setErr(''); setEditing(true); }}><${Icon} name="pencil" size=${15} /> Edit target</button>
      </div>
    </div>

    ${err && !editing && !rowEdit ? html`<div class="toast toast-err no-print" style=${{ marginBottom: '14px' }}>${err}</div>` : ''}

    ${cards
      ? html`<div class="kpi-row">
          ${cards.map((c) => html`<div class=${'kpi' + (c.tone ? ' tgt-' + c.tone : '')}>
            <div class="kpi-label">${c.label}</div><div class="kpi-value">${c.value}</div><div class="kpi-sub">${c.sub}</div>
          </div>`)}
        </div>`
      : html`<div class="card card-pad"><div class="muted">No target set for ${ymLabel(p.ym)}. Use <strong>Edit target</strong> to set one.</div></div>`}

    ${holdHint ? html`<div class="alert section-gap">
      <div class="alert-dot"><${Icon} name="alert" size=${15} /></div>
      <div class="alert-text"><b>3 months below target in a row.</b> Consider holding next month's target flat (Year view → ✏️ in the table) and reviewing the content plan before adding another ${cfg.growthPct}%.</div>
    </div>` : ''}

    <div class="card card-pad section-gap">
      <div class="chart-head chart-head-stack">
        <div class="seg no-print">
          <button class=${view === 'months' ? 'active' : ''} onClick=${() => setView('months')}>Year — Jan to Dec</button>
          <button class=${view === 'pace' ? 'active' : ''} onClick=${() => setView('pace')}>This month — pace</button>
        </div>
        ${view === 'months' ? html`<div class="cal-nav no-print">
          <button class="icon-btn" disabled=${year <= minYear} onClick=${() => setYear(year - 1)} aria-label="Previous year"><${Icon} name="chevronLeft" size=${16} /></button>
          <button class="btn btn-sm" onClick=${() => setYear(now.getFullYear())}>${year}</button>
          <button class="icon-btn" disabled=${year >= maxYear} onClick=${() => setYear(year + 1)} aria-label="Next year"><${Icon} name="chevronRight" size=${16} /></button>
        </div>` : ''}
        ${view === 'pace' && paceMonths.length > 1 ? html`<div class="cal-nav no-print">
          <button class="icon-btn" disabled=${pi <= 0} onClick=${() => setPaceYm(paceMonths[pi - 1])} aria-label="Previous month"><${Icon} name="chevronLeft" size=${16} /></button>
          <button class="btn btn-sm" onClick=${() => setPaceYm(latestPaceYm)}>${ymLabel(paceYm)}</button>
          <button class="icon-btn" disabled=${pi >= paceMonths.length - 1} onClick=${() => setPaceYm(paceMonths[pi + 1])} aria-label="Next month"><${Icon} name="chevronRight" size=${16} /></button>
        </div>` : ''}
      </div>

      ${view === 'pace'
        ? html`
          <div class="tgt-legend">
            <span><i style=${{ borderTop: '2.5px solid #4b57f5' }}></i>Views so far (added up day by day)</span>
            <span><i style=${{ borderTop: '2px dashed #9aa2b1' }}></i>Target pace (${compact(p.target || 0)} by day ${p.n})</span>
            ${p.forecast != null ? html`<span><i style=${{ borderTop: '2px dotted #4b57f5' }}></i>Forecast</span>` : ''}
          </div>
          ${p.target == null ? '' : p.series
            ? html`<${PaceChart} p=${p} />`
            : html`<div class="empty" style=${{ padding: '40px 24px' }}>${p.isPast
                ? `No day-by-day numbers for ${ymLabel(p.ym)} — daily tracking started later, so only the month total is known.`
                : `No day-by-day numbers for ${ymLabel(p.ym)} yet — they appear after the daily TikTok sync runs.`}${p.done != null
                ? html`<br/>${p.final ? 'Month total' : 'TikTok Studio so far'}: <strong>${compact(p.done)}</strong>${p.final || !p.asOfDay ? '' : ` (to day ${p.asOfDay})`}.` : ''}</div>`}
          ${p.forecast != null && p.target ? html`<div class="muted" style=${{ fontSize: '12.5px', marginTop: '8px' }}>🔮 At this pace ${ymLabel(p.ym).split(' ')[0]} ends around <strong>${compact(p.forecast)}</strong> — ${pct(p.forecast, p.target)}% of target.</div>` : ''}`
        : html`
          <div class="tgt-legend">
            <span><i class="sq" style=${{ background: '#0f9d58' }}></i>Hit target</span>
            <span><i class="sq" style=${{ background: '#e5484d' }}></i>Missed</span>
            <span><i class="sq" style=${{ background: '#f5b517' }}></i>In progress</span>
            ${months.some((m) => m.needsStudio) ? html`<span><i class="sq" style=${{ background: '#b8bfcc' }}></i>Estimate — needs TikTok Studio total</span>` : ''}
            ${months.some((m) => m.isCur && m.target != null) ? html`<span><i style=${{ borderTop: '2px dashed #1f2430' }}></i>This month's target</span>` : ''}
            ${months.some((m) => m.target == null && m.done != null) ? html`<span><i class="sq" style=${{ background: '#cfd6f5' }}></i>No target set</span>` : ''}
          </div>
          <${MonthBars} months=${months} />
          <div class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 14px' }}>${judged.length ? html`Hit target <strong>${hits} of ${judged.length}</strong> finished ${judged.length === 1 ? 'month' : 'months'} since ${ymLabel(cfg.startMonth)}.` : `The official record starts with ${ymLabel(cfg.startMonth)} — results appear once it finishes.`}</div>
          <${MonthTable} months=${months} cfg=${cfg} rowEdit=${rowEdit} setRowEdit=${setRowEdit} setErr=${setErr} saveRow=${saveRow} resetRow=${resetRow} />
          ${err && rowEdit ? html`<div class="toast toast-err">${err}</div>` : ''}`}
    </div>

    <div class="card card-pad section-gap">
      <div class="card-title" style=${{ marginBottom: '8px' }}>📅 Weekly check <span class="muted" style=${{ fontWeight: 400 }}>— for the Friday meeting (Mon–Sun, each week's share of the monthly target)</span></div>
      ${lastSyncDay
        ? html`<div class="tgt-weeks">${weekRow('Last week', lastWeek, true)}${weekRow('This week so far', thisWeek, false)}</div>`
        : html`<div class="muted" style=${{ fontSize: '12.5px' }}>Weekly numbers appear once the daily TikTok sync has collected a few days of data.</div>`}
    </div>

    <div class="card card-pad section-gap">
      <div class="eng-notes" style=${{ marginTop: 0 }}>
        <div class="note">📺 <strong>Views in the month</strong> — every view your account got during the month, from <em>all</em> videos (TikTok Studio → Analytics → Overview → <em>Video views</em>).</div>
        <div class="note">📈 <strong>Pace</strong> — the dashed line is where you should be each day to land exactly on target. Above it = ahead, below it = behind. A big jump is usually one breakout video.</div>
        <div class="note">📥 <strong>Numbers:</strong> day by day from the daily TikTok sync — an <em>estimate</em>, often lower than TikTok Studio. A month only counts as hit or missed once its <strong>full-month TikTok Studio figure</strong> is captured; until then it shows grey with “≈”.</div>
        <div class="note">🔁 <strong>Review every 3 months</strong> — one viral video can make a month, so judge the trend over a quarter.</div>
      </div>
    </div>

    ${editing ? html`<${TargetModal} cfg=${cfg} err=${err} onClose=${() => setEditing(false)}
      onSave=${async (next) => { if (await save({ ...targets, views: { ...cfg, ...next } })) setEditing(false); }} />` : ''}
  </div>`;
}

function weekRow(label, w, finished) {
  const fmt = (d) => `${d.getDate()} ${shortMonth(d)}`;
  const head = html`<div class="tgt-week-l">${label}<span class="muted">${fmt(w.from)} – ${fmt(w.to)}</span></div>`;
  if (!w.target) return html`<div class="tgt-week">${head}<div class="muted">No target set for these days.</div></div>`;
  if (!w.days) return html`<div class="tgt-week">${head}<div class="muted">No numbers yet.</div></div>`;
  const vs = finished ? w.target : w.expected;
  const good = w.actual >= vs;
  return html`<div class="tgt-week">
    ${head}
    <div><strong>${compact(w.actual)}</strong> <span class="muted">of ${compact(vs)} ${finished ? 'target' : `expected by now · week target ${compact(w.target)}`}</span></div>
    <span class=${'tgt-chip ' + (good ? 'tgt-hit-chip' : 'tgt-miss-chip')}>${good ? (finished ? '✅ Hit' : 'Ahead') : finished ? 'Missed' : 'Behind'} ${signed(w.actual - vs)}</span>
  </div>`;
}

function MonthTable({ months, cfg, rowEdit, setRowEdit, setErr, saveRow, resetRow }) {
  const pct = (a, t) => (a != null && t ? Math.round((a / t) * 100) : null);
  return html`<div style=${{ overflowX: 'auto' }}>
    <table class="atable">
      <thead><tr><th>Month</th><th>Target</th><th>Views</th><th>% of target</th><th>Status</th><th class="no-print"></th></tr></thead>
      <tbody>
        ${months.map((m) => {
          const editingRow = rowEdit && rowEdit.ym === m.ym;
          const p = m.needsStudio ? null : pct(m.final ? m.done : m.forecast, m.target);
          const status = m.target == null ? ['No target set', 'tgt-muted']
            : m.needsStudio ? ['Needs Studio total', 'tgt-muted']
            : m.final ? (m.done >= m.target ? ['✅ Hit', 'tgt-hit-chip'] : ['Missed', 'tgt-miss-chip'])
            : m.isCur ? ['In progress', 'tgt-cur-chip']
            : m.isPast ? ['Capture from Studio', 'tgt-muted'] : ['Upcoming', 'tgt-muted'];
          return html`<tr style=${m.isCur ? { background: '#fff7e6' } : {}}>
            <td><strong>${ymLabel(m.ym)}</strong></td>
            <td>${editingRow
              ? html`<span class="tgt-edit">
                  <input type="number" min="0" step="1000" value=${rowEdit.value} onInput=${(e) => setRowEdit({ ...rowEdit, value: e.target.value })} />
                  <button class="btn btn-sm btn-gold" onClick=${saveRow}>Save</button>
                  ${m.overridden ? html`<button class="btn btn-sm" onClick=${() => resetRow(m.ym)} title=${`Go back to the +${cfg.growthPct}% plan`}>Reset</button>` : ''}
                  <button class="btn btn-sm btn-ghost" onClick=${() => setRowEdit(null)}>Cancel</button>
                </span>`
              : m.target == null ? html`<span class="muted">—</span>`
              : html`${compact(m.target)}${m.overridden ? html` <span class="muted" title="Set by hand for this month">✱</span>` : ''}`}</td>
            <td>${m.done == null ? html`<span class="muted">—</span>`
              : m.needsStudio
              ? html`<span class="muted">≈${compact(m.done)}</span><span class="muted" style=${{ display: 'block', fontSize: '11px' }}>${m.source === 'sync' ? 'daily-sync estimate' : `Studio, 1–${m.asOfDay} only`}</span>`
              : html`${compact(m.done)}${!m.final ? html`<span class="muted" style=${{ display: 'block', fontSize: '11px' }}>to day ${m.asOfDay}</span>` : ''}`}</td>
            <td>${p != null ? html`<span style=${{ color: p >= 100 ? '#0f7a4d' : '#b4232a', fontWeight: 600 }}>${p}%${!m.final ? html`<span class="muted" style=${{ display: 'block', fontSize: '11px', fontWeight: 400 }}>forecast</span>` : ''}</span>` : html`<span class="muted">—</span>`}</td>
            <td><span class=${'tgt-chip ' + status[1]}>${status[0]}</span></td>
            <td class="no-print">${!editingRow ? html`<button class="btn btn-ghost btn-sm" title="Change this month's target" onClick=${() => { setErr(''); setRowEdit({ ym: m.ym, value: m.target != null ? m.target : '' }); }}><${Icon} name="pencil" size=${13} /></button>` : ''}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
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
      <strong>Preview:</strong> ${preview.map((x, i) => html`${i ? ' → ' : ''}${ymLabel(x.ym).split(' ')[0]} ${compact(x.v)}`)}
    </div>
  <//>`;
}

// Cumulative views through the month vs a straight target-pace line (0 → target),
// with a dotted forecast to month end. Dependency-free SVG; hover a day for numbers.
function PaceChart({ p }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 280, padL = 52, padR = 16, padT = 18, padB = 34;
  const n = p.n;
  const last = p.series.length;
  const niceMax = niceCeil(Math.max(p.target, p.forecast || 0, ...p.series) * 1.06);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (d) => padL + ((d - 1) / (n - 1)) * innerW; // d = day of month, 1..n
  const y = (v) => padT + innerH - (Math.min(v, niceMax) / niceMax) * innerH;
  const band = innerW / (n - 1);
  const paceAt = (d) => (p.target * d) / n;
  const gridVals = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);
  const pts = p.series.map((v, i) => `${x(i + 1)},${y(v)}`).join(' ');
  const area = `${x(1)},${y(0)} ${pts} ${x(last)},${y(0)}`;
  const labelDays = [1, 8, 15, 22, n];
  const mon = shortMonth(ymDate(p.ym));

  let tip = null;
  if (hover != null) {
    const d = hover;
    const lines = [`${d} ${mon}`, `Target pace  ${withThousands(Math.round(paceAt(d)))}`];
    if (d <= last) {
      const v = Math.round(p.series[d - 1]);
      const df = v - Math.round(paceAt(d));
      lines.push(`Views so far  ${withThousands(v)}`, `${df >= 0 ? 'Ahead' : 'Behind'} by ${withThousands(Math.abs(df))}`);
    } else if (p.forecast != null) {
      const s = p.series[last - 1];
      lines.push(`Forecast  ${withThousands(Math.round(s + ((p.forecast - s) * (d - last)) / (n - last)))}`);
    }
    const boxW = Math.max(...lines.map((l) => l.length)) * 6 + 18, boxH = lines.length * 14 + 10;
    let bx = x(d) + 12;
    if (bx + boxW > W - padR) bx = x(d) - boxW - 12;
    tip = { lines, boxW, boxH, bx, by: padT + 4 };
  }

  return html`<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style=${{ minWidth: '520px' }}
      role="img" aria-label="Views added up through the month against the target pace line">
      ${gridVals.map((v) => html`<g>
        <line x1=${padL} y1=${y(v)} x2=${W - padR} y2=${y(v)} stroke="#eef1f8" stroke-width="1" />
        <text x=${padL - 8} y=${y(v) + 4} text-anchor="end" font-size="11" fill="#9aa2b1">${compact(v)}</text>
      </g>`)}
      ${labelDays.map((d) => html`<text x=${x(d)} y=${H - 12} text-anchor="middle" font-size="11" fill="#9aa2b1">${d} ${mon}</text>`)}
      <line x1=${x(1)} y1=${y(paceAt(1))} x2=${x(n)} y2=${y(p.target)} stroke="#9aa2b1" stroke-width="2" stroke-dasharray="6 5" />
      <circle cx=${x(n)} cy=${y(p.target)} r="3.5" fill="#9aa2b1" />
      <text x=${x(n) - 6} y=${y(p.target) - 8} text-anchor="end" font-size="10.5" font-weight="700" fill="#6b7280">Target ${compact(p.target)}</text>
      <polygon points=${area} fill="rgba(75,87,245,.08)" />
      <polyline points=${pts} fill="none" stroke="#4b57f5" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
      ${p.forecast != null && last < n ? html`<g>
        <line x1=${x(last)} y1=${y(p.series[last - 1])} x2=${x(n)} y2=${y(p.forecast)} stroke="#4b57f5" stroke-width="2" stroke-dasharray="2 4" />
        <circle cx=${x(n)} cy=${y(p.forecast)} r="4" fill="#fff" stroke="#4b57f5" stroke-width="1.8" />
      </g>` : ''}
      <circle cx=${x(last)} cy=${y(p.series[last - 1])} r="4.5" fill="#4b57f5" stroke="#fff" stroke-width="2" />

      ${hover != null ? html`<g>
        <line x1=${x(hover)} y1=${padT} x2=${x(hover)} y2=${padT + innerH} stroke="#c7ccf7" stroke-width="1" stroke-dasharray="3 3" />
        <rect x=${tip.bx} y=${tip.by} width=${tip.boxW} height=${tip.boxH} rx="6" fill="#1f2430" opacity="0.96" />
        ${tip.lines.map((l, i) => html`<text x=${tip.bx + 9} y=${tip.by + 17 + i * 14} font-size=${i ? 10.5 : 10} font-weight=${i ? 600 : 400} fill=${i ? '#fff' : '#c7ccf7'}>${l}</text>`)}
      </g>` : ''}
      ${Array.from({ length: n }, (_, i) => html`<rect x=${x(i + 1) - band / 2} y=${padT} width=${band} height=${innerH} fill="transparent"
        style=${{ cursor: 'pointer' }} onMouseEnter=${() => setHover(i + 1)} onMouseLeave=${() => setHover(null)} />`)}
    </svg>
  </div>`;
}

// One bar per month (green hit / red missed / amber in progress) with the dashed
// target line across. A viral month far above the targets is drawn capped.
function MonthBars({ months }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 280, padL = 52, padR = 16, padT = 30, padB = 34;
  const n = months.length;
  const tgts = months.map((m) => m.target).filter((v) => v != null);
  const ref = Math.max(...tgts, 1);
  const within = (v) => v != null && v <= ref * OUTLIER_FACTOR;
  // Only this month's target is drawn, so scale to it (or to all targets when the
  // shown year doesn't include this month, e.g. next year's plan).
  const curI = months.findIndex((m) => m.isCur && m.target != null);
  const shownTargets = curI >= 0 ? [months[curI].target] : tgts;
  const niceMax = niceCeil(Math.max(...shownTargets, ...months.map((m) => m.done).filter(within), ...months.map((m) => m.forecast).filter(within), 1) * 1.08);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const slot = innerW / n;
  const cx = (i) => padL + slot * (i + 0.5);
  const y = (v) => padT + innerH - (Math.min(v, niceMax) / niceMax) * innerH;
  const bw = Math.min(46, slot * 0.56);
  const gridVals = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);
  const color = (m) => (m.done == null ? null : m.needsStudio ? '#b8bfcc' : !m.final ? '#f5b517' : m.target == null ? '#cfd6f5' : m.done >= m.target ? '#0f9d58' : '#e5484d');

  let tip = null;
  if (hover != null) {
    const m = months[hover];
    const lines = [ymLabel(m.ym)];
    if (m.target != null) lines.push(`Target  ${withThousands(m.target)}`);
    else if (m.done != null) lines.push('No target set');
    if (m.needsStudio) lines.push(`Estimate  ≈${withThousands(Math.round(m.done))}`, 'Needs the TikTok Studio total');
    else if (m.done != null) lines.push(`${m.final ? 'Views' : 'So far'}  ${withThousands(Math.round(m.done))}${m.final ? '' : ` (to day ${m.asOfDay})`}`);
    if (!m.final && m.forecast != null) lines.push(`Forecast  ${withThousands(m.forecast)}`);
    const v = m.needsStudio ? null : m.final ? m.done : m.forecast;
    if (v != null && m.target) lines.push(`${Math.round((v / m.target) * 100)}% of target${m.final ? '' : ' (forecast)'}`);
    if (m.done == null && m.isPast) lines.push('Capture this month from TikTok Studio');
    if (!m.isPast && !m.isCur) lines.push('Upcoming');
    const boxW = Math.max(...lines.map((l) => l.length)) * 6 + 18, boxH = lines.length * 14 + 10;
    let bx = cx(hover) + bw / 2 + 8;
    if (bx + boxW > W - padR) bx = cx(hover) - bw / 2 - boxW - 8;
    tip = { lines, boxW, boxH, bx, by: padT + 4 };
  }

  return html`<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style=${{ minWidth: '520px' }}
      role="img" aria-label="Monthly views against monthly targets">
      ${gridVals.map((v) => html`<g>
        <line x1=${padL} y1=${y(v)} x2=${W - padR} y2=${y(v)} stroke="#eef1f8" stroke-width="1" />
        <text x=${padL - 8} y=${y(v) + 4} text-anchor="end" font-size="11" fill="#9aa2b1">${compact(v)}</text>
      </g>`)}
      ${months.map((m, i) => {
        const c = color(m);
        return html`<g>
          ${c ? html`<rect x=${cx(i) - bw / 2} y=${y(m.done)} width=${bw} height=${Math.max(1, padT + innerH - y(m.done))} rx="4" fill=${c} opacity=${hover == null || hover === i ? 1 : 0.55} />` : ''}
          ${c && m.done > niceMax ? html`<text x=${cx(i)} y=${padT - 8} text-anchor="middle" font-size="10.5" font-weight="700" fill=${c}>${compact(m.done)} ↑</text>` : ''}
          <text x=${cx(i)} y=${H - 12} text-anchor="middle" font-size="11" fill=${m.isCur ? '#1f2430' : '#9aa2b1'} font-weight=${m.isCur ? 700 : 400}>${ymLabel(m.ym).split(' ')[0]}</text>
        </g>`;
      })}
      ${curI >= 0 ? (() => {
        const ty = y(months[curI].target), x1 = cx(curI) - slot / 2 + 3, x2 = cx(curI) + slot / 2 - 3;
        return html`<g>
          <line x1=${x1} y1=${ty} x2=${x2} y2=${ty} stroke="#1f2430" stroke-width="2" stroke-dasharray="5 3" />
          <text x=${cx(curI)} y=${ty - 7} text-anchor="middle" font-size="10.5" font-weight="700" fill="#1f2430">Target ${compact(months[curI].target)}</text>
        </g>`;
      })() : ''}
      ${hover != null ? html`<g>
        <rect x=${tip.bx} y=${tip.by} width=${tip.boxW} height=${tip.boxH} rx="6" fill="#1f2430" opacity="0.96" />
        ${tip.lines.map((l, i) => html`<text x=${tip.bx + 9} y=${tip.by + 17 + i * 14} font-size=${i ? 10.5 : 10} font-weight=${i ? 600 : 400} fill=${i ? '#fff' : '#c7ccf7'}>${l}</text>`)}
      </g>` : ''}
      ${months.map((m, i) => html`<rect x=${cx(i) - slot / 2} y=${padT} width=${slot} height=${innerH} fill="transparent"
        style=${{ cursor: 'pointer' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
    </svg>
  </div>`;
}

// Round an axis maximum up to a tidy number.
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => norm <= s);
  return step * mag;
}
