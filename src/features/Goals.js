import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../components/ui.js';
import { readKV, writeKV } from '../lib/kv.js';
import { engagementOf, followerSeries, withThousands } from '../lib/metrics.js';
import { startOfMonth, startOfDay, parse, shortDate } from '../lib/date.js';
import { readTargets, targetFor } from './Targets.js';

// Goals with pace: are we ahead of or behind where we should be? Goals are set per
// month; the card measures them over whatever period it's given (the Monthly
// Report's selected range), scaling the targets when the period isn't a month.
// Stored in app_kv `serigama.goals`. The VIEWS target is not set here: it lives on
// the Targets page (views in the month), so there's one views target, not two.
const KEY = 'serigama.goals';
const DAY = 86400000;
const AVG_MONTH_DAYS = 30.44;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function readGoals() {
  return readKV(KEY, {}) || {};
}

const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

// The window goals are measured over, from a selected {from, to} (Dates or null):
// - no range (all time) -> the current month;
// - starts on the 1st and ends in the same month ("This month", "September",
//   1–30 Sep) -> that whole month, so the full monthly goal applies;
// - anything else -> exactly those days, with monthly goals scaled to its length.
export function goalWindow(from, to, now = new Date()) {
  if (!from) { from = startOfMonth(now); to = now; }
  to = to || now;
  const monthEnd = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  const wholeMonth = from.getDate() === 1 && to.getFullYear() === from.getFullYear() && to.getMonth() === from.getMonth();
  const start = startOfDay(from);
  const end = endOfDay(wholeMonth ? monthEnd : to);
  const days = Math.max(1, Math.round((end - start) / DAY));
  // Days gone so far, counting today in full (a finished period = all of it).
  const gone = now < start ? 0 : Math.min(days, Math.floor((Math.min(now, end) - start) / DAY) + 1);
  return {
    start, end, days, wholeMonth,
    scale: wholeMonth ? 1 : days / AVG_MONTH_DAYS,
    elapsed: gone / days,
    dayNo: gone,
    finished: now > end,
    label: wholeMonth ? `${MONTHS[start.getMonth()]} ${start.getFullYear()}` : `${shortDate(start)} – ${shortDate(end)}`,
  };
}

// Actuals inside a window: posts published in it, their views/engagement, and
// net followers (Studio's monthly figure for a whole month, else daily snapshots).
export function windowActuals(contents, accountStats, w) {
  let views = 0, eng = 0, posts = 0;
  for (const c of contents || []) {
    if (c.status !== 'published') continue;
    const d = parse(c.published_at);
    if (!d || d < w.start || d > w.end) continue;
    posts++;
    if (c.metrics) { views += Number(c.metrics.views) || 0; eng += engagementOf(c.metrics); }
  }
  let followers = null;
  if (w.wholeMonth) {
    const ym = `${w.start.getFullYear()}-${String(w.start.getMonth() + 1).padStart(2, '0')}`;
    const mfoll = readKV('serigama.monthlyfollowers', null);
    if (mfoll && mfoll[ym] != null) followers = Number(mfoll[ym]);
  }
  if (followers == null) {
    const pts = followerSeries(accountStats).filter((p) => { const d = parse(p.day); return d >= w.start && d <= w.end; });
    if (pts.length >= 2) followers = pts[pts.length - 1].followers - pts[0].followers;
  }
  return { views, posts, followers, er: views ? Math.round((eng / views) * 1000) / 10 : null };
}

