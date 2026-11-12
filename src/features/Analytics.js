import { html } from '../lib/html.js';
import { useRemembered } from '../lib/remember.js';
import { useState, useEffect } from 'preact/hooks';
import { Kpi, Icon, Empty } from '../components/ui.js';
import { TrendChart } from './TrendChart.js';
import { TikTokConnect } from './TikTokConnect.js';
import { analytics, compact, withThousands, erOf, engagementOf, periodMetrics, daysOfHistory, applyFilters, engagementExtras, ceilingFloor } from '../lib/metrics.js';
import { readKV } from '../lib/kv.js';
import { insightSource, isInstagram, isThreads } from '../lib/account.js';

// Unicode-block sparkline from a list of numbers (shared by monthly + engagement).
function sparkline(vals) {
  const b = '▁▂▃▄▅▆▇█';
  const mx = Math.max(...vals, 1);
  return vals.map((v) => b[Math.min(7, Math.round((v / mx) * 7))]).join('');
}

// Engagement-rate benchmark. TikTok's typical range is ~3–6%; below is weak,
// above is strong. Returns a coloured badge used as a note beside every ER.
function erRank(er) {
  const v = Number(er) || 0;
  if (v >= 9) return { emoji: '🟢', word: 'excellent', color: '#16a34a' };
  if (v >= 6) return { emoji: '🟢', word: 'strong', color: '#16a34a' };
  if (v >= 3) return { emoji: '🟡', word: 'solid', color: '#ca8a04' };
  if (v >= 1) return { emoji: '🟠', word: 'below avg', color: '#ea580c' };
  return { emoji: '🔴', word: 'low', color: '#dc2626' };
}
// Small inline "🟡 solid" tag placed beside an ER number.
function erTag(er) {
  const r = erRank(er);
  return html`<span style=${{ color: r.color, fontWeight: 600, whiteSpace: 'nowrap' }}>${r.emoji} ${r.word}</span>`;
}
import { FUNNELS } from '../lib/constants.js';
import { audienceFacts, shareWord } from '../lib/audience.js';
import { shortDate, dayKey, addDays, startOfDay, startOfMonth, parse } from '../lib/date.js';

