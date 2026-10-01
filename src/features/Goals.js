import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../components/ui.js';
import { readKV, writeKV } from '../lib/kv.js';
import { engagementOf, followerGrowth, withThousands } from '../lib/metrics.js';
import { startOfMonth, parse } from '../lib/date.js';

// Monthly goals with pace: are we ahead of or behind where we should be today?
// Stored in app_kv `serigama.goals`. The views goal is also mirrored to the older
// `serigama.goal.views` key so nothing that still reads it breaks.
const KEY = 'serigama.goals';
const LEGACY_VIEWS_KEY = 'serigama.goal.views';

export function readGoals() {
  const g = readKV(KEY, {}) || {};
  if (!g.views) g.views = Number(readKV(LEGACY_VIEWS_KEY, 0)) || 0;
  return g;
}

// This month's actuals for each goal. Exported so saved reports can reuse it.
export function monthActuals(contents, accountStats, now = new Date()) {
  const start = startOfMonth(now);
  let views = 0, eng = 0, posts = 0;
  for (const c of contents || []) {
    if (c.status !== 'published') continue;
    const d = parse(c.published_at);
    if (!d || d < start) continue;
    posts++;
    if (c.metrics) { views += Number(c.metrics.views) || 0; eng += engagementOf(c.metrics); }
  }
  // Followers: the Studio-captured monthly figure wins; otherwise the daily snapshots.
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mfoll = readKV('serigama.monthlyfollowers', null);
  let followers = mfoll && mfoll[ym] != null ? Number(mfoll[ym]) : null;
  if (followers == null) {
    const fg = followerGrowth(accountStats, { from: start, to: now });
    if (fg && fg.days >= 2) followers = fg.gained;
  }
  return { views, posts, followers, er: views ? Math.round((eng / views) * 1000) / 10 : null };
}

export function GoalsCard({ contents, accountStats }) {
  const [goals, setGoals] = useState(readGoals);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState('');

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate() / daysInMonth;
  const act = monthActuals(contents, accountStats, now);
  const postsTarget = goals.postsPerWeek ? Math.round((goals.postsPerWeek * daysInMonth) / 7) : 0;

  const rows = [
    { key: 'views', label: 'Views', target: goals.views, cur: act.views, fmt: withThousands, pace: true },
    { key: 'posts', label: 'Posts published', target: postsTarget, cur: act.posts, fmt: String, pace: true,
      note: goals.postsPerWeek ? `${goals.postsPerWeek} / week` : '' },
    { key: 'followers', label: 'New followers', target: goals.followers, cur: act.followers, fmt: (n) => (n < 0 ? '' : '+') + withThousands(n), pace: true,
      empty: 'No follower figure for this month yet — it appears after the next Studio capture or daily sync.' },
    { key: 'er', label: 'Engagement rate', target: goals.er, cur: act.er, fmt: (n) => n + '%', pace: false,
      empty: 'No published posts with numbers this month yet.' },
  ];
  const anySet = rows.some((r) => r.target);

  const startEdit = () => {
    setDraft({ views: goals.views || '', postsPerWeek: goals.postsPerWeek || '', followers: goals.followers || '', er: goals.er || '' });
    setErr('');
    setEditing(true);
  };
  const save = async () => {
    const num = (v, dec) => Math.max(0, dec ? Math.round((Number(v) || 0) * 10) / 10 : Math.round(Number(v) || 0));
    const next = { views: num(draft.views), postsPerWeek: num(draft.postsPerWeek, true), followers: num(draft.followers), er: num(draft.er, true) };
    try {
      await writeKV(KEY, next);
      await writeKV(LEGACY_VIEWS_KEY, next.views);
      setGoals(next);
      setEditing(false);
    } catch (e) {
      setErr('Could not save to the cloud — check your connection and try again.');
    }
  };
  const dset = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div class="card-title"><${Icon} name="target" size=${15} /> Monthly goals <span class="muted" style=${{ fontWeight: 400 }}>— ${now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}, day ${now.getDate()} of ${daysInMonth}</span></div>
      ${editing ? '' : html`<button class="btn btn-sm no-print" onClick=${startEdit}>${anySet ? 'Edit goals' : 'Set goals'}</button>`}
    </div>

    ${editing
      ? html`<div class="goal-edit">
          <div class="field"><label>Views this month</label><input type="number" min="0" value=${draft.views} onInput=${dset('views')} placeholder="e.g. 500000" /></div>
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
      ? html`<p class="muted" style=${{ fontSize: '12.5px', marginTop: '8px', marginBottom: 0 }}>Set monthly targets for views, posting, followers and engagement — each bar shows how you're doing vs. where you should be by today.</p>`
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
            const onTrack = r.pace ? cur >= r.target * elapsed : cur >= r.target;
            const projected = r.pace && elapsed ? Math.round(cur / elapsed) : null;
            return html`<div class="goal">
              <div class="goal-head">
                <span>${r.label}${r.note ? html` <span class="muted" style=${{ fontWeight: 400 }}>(${r.note})</span>` : ''}</span>
                <span style=${{ color: onTrack ? '#0f7a4d' : '#b4232a', fontWeight: 600 }}>${onTrack ? (r.pace ? 'On track' : 'Hitting it') : (r.pace ? 'Behind pace' : 'Below target')}</span>
              </div>
              <div class="goal-num"><strong>${r.fmt(cur)}</strong> <span class="muted">of ${r.fmt(r.target)}</span></div>
              <div class="progress"><i style=${{ width: Math.max(2, pct) + '%', background: onTrack ? 'var(--green)' : 'var(--amber)' }}></i></div>
              <div class="muted" style=${{ fontSize: '11.5px', marginTop: '5px' }}>
                ${r.pace ? `At this pace: ~${r.fmt(projected)} by month end` : `${cur >= r.target ? '▲' : '▼'} ${Math.abs(Math.round((cur - r.target) * 10) / 10)} pts vs target`}
              </div>
            </div>`;
          })}
        </div>`}
  </div>`;
}
