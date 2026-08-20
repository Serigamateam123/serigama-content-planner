import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Empty } from '../components/ui.js';
import { analytics, compact, withThousands, erOf } from '../lib/metrics.js';
import { startOfDay, startOfMonth, addDays, dayKey, parse, shortDate } from '../lib/date.js';

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PRESETS = [
  { key: '7', label: 'Last 7 days' },
  { key: '28', label: 'Last 28 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

function rangeFor(key, now) {
  const to = dayKey(now);
  if (key === '7') return { from: dayKey(addDays(startOfDay(now), -6)), to, label: 'Last 7 days' };
  if (key === '28') return { from: dayKey(addDays(startOfDay(now), -27)), to, label: 'Last 28 days' };
  if (key === '90') return { from: dayKey(addDays(startOfDay(now), -89)), to, label: 'Last 90 days' };
  if (key === 'month') return { from: dayKey(startOfMonth(now)), to, label: MONTHS_FULL[now.getMonth()] + ' ' + now.getFullYear() };
  if (key === 'year') return { from: dayKey(new Date(now.getFullYear(), 0, 1)), to, label: String(now.getFullYear()) };
  return { from: '', to: '', label: 'All time' };
}

// Clean, single-screen executive board. Every number follows the chosen time range
// (preset or custom dates); audience + best-month highlights come from Studio captures.
export function AnalyticsDashboard({ contents, campaigns, accounts, accountStats, onNavigate, onRefresh }) {
  const now = new Date();
  const [rangeKey, setRangeKey] = useState('all');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');

  const r = rangeKey === 'custom'
    ? { from: cFrom || '', to: cTo || dayKey(now), label: cFrom && cTo ? `${shortDate(cFrom)} – ${shortDate(cTo)}` : (cFrom ? `since ${shortDate(cFrom)}` : 'Custom range') }
    : rangeFor(rangeKey, now);

  const at = (from, to) => analytics(contents, campaigns, { campaign_id: 'all', account_id: 'all', platform: 'all', from, to }, accountStats || []);
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
        <div class="eyebrow">Overview</div>
        <h1 class="page-title">Analytics Dashboard</h1>
        <div class="page-sub">A one-glance summary of your TikTok performance — <strong>${r.label}</strong></div>
      </div>
      <div class="page-actions">
        <button class="btn" onClick=${onRefresh}><${Icon} name="refresh" size=${15} /> Refresh</button>
        <button class="btn" onClick=${() => onNavigate('analytics')}><${Icon} name="analytics" size=${15} /> Full detail</button>
      </div>
    </div>

    <div class="card card-pad">
      <div style=${{ display: 'flex', alignItems: 'flex-end', gap: '18px', flexWrap: 'wrap' }}>
        <div class="field" style=${{ minWidth: '170px' }}>
          <label>Time range</label>
          <select value=${rangeKey} onChange=${(e) => { const k = e.target.value; setRangeKey(k); if (k === 'all') { setCFrom(''); setCTo(''); } else if (k !== 'custom') { const rr = rangeFor(k, now); setCFrom(rr.from); setCTo(rr.to); } }}>
            ${PRESETS.map((p) => html`<option value=${p.key}>${p.label}</option>`)}
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

    ${a.publishedCount === 0
      ? html`<div class="card card-pad section-gap"><${Empty} title="No posts in this range">Pick a wider time range, or connect TikTok to pull metrics.</${Empty}></div>`
      : html`
        <div class="section-gap" style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          ${stat('👁', 'Total views', compact(a.totalViews), rangeKey === 'all' ? 'lifetime, all videos' : 'from posts in this range', deltaChip(a.totalViews, cmp && cmp.views))}
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

        <div class="card card-pad section-gap" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📝 The story</div>
          <div class="note">In <strong>${r.label.toLowerCase()}</strong>, ${a.publishedCount} ${a.publishedCount === 1 ? 'post' : 'posts'} earned <strong>${compact(a.totalViews)} views</strong> at <strong>${a.avgER}%</strong> engagement${erWord ? ' (' + erWord + ')' : ''}${cmp && cmp.views ? html` — <strong>${pctChange(a.totalViews, cmp.views) >= 0 ? 'up' : 'down'} ${Math.abs(pctChange(a.totalViews, cmp.views) || 0)}%</strong> vs the period before` : ''}.</div>
          ${aud ? html`<div class="note">You're at <strong>${withThousands(followers)} followers</strong>${follInRange != null ? html`, <strong>+${withThousands(follInRange)}</strong> in this window` : ''}. The audience is mostly <strong>${aud.locations[0].name}n women aged 25–44</strong> — working adults, your actual buyers.</div>` : ''}
          ${top3[0] ? html`<div class="note">🎯 The lever: <strong>reach new people consistently.</strong> Wins like “${clip(top3[0].title)}” show the ceiling is high — the job is lifting the quiet posts.</div>` : ''}
        </div>
      `}
  </div>`;
}