// `period` = { from, to } Dates from the page's range picker (omit for this month).
// `actuals` = the page's own figures for that range ({ views, posts, er, followers });
// any given (non-null) value replaces ours, so the card always agrees with the page.
export function GoalsCard({ contents, accountStats, period, actuals, onNavigate }) {
  const [goals, setGoals] = useState(readGoals);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState('');

  const now = new Date();
  const w = goalWindow(period && period.from, period && period.to, now);
  const act = windowActuals(contents, accountStats, w);
  for (const [k, v] of Object.entries(actuals || {})) if (v != null) act[k] = v;
  const target = (monthly) => (monthly ? Math.round(monthly * w.scale) : 0);
  const postsTarget = goals.postsPerWeek ? Math.round((goals.postsPerWeek * w.days) / 7) : 0;
  const when = w.wholeMonth ? 'this month' : 'this period';

  // The views target for this month comes from the Targets page.
  const ymOfWin = `${w.start.getFullYear()}-${String(w.start.getMonth() + 1).padStart(2, '0')}`;
  const viewsTarget = w.wholeMonth ? targetFor(readTargets().views, ymOfWin) : null;
  const rows = [
    { key: 'posts', label: 'Posts published', target: postsTarget, cur: act.posts, fmt: String, pace: true,
      note: goals.postsPerWeek ? `${goals.postsPerWeek} / week` : '' },
    { key: 'followers', label: 'New followers', target: target(goals.followers), cur: act.followers, fmt: (n) => (n < 0 ? '' : '+') + withThousands(n), pace: true,
      empty: `No follower figure for ${when} yet — it appears after a Studio capture or daily sync.` },
    { key: 'er', label: 'Engagement rate', target: goals.er, cur: act.er, fmt: (n) => n + '%', pace: false,
      empty: `No published posts with numbers ${when}.` },
  ];
  const anySet = rows.some((r) => r.target);

  const startEdit = () => {
    setDraft({ postsPerWeek: goals.postsPerWeek || '', followers: goals.followers || '', er: goals.er || '' });
    setErr('');
    setEditing(true);
  };
  const save = async () => {
    const num = (v, dec) => Math.max(0, dec ? Math.round((Number(v) || 0) * 10) / 10 : Math.round(Number(v) || 0));
    const next = { postsPerWeek: num(draft.postsPerWeek, true), followers: num(draft.followers), er: num(draft.er, true) };
    try {
      await writeKV(KEY, next);
      setGoals(next);
      setEditing(false);
    } catch (e) {
      setErr('Could not save to the cloud — check your connection and try again.');
    }
  };
  const dset = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div class="card-title"><${Icon} name="target" size=${15} /> Goals <span class="muted" style=${{ fontWeight: 400 }}>— ${w.label}${w.finished ? ' (finished)' : w.dayNo ? `, day ${w.dayNo} of ${w.days}` : ' (not started)'}${w.wholeMonth ? '' : ` · monthly goals scaled to ${w.days} ${w.days === 1 ? 'day' : 'days'}`}</span></div>
      ${editing ? '' : html`<button class="btn btn-sm no-print" onClick=${startEdit}>${anySet ? 'Edit goals' : 'Set goals'}</button>`}
    </div>

    ${editing
      ? html`<div class="goal-edit">
          <div class="field"><label>Posts per week</label><input type="number" min="0" step="0.5" value=${draft.postsPerWeek} onInput=${dset('postsPerWeek')} placeholder="e.g. 5" /></div>
          <div class="field"><label>New followers this month</label><input type="number" min="0" value=${draft.followers} onInput=${dset('followers')} placeholder="e.g. 2000" /></div>
          <div class="field"><label>Engagement rate (%)</label><input type="number" min="0" step="0.1" value=${draft.er} onInput=${dset('er')} placeholder="e.g. 6" /></div>
          ${err ? html`<div class="toast toast-err" style=${{ gridColumn: '1 / -1' }}>${err}</div>` : ''}
          <div style=${{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <span class="muted" style=${{ fontSize: '12px', marginRight: 'auto', alignSelf: 'center' }}>Leave a box empty to skip that goal.</span>
            <button class="btn btn-sm" onClick=${() => setEditing(false)}>Cancel</button>
            <button class="btn btn-sm btn-gold" onClick=${save}>Save goals</button>
          </div>
        </div>`
      : !anySet
      ? html`<p class="muted" style=${{ fontSize: '12.5px', marginTop: '8px', marginBottom: 0 }}>Set monthly goals for posting, followers and engagement — each bar shows how you're doing vs. where you should be by today.</p>`
      : html`<div class="goal-grid">
          ${rows.filter((r) => r.target).map((r) => {
            const cur = r.cur;
            if (cur == null) {
              return html`<div class="goal">
                <div class="goal-head"><span>${r.label}</span><span class="muted">target ${r.fmt(r.target)}</span></div>
                <div class="muted" style=${{ fontSize: '12px', marginTop: '6px' }}>${r.empty}</div>
              </div>`;
            }
            const pct = Math.max(0, Math.min(100, Math.round((cur / r.target) * 100)));
            const live = r.pace && !w.finished && w.elapsed < 1; // still running: judge by pace
            const onTrack = live ? cur >= r.target * w.elapsed : cur >= r.target;
            const projected = live && w.elapsed ? Math.round(cur / w.elapsed) : null;
            return html`<div class="goal">
              <div class="goal-head">
                <span>${r.label}${r.note ? html` <span class="muted" style=${{ fontWeight: 400 }}>(${r.note})</span>` : ''}</span>
                <span style=${{ color: onTrack ? '#0f7a4d' : '#b4232a', fontWeight: 600 }}>${live ? (onTrack ? 'On track' : 'Behind pace') : (onTrack ? 'Goal met' : 'Below goal')}</span>
              </div>
              <div class="goal-num"><strong>${r.fmt(cur)}</strong> <span class="muted">of ${r.fmt(r.target)}</span></div>
              <div class="progress"><i style=${{ width: Math.max(2, pct) + '%', background: onTrack ? 'var(--green)' : 'var(--amber)' }}></i></div>
              <div class="muted" style=${{ fontSize: '11.5px', marginTop: '5px' }}>
                ${!r.pace
                  ? `${cur >= r.target ? '▲' : '▼'} ${Math.abs(Math.round((cur - r.target) * 10) / 10)} pts vs goal`
                  : live
                  ? `At this pace: ~${r.fmt(projected)} by the end of ${w.wholeMonth ? 'the month' : 'the period'}`
                  : `${Math.round((cur / r.target) * 100)}% of goal${w.finished ? ' — final' : ''}`}
              </div>
            </div>`;
          })}
        </div>`}
    <div class="goal-views-link">
      <span>📺 <strong>Views target</strong>${viewsTarget != null
        ? html` for ${w.label}: <strong>${withThousands(viewsTarget)}</strong> views in the month`
        : w.wholeMonth ? ` — none set for ${w.label}` : ' — set per month'} · tracked on the Targets page.</span>
      ${onNavigate ? html`<button class="btn btn-sm btn-ghost no-print" onClick=${() => onNavigate('targets')}>Open Targets →</button>` : ''}
    </div>
  </div>`;
}
