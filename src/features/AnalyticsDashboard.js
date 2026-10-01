import { html } from '../lib/html.js';
import { useRemembered } from '../lib/remember.js';
import { useState } from 'preact/hooks';
import { Icon, Empty } from '../components/ui.js';
import { analytics, compact, withThousands, erOf, breakdownBy } from '../lib/metrics.js';
import { GoalsCard } from './Goals.js';
import { readKV, updateKVEntry } from '../lib/kv.js';
import { startOfDay, startOfMonth, addDays, dayKey, parse, shortDate } from '../lib/date.js';

const REPORTS_KEY = 'serigama.reports'; // app_kv map: report id -> saved snapshot

// "Malaysia" -> "Malaysian women"; unknown countries fall back to "women in X".
const DEMONYMS = { Malaysia: 'Malaysian', Singapore: 'Singaporean', Indonesia: 'Indonesian', Brunei: 'Bruneian', Thailand: 'Thai', Philippines: 'Filipino' };
const womenOf = (country) => (DEMONYMS[country] ? `${DEMONYMS[country]} women` : `women in ${country}`);

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PRESETS = [
  { key: '7', label: 'Last 7 days' },
  { key: '28', label: 'Last 28 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

// The 12 months before this one, newest first, as "m:YYYY-MM" range keys.
function pastMonths(now) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    return { key: `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}` };
  });
}