const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7', label: 'Last 7 days' },
  { key: '28', label: 'Last 28 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

export function Analytics({ contents, replies = [], accounts, accountStats, metricsHistory, onSaveMetrics }) {
  const DEFAULTS = { funnel: 'all', account_id: 'all', platform: 'all', hashtag: '', from: dayKey(startOfMonth(new Date())), to: dayKey(new Date()), grain: 'monthly', preset: 'month' };
  // `f` = the filters currently APPLIED to the results. `draft` = what the user is
  // editing in the filter bar. Nothing filters until they press Search (setF(draft)).
  // Opened from the Monthly Report's "Post performance" button: start on its period.
  // Opened from the Monthly Report's button: its dates come in the link and win.
  // Otherwise the last applied filters are remembered for this tab.
  const fromLink = (() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if (!q.has('from') && !q.has('to')) return null;
    return { ...DEFAULTS, from: q.get('from') || '', to: q.get('to') || '', preset: q.get('preset') || 'custom' };
  })();
  // The account comes from the sidebar switcher (contents arrive pre-filtered), so
  // an account id remembered from the old per-page filter is ignored.
  const [fSaved, setF] = useRemembered('performance.filters', DEFAULTS, { override: fromLink });
  const f = { ...fSaved, account_id: 'all' };
  const [draft, setDraft] = useState(f);
  const [showEntry, setShowEntry] = useState(false);
  const [sel, setSel] = useState(null); // which KPI tile is expanded
  const history = metricsHistory || [];
  const histDays = daysOfHistory(history);
  const [measurePref, setMeasurePref] = useState(null);
  const measure = 'lifetime';

  const dset = (k) => (e) => setDraft((s) => ({ ...s, [k]: e.target.value }));
  const dsetDate = (k) => (e) => setDraft((s) => ({ ...s, [k]: e.target.value, preset: 'custom' }));
  const dPreset = (key) => {
    const now = new Date();
    if (key === 'custom') return setDraft((s) => ({ ...s, preset: 'custom' }));
    if (key === 'all') return setDraft((s) => ({ ...s, from: '', to: '', preset: key }));
    let from;
    if (key === 'today') from = startOfDay(now);
    else if (key === 'month') from = startOfMonth(now);
    else from = addDays(startOfDay(now), -(Number(key) - 1));
    setDraft((s) => ({ ...s, from: dayKey(from), to: dayKey(now), preset: key }));
  };
  const search = () => setF(draft);
  const clearAll = () => { setDraft(DEFAULTS); setF(DEFAULTS); };
  // Hashtag chips are clicked from the results, so they apply immediately (and sync the draft).
  const pickHashtag = (tag) => { const h = (s) => ({ ...s, hashtag: s.hashtag === tag ? '' : tag }); setF(h); setDraft(h); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(f);

  const a = analytics(contents, f, accountStats || []);
  const publishedAll = contents.filter((c) => c.status === 'published');

  const rangeMode = measure === 'range' && histDays >= 2;

  // Period (Studio-style) figures: apply every filter EXCEPT the publish-date one,
  // then measure the views that HAPPENED inside the window from snapshot deltas.
  const scope = applyFilters(contents, { ...f, from: '', to: '' }).filter((c) => c.status === 'published');
  const from = f.from ? startOfDay(parse(f.from)) : null;
  const to = f.to ? new Date(startOfDay(parse(f.to)).getTime() + 86399999) : null;
  const pm = periodMetrics(scope, history, from, to);

  // Which figures the KPI row shows.
  const kViews = rangeMode ? pm.views : a.totalViews;
  const kEng = rangeMode ? pm.engagement : a.totalEngagement;
  const kER = rangeMode ? pm.er : a.avgER;
  const kPosts = rangeMode ? pm.postsWithData : a.publishedCount;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Performance</div>
        <h1 class="page-title">Post Performance</h1>
        <div class="page-sub">${a.publishedCount} published ${a.publishedCount === 1 ? 'post' : 'posts'} with numbers in this view</div>
      </div>
      <div class="page-actions">
        <button class="btn" onClick=${() => setShowEntry((v) => !v)}><${Icon} name="pencil" size=${15} /> ${showEntry ? 'Hide' : 'Update'} numbers</button>
        <button class="btn btn-gold no-print" onClick=${() => window.print()}><${Icon} name="download" size=${15} /> Export PDF</button>
      </div>
    </div>

    <${TikTokConnect} onSynced=${() => location.reload()} />

    <div class="card card-pad">
      <div class="filters">
        <div class="field">
          <label>Funnel stage</label>
          <select value=${draft.funnel} onChange=${dset('funnel')}>
            <option value="all">All funnel stages</option>
            ${FUNNELS.map((fu) => html`<option value=${fu.id}>${fu.emoji} ${fu.name}</option>`)}
            <option value="none">Not tagged</option>
          </select>
        </div>
        <div class="field">
          <label>Time range</label>
          <select value=${draft.preset || 'custom'} onChange=${(e) => dPreset(e.target.value)}>
            ${RANGE_PRESETS.map((p) => html`<option value=${p.key}>${p.label}</option>`)}
            <option value="custom">Custom range…</option>
          </select>
        </div>
        <div class="field">
          <label>Or pick custom dates</label>
          <div style=${{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="date" value=${draft.from} onInput=${dsetDate('from')} />
            <span class="muted">→</span>
            <input type="date" value=${draft.to} onInput=${dsetDate('to')} />
          </div>
        </div>
        <div class="filters-actions" style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn btn-gold" onClick=${search}><${Icon} name="check" size=${15} /> Search</button>
          <button class="btn" onClick=${clearAll}>Clear</button>
        </div>
      </div>
      ${dirty ? html`<div class="muted" style=${{ fontSize: '12px', marginTop: '8px', color: 'var(--gold-strong)' }}>You've changed the filters — press <strong>Search</strong> to apply.</div>` : ''}
      ${f.hashtag
        ? html`<div style=${{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button class="chip-btn active" onClick=${() => pickHashtag(f.hashtag)}>${f.hashtag} ✕</button>
            <span class="muted" style=${{ fontSize: '12px' }}>Filtering by hashtag — click to clear</span>
          </div>`
        : ''}
    </div>

    ${f.funnel !== 'all' && a.publishedCount === 0
      ? html`<div class="card card-pad section-gap" style=${{ borderLeft: '3px solid var(--amber)' }}>
          <strong>No published posts with numbers ${f.funnel === 'none' ? 'are untagged' : 'are tagged with this funnel stage'} in this range.</strong>
          <div class="muted" style=${{ fontSize: '12.5px', marginTop: '4px' }}>
            Open a post from the Calendar or Dashboard and set its <strong>Funnel stage</strong> to include it here.
          </div>
        </div>`
      : ''}

    <div class="kpi-row section-gap">
      ${[
        { kind: 'views', label: rangeMode ? 'Views in range' : 'Views of posts published', value: withThousands(kViews), sub: rangeMode ? 'in selected dates' : 'all-time, posts in this range' },
        { kind: 'engagement', label: 'Engagement', value: withThousands(kEng), sub: kER + '% avg. rate' },
        { kind: 'published', label: rangeMode ? 'Active posts' : 'Published', value: kPosts, sub: rangeMode ? 'got views in range' : 'posts with numbers' },
      ].map((t) => html`<${Kpi}
        label=${t.label} value=${t.value} sub=${t.sub}
        active=${sel === t.kind}
        onClick=${() => setSel((s) => (s === t.kind ? null : t.kind))}
      />`)}
      <${Kpi}
        label="Followers"
        value=${a.followerGrowth ? withThousands(a.followerGrowth.current) : '—'}
        sub=${!a.followerGrowth
          ? 'connect TikTok'
          : a.followerGrowth.days >= 2
          ? (a.followerGrowth.gained >= 0 ? '▲ ' : '▼ ') + withThousands(Math.abs(a.followerGrowth.gained)) + ' in range'
          : 'followers now'}
        active=${sel === 'followers'}
        onClick=${() => setSel((s) => (s === 'followers' ? null : 'followers'))}
      />
    </div>

    ${sel === 'followers'
      ? html`<${FollowerCard} fg=${a.followerGrowth} gains=${a.followerGain} posts=${a.published} onClose=${() => setSel(null)} /><${FollowerMonthlyCard} />`
      : sel
      ? html`<${KpiDetail} kind=${sel} a=${a} rangeMode=${rangeMode} history=${history} onClose=${() => setSel(null)} />`
      : null}

    ${sel === 'views' ? html`
      <${MonthlyReport} contents=${contents} />
    ` : ''}

    ${isInstagram() ? html`<${InstagramSplit} posts=${a.published} trials=${contents.filter((c) => {
      if (!c.trial || c.platform !== 'instagram') return false;
      const at = c.published_at || c.scheduled_at; const d = at ? dayKey(new Date(at)) : '';
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    })} />` : ''}
    ${isThreads() ? html`<${ThreadsSplit} posts=${a.published} replies=${replies.filter((c) => {
      const d = c.published_at ? dayKey(new Date(c.published_at)) : '';
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    })} />` : ''}

    ${showEntry
      ? html`<${MetricsEntry} contents=${publishedAll} onSave=${onSaveMetrics} />`
      : null}
  </div>`;
}

// Instagram only: the posts in view split into Feed (photos / carousels) and Reels.
// Per reel, Instagram's API gives views, reach, likes, comments, shares, saves and
// watch time (app_kv `serigama.reels`, keyed by post id). It does NOT give followers
// gained, followers vs non-followers or view sources per reel, so those are shown
// account-wide (from the monthly record and the audience record, both per account).
const IG_FORMAT = { REEL: 'Reels', REELS: 'Reels', POST: 'Feed posts', FEED: 'Feed posts', CAROUSEL_CONTAINER: 'Carousels', CAROUSEL_ALBUM: 'Carousels', STORY: 'Stories', AD: 'Ads', IGTV: 'Videos', LIVE: 'Live' };
const igFormatName = (k) => IG_FORMAT[String(k).toUpperCase()] || String(k).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function InstagramSplit({ posts, trials = [] }) {
  const [showAll, setShowAll] = useState({ feed: false, reels: false });
  const extras = readKV('serigama.reels', {}) || {};
  const monthly = (readKV('serigama.monthly', {}) || {}).months || {};
  const aud = readKV('serigama.audience', null);
  const all = (posts || []).filter((c) => c.platform === 'instagram');
  const reels = all.filter((c) => c.format === 'reel');
  const feed = all.filter((c) => c.format !== 'reel');
  const num = (v) => Number(v) || 0;
  const views = (c) => num(c.metrics && c.metrics.views);
  const byViews = (list) => [...list].sort((x, y) => views(y) - views(x));
  const clip = (t) => { t = (t || '(untitled)').trim().split('\n')[0]; return t.length > 46 ? t.slice(0, 46) + '…' : t; };
  const day = (c) => (c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
  // Plain title + a round play button that plays the post inside the planner
  // (Instagram's embed player, which works without being signed in to Instagram).
  const [playing, setPlaying] = useState(null);
  const playBtn = (c) => html`<button type="button" onClick=${() => setPlaying(c)} title="Play" aria-label=${'Play ' + clip(c.title)}
    style=${{ flex: '0 0 auto', width: '26px', height: '26px', padding: 0, border: 'none', cursor: 'pointer', borderRadius: '50%', background: 'linear-gradient(135deg, #f58529, #dd2a7b 50%, #8134af)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="#fff"/></svg></button>`;
  const titleCell = (c) => html`<td class="atable-title" style=${{ minWidth: '220px' }}>
    <div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      ${c.post_url ? playBtn(c) : ''}<span>${c.trial ? html`<span class="trial-tag">Trial reel</span> ` : ''}${clip(c.title)}</span>
    </div></td>`;
  const sum = (list, f) => list.reduce((n, c) => n + f(c), 0);
  const watchSec = (c) => { const ms = (extras[String(c.external_id)] || {}).ig_reels_avg_watch_time; return ms != null ? Math.round(num(ms) / 100) / 10 : null; };
  const web = readKV('serigama.reelsweb', {}) || {};
  const webOf = (c) => web[String(c.external_id)] || null;
  const follows = (c) => (c.newFollowers != null ? c.newFollowers : (webOf(c) ? webOf(c).follows : null));
  const withFollows = reels.filter((c) => follows(c) != null);
  const followsSum = sum(withFollows, follows);
  const topFollow = [...withFollows].sort((a, b) => follows(b) - follows(a))[0];
  const webDate = Object.values(web).map((x) => x.capturedAt).sort().pop();
  const withWatch = reels.filter((c) => watchSec(c) != null);
  const avgWatch = withWatch.length ? Math.round((sum(withWatch, watchSec) / withWatch.length) * 10) / 10 : null;

  // Account-wide splits from the latest month that has them.
  const monthKey = Object.keys(monthly).filter((k) => monthly[k].viewsByFormat || monthly[k].viewsByFollowType).sort().pop();
  const mrec = monthKey ? monthly[monthKey] : null;
  const monthName = mrec ? `${mrec.label}${mrec.complete ? '' : ` 1–${mrec.days}`}` : '';
  const shares = (obj) => { const t = Object.values(obj || {}).reduce((n, v) => n + num(v), 0); return t ? Object.entries(obj).map(([k, v]) => ({ k, v: num(v), pct: Math.round((num(v) / t) * 100) })).sort((p, q) => q.v - p.v) : []; };
  const formatRows = shares(mrec && mrec.viewsByFormat).filter((r) => r.pct > 0).map((r) => ({ ...r, name: igFormatName(r.k) }));
  const ft = mrec && mrec.viewsByFollowType;
  const folV = ft ? num(ft.FOLLOWER) : 0, nonV = ft ? num(ft.NON_FOLLOWER) : 0, ftT = folV + nonV;
  const pctOf = (v) => { const p = (v / ftT) * 100; return (p > 0 && p < 10) || (p > 90 && p < 100) ? Math.round(p * 10) / 10 : Math.round(p); };

  const tile = (color, label, value, sub) => html`<div class="kpi" style=${{ borderTop: '3px solid ' + color, boxShadow: 'none', padding: '12px 14px' }}>
    <div class="kpi-label">${label}</div><div class="kpi-value" style=${{ fontSize: '22px' }}>${value}</div>${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
  const tiles = (children) => html`<div class="kpi-row" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', margin: '10px 0' }}>${children}</div>`;
  const more = (key, list) => (list.length > 10 ? html`<button class="btn btn-ghost btn-sm" style=${{ marginTop: '6px' }} onClick=${() => setShowAll((s) => ({ ...s, [key]: !s[key] }))}>${showAll[key] ? 'Show top 10' : `Show all ${list.length}`}</button>` : '');
  const bar = (label, pct, color) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', padding: '3px 0' }}>
    <span style=${{ width: '96px' }}>${label}</span>${pctBar(pct, color)}<strong style=${{ width: '42px', textAlign: 'right' }}>${pct}%</strong></div>`;

  const feedRows = byViews(feed).slice(0, showAll.feed ? undefined : 10);
  const reelRows = byViews(reels).slice(0, showAll.reels ? undefined : 10);

  // Trial reels: Instagram syncs them like any reel but doesn't flag them, so they're
  // the reels ticked "Trial reel" in the planner (or added by hand before they sync).
  const trialRows = [...trials].sort((x, y) => views(y) - views(x));
  const hasNums = (c) => !!c.metrics;
  const trialSection = trials.length ? html`<div class="card card-pad section-gap" style=${{ borderLeft: '4px solid #dc2626' }}>
      <div class="card-title"><span class="trial-tag">Trial reels</span> <span class="muted" style=${{ fontWeight: 400 }}>(${trials.length} in this range — shown to non-followers first)</span></div>
      ${tiles(html`
        ${tile('#dc2626', 'Trial reels', trials.length)}
        ${tile('#6366f1', 'Views', compact(sum(trials.filter(hasNums), views)))}
        ${tile('#ec4899', '❤️ Likes', compact(sum(trials.filter(hasNums), (c) => num(c.metrics.likes))))}
        ${tile('#3b82f6', '💬 Comments', compact(sum(trials.filter(hasNums), (c) => num(c.metrics.comments))))}
        ${tile('#22c55e', '🔁 Shares', compact(sum(trials.filter(hasNums), (c) => num(c.metrics.shares))))}
        ${tile('#0ea5e9', '👥 Reach', compact(sum(trials.filter(hasNums), (c) => num(c.metrics.reach))))}`)}
      <div style=${{ overflowX: 'auto' }}><table class="atable">
        <thead><tr><th>Reel</th><th>Date</th><th>Numbers</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th></tr></thead>
        <tbody>${trialRows.map((c) => html`<tr>${titleCell(c)}<td>${day(c.published_at ? c : { published_at: c.scheduled_at })}</td>
          <td>${c.external_id ? html`<span style=${{ color: '#0f7a4d', fontWeight: 600 }}>From Instagram</span>` : html`<span style=${{ color: '#b7791f', fontWeight: 600 }}>Typed in</span>`}</td>
          ${hasNums(c) ? html`<td>${compact(views(c))}</td><td>${compact(num(c.metrics.reach))}</td><td>${compact(num(c.metrics.likes))}</td><td>${compact(num(c.metrics.comments))}</td><td>${compact(num(c.metrics.shares))}</td>`
            : html`<td colspan="5" class="muted" style=${{ fontSize: '12px' }}>Numbers not typed in yet — Update numbers ↑</td>`}
        </tr>`)}</tbody>
      </table></div>
      <p class="muted" style=${{ fontSize: '11px', margin: '8px 0 0' }}>Trial reels are shown to non-followers first. Instagram syncs them with their numbers like any reel, but doesn't say which ones are trials — so they're the reels you've ticked “Trial reel” in the calendar.</p>
    </div>` : html`<div class="card card-pad section-gap" style=${{ borderLeft: '4px solid #dc2626' }}>
      <div class="card-title"><span class="trial-tag">Trial reels</span> <span class="muted" style=${{ fontWeight: 400 }}>(none in this range)</span></div>
      <p class="muted" style=${{ fontSize: '12.5px', margin: '6px 0 0', lineHeight: 1.6 }}>To show a trial reel here: after the sync brings it in (every morning, or press <strong>Refresh</strong>), open it in the Content Calendar → tick <span class="trial-tag">Trial reel</span> → Save. Its numbers come from Instagram automatically.</p>
    </div>`;

  return html`<div>
    ${trialSection}
    <div class="card card-pad section-gap">
      <div class="card-title">📷 Feed posts <span class="muted" style=${{ fontWeight: 400 }}>(${feed.length} — photos & carousels in this range)</span></div>
      ${feed.length ? html`
        ${tiles(html`
          ${tile('#6366f1', 'Views', compact(sum(feed, views)))}
          ${tile('#ec4899', '❤️ Likes', compact(sum(feed, (c) => num(c.metrics.likes))))}
          ${tile('#3b82f6', '💬 Comments', compact(sum(feed, (c) => num(c.metrics.comments))))}
          ${tile('#22c55e', '🔁 Shares', compact(sum(feed, (c) => num(c.metrics.shares))))}
          ${tile('#f59e0b', '🔖 Saves', compact(sum(feed, (c) => num(c.saves))))}`)}
        <div style=${{ overflowX: 'auto' }}><table class="atable">
          <thead><tr><th>Post</th><th>Date</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th></tr></thead>
          <tbody>${feedRows.map((c) => html`<tr>${titleCell(c)}<td>${day(c)}</td><td>${compact(views(c))}</td><td>${compact(num(c.metrics.reach))}</td><td>${compact(num(c.metrics.likes))}</td><td>${compact(num(c.metrics.comments))}</td><td>${compact(num(c.metrics.shares))}</td><td>${compact(num(c.saves))}</td></tr>`)}</tbody>
        </table></div>
        ${more('feed', feed)}` : html`<p class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 0' }}>No feed posts in this range.</p>`}
    </div>

    <div class="card card-pad section-gap">
      <div class="card-title">🎬 Reels <span class="muted" style=${{ fontWeight: 400 }}>(${reels.length} in this range)</span></div>
      ${reels.length ? html`
        ${tiles(html`
          ${tile('#6366f1', 'Views', compact(sum(reels, views)))}
          ${tile('#ec4899', '❤️ Likes', compact(sum(reels, (c) => num(c.metrics.likes))))}
          ${tile('#3b82f6', '💬 Comments', compact(sum(reels, (c) => num(c.metrics.comments))))}
          ${tile('#22c55e', '🔁 Shares', compact(sum(reels, (c) => num(c.metrics.shares))))}
          ${tile('#f59e0b', '🔖 Saves', compact(sum(reels, (c) => num(c.saves))))}
          ${tile('#0ea5e9', '⏱️ Avg watch', avgWatch != null ? avgWatch + 's' : '—', avgWatch != null ? 'per view, these reels' : 'after the next sync')}
          ${tile('#0f7a4d', '👥 Followers gained', withFollows.length ? '+' + withThousands(followsSum) : '—', withFollows.length ? (withFollows.length < reels.length ? `from ${withFollows.length} of ${reels.length} reels` : 'from these reels') : 'next Thursday capture')}`)}

        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', margin: '4px 0 12px' }}>
          <div class="eng-notes" style=${{ margin: 0 }}>
            <div class="eng-notes-title">👥 Follows & unfollows <span class="muted" style=${{ fontWeight: 400 }}>(whole account)</span></div>
            ${aud && aud.follows28d != null ? html`
              <div style=${{ fontSize: '12.5px', lineHeight: 1.7 }}>
                Last 7 days: <strong style=${{ color: '#0f7a4d' }}>+${withThousands(aud.follows7d || 0)}</strong> follows · <strong style=${{ color: '#b4232a' }}>−${withThousands(aud.unfollows7d || 0)}</strong> unfollows<br/>
                Last 28 days: <strong style=${{ color: '#0f7a4d' }}>+${withThousands(aud.follows28d || 0)}</strong> follows · <strong style=${{ color: '#b4232a' }}>−${withThousands(aud.unfollows28d || 0)}</strong> unfollows
              </div>`
              : html`<div class="muted" style=${{ fontSize: '12px' }}>Appears after the next sync.</div>`}
            <div class="muted" style=${{ fontSize: '11px', marginTop: '4px' }}>${topFollow && follows(topFollow) > 0 ? html`Top reel for followers: <strong>“${clip(topFollow.title)}”</strong> (+${withThousands(follows(topFollow))}). ` : ''}Unfollows are only reported for the whole account.</div>
          </div>
          <div class="eng-notes" style=${{ margin: 0 }}>
            <div class="eng-notes-title">👀 Followers vs non-followers <span class="muted" style=${{ fontWeight: 400 }}>(account views${monthName ? ', ' + monthName : ''})</span></div>
            ${ftT ? html`
              <div style=${{ display: 'flex', height: '16px', borderRadius: '5px', overflow: 'hidden', margin: '6px 0 8px' }}>
                <div style=${{ width: Math.round((folV / ftT) * 100) + '%', background: '#3b82f6' }} title="Followers"></div>
                <div style=${{ width: Math.round((nonV / ftT) * 100) + '%', background: '#f59e0b' }} title="Non-followers"></div>
              </div>
              <div style=${{ fontSize: '12.5px' }}><span style=${{ color: '#3b82f6', fontWeight: 700 }}>Followers ${pctOf(folV)}%</span> · <span style=${{ color: '#b7791f', fontWeight: 700 }}>Non-followers ${pctOf(nonV)}%</span></div>
              <div class="muted" style=${{ fontSize: '11px', marginTop: '4px' }}>Non-follower views are new people finding you — that's where new followers come from.</div>`
              : html`<div class="muted" style=${{ fontSize: '12px' }}>Appears after the next sync (Instagram doesn't split this per reel).</div>`}
          </div>
          <div class="eng-notes" style=${{ margin: 0 }}>
            <div class="eng-notes-title">📍 Where views came from <span class="muted" style=${{ fontWeight: 400 }}>(account views by format${monthName ? ', ' + monthName : ''})</span></div>
            ${formatRows.length ? formatRows.slice(0, 5).map((r) => bar(r.name, r.pct, '#6366f1'))
              : html`<div class="muted" style=${{ fontSize: '12px' }}>Appears after the next sync. Instagram doesn't report Explore / Reels-tab sources through its API.</div>`}
          </div>
        </div>

        <div style=${{ overflowX: 'auto' }}><table class="atable">
          <thead><tr><th>Reel</th><th>Date</th><th>Views</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Avg watch</th><th title="Follows from this reel (instagram.com insights)">Follows</th><th title="Share of views from people who don't follow you">Non-followers</th></tr></thead>
          <tbody>${reelRows.map((c) => { const w = watchSec(c); return html`<tr>
            ${titleCell(c)}<td>${day(c)}</td><td>${compact(views(c))}</td><td>${compact(num(c.metrics.reach))}</td><td>${compact(num(c.metrics.likes))}</td><td>${compact(num(c.metrics.comments))}</td><td>${compact(num(c.metrics.shares))}</td><td>${compact(num(c.saves))}</td><td>${w != null ? w + 's' : '—'}</td><td>${follows(c) != null ? (follows(c) > 0 ? html`<strong style=${{ color: '#0f7a4d' }}>+${withThousands(follows(c))}</strong>` : '0') : '—'}</td><td>${webOf(c) ? webOf(c).nonFollowerViewsPct + '%' : '—'}</td>
          </tr>`; })}</tbody>
        </table></div>
        ${more('reels', reels)}
        <p class="muted" style=${{ fontSize: '11px', margin: '8px 0 0' }}>From Instagram, updated by the daily sync. Reach = accounts that saw the reel; views count repeat plays.${webDate ? ` Follows and non-followers come from instagram.com insights (captured ${new Date(webDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, refreshed on Thursdays).` : ''}</p>` : html`<p class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 0' }}>No reels in this range.</p>`}
    </div>
    <${IgViewers} aud=${aud} monthly=${monthly} posts=${all} />
    ${playing ? html`<${IgPlayer} post=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

// Pop-up player for one Instagram post, using Instagram's own embed page.
// Also used for Threads posts and replies (Threads' own embed page).
function IgPlayer({ post, onClose }) {
  const url = String(post.post_url || '');
  const th = url.match(/threads\.(?:net|com)\/(@[^/]+)\/post\/([^/?#]+)/);
  const m = url.match(/instagram\.com\/(reel|reels|p|tv)\/([^/?#]+)/);
  const kind = m && m[1] === 'p' ? 'p' : 'reel';
  const src = th ? `https://www.threads.com/${th[1]}/post/${th[2]}/embed` : m ? `https://www.instagram.com/${kind}/${m[2]}/embed/` : null;
  const app = th ? 'Threads' : 'Instagram';
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div role="dialog" aria-modal="true" aria-label="Play post" onClick=${onClose}
    style=${{ position: 'fixed', inset: 0, background: 'rgba(10,10,20,.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
    <div onClick=${(e) => e.stopPropagation()} style=${{ background: 'var(--surface, #fff)', borderRadius: '14px', overflow: 'hidden', width: 'min(420px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px 8px 14px', borderBottom: '1px solid var(--border-2, #eee)' }}>
        <span style=${{ flex: 1, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${(post.title || '').split('\n')[0]}</span>
        <a href=${post.post_url} target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style=${{ whiteSpace: 'nowrap' }}>Open in ${app} ↗</a>
        <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Close" style=${{ fontSize: '16px', lineHeight: 1 }}>✕</button>
      </div>
      ${src ? html`<iframe src=${src} title=${app + ' post'} allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen
          style=${{ border: 0, width: '100%', height: 'min(760px, calc(92vh - 50px))', background: '#fff' }}></iframe>`
        : html`<p class="muted" style=${{ padding: '20px', fontSize: '13px' }}>This post has no ${app} link to open.</p>`}
    </div>
  </div>`;
}

// Threads only: the account's own posts, and its replies on other people's threads,
// each with totals and a table. Per item Threads gives views, likes, replies, reposts,
// quotes and shares (reposts/quotes/shares split kept in app_kv `serigama.threadsposts`).
function ThreadsSplit({ posts, replies }) {
  const [showAll, setShowAll] = useState({ posts: false, replies: false });
  const [open, setOpen] = useState(null);
  const extra = readKV('serigama.threadsposts', {}) || {};
  const num = (v) => Number(v) || 0;
  const m = (c, k) => num(c.metrics && c.metrics[k]);
  const x = (c, k) => num((extra[String(c.external_id)] || {})[k]);
  const reposts = (c) => (extra[String(c.external_id)] ? x(c, 'reposts') : m(c, 'shares'));
  const quotes = (c) => x(c, 'quotes');
  const shares = (c) => x(c, 'shares');
  const sum = (list, fn) => list.reduce((n, c) => n + fn(c), 0);
  const byViews = (list) => [...list].sort((p, q) => m(q, 'views') - m(p, 'views'));
  const clip = (t) => { t = (t || '').trim().split('\n')[0] || '(no text)'; return t.length > 60 ? t.slice(0, 60) + '…' : t; };
  const day = (c) => (c.published_at ? new Date(c.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
  const ths = (list) => list.filter((c) => c.platform === 'threads');
  const tile = (color, label, value) => html`<div class="kpi" style=${{ borderTop: '3px solid ' + color, boxShadow: 'none', padding: '12px 14px' }}>
    <div class="kpi-label">${label}</div><div class="kpi-value" style=${{ fontSize: '22px' }}>${value}</div></div>`;
  const section = (key, icon, title, note, list) => {
    const rows = byViews(list).slice(0, showAll[key] ? undefined : 10);
    return html`<div class="card card-pad section-gap">
      <div class="card-title">${icon} ${title} <span class="muted" style=${{ fontWeight: 400 }}>(${list.length} in this range)</span></div>
      <p class="muted" style=${{ fontSize: '12px', margin: '4px 0 0' }}>${note}</p>
      ${list.length ? html`
        <div class="kpi-row" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', margin: '10px 0' }}>
          ${tile('#6366f1', '👁 Views', compact(sum(list, (c) => m(c, 'views'))))}
          ${tile('#ec4899', '❤️ Likes', compact(sum(list, (c) => m(c, 'likes'))))}
          ${tile('#3b82f6', '💬 Replies', compact(sum(list, (c) => m(c, 'comments'))))}
          ${tile('#22c55e', '🔁 Reposts', compact(sum(list, reposts)))}
          ${tile('#f59e0b', '❝ Quotes', compact(sum(list, quotes)))}
          ${tile('#0ea5e9', '↗ Shares', compact(sum(list, shares)))}
        </div>
        <div style=${{ overflowX: 'auto' }}><table class="atable">
          <thead><tr><th>${key === 'replies' ? 'Reply' : 'Post'}</th><th>Date</th><th>Views</th><th>Likes</th><th>Replies</th><th>Reposts</th><th>Quotes</th><th>Shares</th></tr></thead>
          <tbody>${rows.map((c) => html`<tr>
            <td class="atable-title" style=${{ minWidth: '220px' }}><div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              ${c.post_url ? html`<button class="play-btn" title=${key === 'replies' ? 'View reply' : 'View post'} aria-label="View on Threads" onClick=${() => setOpen(c)}>▶</button>` : ''}<span>${clip(c.title)}</span></div></td>
            <td>${day(c)}</td><td>${compact(m(c, 'views'))}</td><td>${compact(m(c, 'likes'))}</td><td>${compact(m(c, 'comments'))}</td>
            <td>${compact(reposts(c))}</td><td>${compact(quotes(c))}</td><td>${compact(shares(c))}</td>
          </tr>`)}</tbody>
        </table></div>
        ${list.length > 10 ? html`<button class="btn btn-ghost btn-sm" style=${{ marginTop: '6px' }} onClick=${() => setShowAll((s) => ({ ...s, [key]: !s[key] }))}>${showAll[key] ? 'Show top 10' : `Show all ${list.length}`}</button>` : ''}`
        : html`<p class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 0' }}>None in this range.</p>`}
    </div>`;
  };
  return html`<div>
    ${section('posts', '🧵', 'Threads posts', 'Your own threads.', ths(posts))}
    ${section('replies', '↪️', 'Replies', "Your replies on other people's threads — each has its own views and likes. Press ▶ to view one here.", ths(replies))}
    ${open ? html`<${IgPlayer} post=${open} onClose=${() => setOpen(null)} />` : ''}
  </div>`;
}

// "Who saw your content": reached-audience demographics (not just followers) for a period.
// Instagram has no per-post demographics; when one post dominates the period's views,
// this is effectively that post's audience, and the panel says so.
function IgViewers({ aud, monthly, posts }) {
  const v = aud && aud.viewers;
  const frames = v ? ['this_month', 'this_week'].filter((k) => v[k]) : [];
  const [tf, setTf] = useState(frames[0] || 'this_month');
  let regionName = (c) => c;
  try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); regionName = (c) => (/^[A-Z]{2}$/.test(c) ? dn.of(c) || c : c); } catch (_) {}
  const raw = v && (v[tf] || v[frames[0]]);
  const cur = raw && {
    ...raw,
    gender: (raw.gender || []).map((g) => (g.label === 'Other' ? { ...g, label: 'Not stated' } : g)),
    countries: (raw.countries || []).map((c) => ({ ...c, name: regionName(c.name) })),
  };
  const frameName = { this_month: 'This month', this_week: 'This week' };
  const now = new Date();
  const mKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthViews = Number(monthly[mKey] && monthly[mKey].views) || 0;
  const top = (posts || []).filter((c) => c.published_at && c.published_at.slice(0, 7) === mKey)
    .sort((a, b) => (Number(b.metrics && b.metrics.views) || 0) - (Number(a.metrics && a.metrics.views) || 0))[0];
  const topShare = top && monthViews ? Math.min(100, Math.round(((Number(top.metrics.views) || 0) / monthViews) * 100)) : 0;
  const clip = (t) => { t = (t || '').trim().split('\n')[0]; return t.length > 40 ? t.slice(0, 40) + '…' : t; };
  const rows = (list, color, key = 'name') => (list || []).filter((r) => r.pct > 0).slice(0, 6).map((r) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', padding: '3px 0' }}>
    <span style=${{ width: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${r[key]}>${r[key]}</span>${pctBar(Math.round(r.pct), color)}<strong style=${{ width: '46px', textAlign: 'right' }}>${r.pct}%</strong></div>`);
  const box = (title, body) => html`<div class="eng-notes" style=${{ margin: 0 }}><div class="eng-notes-title">${title}</div>${body}</div>`;
  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
      <div class="card-title" style=${{ margin: 0 }}>🌍 Who saw your content <span class="muted" style=${{ fontWeight: 400 }}>(everyone reached, not just followers)</span></div>
      ${frames.length > 1 ? html`<div style=${{ display: 'flex', gap: '6px' }}>${frames.map((k) => html`<button class=${'btn btn-sm ' + (k === tf ? 'btn-primary' : 'btn-ghost')} onClick=${() => setTf(k)}>${frameName[k]}</button>`)}</div>` : ''}
    </div>
    ${cur ? html`
      ${tf === 'this_month' && topShare >= 50 ? html`<p style=${{ fontSize: '12.5px', margin: '10px 0 0', padding: '8px 10px', background: 'var(--border-2)', borderRadius: '8px' }}>
        💡 <strong>“${clip(top.title)}”</strong> made <strong>${topShare >= 95 ? 'almost all' : topShare + '%'}</strong> of this month's views, so this is mostly <em>that post's</em> audience.</p>` : ''}
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '12px' }}>
        ${box('Gender', rows(cur.gender, '#ec4899', 'label'))}
        ${box('Age', rows(cur.age, '#6366f1', 'label'))}
        ${box('Top countries', rows(cur.countries, '#22c55e'))}
        ${cur.cities && cur.cities.length ? box('Top cities', rows(cur.cities, '#f59e0b')) : ''}
      </div>
      <p class="muted" style=${{ fontSize: '11px', margin: '8px 0 0' }}>From Instagram (accounts reached, ${frameName[tf] ? frameName[tf].toLowerCase() : ''}). Instagram doesn't give demographics for a single post.</p>`
      : html`<p class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 0' }}>Appears after the next sync.</p>`}
  </div>`;
}

// "▲12% vs prior week" — nothing when Studio has no earlier period (a new account shows "--").
function changeChip(pct, label) {
  if (pct == null) return '';
  return html`<span style=${{ color: pct >= 0 ? '#0f7a4d' : '#b4232a', fontSize: '11.5px' }}>${pct >= 0 ? '▲' : '▼'}${Math.abs(pct)}% ${label}</span>`;
}

// Follower section: real daily growth pace, per-video follows (from Studio), and
// the audience profile (gender / age / location / active times) captured from Studio.
function pctBar(pct, color, track = 'var(--border-2)') {
  return html`<div style=${{ flex: 1, height: '8px', background: track, borderRadius: '4px', overflow: 'hidden' }}>
    <div style=${{ width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: color, borderRadius: '4px' }}></div>
  </div>`;
}

// Monthly net-follower growth (captured from Studio), as a clean table like the
// Monthly performance card. Each month shows a ▲ if it beat the month before, ▼ if
// fewer — plus the exact change — so momentum is readable at a glance.
function FollowerMonthlyCard() {
  const mf = readKV('serigama.monthlyfollowers', null);
  if (!mf || !Object.keys(mf).length) return '';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = Object.entries(mf).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, net]) => ({ key, net: Number(net) }));
  const label = (key) => { const [y, m] = key.split('-'); return MON[Number(m) - 1] + ' ' + y.slice(2); };
  const total = months.reduce((s, m) => s + m.net, 0);
  const peak = months.reduce((a, b) => (b.net > a.net ? b : a), months[0]);
  const avg = Math.round(total / months.length);

  return html`<div class="card card-pad section-gap">
    <div class="card-title">Monthly follower growth <span class="muted" style=${{ fontWeight: 400 }}>net new followers · ${label(months[0].key)} – ${label(months[months.length - 1].key)}</span></div>
    <div style=${{ overflowX: 'auto' }}>
      <table class="atable">
        <thead><tr>
          <th>Month</th>
          <th>Net followers</th>
          <th title="Change vs the month before">vs last month</th>
        </tr></thead>
        <tbody>
          ${months.map((m, i) => {
            const prev = i > 0 ? months[i - 1].net : null;
            const diff = prev == null ? null : m.net - prev;
            const up = diff != null && diff > 0;
            const down = diff != null && diff < 0;
            const trend = prev == null
              ? html`<span class="muted">—</span>`
              : up ? html`<span style=${{ color: '#0f7a4d', fontWeight: 600 }}>▲ +${withThousands(diff)}</span>`
              : down ? html`<span style=${{ color: '#b4232a', fontWeight: 600 }}>▼ ${withThousands(diff)}</span>`
              : html`<span class="muted">± 0</span>`;
            return html`<tr style=${m === peak ? { background: '#fff7e6' } : {}}>
              <td><strong>${label(m.key)}</strong></td>
              <td style=${{ color: m.net < 0 ? '#b4232a' : '#0f7a4d', fontWeight: 600 }}>${m.net < 0 ? '' : '+'}${withThousands(m.net)}</td>
              <td>${trend}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    <div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
      <div class="note">🚀 <strong>${label(peak.key)} was your best month</strong> — +${withThousands(peak.net)} (${(peak.net / (avg || 1)).toFixed(1)}× your ${withThousands(avg)}/month average).${peak.net >= 2 * avg ? ' One big month did a lot of the work.' : ''}</div>
      <div class="note">📊 Total captured across these months: <strong>+${withThousands(total)}</strong>. ${peak.net >= 2 * avg
        ? html`Growth is <strong>spiky</strong> — the opportunity is lifting the quiet months, not waiting for another big one.`
        : html`Growth is <strong>fairly steady</strong> month to month.`}</div>
    </div>
  </div>`;
}

function FollowerCard({ fg, gains, posts, onClose }) {
  const [playing, setPlaying] = useState(null);
  const aud = readKV('serigama.audience', null);
  const current = (aud && aud.totalFollowers) || (fg && fg.current) || 0;

  const head = html`<div class="chart-head">
    <div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div class="card-title">Followers</div>
      ${onClose ? html`<button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>` : ''}
    </div>
    <div style=${{ textAlign: 'right' }}>
      <div style=${{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em' }}>${withThousands(current)}</div>
      <div class="muted" style=${{ fontSize: '11.5px' }}>followers now</div>
    </div>
  </div>`;

  if (!fg && !aud) {
    return html`<div class="card card-pad section-gap">${head}
      <p class="muted" style=${{ fontSize: '12.5px', marginTop: '8px', marginBottom: 0 }}>
        No follower data yet. Once your daily sync runs — and after a Studio audience pull — this shows your daily growth pace and who's following you.
      </p></div>`;
  }

  const clip = (t) => { t = (t || '(untitled)').trim(); return t.length > 44 ? t.slice(0, 44) + '…' : t; };

  // Daily growth pace — Studio's net figures are accurate (the Display-API count lags).
  // `net28dDays`: for an account younger than 28 days, the days those followers came in.
  const perDay = aud && aud.net28d ? Math.round((aud.net28d / (aud.net28dDays || 28)) * 10) / 10 : null;
  const step = current < 10000 ? 1000 : 5000;
  const milestone = (Math.floor(current / step) + 1) * step;
  const daysTo = perDay && perDay > 0 ? Math.ceil((milestone - current) / perDay) : null;
  const etaDate = daysTo != null ? new Date(Date.now() + daysTo * 86400000) : null;
  const etaLabel = etaDate ? etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;

  // Followers gained per video — prefer Studio's real new_followers (from the
  // studio_metrics table or the captured localStorage map), fall back to the estimate.
  const studioFollows = (c) => (c.newFollowers != null ? c.newFollowers : (c.studio && c.studio.new_followers != null ? c.studio.new_followers : null));
  let perPost = (posts || [])
    .map((c) => ({ c, g: studioFollows(c), studio: true }))
    .filter((r) => r.g != null && r.g > 0);
  if (!perPost.length && gains && gains.size) {
    perPost = (posts || []).map((c) => ({ c, g: gains.get(c.id), studio: false })).filter((r) => r.g != null && r.g > 0);
  }
  // Studio's per-video "new followers" are gross follows: people who unfollow later
  // stay counted on the video, so the videos can add up to more than the total.
  const viaVideos = perPost.reduce((n, r) => n + r.g, 0);
  const unfollowed = viaVideos - current;
  perPost = perPost.sort((a, b) => b.g - a.g).slice(0, 6);
  const fromStudio = perPost.length && perPost[0].studio;

  return html`<div class="card card-pad section-gap">${head}

    ${aud ? html`<div style=${{ marginTop: '10px', padding: '12px 14px', background: '#f4fbf7', border: '1px solid #cdeddd', borderRadius: 'var(--radius-sm)' }}>
      ${perDay != null ? html`<div style=${{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <span style=${{ fontSize: '20px', fontWeight: 700, color: '#0f7a4d' }}>${perDay >= 0 ? '+' : ''}${perDay}/day</span>
        <span class="muted" style=${{ fontSize: '12px' }}>average, based on ${insightSource()} net followers</span>
      </div>` : html`<div class="muted" style=${{ fontSize: '12.5px' }}>Daily growth pace appears once ${insightSource()} reports follower growth for this account.</div>`}
      ${aud.net7d != null || aud.net28d != null ? html`<div style=${{ display: 'flex', gap: '20px', marginTop: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
        ${aud.net7d != null ? html`<div>Last 7 days <strong style=${{ color: '#0f7a4d' }}>${aud.net7d >= 0 ? '+' : ''}${aud.net7d}</strong> ${changeChip(aud.net7dChangePct, 'vs prior week')}</div>` : ''}
        ${aud.net28d != null ? html`<div>Last 28 days <strong style=${{ color: '#0f7a4d' }}>${aud.net28d >= 0 ? '+' : ''}${aud.net28d}</strong> ${changeChip(aud.net28dChangePct, 'vs prior 4 wks')}</div>` : ''}
      </div>` : ''}
      ${aud.unfollows28d != null ? html`<div class="kpi-row" style=${{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' }}>
        ${[
          ['#22c55e', 'Follows · 28 days', '+' + withThousands(aud.follows28d || 0), `last 7 days +${withThousands(aud.follows7d || 0)}`],
          ['#ef4444', 'Unfollows · 28 days', '−' + withThousands(aud.unfollows28d || 0), `last 7 days −${withThousands(aud.unfollows7d || 0)}`],
          ['#3b82f6', 'Net · 28 days', (aud.net28d >= 0 ? '+' : '') + withThousands(aud.net28d || 0), 'reported by Instagram'],
        ].map(([color, label, val, sub]) => html`<div class="kpi" style=${{ borderTop: '3px solid ' + color, boxShadow: 'none', padding: '12px 14px', background: '#fff' }}>
          <div class="kpi-label">${label}</div>
          <div class="kpi-value" style=${{ fontSize: '22px', color }}>${val}</div>
          <div class="kpi-sub">${sub}</div>
        </div>`)}
      </div>` : ''}
      ${daysTo != null ? html`<div style=${{ fontSize: '12.5px', marginTop: '8px' }}>🎯 At this pace you'll hit <strong>${withThousands(milestone)}</strong> in about <strong>${daysTo} days</strong> (~${etaLabel}).</div>` : ''}
      <div class="muted" style=${{ fontSize: '11px', marginTop: '6px' }}>${isInstagram() ? 'Updated from Instagram' : 'Captured from Studio'} on ${aud.capturedAt}. ${isInstagram() ? '' : aud.net7dChangePct == null || aud.net28dChangePct == null ? html`No earlier period to compare yet (new account).` : aud.net7dChangePct >= 0 && aud.net28dChangePct >= 0 ? html`Growth is <strong style=${{ color: '#0f7a4d' }}>accelerating</strong> — both windows up vs the period before.` : aud.net7dChangePct < 0 && aud.net28dChangePct < 0 ? html`Growth <strong style=${{ color: '#b4232a' }}>cooled</strong> — both windows down vs the period before.` : html`Growth is <strong>mixed</strong> vs the period before — see the two windows above.`}</div>
    </div>` : (fg && fg.days >= 2 ? html`<div style=${{ marginTop: '10px' }}><${TrendChart} data=${fg.points} grain="daily" /></div>` : html`<p class="muted" style=${{ fontSize: '12.5px', marginTop: '8px' }}>Ask me to pull your follower audience from Studio to see daily growth pace and demographics.</p>`)}

    ${perPost.length ? html`<div style=${{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
      <div class="card-title" style=${{ fontSize: '13px', marginBottom: '2px' }}>New follows per video ${fromStudio ? html`<span class="muted" style=${{ fontWeight: 400 }}>(from ${insightSource()})</span>` : html`<span class="muted" style=${{ fontWeight: 400 }}>(estimated)</span>`}</div>
      <p class="muted" style=${{ fontSize: '11.5px', marginTop: 0, marginBottom: '8px' }}>Which videos actually convert viewers into followers — the real growth engine. ${fromStudio ? 'Counts everyone who followed from the video, including people who unfollowed later.' : ''}</p>
      ${fromStudio ? html`<div class="kpi-row" style=${{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', margin: '4px 0 6px' }}>
          ${[
            ['#22c55e', 'New follows', '+' + withThousands(viaVideos), 'from these videos'],
            ['#ef4444', 'Unfollowed', unfollowed > 0 ? '−' + withThousands(unfollowed) : '—', unfollowed > 0 ? 'at least — follows minus followers now' : "can't be worked out here"],
            ['#3b82f6', 'Followers now', withThousands(current), `from ${insightSource()}`],
          ].map(([color, label, val, sub]) => html`<div class="kpi" style=${{ borderTop: '3px solid ' + color, boxShadow: 'none', padding: '12px 14px' }}>
            <div class="kpi-label">${label}</div>
            <div class="kpi-value" style=${{ fontSize: '22px', color: val === '—' ? 'var(--muted-2)' : color }}>${val}</div>
            <div class="kpi-sub">${sub}</div>
          </div>`)}
        </div>
        <p class="muted" style=${{ fontSize: '11px', margin: '0 0 8px' }}>${unfollowed > 0
          ? "TikTok doesn't report unfollows directly, so this is worked out from the numbers above. It's a minimum: anyone who followed from your profile or search and then left isn't counted."
          : "TikTok doesn't report unfollows. It can only be worked out when these videos brought more follows than you have followers now — here most followers came from older videos or before Studio figures were captured, so the gap is hidden."}</p>` : ''}
      ${perPost.map((r) => html`<div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '12.5px', padding: '5px 0', borderTop: '1px solid var(--border-2)' }}>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }}>
          ${tiktokId(r.c) ? html`<button class="play-btn" title="Play video" onClick=${() => setPlaying(r.c)}>▶</button>` : ''}
          ${r.c.post_url ? html`<a href=${r.c.post_url} target="_blank" rel="noopener" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${clip(r.c.title)}</a>` : html`<span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${clip(r.c.title)}</span>`}
        </span>
        <strong style=${{ color: '#0f7a4d', whiteSpace: 'nowrap' }}>+${withThousands(r.g)}</strong>
      </div>`)}
    </div>` : ''}

    ${aud ? (() => {
      const fx = audienceFacts(aud);
      const fem = fx.female ? fx.female.pct : 0, mal = fx.male ? fx.male.pct : 0;
      const cnt = (pct) => withThousands(Math.round((pct / 100) * current));
      const panel = (icon, title, body) => html`<div style=${{ background: '#fafbfd', border: '1px solid var(--border)', borderRadius: '10px', padding: '13px 15px' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '11px' }}>${icon}<span>${title}</span></div>
        ${body}
      </div>`;
      const statRow = (label, pct, valueText, color) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', padding: '3.5px 0' }}>
        <span style=${{ width: '86px', flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${label}</span>
        ${pctBar(pct, color)}
        <strong style=${{ width: '46px', flex: '0 0 auto', textAlign: 'right' }}>${valueText}</strong>
      </div>`;
      const legendRow = (dot, label, pct, count) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px', padding: '4px 0' }}>
        <span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: dot, flex: '0 0 auto' }}></span>
        <span style=${{ flex: 1 }}>${label}</span>
        <strong style=${{ width: '38px', textAlign: 'right' }}>${pct}%</strong>
        <span class="muted" style=${{ width: '58px', textAlign: 'right', fontSize: '11px' }}>~${count}</span>
      </div>`;
      return html`<div style=${{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
        <div class="card-title" style=${{ fontSize: '13px', marginBottom: '12px' }}>Who follows you <span class="muted" style=${{ fontWeight: 400 }}>(audience — from ${insightSource()})</span></div>
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '12px' }}>
          ${panel('👥', 'Gender', html`
            <div style=${{ display: 'flex', height: '18px', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
              <div style=${{ width: fem + '%', background: '#ec4899' }}></div>
              <div style=${{ width: mal + '%', background: '#3b82f6' }}></div>
            </div>
            ${legendRow('#ec4899', 'Female', fem, cnt(fem))}
            ${legendRow('#3b82f6', 'Male', mal, cnt(mal))}
          `)}
          ${panel('🎂', 'Age', html`${aud.age.map((a2) => statRow(a2.label, a2.pct, a2.pct + '%', '#6366f1'))}`)}
          ${panel('📍', 'Top locations', html`${aud.locations.map((l) => statRow(l.name, l.pct, l.lt1 ? '<1%' : l.pct + '%', l.name === 'Others' ? '#cbd5e1' : '#0ea5e9'))}`)}
          ${panel('⏰', 'Most active', html`
            <div style=${{ fontSize: '12.5px', lineHeight: 1.5 }}>${aud.activeNote}</div>
            <div class="muted" style=${{ fontSize: '11px', marginTop: '9px' }}>Post an hour or two before these peaks for the best first push.</div>
          `)}
        </div>
        <div class="eng-notes" style=${{ marginTop: '14px', borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📝 What your audience is telling you</div>
          ${fx.lead ? html`<div class="note">${shareWord(fx.lead.pct)} of your followers are <strong>${fx.lead.word} (${fx.lead.pct}%)</strong>${fx.span ? html`, and <strong>${fx.span.pct}%</strong> are aged <strong>${fx.span.label}</strong>${fx.span.from >= 25 ? ' — working-age adults, not teens' : ''}` : ''}.</div>` : ''}
          ${fx.top ? html`<div class="note"><strong>${fx.top.pct}% are in ${fx.top.name}</strong>${fx.next.length ? html`, then ${fx.next.map((l) => `${l.name} (${l.lt1 ? '<1' : l.pct}%)`).join(' and ')}` : ''} — content in their language and culture lands best.</div>` : ''}
          ${fx.people && fx.span ? html`<div class="note">🎯 Your core audience: <strong>${fx.people} aged ${fx.span.label}</strong>. Make hooks, humour and offers for them first.</div>` : ''}
        </div>
        <div class="muted" style=${{ fontSize: '11px', marginTop: '8px' }}>ℹ️ TikTok only breaks audience location down to <strong>country</strong>, not city — so city-level data isn't available here.</div>
      </div>`;
    })() : ''}
    ${playing ? html`<${VideoModal} video=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

// Colour + arrow for a good/okay/low verdict.
function tint(t) {
  return t === 'good' ? { color: '#0f7a4d', arrow: '▲' }
    : t === 'ok' ? { color: '#b7791f', arrow: '●' }
    : t === 'low' ? { color: '#b4232a', arrow: '▼' }
    : { color: 'var(--muted)', arrow: '' };
}

// Benchmark a captured Studio number → {color, arrow, note} for at-a-glance reporting.
// Bands are rules of thumb, not official TikTok thresholds.
function studioVerdict(kind, val, views) {
  if (val == null) return { ...tint(''), note: 'Not captured yet for this video.' };
  if (kind === 'hook') {
    const t = val >= 60 ? 'good' : val >= 40 ? 'ok' : 'low';
    return { ...tint(t), note: `Hook = % of viewers still watching at 3 seconds. Rule of thumb: 60%+ strong, 40–59% okay, under 40% weak (rework your first 2 seconds). This video: ${val}%.` };
  }
  if (kind === 'newv') {
    const t = val >= 20 ? 'good' : val >= 8 ? 'ok' : 'low';
    return { ...tint(t), note: `New viewers = share of people seeing you for the first time. Higher = more reach to new audiences (growth). 20%+ is healthy; ${val}% means mostly returning fans — loyal, but not breaking out to new people.` };
  }
  if (kind === 'foll') {
    const conv = views ? (val / views) * 100 : null;
    const t = conv == null ? '' : conv >= 0.1 ? 'good' : conv >= 0.03 ? 'ok' : 'low';
    return { ...tint(t), note: `Followers gained from this video${conv != null ? ` (${conv.toFixed(2)}% of viewers followed)` : ''}. Above ~0.1% of viewers is a good conversion; under 0.03% means people watched but didn't follow — give them a reason to.` };
  }
  return { ...tint(''), note: '' };
}

// Auto-written "what your numbers are actually saying" read across the captured
// TikTok Studio videos in view — the plain-English story, not just the definitions.
function studioSummary(captured) {
  const notes = [];
  if (!captured || !captured.length) return notes;
  const clip = (t) => { t = (t || '(untitled)').trim(); return t.length > 40 ? t.slice(0, 40) + '…' : t; };
  const avg = (arr) => Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
  const r1 = (x) => Math.round(x * 10) / 10;

  const withHook = captured.filter((c) => c.studio.hook_3s_pct != null);
  const withNewv = captured.filter((c) => c.studio.new_viewers_pct != null);

  if (withHook.length) {
    const ah = avg(withHook.map((c) => c.studio.hook_3s_pct));
    let line = `🪝 <strong>Hooks average ${ah}% at 3 seconds</strong> — `;
    line += ah >= 60 ? 'strong. Most viewers survive your opening, so keep starting videos this way.'
      : ah >= 40 ? 'okay, with room to grow. A punchier first 2 seconds would widen your reach.'
      : 'weak — your first 2 seconds are losing people. Lead straight with the payoff.';
    notes.push(line);
    if (withHook.length >= 2) {
      const sorted = [...withHook].sort((x, y) => x.studio.hook_3s_pct - y.studio.hook_3s_pct);
      const lo = sorted[0], hi = sorted[sorted.length - 1];
      if (hi.studio.hook_3s_pct - lo.studio.hook_3s_pct >= 4) {
        notes.push(`↳ Best opener: “${clip(hi.title)}” (${hi.studio.hook_3s_pct}%). Weakest: “${clip(lo.title)}” (${lo.studio.hook_3s_pct}%) — compare their first 2 seconds.`);
      }
    }
  }

  if (withNewv.length) {
    const anv = avg(withNewv.map((c) => c.studio.new_viewers_pct));
    let line = `🆕 <strong>~${anv}% of viewers are new</strong> on average — `;
    line += anv >= 20 ? 'you\'re reaching fresh audiences well; good for growth.'
      : anv >= 8 ? 'a modest flow of new people. Broader hooks/topics would reach more strangers.'
      : `so about ${100 - anv}% are returning fans. Loyal audience — but these videos aren\'t breaking out to new people, which is the main lever if growth is the goal.`;
    notes.push(line);
  }

  const fw = captured.filter((c) => c.studio.new_followers != null && c.metrics && c.metrics.views);
  if (fw.length) {
    const totF = fw.reduce((s, c) => s + c.studio.new_followers, 0);
    const totV = fw.reduce((s, c) => s + (Number(c.metrics.views) || 0), 0);
    const conv = totV ? r1((totF / totV) * 100) : 0;
    let line = `➕ <strong>Converting ~${conv}% of viewers into followers</strong> (${totF} from ${compact(totV)} views) — `;
    line += conv >= 0.1 ? 'a healthy follow rate.' : 'low. People watch but don\'t follow — add a clear “follow for more” and a reason to.';
    notes.push(line);
  }

  const hookAvg = withHook.length ? avg(withHook.map((c) => c.studio.hook_3s_pct)) : 0;
  const newvAvg = withNewv.length ? avg(withNewv.map((c) => c.studio.new_viewers_pct)) : 100;
  if (hookAvg >= 55 && newvAvg < 8) {
    notes.push('📌 <strong>The story:</strong> you hook and hold your existing fans well, but you\'re not reaching or converting new people yet — that\'s the specific thing to work on.');
  }
  return notes;
}

// Boss-level read of the VIEWS picture: what's driving reach, momentum, concentration.
// Publishing-focused boss insights for the Published section: output cadence,
// consistency and trend — the "are we shipping enough, regularly?" view (distinct
// from viewsInsights, which is about reach).
function publishingInsights(published) {
  const notes = [];
  if (!published || !published.length) return notes;
  const dated = published.map((c) => parse(c.published_at)).filter(Boolean).sort((a, b) => a - b);
  if (dated.length < 2) { notes.push(`🗂️ <strong>${published.length} posts</strong> with numbers in this view.`); return notes; }
  const first = dated[0], last = dated[dated.length - 1];
  const spanDays = Math.max(1, Math.round((last - first) / 86400000));
  const perWeek = Math.round((dated.length / (spanDays / 7)) * 10) / 10;
  notes.push(`📅 <strong>${dated.length} posts over ${spanDays} days</strong> — about <strong>${perWeek}/week</strong>. ${perWeek >= 4 ? 'A strong, consistent cadence.' : perWeek >= 2 ? 'A steady cadence; a little more frequency compounds fast on TikTok.' : 'Posting more often is the cheapest growth lever you have.'}`);

  const cut30 = new Date(last.getTime() - 30 * 86400000);
  const cut60 = new Date(last.getTime() - 60 * 86400000);
  const recent = dated.filter((d) => d > cut30).length;
  const prior = dated.filter((d) => d > cut60 && d <= cut30).length;
  if (recent || prior) {
    notes.push(recent > prior ? `📈 <strong>Ramping up</strong> — ${recent} posts in the last 30 days vs ${prior} the month before.`
      : recent < prior ? `📉 <strong>Slowing down</strong> — ${recent} posts in the last 30 days vs ${prior} before. Consistency keeps the algorithm warm.`
      : `➡️ <strong>Steady output</strong> — ${recent} posts in each of the last two 30-day windows.`);
  }

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mm = {};
  for (const d of dated) { const k = `${d.getFullYear()}-${d.getMonth()}`; mm[k] = (mm[k] || 0) + 1; }
  const best = Object.entries(mm).sort((a, b) => b[1] - a[1])[0];
  if (best) { const [y, m] = best[0].split('-'); notes.push(`🗓️ <strong>Most active month: ${MON[Number(m)]} ${y.slice(2)}</strong> — ${best[1]} posts.`); }

  let maxGap = 0;
  for (let i = 1; i < dated.length; i++) { const g = Math.round((dated[i] - dated[i - 1]) / 86400000); if (g > maxGap) maxGap = g; }
  if (maxGap >= 7) notes.push(`⏳ <strong>Longest quiet stretch: ${maxGap} days</strong> between posts — gaps like this cool your reach; the algorithm rewards regularity.`);
  return notes;
}

function viewsInsights(published) {
  const notes = [];
  if (!published || !published.length) return notes;
  const views = (c) => Number(c.metrics.views) || 0;
  const clip = (t) => { t = (t || '').trim(); return t.length > 44 ? t.slice(0, 44) + '…' : t; };
  const sorted = [...published].sort((a, b) => views(b) - views(a));
  const n = sorted.length;
  const total = sorted.reduce((s, c) => s + views(c), 0);

  notes.push(`🏆 <strong>Top video:</strong> “${clip(sorted[0].title)}” — ${compact(views(sorted[0]))} views.`);

  if (n >= 5 && total) {
    const top3 = sorted.slice(0, 3).reduce((s, c) => s + views(c), 0);
    const pct = Math.round((top3 / total) * 100);
    let line = `🎯 <strong>Your top 3 videos = ${pct}% of all views.</strong> `;
    line += pct >= 70 ? 'Heavily reliant on a few hits — landing wins across more posts would steady your reach.'
      : pct >= 40 ? 'A handful of videos carry a lot; solid, but worth spreading.'
      : 'Views are spread nicely across many posts — consistent output.';
    notes.push(line);
  }

  if (n >= 5) {
    const bar = 50000;
    const cleared = sorted.filter((c) => views(c) >= bar).length;
    const pct = Math.round((cleared / n) * 100);
    notes.push(`✅ <strong>${pct}% of posts cleared 50K views</strong> (${cleared} of ${n}) — ${pct >= 50 ? 'a strong hit rate.' : pct >= 25 ? 'a decent hit rate; the rest underperform.' : 'most posts stay small — lifting the floor is where reliable growth comes from.'}`);
  }

  if (n >= 4) {
    const mid = published.map(views).sort((a, b) => a - b);
    const median = mid.length % 2 ? mid[(mid.length - 1) / 2] : Math.round((mid[mid.length / 2 - 1] + mid[mid.length / 2]) / 2);
    const avg = Math.round(total / n);
    notes.push(`📊 <strong>Typical (median) post: ${compact(median)} views</strong> vs ${compact(avg)} average. ${median < avg * 0.5 ? 'A few viral hits pull the average up — most posts land lower.' : 'Fairly even — the average reflects your typical post.'}`);
  }

  const byDate = published.filter((c) => parse(c.published_at)).sort((a, b) => parse(a.published_at) - parse(b.published_at));
  if (byDate.length >= 6) {
    const half = Math.floor(byDate.length / 2);
    const avgOf = (arr) => Math.round(arr.reduce((s, c) => s + views(c), 0) / arr.length);
    const older = avgOf(byDate.slice(0, half)), recent = avgOf(byDate.slice(half));
    const pc = older ? Math.round(((recent - older) / older) * 100) : 0;
    notes.push(pc >= 10 ? `📈 <strong>Views trending up</strong> — recent posts average ${compact(recent)} vs ${compact(older)} earlier (+${pc}%).`
      : pc <= -10 ? `📉 <strong>Views cooling off</strong> — recent posts average ${compact(recent)} vs ${compact(older)} earlier (${pc}%). Try a fresh hook or format.`
      : `➡️ <strong>Views holding steady</strong> — ~${compact(recent)} per recent post.`);
  }

  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dw = {};
  for (const c of published) { const d = parse(c.published_at); if (!d) continue; (dw[d.getDay()] = dw[d.getDay()] || { s: 0, n: 0 }); dw[d.getDay()].s += views(c); dw[d.getDay()].n++; }
  const days = Object.entries(dw).filter(([, val]) => val.n >= 2);
  if (days.length >= 2) {
    const b = days.map(([k, val]) => ({ k: Number(k), avg: val.s / val.n })).sort((x, y) => y.avg - x.avg)[0];
    notes.push(`📅 <strong>Best day for views: ${DOW[b.k]}</strong> — averages ${compact(Math.round(b.avg))} views.`);
  }
  return notes;
}

// Monthly performance, measured TWO clear ways:
//  (A) Views that HAPPENED in the month — the real TikTok Studio number (from
//      localStorage 'serigama.monthly', captured manually from Studio).
//  (B) Views EARNED by the videos published that month — all-time, from app data.
// "Jan – Sep 2026", or "Nov 2026 – Feb 2027" when the range crosses a year.
function monthSpan(firstKey, lastKey) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y1, m1] = firstKey.split('-');
  const [y2, m2] = lastKey.split('-');
  const a = MON[Number(m1) - 1], b = MON[Number(m2) - 1];
  if (y1 !== y2) return `${a} ${y1} – ${b} ${y2}`;
  return firstKey === lastKey ? `${a} ${y1}` : `${a} – ${b} ${y1}`;
}

function MonthlyReport({ contents }) {
  const stored = readKV('serigama.monthly', null);
  if (!stored || !stored.months) return '';
  const keys = Object.keys(stored.months).sort();
  if (!keys.length) return '';

  // Month a post was published, in local time (published_at is stored in UTC, so a
  // post made early on the 1st in Malaysia would otherwise land in the month before).
  const monthOf = (c) => { const d = parse(c.published_at); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };
  const pubList = (ym) => (contents || []).filter((c) => c.status === 'published' && monthOf(c) === ym);
  const pubViews = (ym) => pubList(ym).reduce((s, c) => s + (Number(c.metrics && c.metrics.views) || 0), 0);

  const rows = keys.map((k) => {
    const m = stored.months[k];
    const ongoing = k === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    return { key: k, m, ongoing, short: m.label.slice(0, 3), label: m.complete ? m.label : ongoing ? `${m.label} (1–${m.days} so far)` : `${m.label} — 1–${m.days} only`, studioViews: m.views, pubV: pubViews(k), posts: pubList(k).length, cf: ceilingFloor(pubList(k)) };
  });
  rows.forEach((r, i) => { r.prevCf = i > 0 ? rows[i - 1].cf : null; });

  const clipT = (t, n = 34) => { t = (t || '(untitled)').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  // ▲/▼ vs the month before, as a % change.
  const delta = (cur, prev) => {
    if (cur == null || prev == null || !prev) return '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return html`<span class="wow wow-flat">± 0%</span>`;
    return html`<span class=${'wow ' + (pct > 0 ? 'wow-up' : 'wow-down')} title="vs the month before">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };
  const peak = rows.reduce((a, b) => (b.studioViews > a.studioViews ? b : a));

  return html`<div class="card card-pad section-gap">
    <div class="card-title">Monthly performance <span class="muted" style=${{ fontWeight: 400 }}>${monthSpan(keys[0], keys[keys.length - 1])}</span></div>
    <div style=${{ overflowX: 'auto' }}>
      <table class="atable">
        <thead><tr>
          <th>Month</th>
          <th title="Views that happened during the month — matches TikTok Studio">📺 Views in the month<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(${insightSource()})</span></th>
          <th title="All-time views of the videos published that month">🎬 From that month's posts<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(all-time)</span></th>
          <th>Posts</th>
          <th title="The best video posted that month — how big one video can pop">🏔️ Ceiling<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(best video)</span></th>
          <th title="The middle (median) video posted that month — what a normal video gets">🪵 Floor<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(normal video)</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr style=${r === peak ? { background: '#fff7e6' } : {}}>
            <td><strong>${r.label}</strong></td>
            <td>${compact(r.studioViews)}${r.m.complete || r.ongoing ? '' : html`<span class="muted" style=${{ display: 'block', fontSize: '11px' }}>part month — capture full month</span>`}</td>
            <td>${compact(r.pubV)}</td>
            <td>${r.posts}</td>
            <td>${r.cf
              ? html`<strong>${compact(r.cf.ceiling)}</strong>${delta(r.cf.ceiling, r.prevCf && r.prevCf.ceiling)}
                  <span class="muted" style=${{ display: 'block', fontSize: '11px', lineHeight: 1.3, maxWidth: '150px', marginLeft: 'auto', whiteSpace: 'normal' }} title=${r.cf.ceilingPost.title || ''}>${clipT(r.cf.ceilingPost.title)}</span>`
              : html`<span class="muted">—</span>`}</td>
            <td>${r.cf ? html`<strong>${compact(r.cf.floor)}</strong>${delta(r.cf.floor, r.prevCf && r.prevCf.floor)}` : html`<span class="muted">—</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <${CeilingFloorChart} rows=${rows} />
  </div>`;
}

// Ceiling (best post) and floor (middle post) for each month as two lines, with the
// gap between them shaded. Log scale — each gridline is 10× the one below — so a 3K
// month and a 4.45M month fit on one chart. Hover a month for its numbers.
function CeilingFloorChart({ rows }) {
  const [hover, setHover] = useState(null);
  const pts = rows.filter((r) => r.cf);
  if (pts.length < 2) return '';
  const W = 720, H = 300, padL = 50, padR = 84, padT = 22, padB = 34;
  const n = pts.length;
  const lg = (v) => Math.log10(Math.max(1, v));
  const lo = Math.floor(Math.min(...pts.map((p) => lg(p.cf.floor))));
  const hi = Math.max(lo + 1, Math.ceil(Math.max(...pts.map((p) => lg(p.cf.ceiling)))));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (i / (n - 1)) * innerW;
  const y = (v) => padT + innerH * (1 - (lg(v) - lo) / (hi - lo));
  const band = innerW / (n - 1);
  const C = '#4b57f5', F = '#c47f1a';
  const line = (get) => pts.map((p, i) => `${x(i)},${y(get(p))}`).join(' ');
  const gap = `${line((p) => p.cf.ceiling)} ${pts.map((p, i) => `${x(i)},${y(p.cf.floor)}`).reverse().join(' ')}`;
  const tick = (k) => compact(Math.pow(10, k));
  const xLabel = (p, i) => (i === 0 || p.key.endsWith('-01') ? `${p.short} ${p.key.slice(2, 4)}` : p.short);
  const last = pts[n - 1];

  let tip = null;
  if (hover != null) {
    const p = pts[hover];
    const t = (p.cf.ceilingPost.title || '(untitled)').trim();
    const lines = [
      `${p.m.label} ${p.key.slice(0, 4)}`,
      `Ceiling  ${withThousands(p.cf.ceiling)}`,
      `  “${t.length > 30 ? t.slice(0, 30) + '…' : t}”`,
      `Floor  ${withThousands(p.cf.floor)}`,
      `${p.posts} ${p.posts === 1 ? 'post' : 'posts'} · best is ${Math.round(p.cf.ceiling / Math.max(1, p.cf.floor))}× the middle`,
    ];
    const boxW = Math.max(...lines.map((l) => l.length)) * 6 + 18, boxH = lines.length * 14 + 10;
    let bx = x(hover) + 12;
    if (bx + boxW > W - 4) bx = x(hover) - boxW - 12;
    tip = { lines, boxW, boxH, bx, by: padT + 2 };
  }

  return html`<div style=${{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border-2)' }}>
    <div class="chart-head" style=${{ marginBottom: '2px' }}>
      <div class="card-title" style=${{ fontSize: '13.5px' }}>Ceiling & floor, month by month</div>
    </div>
    <div class="tgt-legend">
      <span><i style=${{ borderTop: `2.5px solid ${C}` }}></i>Ceiling — best video</span>
      <span><i style=${{ borderTop: `2px dashed ${F}` }}></i>Floor — middle video</span>
      <span class="muted">Log scale: each line up is 10×. Hover a month for details.</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style=${{ minWidth: '520px' }}
        role="img" aria-label="Ceiling and floor views for each month, log scale">
        ${Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((k) => html`<g>
          <line x1=${padL} y1=${y(Math.pow(10, k))} x2=${W - padR} y2=${y(Math.pow(10, k))} stroke="#eef1f8" stroke-width="1" />
          <text x=${padL - 8} y=${y(Math.pow(10, k)) + 4} text-anchor="end" font-size="11" fill="#9aa2b1">${tick(k)}</text>
        </g>`)}
        ${pts.map((p, i) => html`<text x=${x(i)} y=${H - 12} text-anchor="middle" font-size="11" fill=${hover === i ? '#1f2430' : '#9aa2b1'} font-weight=${hover === i ? 700 : 400}>${xLabel(p, i)}</text>`)}
        <polygon points=${gap} fill="rgba(75,87,245,.07)" />
        <polyline points=${line((p) => p.cf.floor)} fill="none" stroke=${F} stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" />
        <polyline points=${line((p) => p.cf.ceiling)} fill="none" stroke=${C} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${pts.map((p, i) => html`<g>
          <circle cx=${x(i)} cy=${y(p.cf.floor)} r=${hover === i ? 4.5 : 3} fill=${F} />
          <circle cx=${x(i)} cy=${y(p.cf.ceiling)} r=${hover === i ? 5 : 3.5} fill=${C} />
        </g>`)}
        <text x=${x(n - 1) + 8} y=${y(last.cf.ceiling) + 4} font-size="11" font-weight="700" fill=${C}>${compact(last.cf.ceiling)}</text>
        <text x=${x(n - 1) + 8} y=${y(last.cf.floor) + 4} font-size="11" font-weight="700" fill=${F}>${compact(last.cf.floor)}</text>
        ${hover != null ? html`<g>
          <line x1=${x(hover)} y1=${padT} x2=${x(hover)} y2=${padT + innerH} stroke="#c7ccf7" stroke-width="1" stroke-dasharray="3 3" />
          <rect x=${tip.bx} y=${tip.by} width=${tip.boxW} height=${tip.boxH} rx="6" fill="#1f2430" opacity="0.96" />
          ${tip.lines.map((l, i) => html`<text x=${tip.bx + 9} y=${tip.by + 17 + i * 14} font-size=${i ? 10.5 : 10} font-weight=${i === 1 || i === 3 ? 700 : 400} fill=${i === 0 || i === 2 || i === 4 ? '#c7ccf7' : '#fff'}>${l}</text>`)}
        </g>` : ''}
        ${pts.map((p, i) => html`<rect x=${x(i) - band / 2} y=${padT} width=${band} height=${innerH} fill="transparent"
          style=${{ cursor: 'pointer' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
      </svg>
    </div>
  </div>`;
}

// Small play + title cell shared by the detail tables.
function videoNameCell(c, setPlaying) {
  const label = c.title || '(untitled)';
  return html`<td>
    ${tiktokId(c) ? html`<button class="play-btn" title="Play video" onClick=${() => setPlaying(c)}>▶</button>` : ''}
    ${c.post_url ? html`<a href=${c.post_url} target="_blank" rel="noopener">${label}</a>` : label}
  </td>`;
}

// Focused per-tile detail — each KPI shows ONLY the columns that belong to it,
// so Views, Engagement, ER and Published no longer repeat the same big table.
function KpiDetail({ kind, a, rangeMode, history, onClose }) {
  const [playing, setPlaying] = useState(null);
  const [pubSort, setPubSort] = useState({ key: 'views', dir: 'desc' });
  const TITLES = { views: 'Views', engagement: 'Engagement', er: 'Engagement rate & insights', published: 'Published posts' };
  const v = (c) => Number(c.metrics.views) || 0;
  const eng = (c) => engagementOf(c.metrics);

  // Week-over-week deltas for the per-video table: compare each video's current
  // count with its value ~7 days ago, taken from the daily content_metrics
  // snapshots (auto-sync writes one per video per day). Only Views/Likes/Shares/
  // Comments — and Engagement, derived from them — have this history; the Studio
  // metrics (hook / new viewers / new followers) are captured once, no delta.
  const WOW_CUTOFF = Date.now() - 7 * 86400000;
  const weekAgoBy = new Map();
  for (const m of history || []) {
    const t = new Date(m.fetched_at).getTime();
    if (!(t <= WOW_CUTOFF)) continue; // only snapshots at or before the 7-day mark
    const prev = weekAgoBy.get(m.content_id);
    if (!prev || t > prev._t) weekAgoBy.set(m.content_id, { _t: t, views: +m.views || 0, likes: +m.likes || 0, comments: +m.comments || 0, shares: +m.shares || 0 });
  }
  const wowCell = (c, metric) => {
    const wa = weekAgoBy.get(c.id);
    if (!wa) {
      const pub = parse(c.published_at);
      return metric === 'views' && pub && Date.now() - pub < 7 * 86400000 ? html`<div class="wow wow-flat">new</div>` : '';
    }
    const now = metric === 'engagement' ? eng(c) : Number(c.metrics[metric]) || 0;
    const then = metric === 'engagement' ? wa.likes + wa.comments + wa.shares : wa[metric] || 0;
    const d = now - then;
    if (d === 0) return '';
    const up = d > 0;
    return html`<div class=${'wow ' + (up ? 'wow-up' : 'wow-down')} title="Change over the last 7 days">${up ? '▲ +' : '▼ −'}${compact(Math.abs(d))}</div>`;
  };

  const rows = [...a.published];
  if (kind === 'views') rows.sort((x, y) => v(y) - v(x));
  else if (kind === 'engagement') rows.sort((x, y) => eng(y) - eng(x));
  else if (kind === 'er') rows.sort((x, y) => erOf(y.metrics) - erOf(x.metrics));
  else rows.sort((x, y) => new Date(y.published_at || 0) - new Date(x.published_at || 0));

  if (rows.length === 0) {
    return html`<div class="card card-pad section-gap">
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div class="card-title">${TITLES[kind]}</div>
        <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
      </div>
      <${Empty} title="No numbers in this view">Adjust the filters or date range, or connect TikTok to pull metrics.</${Empty}>
    </div>`;
  }

  const sb = a.scoreboard;
  const maxViews = rows.reduce((m, c) => Math.max(m, v(c)), 0);
  const bestER = rows.reduce((m, c) => Math.max(m, erOf(c.metrics)), 0);
  const sortedV = rows.map(v).sort((x, y) => x - y);
  const medianViews = sortedV.length ? (sortedV.length % 2 ? sortedV[(sortedV.length - 1) / 2] : Math.round((sortedV[sortedV.length / 2 - 1] + sortedV[sortedV.length / 2]) / 2)) : 0;
  const pubDates = rows.map((c) => parse(c.published_at)).filter(Boolean).sort((x, y) => x - y);
  const pubSpan = pubDates.length >= 2 ? Math.max(1, Math.round((pubDates[pubDates.length - 1] - pubDates[0]) / 86400000)) : 0;
  const perWeek = pubSpan ? Math.round((pubDates.length / (pubSpan / 7)) * 10) / 10 : rows.length;
  const latest = rows[0] && rows[0].published_at ? shortDate(rows[0].published_at) : '—';
  const SCORE = {
    views: [['Total views', compact(sb.views)], ['Avg / post', compact(Math.round(sb.views / rows.length))], ['Median', compact(medianViews)], ['Best video', compact(maxViews)]],
    engagement: [['Total engagement', compact(sb.engagement)], ['Avg. ER', a.avgER + '%'], ['Likes', compact(sb.likes)], ['Comments', compact(sb.comments)], ['Shares', compact(sb.shares)]],
    published: [['Posts', rows.length], ['Per week', perWeek], ['Best post', compact(maxViews)], ['Latest', latest]],
  }[kind] || [];

  // Only the Published (Active posts) section carries the per-video table — every
  // video-level metric lives here in one row, so the other tiles don't repeat it.
  const COLS = {
    published: [
      ['Date', (c) => (c.published_at ? shortDate(c.published_at) : '—')],
      ['Views', (c) => compact(v(c)), 'views'],
      ['Likes', (c) => compact(Number(c.metrics.likes) || 0), 'likes'],
      ['Shares', (c) => compact(Number(c.metrics.shares) || 0), 'shares'],
      ['Comments', (c) => compact(Number(c.metrics.comments) || 0), 'comments'],
      ['Engagement', (c) => compact(eng(c)), 'engagement'],
    ],
  }[kind] || [];

  // Published rows also carry the captured TikTok Studio metrics — hook / new
  // viewers / new followers — in the same row.
  const showStudio = kind === 'published' && rows.some((c) => c.studio);
  const scell = (knd, val, txt, views) => {
    if (val == null) return html`<td>—</td>`;
    const vd = studioVerdict(knd, val, views);
    return html`<td title=${vd.note} style=${{ color: vd.color, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'help' }}>${vd.arrow} ${txt}</td>`;
  };
  const studioSummaryNotes = showStudio ? studioSummary(rows.filter((c) => c.studio)) : [];

  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
      <div class="card-title">${TITLES[kind]} <span class="muted">(${rows.length})</span></div>
      <button class="btn btn-ghost btn-sm" onClick=${onClose}>Close</button>
    </div>
    ${SCORE.length
      ? html`<div class="score-strip" style=${{ gridTemplateColumns: `repeat(${SCORE.length}, 1fr)` }}>
          ${SCORE.map(([k, val]) => html`<div class="score"><div class="score-v">${val}</div><div class="score-k">${k}</div></div>`)}
        </div>`
      : ''}
    ${kind === 'engagement' ? (() => {
      const engTot = sb.engagement || 1;
      const likePct = Math.round((sb.likes / engTot) * 100);
      const commentPct = Math.round((sb.comments / engTot) * 100);
      const sharePct = Math.max(0, 100 - likePct - commentPct);
      // Saves come from the Studio capture per video; they aren't part of the engagement rate.
      const withSaves = rows.filter((c) => Number(c.saves) > 0);
      const savesTot = rows.reduce((n, c) => n + (Number(c.saves) || 0), 0);
      const erVerdict = a.avgER >= 6 ? '6%+ is genuinely strong for TikTok' : a.avgER >= 3 ? "right in TikTok's typical 3–6% range" : 'below the ~3–6% norm; a clearer call-to-action could lift it';
      const ex = engagementExtras(rows);
      const eclip = (t) => { t = (t || '(untitled)').trim(); return t.length > 38 ? t.slice(0, 38) + '…' : t; };
      const miniRow = (c, right) => html`<div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', fontSize: '12.5px', padding: '3px 0' }}>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }}>
          ${tiktokId(c) ? html`<button class="play-btn" title="Play video" onClick=${() => setPlaying(c)}>▶</button>` : ''}
          <span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${c.post_url ? html`<a href=${c.post_url} target="_blank" rel="noopener">${eclip(c.title)}</a>` : eclip(c.title)}</span>
        </span>
        <strong style=${{ whiteSpace: 'nowrap' }}>${right}</strong>
      </div>`;
      const dash = html`<div class="muted" style=${{ fontSize: '12px' }}>—</div>`;
      return html`
        <div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📊 What counts as a good engagement rate?</div>
          <div class="note">Engagement rate = (likes + comments + shares) ÷ views. It shows how many people <em>reacted</em>, not just watched. TikTok's typical range is <strong>3–6%</strong>.</div>
          <div class="note" style=${{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontWeight: 600 }}>
            <span style=${{ color: '#dc2626' }}>🔴 under 1% low</span>
            <span style=${{ color: '#ea580c' }}>🟠 1–3% below avg</span>
            <span style=${{ color: '#ca8a04' }}>🟡 3–6% solid</span>
            <span style=${{ color: '#16a34a' }}>🟢 6–9% strong</span>
            <span style=${{ color: '#16a34a' }}>🟢 9%+ excellent</span>
          </div>
          <div class="note">Your average across all posts is <strong>${a.avgER}%</strong> ${erTag(a.avgER)} — ${erVerdict}.</div>
        </div>
        <div class="eng-notes">
          <div class="eng-notes-title">Engagement mix</div>
          <div class="kpi-row" style=${{ margin: '6px 0 10px' }}>
            ${[
              ['#ec4899', '❤️ Likes', sb.likes, likePct + '% of engagement'],
              ['#3b82f6', '💬 Comments', sb.comments, commentPct + '% of engagement'],
              ['#22c55e', '🔁 Shares', sb.shares, sharePct + '% of engagement'],
              ['#f59e0b', '🔖 Saves', savesTot, withSaves.length ? `from ${insightSource()} · not in eng. rate` : `not captured from ${insightSource()} yet`],
            ].map(([color, label, val, sub]) => html`<div class="kpi" style=${{ borderTop: '3px solid ' + color, boxShadow: 'none' }}>
              <div class="kpi-label">${label}</div>
              <div class="kpi-value">${withSaves.length || label !== '🔖 Saves' ? compact(val) : '—'}</div>
              <div class="kpi-sub">${sub}</div>
            </div>`)}
          </div>
          <div style=${{ display: 'flex', height: '14px', borderRadius: '6px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style=${{ width: likePct + '%', background: '#ec4899' }} title="Likes"></div>
            <div style=${{ width: commentPct + '%', background: '#3b82f6' }} title="Comments"></div>
            <div style=${{ width: sharePct + '%', background: '#22c55e' }} title="Shares"></div>
          </div>
          <div class="note" style=${{ color: 'var(--muted)' }}>Shares spread you to new people (reach), comments build community, likes are passive approval — a healthy share slice is the best growth sign.</div>
        </div>
        <div style=${{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div class="eng-notes" style=${{ flex: 1, minWidth: '240px' }}>
            <div class="eng-notes-title">🔁 Most shared</div>
            ${ex.topShared.length ? ex.topShared.map((c) => miniRow(c, compact(Number(c.metrics.shares) || 0) + ' shares')) : dash}
          </div>
          <div class="eng-notes" style=${{ flex: 1, minWidth: '240px' }}>
            <div class="eng-notes-title">💬 Most commented</div>
            ${ex.topCommented.length ? ex.topCommented.map((c) => miniRow(c, compact(Number(c.metrics.comments) || 0) + ' comments')) : dash}
          </div>
        </div>
        ${ex.topSaved.length ? html`<div class="eng-notes">
          <div class="eng-notes-title">🔖 Most saved <span class="muted" style=${{ fontWeight: 400 }}>(highest-intent — from ${insightSource()})</span></div>
          ${ex.topSaved.map((c) => miniRow(c, compact(Number(c.saves) || 0) + ' saves'))}
        </div>` : ''}
        <div class="eng-notes">
          <div class="eng-notes-title">💎 Hidden gems <span class="muted" style=${{ fontWeight: 400 }}>(loved but under-seen — worth resharing)</span></div>
          ${ex.hiddenGems.length ? ex.hiddenGems.map((c) => { const gv = Math.round(erOf(c.metrics) * 10) / 10; return miniRow(c, html`${gv}% ${erTag(gv)} · ${compact(Number(c.metrics.views) || 0)} views`); }) : dash}
        </div>
        ${ex.topics.length ? html`<div class="eng-notes">
          <div class="eng-notes-title">🏷️ Topics that spark engagement <span class="muted" style=${{ fontWeight: 400 }}>(hashtags by avg. engagement rate)</span></div>
          ${ex.topics.map((t) => html`<div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12.5px', padding: '3px 0' }}><span><strong>${t.tag}</strong> <span class="muted">(${t.posts} posts)</span></span><span style=${{ whiteSpace: 'nowrap' }}><strong>${t.avgER}%</strong> ${erTag(t.avgER)}</span></div>`)}
        </div>` : ''}
        ${ex.monthlyER.length >= 2 ? html`<div class="eng-notes">
          <div class="eng-notes-title">📈 Engagement rate by month</div>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style=${{ fontFamily: 'monospace', fontSize: '18px', letterSpacing: '2px', color: 'var(--blue-1)' }}>${sparkline(ex.monthlyER.map((m) => m.er))}</span>
            <span style=${{ fontSize: '12px' }}>latest <strong>${ex.monthlyER[ex.monthlyER.length - 1].er}%</strong> ${erTag(ex.monthlyER[ex.monthlyER.length - 1].er)} <span class="muted">(${ex.monthlyER.length} months)</span></span>
          </div>
        </div>` : ''}
        ${a.engNotes && a.engNotes.length ? html`<div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📝 Notes — what to improve</div>
          ${a.engNotes.map((nt) => html`<div class="note">${nt}</div>`)}
        </div>` : ''}
      `;
    })() : ''}
    ${kind === 'views' ? (() => {
      const vi = viewsInsights(rows);
      return vi.length ? html`<div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
        <div class="eng-notes-title">📈 Views insights</div>
        ${vi.map((nt) => html`<div class="note" dangerouslySetInnerHTML=${{ __html: nt }}></div>`)}
      </div>` : '';
    })() : ''}
    ${kind === 'published' ? (() => {
      const pi = publishingInsights(rows);
      return pi.length ? html`<div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
        <div class="eng-notes-title">📅 Publishing insights <span class="muted" style=${{ fontWeight: 400 }}>(output & consistency)</span></div>
        ${pi.map((nt) => html`<div class="note" dangerouslySetInnerHTML=${{ __html: nt }}></div>`)}
      </div>` : '';
    })() : ''}
    ${COLS.length
      ? (() => {
          const HEAD_KEY = { Video: 'video', Date: 'date', Views: 'views', Likes: 'likes', Shares: 'shares', Comments: 'comments', Engagement: 'engagement', 'Hook 3s': 'hook', 'New viewers': 'newv', 'New followers': 'foll' };
          const sortVal = (key, c) => {
            if (key === 'video') return (c.title || '').toLowerCase();
            if (key === 'date') return new Date(c.published_at || 0).getTime();
            if (key === 'views') return v(c);
            if (key === 'likes') return Number(c.metrics.likes) || 0;
            if (key === 'shares') return Number(c.metrics.shares) || 0;
            if (key === 'comments') return Number(c.metrics.comments) || 0;
            if (key === 'engagement') return eng(c);
            if (key === 'hook') return c.studio && c.studio.hook_3s_pct != null ? c.studio.hook_3s_pct : -1;
            if (key === 'newv') return c.studio && c.studio.new_viewers_pct != null ? c.studio.new_viewers_pct : -1;
            if (key === 'foll') { const f = c.newFollowers != null ? c.newFollowers : (c.studio && c.studio.new_followers != null ? c.studio.new_followers : null); return f != null ? f : -1; }
            return 0;
          };
          const tableRows = [...rows].sort((x, y) => {
            const av = sortVal(pubSort.key, x), bv = sortVal(pubSort.key, y);
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return pubSort.dir === 'asc' ? cmp : -cmp;
          });
          const th = (label, title) => {
            const key = HEAD_KEY[label];
            const active = key && pubSort.key === key;
            const arrow = active
              ? html`<span style=${{ color: 'var(--blue-1)' }}> ${pubSort.dir === 'asc' ? '▲' : '▼'}</span>`
              : key ? html`<span style=${{ opacity: 0.3 }}> ↕</span>` : '';
            return html`<th title=${title || (key ? 'Click to sort by ' + label : '')} style=${{ cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none', color: active ? 'var(--blue-1)' : '' }}
              onClick=${key ? () => setPubSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' })) : null}>${label}${arrow}</th>`;
          };
          return html`<div class="muted" style=${{ fontSize: '11.5px', margin: '2px 0 8px' }}>↕ Click any column heading to sort — <strong>Views</strong> for top performers, <strong>Date</strong> for newest/oldest (click again to reverse). The <strong style=${{ color: '#0f7a4d' }}>▲</strong>/<strong style=${{ color: '#b4232a' }}>▼</strong> under a number is the change over the last 7 days (Views, Likes, Shares, Comments, Engagement); “new” = posted this week.</div>
            <div style=${{ overflowX: 'auto' }}>
            <table class="atable">
              <thead><tr>${th('Video')}${COLS.map(([h]) => th(h))}
                ${showStudio ? html`${th('Hook 3s', 'From TikTok Studio — click to sort')}${th('New viewers', 'From TikTok Studio — click to sort')}${th('New followers', 'From TikTok Studio — click to sort')}` : ''}
              </tr></thead>
              <tbody>
                ${tableRows.map((c) => {
                  const views = Number(c.metrics.views) || 0;
                  const s = c.studio;
                  const foll = c.newFollowers != null ? c.newFollowers : (s && s.new_followers != null ? s.new_followers : null); // captured Studio value preferred over the stale studio row
                  return html`<tr>
                    ${videoNameCell(c, setPlaying)}
                    ${COLS.map(([, fn, wowKey]) => html`<td>${fn(c)}${wowKey ? wowCell(c, wowKey) : ''}</td>`)}
                    ${showStudio ? html`${scell('hook', s && s.hook_3s_pct, s && s.hook_3s_pct != null ? s.hook_3s_pct + '%' : null, views)}${scell('newv', s && s.new_viewers_pct, s && s.new_viewers_pct != null ? s.new_viewers_pct + '%' : null, views)}${scell('foll', foll, foll != null ? '+' + withThousands(foll) : null, views)}` : ''}
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>`;
        })()
      : ''}
    ${showStudio
      ? html`<div class="eng-notes" style=${{ marginTop: '12px' }}>
          <div class="eng-notes-title">📊 Hook / New viewers / New followers — what they mean</div>
          <div class="note">🪝 <strong>Hook 3s</strong> — % still watching at 3 seconds. <strong style=${{ color: '#0f7a4d' }}>🎯 Our goal: 63%</strong> (our breakout average). 60%+ strong, 40–59% okay, under 40% weak.</div>
          <div class="note">🆕 <strong>New viewers</strong> — first-time viewers. Higher = <strong>reaching new people</strong>; 20%+ healthy, low % = mostly loyal fans.</div>
          <div class="note">➕ <strong>New followers</strong> — followed because of this video. ~<strong style=${{ color: '#0f7a4d' }}>0.1%+ of viewers</strong> is a good conversion.</div>
          <div class="note" style=${{ color: 'var(--muted)' }}>Colour: <strong style=${{ color: '#0f7a4d' }}>▲ good</strong> · <strong style=${{ color: '#b7791f' }}>● okay</strong> · <strong style=${{ color: '#b4232a' }}>▼ needs work</strong>. Hover a number for the full note. Only videos you've captured from Studio show these.</div>
        </div>`
      : ''}
    ${playing ? html`<${VideoModal} video=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

// Dedicated standalone section for the rich TikTok Studio metrics (hook, watch
// time, retention, audience). Only the videos you've captured appear here — kept
// separate so the deep data lives in ONE place, not repeated under every tile.
function StudioCard({ published }) {
  const [playing, setPlaying] = useState(null);
  const captured = (published || []).filter((c) => c.studio);
  if (!captured.length) return '';
  captured.sort((x, y) => (Number(y.metrics.views) || 0) - (Number(x.metrics.views) || 0));
  const summary = studioSummary(captured);
  const scell = (knd, val, txt, views) => {
    if (val == null) return html`<td>—</td>`;
    const vd = studioVerdict(knd, val, views);
    return html`<td title=${vd.note} style=${{ color: vd.color, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'help' }}>${vd.arrow} ${txt}</td>`;
  };

  return html`<div class="card card-pad section-gap">
    <div class="card-title">📊 TikTok Studio insights <span class="muted" style=${{ fontWeight: 400 }}>(${captured.length} captured ${captured.length === 1 ? 'video' : 'videos'})</span></div>
    <p class="muted" style=${{ fontSize: '12.5px', marginTop: 0 }}>Deep metrics only TikTok Studio exposes — hook, watch time and audience. Manually captured, so only videos you've grabbed show here.</p>
    <div style=${{ overflowX: 'auto' }}>
      <table class="atable">
        <thead><tr><th>Video</th><th>Hook 3s</th><th>Avg watch</th><th>Watched full</th><th>New viewers</th><th>New followers</th></tr></thead>
        <tbody>
          ${captured.map((c) => {
            const s = c.studio;
            const views = Number(c.metrics.views) || 0;
            return html`<tr>
              ${videoNameCell(c, setPlaying)}
              ${scell('hook', s.hook_3s_pct, s.hook_3s_pct != null ? s.hook_3s_pct + '%' : null, views)}
              <td>${s.avg_watch_label || (s.avg_watch_seconds != null ? s.avg_watch_seconds + 's' : '—')}</td>
              <td>${s.watched_full_pct != null ? s.watched_full_pct + '%' : '—'}</td>
              ${scell('newv', s.new_viewers_pct, s.new_viewers_pct != null ? s.new_viewers_pct + '%' : null, views)}
              ${scell('foll', s.new_followers, s.new_followers != null ? '+' + withThousands(s.new_followers) : null, views)}
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    <div class="eng-notes" style=${{ marginTop: '12px' }}>
      <div class="eng-notes-title">What these mean</div>
      <div class="note">🪝 <strong>Hook 3s</strong> — % still watching at 3 seconds. <strong style=${{ color: '#0f7a4d' }}>🎯 Our goal: 63%</strong> (our breakout average). 60%+ strong, 40–59% okay, under 40% weak.</div>
      <div class="note">🆕 <strong>New viewers</strong> — first-time viewers. Higher = <strong>reaching new people (growth)</strong>; 20%+ healthy, low % = mostly loyal fans.</div>
      <div class="note">➕ <strong>New followers</strong> — followed because of this video. ~<strong style=${{ color: '#0f7a4d' }}>0.1%+ of viewers</strong> is a good conversion.</div>
      <div class="note" style=${{ color: 'var(--muted)' }}>Colour key: <strong style=${{ color: '#0f7a4d' }}>▲ good</strong> · <strong style=${{ color: '#b7791f' }}>● okay</strong> · <strong style=${{ color: '#b4232a' }}>▼ needs work</strong>. Hover a number for its full note.</div>
    </div>
    ${playing ? html`<${VideoModal} video=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

// The numeric TikTok video id, from external_id or parsed out of the share URL.
function tiktokId(c) {
  if (c.external_id && /^\d+$/.test(String(c.external_id))) return String(c.external_id);
  const m = (c.post_url || '').match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

// Plays a TikTok video inline via the official embed player (loaded only on open).
function VideoModal({ video, onClose }) {
  const id = tiktokId(video);
  const stop = (e) => e.stopPropagation();
  return html`<div class="overlay" onClick=${onClose}>
    <div class="video-modal" onClick=${stop}>
      <button class="x-btn video-x" onClick=${onClose} aria-label="Close">×</button>
      ${id
        ? html`<iframe
            src=${`https://www.tiktok.com/player/v1/${id}?rel=0&description=0&music_info=0`}
            title=${video.title || 'TikTok video'}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowfullscreen
            style=${{ width: '100%', height: '100%', border: 'none', borderRadius: '14px' }}></iframe>`
        : html`<div style=${{ padding: '40px', color: '#fff', textAlign: 'center' }}>
            Couldn't find this video's id.
            ${video.post_url ? html`<div style=${{ marginTop: '10px' }}><a href=${video.post_url} target="_blank" rel="noopener" style=${{ color: 'var(--gold)' }}>Open on TikTok ↗</a></div>` : ''}
          </div>`}
    </div>
  </div>`;
}

// Inline editor: type real reach/views/likes/comments/shares per published post.
function MetricsEntry({ contents, onSave }) {
  if (contents.length === 0) {
    return html`<div class="card card-pad section-gap"><${Empty} title="No published content yet">Mark content as “Published” to enter its numbers here.</${Empty}></div>`;
  }
  return html`<div class="card card-pad section-gap">
    <div class="card-title" style=${{ marginBottom: '4px' }}>Update numbers</div>
    <p class="muted" style=${{ fontSize: '12.5px', marginTop: 0 }}>
      Enter what each post actually did. Engagement rate is calculated for you.
      <span class="nowrap">(Phase 2 will fill these in automatically.)</span>
    </p>
    <div style=${{ overflowX: 'auto' }}>
      <table class="mtable">
        <thead>
          <tr><th>Post</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th></th></tr>
        </thead>
        <tbody>
          ${contents.map((c) => html`<${MetricRow} key=${c.id} content=${c} onSave=${onSave} />`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

function MetricRow({ content, onSave }) {
  const m = content.metrics || {};
  const [v, setV] = useState({
    reach: m.reach || '',
    views: m.views || '',
    likes: m.likes || '',
    comments: m.comments || '',
    shares: m.shares || '',
  });
  const [state, setState] = useState('idle'); // idle | saving | saved
  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setState('idle'); };

  const save = async () => {
    setState('saving');
    const reach = Number(v.reach) || 0;
    const likes = Number(v.likes) || 0;
    const comments = Number(v.comments) || 0;
    const shares = Number(v.shares) || 0;
    const engagement = likes + comments + shares;
    const engagement_rate = reach ? Math.round((engagement / reach) * 1000) / 10 : 0;
    await onSave(content.id, { reach, views: Number(v.views) || 0, likes, comments, shares, engagement, engagement_rate });
    setState('saved');
  };

  const cell = (k) => html`<td><input type="number" min="0" value=${v[k]} onInput=${set(k)} /></td>`;
  return html`<tr>
    <td style=${{ maxWidth: '220px' }}><div class="sched-title" style=${{ fontSize: '13px' }}>${content.title}</div></td>
    ${cell('reach')}${cell('views')}${cell('likes')}${cell('comments')}${cell('shares')}
    <td><button class="btn btn-sm ${state === 'saved' ? 'btn-gold' : ''}" onClick=${save}>${state === 'saving' ? '…' : state === 'saved' ? 'Saved ✓' : 'Save'}</button></td>
  </tr>`;
}