// "YYYY-MM-DD" -> local midnight (new Date('YYYY-MM-DD') would be UTC midnight).
const localDay = (k) => { if (!k) return null; const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

function rangeFor(key, now) {
  const to = dayKey(now);
  if (key.startsWith('m:')) {
    const [y, m] = key.slice(2).split('-').map(Number);
    return { from: dayKey(new Date(y, m - 1, 1)), to: dayKey(new Date(y, m, 0)), label: MONTHS_FULL[m - 1] + ' ' + y };
  }
  if (key === '7') return { from: dayKey(addDays(startOfDay(now), -6)), to, label: 'Last 7 days' };
  if (key === '28') return { from: dayKey(addDays(startOfDay(now), -27)), to, label: 'Last 28 days' };
  if (key === '90') return { from: dayKey(addDays(startOfDay(now), -89)), to, label: 'Last 90 days' };
  if (key === 'month') return { from: dayKey(startOfMonth(now)), to, label: MONTHS_FULL[now.getMonth()] + ' ' + now.getFullYear() };
  if (key === 'year') return { from: dayKey(new Date(now.getFullYear(), 0, 1)), to, label: String(now.getFullYear()) };
  return { from: '', to: '', label: 'All time' };
}

// Clean, single-screen executive board. Every number follows the chosen time range
// (preset or custom dates); audience + best-month highlights come from Studio captures.
export function AnalyticsDashboard({ contents, accountStats, onNavigate, onRefresh }) {
  const now = new Date();
  const monthDefault = rangeFor('month', now);
  const [rangeKey, setRangeKey] = useRemembered('report.range', 'month');
  const [cFrom, setCFrom] = useRemembered('report.from', monthDefault.from);
  const [cTo, setCTo] = useRemembered('report.to', monthDefault.to);
  const [viewing, setViewing] = useState(null); // a saved report being shown
  const [reports, setReports] = useState(() => readKV(REPORTS_KEY, {}) || {});
  const [saveMsg, setSaveMsg] = useState(null);

  const r = rangeKey === 'custom'
    ? { from: cFrom || '', to: cTo || dayKey(now), label: cFrom && cTo ? `${shortDate(cFrom)} – ${shortDate(cTo)}` : (cFrom ? `since ${shortDate(cFrom)}` : 'Custom range') }
    : rangeFor(rangeKey, now);

  const at = (from, to) => analytics(contents, { account_id: 'all', platform: 'all', from, to }, accountStats || []);
  const a = at(r.from, r.to);

  // Previous equal-length period, for the ▲/▼ "vs prev" comparison (bounded ranges only).
  let cmp = null;
  if (r.from && r.to) {
    const fromD = parse(r.from), toD = parse(r.to);
    if (fromD && toD && toD >= fromD) {
      const len = toD - fromD;
      const prevTo = new Date(fromD.getTime() - 86400000);
      const prevFrom = new Date(prevTo.getTime() - len);
      const pa = at(dayKey(prevFrom), dayKey(prevTo));
      cmp = { views: pa.totalViews, eng: pa.totalEngagement, posts: pa.publishedCount };
    }
  }
  const pctChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const deltaChip = (cur, prev, isCount) => {
    if (prev == null) return '';
    const d = isCount ? cur - prev : pctChange(cur, prev);
    if (d == null) return '';
    const color = d > 0 ? '#0f7a4d' : d < 0 ? '#b4232a' : 'var(--muted)';
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '±';
    return html`<span style=${{ color, fontWeight: 600, fontSize: '11.5px' }}>${arrow} ${isCount ? Math.abs(d) : Math.abs(d) + '%'} <span class="muted" style=${{ fontWeight: 400 }}>vs prev</span></span>`;
  };
  let aud = null, mfoll = null, ts = null;
  try { aud = JSON.parse(localStorage.getItem('serigama.audience') || 'null'); } catch (e) { aud = null; }
  try { mfoll = JSON.parse(localStorage.getItem('serigama.monthlyfollowers') || 'null'); } catch (e) { mfoll = null; }
  try { const mm = JSON.parse(localStorage.getItem('serigama.monthly') || 'null'); ts = mm && mm.trafficSourceOverall ? mm.trafficSourceOverall : null; } catch (e) { ts = null; }

  const follDeltaPct = aud ? (rangeKey === '7' ? aud.net7dChangePct : rangeKey === '28' ? aud.net28dChangePct : null) : null;
  const followers = (aud && aud.totalFollowers) || (a.followerGrowth && a.followerGrowth.current) || 0;
  // All-time total views — the traffic-source split is an overall Studio snapshot,
  // so its real view counts are computed against every published video, not the range.
  const allViews = (contents || []).filter((c) => c.status === 'published' && c.metrics).reduce((s, c) => s + (Number(c.metrics.views) || 0), 0);
  const views = (c) => Number(c.metrics && c.metrics.views) || 0;
  const sorted = [...a.published].sort((x, y) => views(y) - views(x));
  const top3 = sorted.slice(0, 3);
  const avgPer = a.publishedCount ? Math.round(a.totalViews / a.publishedCount) : 0;
  const erWord = a.avgER >= 6 ? 'strong' : a.avgER >= 3 ? 'solid for TikTok' : a.avgER > 0 ? 'below the 3–6% norm' : '';

  // posting cadence within the range
  const dates = a.published.map((c) => parse(c.published_at)).filter(Boolean).sort((x, y) => x - y);
  const span = dates.length >= 2 ? Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 86400000)) : 0;
  const perWeek = span ? Math.round((dates.length / (span / 7)) * 10) / 10 : dates.length;

  const follInRange = (() => {
    if (rangeKey === '7') return aud ? aud.net7d : null;
    if (rangeKey === '28') return aud ? aud.net28d : null;
    if (!mfoll) return null;
    const fromD = r.from ? parse(r.from) : new Date(2000, 0, 1);
    const toD = r.to ? parse(r.to) : now;
    const fromMonth = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    const toMonth = new Date(toD.getFullYear(), toD.getMonth(), 1);
    let sum = 0, any = false;
    for (const [k, v] of Object.entries(mfoll)) {
      const [y, m] = k.split('-');
      const md = new Date(Number(y), Number(m) - 1, 1);
      if (md >= fromMonth && md <= toMonth) { sum += Number(v); any = true; }
    }
    return any ? sum : null;
  })();

  let bestFollMonth = null;
  if (mfoll) { const e = Object.entries(mfoll).map(([k, v]) => [k, Number(v)]).sort((x, y) => y[1] - x[1])[0]; if (e) bestFollMonth = { m: MONTHS_FULL[Number(e[0].split('-')[1]) - 1], net: e[1] }; }

  // Views in the month (TikTok Studio's monthly figure) for the selected range —
  // only when it covers whole calendar month(s), or this month so far, since
  // Studio's numbers are per month. Same source as the Targets page.
  const vim = (() => {
    if (!r.from || !r.to) return null;
    const studioMonths = (readKV('serigama.monthly', {}) || {}).months || {};
    const f = localDay(r.from), t = localDay(r.to);
    if (f.getDate() !== 1) return null;
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let sum = 0, partial = null;
    for (let d = new Date(f); d <= t; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      if (monthEnd > t && ym !== curYm) return null; // range stops mid-month
      const m = studioMonths[ym];
      const name = MONTHS_FULL[d.getMonth()];
      if (!m) return { missing: name };
      sum += Number(m.views) || 0;
      if (!m.complete) partial = `${name} 1–${m.days}`;
    }
    return { sum, partial };
  })();

  // Freeze the current numbers so this period can be revisited later, exactly as presented.
  const saveReport = async () => {
    const id = 'r' + Date.now().toString(36);
    const snap = {
      id,
      savedAt: new Date().toISOString(),
      label: r.label,
      from: r.from,
      to: r.to,
      stats: { viewsInMonth: vim && vim.sum != null && !vim.partial ? vim.sum : null, views: a.totalViews, engagement: a.totalEngagement, er: a.avgER, posts: a.publishedCount, perWeek, avgPer, followers, follInRange },
      top: top3.map((c) => ({ title: c.title || '(untitled)', views: views(c), er: Math.round(erOf(c.metrics) * 10) / 10, url: c.post_url || '' })),
      funnel: breakdownBy(a.published, 'funnel_stage').map(({ label, posts, views: v, avgViews, er }) => ({ label, posts, views: v, avgViews, er })),
      pillar: breakdownBy(a.published, 'pillar').map(({ label, posts, views: v, avgViews, er }) => ({ label, posts, views: v, avgViews, er })),
      comparePct: cmp && cmp.views ? pctChange(a.totalViews, cmp.views) : null,
    };
    try {
      setReports(await updateKVEntry(REPORTS_KEY, id, snap));
      setSaveMsg({ ok: true, text: `Saved “${r.label}” — find it under Saved reports at the bottom of this page.` });
    } catch (e) {
      setSaveMsg({ ok: false, text: 'Could not save the report to the cloud — check your connection and try again.' });
    }
    setTimeout(() => setSaveMsg(null), 5000);
  };
  const deleteReport = async (id) => {
    if (!confirm('Delete this saved report?')) return;
    try { setReports(await updateKVEntry(REPORTS_KEY, id, null)); setViewing(null); }
    catch (e) { alert('Could not delete — check your connection and try again.'); }
  };

  // Carry the selected period over, so Post Performance opens on the same dates.
  const PP_PRESETS = ['7', '28', '90', 'month', 'all'];
  const openPostPerformance = () => {
    const q = new URLSearchParams({ from: r.from || '', to: r.to || '', preset: PP_PRESETS.includes(rangeKey) ? rangeKey : 'custom' });
    onNavigate('analytics?' + q.toString());
  };

  if (viewing) return html`<${ReportView} rep=${viewing} onBack=${() => setViewing(null)} onDelete=${() => deleteReport(viewing.id)} />`;

  const clip = (t) => { t = (t || '(untitled)').trim(); return t.length > 42 ? t.slice(0, 42) + '…' : t; };

  const stat = (icon, label, value, sub, delta, accent) => html`<div style=${{ background: accent ? '#f4fbf7' : '#fafbfd', border: '1px solid ' + (accent ? '#cdeddd' : 'var(--border)'), borderRadius: '12px', padding: '16px 18px' }}>
    <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '9px' }}>${icon}<span>${label}</span></div>
    <div style=${{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.02 }}>${value}</div>
    <div class="muted" style=${{ fontSize: '12px', marginTop: '5px' }}>${sub}</div>
    ${delta ? html`<div style=${{ marginTop: '6px' }}>${delta}</div>` : ''}
  </div>`;

  const highlight = (label, title, sub) => html`<div style=${{ border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px' }}>
    <div style=${{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '5px' }}>${label}</div>
    <div style=${{ fontSize: '13.5px', fontWeight: 600 }}>${title}</div>
    <div class="muted" style=${{ fontSize: '12px', marginTop: '2px' }}>${sub}</div>
  </div>`;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Report</div>
        <h1 class="page-title">Monthly Report</h1>
        <div class="page-sub">A one-glance summary of your TikTok performance — <strong>${r.label}</strong></div>
      </div>
      <div class="page-actions">
        <button class="btn" onClick=${onRefresh}><${Icon} name="refresh" size=${15} /> Refresh</button>
        <button class="btn" onClick=${openPostPerformance} title=${'Open Post Performance for ' + r.label}><${Icon} name="analytics" size=${15} /> Post performance</button>
        <button class="btn" onClick=${() => window.print()}><${Icon} name="print" size=${15} /> Print / PDF</button>
        <button class="btn btn-gold" onClick=${saveReport} disabled=${a.publishedCount === 0}><${Icon} name="save" size=${15} /> Save this report</button>
      </div>
    </div>
    ${saveMsg ? html`<div class=${'toast no-print' + (saveMsg.ok ? '' : ' toast-err')} style=${{ marginBottom: '14px' }}>${saveMsg.text}</div>` : ''}

    <div class="card card-pad">
      <div style=${{ display: 'flex', alignItems: 'flex-end', gap: '18px', flexWrap: 'wrap' }}>
        <div class="field" style=${{ minWidth: '170px' }}>
          <label>Time range</label>
          <select value=${rangeKey} onChange=${(e) => { const k = e.target.value; setRangeKey(k); if (k === 'all') { setCFrom(''); setCTo(''); } else if (k !== 'custom') { const rr = rangeFor(k, now); setCFrom(rr.from); setCTo(rr.to); } }}>
            ${PRESETS.map((p) => html`<option value=${p.key}>${p.label}</option>`)}
            <optgroup label="Pick a month">
              ${pastMonths(now).map((p) => html`<option value=${p.key}>${p.label}</option>`)}
            </optgroup>
            <option value="custom">Custom range…</option>
          </select>
        </div>
        <div class="field">
          <label>Or pick custom dates</label>
          <div style=${{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="date" value=${cFrom} onInput=${(e) => { setCFrom(e.target.value); setRangeKey('custom'); }} />
            <span class="muted">→</span>
            <input type="date" value=${cTo} onInput=${(e) => { setCTo(e.target.value); setRangeKey('custom'); }} />
          </div>
        </div>
        <div class="field">
          <label style=${{ visibility: 'hidden' }}>Clear</label>
          <button class="btn" onClick=${() => { setRangeKey('all'); setCFrom(''); setCTo(''); }}>Clear</button>
        </div>
      </div>
    </div>

    <${GoalsCard} contents=${contents} accountStats=${accountStats}
      period=${r.from ? { from: localDay(r.from), to: localDay(r.to) } : null}
      actuals=${r.from ? { posts: a.publishedCount, er: a.publishedCount ? a.avgER : null, followers: follInRange } : null}
      onNavigate=${onNavigate} />

    ${a.publishedCount === 0
      ? html`<div class="card card-pad section-gap"><${Empty} title="No posts in this range">Pick a wider time range, or connect TikTok to pull metrics.</${Empty}></div>`
      : html`
        <div class="section-gap" style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          ${stat('📺', 'Views in the month', vim && vim.sum != null ? compact(vim.sum) : '—',
            !vim ? 'pick a whole month to see this' : vim.missing ? `${vim.missing} not captured from TikTok Studio yet` : vim.partial ? `TikTok Studio · ${vim.partial} only` : 'TikTok Studio — same number as Targets')}
          ${stat('👁', 'Views of posts published', compact(a.totalViews), rangeKey === 'all' ? 'all-time, all videos' : 'all-time views of the posts published in this range', deltaChip(a.totalViews, cmp && cmp.views))}
          ${stat('💬', 'Engagement', compact(a.totalEngagement), `${a.avgER}% avg. rate${erWord ? ' — ' + erWord : ''}`, deltaChip(a.totalEngagement, cmp && cmp.eng))}
          ${stat('👥', 'Followers', withThousands(followers), follInRange != null ? `+${withThousands(follInRange)} gained (${r.label.toLowerCase()})` : 'current total', follDeltaPct != null ? html`<span style=${{ color: follDeltaPct >= 0 ? '#0f7a4d' : '#b4232a', fontWeight: 600, fontSize: '11.5px' }}>${follDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(follDeltaPct)}% <span class="muted" style=${{ fontWeight: 400 }}>vs prev</span></span>` : '')}
          ${stat('🎬', 'Posts published', withThousands(a.publishedCount), `~${perWeek} / week · ${compact(avgPer)} avg views`, deltaChip(a.publishedCount, cmp && cmp.posts, true))}
        </div>

        ${ts ? (() => {
          const NAMES = { 'For You': 'For You feed', 'Personal profile': 'Your profile', 'Search': 'Search', 'Following': 'Following feed', 'Sound': 'Sound', 'Other': 'Other' };
          const rows2 = Object.entries(ts).map(([k, v]) => [k, Number(v)]).sort((x, y) => y[1] - x[1]);
          const fy = Number(ts['For You'] || 0);
          const prof = Number(ts['Personal profile'] || 0);
          return html`<div class="card card-pad section-gap">
            <div class="card-title" style=${{ fontSize: '13px', marginBottom: '3px' }}>📡 Where your views come from <span class="muted" style=${{ fontWeight: 400 }}>(traffic source — account overall)</span></div>
            <p class="muted" style=${{ fontSize: '11.5px', marginTop: 0, marginBottom: '11px' }}>How people find your videos. A high <strong>For You</strong> share means the algorithm is pushing you to <em>new</em> people. <strong>Note:</strong> TikTok gives this as one account-level figure, so it stays the same whatever time range you pick above.</p>
            ${rows2.map(([k, v]) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', padding: '3.5px 0' }}>
              <span style=${{ width: '110px', flex: '0 0 auto' }}>${NAMES[k] || k}</span>
              <div style=${{ flex: 1, height: '8px', background: 'var(--border-2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style=${{ width: Math.min(100, v) + '%', height: '100%', background: k === 'For You' ? '#0f7a4d' : '#0ea5e9', borderRadius: '4px' }}></div>
              </div>
              <strong style=${{ width: '46px', flex: '0 0 auto', textAlign: 'right' }}>${v}%</strong>
              <span class="muted" style=${{ width: '66px', flex: '0 0 auto', textAlign: 'right', fontSize: '11px' }}>~${compact(Math.round((v / 100) * allViews))}</span>
            </div>`)}
            <div class="eng-notes" style=${{ marginTop: '10px', borderLeft: '3px solid var(--gold-strong)' }}>
              <div class="note"><strong>${fy}% comes from the For You feed</strong> — the algorithm is doing the reaching, putting you in front of new people. Only <strong>${prof}%</strong> is your existing profile visitors. ${fy >= 70 ? 'Healthy — your growth depends on strangers finding you, exactly what you want.' : 'A bigger For You share would mean more reach to new audiences.'}</div>
            </div>
          </div>`;
        })() : ''}

        <div class="section-gap" style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '14px' }}>
          ${bestFollMonth ? highlight('🚀 Best month for follows', bestFollMonth.m, '+' + withThousands(bestFollMonth.net) + ' followers') : ''}
          ${aud ? (() => {
            const cf = (pct) => withThousands(Math.round((pct / 100) * followers));
            const g = aud.gender[0], age = aud.age[0].pct + aud.age[1].pct, loc = aud.locations[0];
            const mut = { fontWeight: 400, fontSize: '11.5px' };
            return html`<div style=${{ border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px' }}>
              <div style=${{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>👤 Who follows you <span style=${{ fontWeight: 400 }}>(of ${withThousands(followers)})</span></div>
              <div style=${{ fontSize: '13px', fontWeight: 600, lineHeight: 1.65 }}>
                ${g.pct}% women <span class="muted" style=${mut}>≈ ${cf(g.pct)}</span><br/>
                ${age.toFixed(0)}% aged 25–44 <span class="muted" style=${mut}>≈ ${cf(age)}</span><br/>
                ${loc.pct}% in ${loc.name} <span class="muted" style=${mut}>≈ ${cf(loc.pct)}</span>
              </div>
            </div>`;
          })() : ''}
          ${highlight('📅 Posting cadence', `~${perWeek} posts / week`, `${a.publishedCount} posts in ${r.label.toLowerCase()}`)}
        </div>

        <${BreakdownCard} published=${a.published} />

        <div class="card card-pad section-gap" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📝 The story</div>
          <div class="note">In <strong>${r.label.toLowerCase()}</strong>, ${a.publishedCount} ${a.publishedCount === 1 ? 'post' : 'posts'} earned <strong>${compact(a.totalViews)} views</strong> at <strong>${a.avgER}%</strong> engagement${erWord ? ' (' + erWord + ')' : ''}${cmp && cmp.views ? html` — <strong>${pctChange(a.totalViews, cmp.views) >= 0 ? 'up' : 'down'} ${Math.abs(pctChange(a.totalViews, cmp.views) || 0)}%</strong> vs the period before` : ''}.</div>
          ${aud ? html`<div class="note">You're at <strong>${withThousands(followers)} followers</strong>${follInRange != null ? html`, <strong>+${withThousands(follInRange)}</strong> in this window` : ''}. The audience is mostly <strong>${womenOf(aud.locations[0].name)} aged 25–44</strong> — working adults, your actual buyers.</div>` : ''}
          ${top3[0] ? html`<div class="note">🎯 The lever: <strong>reach new people consistently.</strong> Wins like “${clip(top3[0].title)}” show the ceiling is high — the job is lifting the quiet posts.</div>` : ''}
        </div>
      `}

    <${SavedReports} reports=${reports} onOpen=${setViewing} />
  </div>`;
}

// Published posts grouped by funnel stage / pillar / product, so the report shows
// WHICH kind of content works — not just how much was posted.
const BREAKDOWNS = [
  { field: 'funnel_stage', label: 'Funnel stage' },
  { field: 'pillar', label: 'Pillar' },
  { field: 'product', label: 'Product' },
];

function BreakdownCard({ published }) {
  const [field, setField] = useRemembered('report.breakdown', 'funnel_stage');
  const rows = breakdownBy(published, field);
  const tagged = rows.filter((x) => x.key !== '__none');
  const untagged = rows.find((x) => x.key === '__none');
  const best = tagged.length >= 2 ? [...tagged].sort((x, y) => y.avgViews - x.avgViews)[0] : null;
  const what = (BREAKDOWNS.find((b) => b.field === field) || {}).label.toLowerCase();
  return html`<div class="card card-pad section-gap">
    <div class="chart-head" style=${{ marginBottom: '8px' }}>
      <div class="card-title">What kind of content works</div>
      <div class="seg no-print">
        ${BREAKDOWNS.map((b) => html`<button class=${field === b.field ? 'active' : ''} onClick=${() => setField(b.field)}>${b.label}</button>`)}
      </div>
    </div>
    ${tagged.length === 0
      ? html`<div class="muted" style=${{ fontSize: '12.5px' }}>None of the posts in this range have a ${what} yet. Open a post (Calendar or Dashboard) and set its <strong>${what}</strong> to see this breakdown.</div>`
      : html`<${BreakdownTable} rows=${rows} />
        <div class="eng-notes" style=${{ marginTop: '10px', borderLeft: '3px solid var(--gold-strong)' }}>
          ${best ? html`<div class="note">🏆 <strong>${best.label}</strong> posts average <strong>${compact(best.avgViews)} views</strong> each — the strongest ${what} in this range.</div>` : ''}
          ${untagged ? html`<div class="note">🏷️ ${untagged.posts} ${untagged.posts === 1 ? 'post isn\'t' : 'posts aren\'t'} tagged yet — tag them for a more complete picture.</div>` : ''}
        </div>`}
  </div>`;
}

function BreakdownTable({ rows }) {
  return html`<div style=${{ overflowX: 'auto' }}>
    <table class="atable">
      <thead><tr><th>Group</th><th>Posts</th><th>Total views</th><th>Avg views / post</th><th>Eng. rate</th></tr></thead>
      <tbody>
        ${rows.map((x) => html`<tr class=${x.key === '__none' ? 'muted' : ''}>
          <td><strong>${x.label}</strong></td>
          <td>${x.posts}</td>
          <td>${compact(x.views)}</td>
          <td>${compact(x.avgViews)}</td>
          <td>${x.er}%</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

function SavedReports({ reports, onOpen }) {
  const list = Object.values(reports || {}).sort((x, y) => (x.savedAt < y.savedAt ? 1 : -1));
  return html`<div class="card card-pad section-gap no-print">
    <div class="card-title" style=${{ marginBottom: '4px' }}>Saved reports <span class="muted">(${list.length})</span></div>
    ${list.length === 0
      ? html`<div class="muted" style=${{ fontSize: '12.5px' }}>Press <strong>Save this report</strong> before your meeting to keep a snapshot of the numbers. You can come back to it any time, even after the live numbers change.</div>`
      : html`<div class="list">
          ${list.map((rp) => html`<div class="sched-item" style=${{ cursor: 'pointer' }} onClick=${() => onOpen(rp)}>
            <div class="sched-main">
              <div class="sched-title">${rp.label}</div>
              <div class="sched-meta">Saved ${shortDate(rp.savedAt)} · ${compact(rp.stats.views)} views · ${rp.stats.posts} posts · ${rp.stats.er}% ER</div>
            </div>
            <${Icon} name="chevronRight" size=${16} />
          </div>`)}
        </div>`}
  </div>`;
}

// A saved report, shown full-page (so Print / PDF works the same as the live one).
function ReportView({ rep, onBack, onDelete }) {
  const st = rep.stats || {};
  const tile = (label, value, sub) => html`<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  const tagged = (rows) => rows && rows.some((x) => x.label !== 'Not tagged');
  return html`<div>
    <div class="page-head">
      <div>
        <button class="btn btn-ghost btn-sm" style=${{ marginBottom: '8px' }} onClick=${onBack}><${Icon} name="chevronLeft" size=${15} /> Back to live report</button>
        <div class="eyebrow">Saved report</div>
        <h1 class="page-title">${rep.label}</h1>
        <div class="page-sub">Snapshot saved ${new Date(rep.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-danger btn-sm" onClick=${onDelete}><${Icon} name="trash" size=${14} /> Delete</button>
        <button class="btn btn-gold" onClick=${() => window.print()}><${Icon} name="print" size=${15} /> Print / PDF</button>
      </div>
    </div>

    <div class="kpi-row">
      ${st.viewsInMonth != null ? tile('Views in the month', compact(st.viewsInMonth), 'TikTok Studio') : ''}
      ${tile('Views of posts published', compact(st.views), rep.comparePct != null ? `${rep.comparePct >= 0 ? '▲' : '▼'} ${Math.abs(rep.comparePct)}% vs period before` : '')}
      ${tile('Engagement', compact(st.engagement), `${st.er}% avg. rate`)}
      ${tile('Followers', withThousands(st.followers), st.follInRange != null ? `+${withThousands(st.follInRange)} gained` : '')}
      ${tile('Posts published', st.posts, `~${st.perWeek} / week · ${compact(st.avgPer)} avg views`)}
    </div>

    ${rep.top && rep.top.length ? html`<div class="card card-pad section-gap">
      <div class="card-title" style=${{ marginBottom: '6px' }}>Top posts</div>
      <table class="atable">
        <thead><tr><th>Video</th><th>Views</th><th>ER</th></tr></thead>
        <tbody>${rep.top.map((t) => html`<tr>
          <td class="atable-title">${t.url ? html`<a href=${t.url} target="_blank" rel="noopener noreferrer">${t.title}</a>` : t.title}</td>
          <td>${compact(t.views)}</td><td>${t.er}%</td>
        </tr>`)}</tbody>
      </table>
    </div>` : ''}

    ${tagged(rep.funnel) ? html`<div class="card card-pad section-gap"><div class="card-title" style=${{ marginBottom: '6px' }}>By funnel stage</div><${BreakdownTable} rows=${rep.funnel.map((x) => ({ ...x, key: x.label === 'Not tagged' ? '__none' : x.label }))} /></div>` : ''}
    ${tagged(rep.pillar) ? html`<div class="card card-pad section-gap"><div class="card-title" style=${{ marginBottom: '6px' }}>By content pillar</div><${BreakdownTable} rows=${rep.pillar.map((x) => ({ ...x, key: x.label === 'Not tagged' ? '__none' : x.label }))} /></div>` : ''}
  </div>`;
}
