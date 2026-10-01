import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Kpi, Icon, Empty } from '../components/ui.js';
import { TrendChart } from './TrendChart.js';
import { TikTokConnect } from './TikTokConnect.js';
import { analytics, compact, withThousands, erOf, engagementOf, periodMetrics, periodTrend, daysOfHistory, applyFilters, engagementExtras, ceilingFloor } from '../lib/metrics.js';

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
import { PLATFORMS, PLATFORM_LABEL, FUNNELS } from '../lib/constants.js';
import { shortDate, dayKey, addDays, startOfDay, startOfMonth, parse } from '../lib/date.js';

const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7', label: 'Last 7 days' },
  { key: '28', label: 'Last 28 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

export function Analytics({ contents, accounts, accountStats, metricsHistory, onSaveMetrics }) {
  const DEFAULTS = { funnel: 'all', account_id: 'all', platform: 'all', hashtag: '', from: dayKey(startOfMonth(new Date())), to: dayKey(new Date()), grain: 'monthly', preset: 'month' };
  // `f` = the filters currently APPLIED to the results. `draft` = what the user is
  // editing in the filter bar. Nothing filters until they press Search (setF(draft)).
  const [f, setF] = useState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [showEntry, setShowEntry] = useState(false);
  const [sel, setSel] = useState(null); // which KPI tile is expanded
  const history = metricsHistory || [];
  const histDays = daysOfHistory(history);
  const [measurePref, setMeasurePref] = useState(null);
  const measure = 'lifetime';
  // Views-trend chart mode: 'overall' = views the account got each day (Studio
  // style, from snapshots) · 'post' = views grouped by each post's publish date.
  const [trendView, setTrendView] = useState(null);

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
  const scopeIds = new Set(scope.map((c) => c.id));
  const from = f.from ? startOfDay(parse(f.from)) : null;
  const to = f.to ? new Date(startOfDay(parse(f.to)).getTime() + 86399999) : null;
  const pm = periodMetrics(scope, history, from, to);
  const pTrend = periodTrend(history.filter((m) => scopeIds.has(m.content_id)), f.grain || 'monthly');

  // Which figures the KPI row + trend chart show, based on the toggle.
  const kViews = rangeMode ? pm.views : a.totalViews;
  const kEng = rangeMode ? pm.engagement : a.totalEngagement;
  const kER = rangeMode ? pm.er : a.avgER;
  const kPosts = rangeMode ? pm.postsWithData : a.publishedCount;
  // Overall ("views over time") view. For the MONTHLY grain we use the captured
  // TikTok Studio monthly totals (an exact match to Studio); daily/weekly use the
  // smoothed snapshot series (periodTrend). Falls back to by-post-date when there's
  // nothing to show yet. The user's explicit toggle pick always wins.
  let studioMonthly = null;
  try {
    const mm = JSON.parse(localStorage.getItem('serigama.monthly') || 'null');
    if (mm && mm.months) studioMonthly = Object.keys(mm.months).sort().map((k) => ({ key: k, value: Number(mm.months[k].views) || 0 }));
  } catch (e) { studioMonthly = null; }
  const hasStudioMonthly = !!(studioMonthly && studioMonthly.length);
  const canOverall = pTrend.length > 0 || hasStudioMonthly;
  const usingOverall = (trendView || (canOverall ? 'overall' : 'post')) === 'overall';
  const overallIsStudio = f.grain === 'monthly' && hasStudioMonthly;
  const overallData = overallIsStudio ? studioMonthly : pTrend;
  const chartData = usingOverall ? overallData : a.trend;

  // Trend footer stats (follow whichever series is charted)
  const values = chartData.map((t) => t.value);
  const best = values.length ? Math.max(...values) : 0;
  const chartedTotal = values.reduce((s, v) => s + v, 0);
  const avgPer = values.length ? Math.round(chartedTotal / values.length) : 0;

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
          <label>Account</label>
          <select value=${draft.account_id} onChange=${dset('account_id')}>
            <option value="all">All accounts</option>
            ${accounts.map((ac) => html`<option value=${ac.id}>${ac.display_name || ac.handle}</option>`)}
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
        { kind: 'views', label: rangeMode ? 'Views in range' : 'Total views', value: withThousands(kViews), sub: rangeMode ? 'in selected dates' : 'lifetime' },
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
      <${MonthlyReport} contents=${contents} followers=${a.followerGrowth ? a.followerGrowth.current : 0} />

      <div class="card card-pad section-gap">
        <div class="chart-head chart-head-stack">
          <div>
            <div class="card-title">Views trend</div>
            <div class="chart-sub">${usingOverall
              ? (overallIsStudio
                  ? 'Total views each month — matched to your TikTok Studio numbers.'
                  : `Views your account got each ${f.grain === 'weekly' ? 'week' : 'day'} — like TikTok Studio (smoothed for the days before daily tracking; exact from now on).`)
              : 'Views grouped by the day each post was published.'}</div>
          </div>
          <div class="chart-controls">
            <div class="seg">
              <button class=${usingOverall ? 'active' : ''} onClick=${() => setTrendView('overall')}>Views over time</button>
              <button class=${!usingOverall ? 'active' : ''} onClick=${() => setTrendView('post')}>By post date</button>
            </div>
            <div class="seg">
              ${['daily', 'weekly', 'monthly'].map(
                (g) => html`<button class=${f.grain === g ? 'active' : ''} onClick=${() => setF((s) => ({ ...s, grain: g }))}>${g[0].toUpperCase() + g.slice(1)}</button>`
              )}
            </div>
          </div>
        </div>
        ${usingOverall && chartData.length === 0
          ? html`<div class="empty" style=${{ padding: '48px 24px' }}>Daily-views tracking just began (~Aug 2026) and fills in a little more each day. Check back soon — or use <strong>By post date</strong> to see your full history.</div>`
          : html`
            <${TrendChart} data=${chartData} grain=${f.grain} />
            <div class="trend-foot">
              <div><div class="k">${usingOverall ? 'Views in this view' : 'Total views'}</div><div class="v">${withThousands(chartedTotal)}</div></div>
              <div><div class="k">Avg. per ${f.grain === 'monthly' ? 'month' : f.grain === 'weekly' ? 'week' : 'day'}</div><div class="v">${compact(avgPer)}</div></div>
              <div><div class="k">Best ${f.grain === 'monthly' ? 'month' : f.grain === 'weekly' ? 'week' : 'day'}</div><div class="v">${compact(best)}</div></div>
              <div><div class="k">Best platform</div><div class="v">${a.bestPlatform ? PLATFORM_LABEL[a.bestPlatform] : '—'}</div></div>
            </div>`}
      </div>

      <${HashtagCard} rows=${a.hashtags} active=${f.hashtag} onPick=${pickHashtag} />
    ` : ''}

    ${showEntry
      ? html`<${MetricsEntry} contents=${publishedAll} onSave=${onSaveMetrics} />`
      : null}
  </div>`;
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
  let mf = null;
  try { mf = JSON.parse(localStorage.getItem('serigama.monthlyfollowers') || 'null'); } catch (e) { mf = null; }
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
      <div class="note">🚀 <strong>${label(peak.key)} was your best month</strong> — +${withThousands(peak.net)} (${(peak.net / (avg || 1)).toFixed(1)}× your ${withThousands(avg)}/month average). One viral video does the heavy lifting.</div>
      <div class="note">📊 Total captured across these months: <strong>+${withThousands(total)}</strong>. Growth is <strong>spiky</strong> — the opportunity is lifting the quiet months, not chasing another fluke.</div>
    </div>
  </div>`;
}

function FollowerCard({ fg, gains, posts, onClose }) {
  const [playing, setPlaying] = useState(null);
  let aud = null;
  try { aud = JSON.parse(localStorage.getItem('serigama.audience') || 'null'); } catch (e) { aud = null; }
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
  const perDay = aud && aud.net28d ? Math.round((aud.net28d / 28) * 10) / 10 : null;
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
  perPost = perPost.sort((a, b) => b.g - a.g).slice(0, 6);
  const fromStudio = perPost.length && perPost[0].studio;

  return html`<div class="card card-pad section-gap">${head}

    ${aud ? html`<div style=${{ marginTop: '10px', padding: '12px 14px', background: '#f4fbf7', border: '1px solid #cdeddd', borderRadius: 'var(--radius-sm)' }}>
      <div style=${{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <span style=${{ fontSize: '20px', fontWeight: 700, color: '#0f7a4d' }}>+${perDay}/day</span>
        <span class="muted" style=${{ fontSize: '12px' }}>average, based on Studio net followers</span>
      </div>
      <div style=${{ display: 'flex', gap: '20px', marginTop: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
        <div>Last 7 days <strong style=${{ color: '#0f7a4d' }}>+${aud.net7d}</strong> <span style=${{ color: aud.net7dChangePct >= 0 ? '#0f7a4d' : '#b4232a', fontSize: '11.5px' }}>${aud.net7dChangePct >= 0 ? '▲' : '▼'}${Math.abs(aud.net7dChangePct)}% vs prior week</span></div>
        <div>Last 28 days <strong style=${{ color: '#0f7a4d' }}>+${aud.net28d}</strong> <span style=${{ color: aud.net28dChangePct >= 0 ? '#0f7a4d' : '#b4232a', fontSize: '11.5px' }}>${aud.net28dChangePct >= 0 ? '▲' : '▼'}${Math.abs(aud.net28dChangePct)}% vs prior 4 wks</span></div>
      </div>
      ${daysTo != null ? html`<div style=${{ fontSize: '12.5px', marginTop: '8px' }}>🎯 At this pace you'll hit <strong>${withThousands(milestone)}</strong> in about <strong>${daysTo} days</strong> (~${etaLabel}).</div>` : ''}
      <div class="muted" style=${{ fontSize: '11px', marginTop: '6px' }}>Captured from Studio on ${aud.capturedAt}. ${aud.net7dChangePct >= 0 && aud.net28dChangePct >= 0 ? html`Growth is <strong style=${{ color: '#0f7a4d' }}>accelerating</strong> — both windows up vs the period before.` : aud.net7dChangePct < 0 && aud.net28dChangePct < 0 ? html`Growth <strong style=${{ color: '#b4232a' }}>cooled</strong> — both windows down vs the period before.` : html`Growth is <strong>mixed</strong> vs the period before — see the two windows above.`}</div>
    </div>` : (fg && fg.days >= 2 ? html`<div style=${{ marginTop: '10px' }}><${TrendChart} data=${fg.points} grain="daily" /></div>` : html`<p class="muted" style=${{ fontSize: '12.5px', marginTop: '8px' }}>Ask me to pull your follower audience from Studio to see daily growth pace and demographics.</p>`)}

    ${perPost.length ? html`<div style=${{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
      <div class="card-title" style=${{ fontSize: '13px', marginBottom: '2px' }}>Followers gained per video ${fromStudio ? html`<span class="muted" style=${{ fontWeight: 400 }}>(from Studio)</span>` : html`<span class="muted" style=${{ fontWeight: 400 }}>(estimated)</span>`}</div>
      <p class="muted" style=${{ fontSize: '11.5px', marginTop: 0, marginBottom: '8px' }}>Which videos actually convert viewers into followers — the real growth engine.</p>
      ${perPost.map((r) => html`<div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '12.5px', padding: '5px 0', borderTop: '1px solid var(--border-2)' }}>
        <span style=${{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }}>
          ${tiktokId(r.c) ? html`<button class="play-btn" title="Play video" onClick=${() => setPlaying(r.c)}>▶</button>` : ''}
          ${r.c.post_url ? html`<a href=${r.c.post_url} target="_blank" rel="noopener" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${clip(r.c.title)}</a>` : html`<span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${clip(r.c.title)}</span>`}
        </span>
        <strong style=${{ color: '#0f7a4d', whiteSpace: 'nowrap' }}>+${withThousands(r.g)}</strong>
      </div>`)}
    </div>` : ''}

    ${aud ? (() => {
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
        <div class="card-title" style=${{ fontSize: '13px', marginBottom: '12px' }}>Who follows you <span class="muted" style=${{ fontWeight: 400 }}>(audience — from Studio)</span></div>
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '12px' }}>
          ${panel('👥', 'Gender', html`
            <div style=${{ display: 'flex', height: '18px', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
              <div style=${{ width: aud.gender[0].pct + '%', background: '#ec4899' }}></div>
              <div style=${{ width: aud.gender[1].pct + '%', background: '#3b82f6' }}></div>
            </div>
            ${legendRow('#ec4899', 'Female', aud.gender[0].pct, cnt(aud.gender[0].pct))}
            ${legendRow('#3b82f6', 'Male', aud.gender[1].pct, cnt(aud.gender[1].pct))}
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
          <div class="note">Two-thirds of your followers are <strong>women (${aud.gender[0].pct}%)</strong>, and <strong>${(aud.age[0].pct + aud.age[1].pct).toFixed(1)}%</strong> are aged <strong>25–44</strong> — working adults with spending power, not teens.</div>
          <div class="note"><strong>${aud.locations[0].pct}% are in ${aud.locations[0].name}.</strong> Malay-language content is clearly the right call; your small Brunei + Singapore slices share the language too.</div>
          <div class="note">🎯 Your sweet spot: <strong>Malay workplace/relatable humour aimed at working women 25–44.</strong> That's exactly who your best posts already reach — keep feeding them.</div>
        </div>
        <div class="muted" style=${{ fontSize: '11px', marginTop: '8px' }}>ℹ️ TikTok only breaks audience location down to <strong>country</strong>, not city — so city-level data isn't available here.</div>
      </div>`;
    })() : ''}
    ${playing ? html`<${VideoModal} video=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

// Top hashtags: which topics pull views. Rows are clickable to filter the whole page.
// Collapsed to the top few by default; "Show all" expands the rest.
function HashtagCard({ rows, active, onPick }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows || rows.length === 0) return null;
  const TOP = 5;
  const shown = expanded ? rows : rows.slice(0, TOP);
  const hidden = rows.length - TOP;
  return html`<div class="card card-pad section-gap">
    <div class="card-title" style=${{ marginBottom: '4px' }}>Top hashtags</div>
    <p class="muted" style=${{ fontSize: '12.5px', marginTop: 0 }}>Which topics pull the most views. Click a hashtag to filter everything above by it.</p>
    <div style=${{ overflowX: 'auto' }}>
      <table class="atable">
        <thead><tr>
          <th>Hashtag</th><th>Posts</th><th>Avg views</th><th>Avg ER</th><th>Total views</th>
        </tr></thead>
        <tbody>
          ${shown.map((h) => html`<tr
            style=${{ cursor: 'pointer', background: active === h.tag ? '#fff7e6' : '' }}
            onClick=${() => onPick(h.tag)}>
            <td><strong>${h.tag}</strong></td>
            <td>${h.posts}</td>
            <td>${compact(h.avgViews)}</td>
            <td>${h.avgER}%</td>
            <td>${compact(h.totalViews)}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    ${hidden > 0
      ? html`<button class="btn btn-sm" style=${{ marginTop: '10px' }} onClick=${() => setExpanded((v) => !v)}>
          ${expanded ? 'Show less' : `Show all ${rows.length} hashtags`}
        </button>`
      : ''}
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

function MonthlyReport({ contents, followers }) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('serigama.monthly') || 'null'); } catch (e) { stored = null; }
  if (!stored || !stored.months) return '';
  const keys = Object.keys(stored.months).sort();
  if (!keys.length) return '';

  // Month a post was published, in local time (published_at is stored in UTC, so a
  // post made early on the 1st in Malaysia would otherwise land in the month before).
  const monthOf = (c) => { const d = parse(c.published_at); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };
  const pubList = (ym) => (contents || []).filter((c) => c.status === 'published' && monthOf(c) === ym);
  const pubViews = (ym) => pubList(ym).reduce((s, c) => s + (Number(c.metrics && c.metrics.views) || 0), 0);
  const vpf = (v) => (followers ? Math.round(v / followers) : 0);
  const ts = stored.trafficSourceOverall || {};

  const rows = keys.map((k) => {
    const m = stored.months[k];
    return { m, short: m.label.slice(0, 3), label: m.complete ? m.label : `${m.label} (1–${m.days})`, studioViews: m.views, pubV: pubViews(k), posts: pubList(k).length, cf: ceilingFloor(pubList(k)) };
  });
  rows.forEach((r, i) => { r.prevCf = i > 0 ? rows[i - 1].cf : null; });

  // All-time ceiling: the best video ever, whichever month it was posted in.
  const allTime = ceilingFloor((contents || []).filter((c) => c.status === 'published'));
  const allTimeWhen = allTime ? parse(allTime.ceilingPost.published_at) : null;
  const clipT = (t, n = 34) => { t = (t || '(untitled)').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  // ▲/▼ vs the month before, as a % change.
  const delta = (cur, prev) => {
    if (cur == null || prev == null || !prev) return '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return html`<span class="wow wow-flat">± 0%</span>`;
    return html`<span class=${'wow ' + (pct > 0 ? 'wow-up' : 'wow-down')} title="vs the month before">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };
  // Plain-language read of the latest month with ceiling & floor data.
  const cfRows = rows.filter((r) => r.cf);
  const latest = cfRows[cfRows.length - 1];
  const prevCf = latest ? latest.prevCf : null;
  let cfVerdict = '';
  if (latest && prevCf) {
    const cUp = latest.cf.ceiling >= prevCf.ceiling, fUp = latest.cf.floor >= prevCf.floor;
    cfVerdict = cUp && fUp ? '✅ Both went up — big ideas and normal videos are getting stronger.'
      : !cUp && !fUp ? '⚠️ Both dropped — nothing broke out, and normal videos are getting less reach too.'
      : cUp ? '🎯 The ceiling rose but the floor fell — a hit carried the month; normal videos need work.'
      : '🪵 The floor rose but the ceiling fell — steadier normal videos, but no big breakout.';
  }
  const last = rows[rows.length - 1];
  const peak = rows.reduce((a, b) => (b.studioViews > a.studioViews ? b : a));
  const avgViews = rows.reduce((s, r) => s + r.studioViews, 0) / rows.length;

  const spark = (vals) => { const b = '▁▂▃▄▅▆▇█'; const mx = Math.max(...vals, 1); return vals.map((v) => b[Math.min(7, Math.round((v / mx) * 7))]).join(''); };
  const studioSpark = spark(rows.map((r) => r.studioViews));
  const postsSpark = spark(rows.map((r) => r.pubV));

  return html`<div class="card card-pad section-gap">
    <div class="card-title">Monthly performance <span class="muted" style=${{ fontWeight: 400 }}>${monthSpan(keys[0], keys[keys.length - 1])}</span></div>
    <div style=${{ overflowX: 'auto' }}>
      <table class="atable">
        <thead><tr>
          <th>Month</th>
          <th title="Views that happened during the month — matches TikTok Studio">📺 Views in the month<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(Studio)</span></th>
          <th title="All-time views of the videos published that month">🎬 From that month's posts<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(all-time)</span></th>
          <th>Posts</th>
          <th title="The best video posted that month — how big one video can pop">🏔️ Ceiling<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(best video)</span></th>
          <th title="The middle (median) video posted that month — what a normal video gets">🪵 Floor<br/><span style=${{ fontWeight: 400, color: 'var(--muted)' }}>(normal video)</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr style=${r === peak ? { background: '#fff7e6' } : {}}>
            <td><strong>${r.label}</strong></td>
            <td>${compact(r.studioViews)}</td>
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
    <div class="eng-notes">
      <div class="note" style=${{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style=${{ fontFamily: 'monospace', fontSize: '18px', letterSpacing: '2px', color: 'var(--blue-1)' }}>${studioSpark}</span>
        <span class="muted" style=${{ fontSize: '12px' }}>📺 views in the month (${rows[0].short}→${last.short})</span>
      </div>
      <div class="note" style=${{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style=${{ fontFamily: 'monospace', fontSize: '18px', letterSpacing: '2px', color: 'var(--gold-strong)' }}>${postsSpark}</span>
        <span class="muted" style=${{ fontSize: '12px' }}>🎬 from that month's posts</span>
      </div>
    </div>
    <div class="eng-notes">
      <div class="note">📺 <strong>Views in the month</strong> — TikTok Studio's figure: views during the month across <em>all</em> your videos. <em>"How much reach did we get?"</em></div>
      <div class="note">🎬 <strong>From that month's posts</strong> — all-time views of the videos you <em>published</em> that month. <em>"How good was that month's content?"</em></div>
      <div class="note">🏔️ <strong>Ceiling</strong> — the views of the <em>best</em> video posted that month. <em>"How big can one video pop?"</em></div>
      <div class="note">🪵 <strong>Floor</strong> — the views of the <em>middle</em> video posted that month (half did better, half did worse). <em>"What does a normal video get?"</em> Each video counts in the month it was <em>posted</em>, even if its views came later.</div>
    </div>
    ${latest ? html`<div class="eng-notes" style=${{ borderLeft: '3px solid var(--blue-1)' }}>
      <div class="eng-notes-title">🏔️ Ceiling & floor</div>
      <div class="note"><strong>${latest.label}:</strong> ceiling <strong>${compact(latest.cf.ceiling)}</strong> (“${clipT(latest.cf.ceilingPost.title, 44)}”)${prevCf ? html`, vs ${compact(prevCf.ceiling)} the month before` : ''} · floor <strong>${compact(latest.cf.floor)}</strong>${prevCf ? html`, vs ${compact(prevCf.floor)}` : ''}.</div>
      ${cfVerdict ? html`<div class="note">${cfVerdict}</div>` : ''}
      ${allTime ? html`<div class="note">🚀 <strong>All-time ceiling: ${compact(allTime.ceiling)}</strong> — “${clipT(allTime.ceilingPost.title, 44)}”${allTimeWhen ? ` (${allTimeWhen.toLocaleString('en-US', { month: 'short', year: 'numeric' })})` : ''}. Proof the account can reach this — the monthly ceiling shows how close each month got.</div>` : ''}
      <div class="note">📏 Score a month by <strong>“did we land one big video?”</strong> (the ceiling), not just how many we posted — while keeping the floor from sliding.</div>
    </div>` : ''}
    <div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
      <div class="note">🚀 <strong>${peak.short} was your biggest month by far</strong> — ${compact(peak.studioViews)} views, <strong>${(peak.studioViews / avgViews).toFixed(1)}× your monthly average</strong>${last.m.complete ? '' : `; ${last.short} is at ${compact(last.studioViews)} so far`}.</div>
      <div class="note">🎯 <strong>Reach efficiency:</strong> ${peak.short} reached <strong>${vpf(peak.studioViews)}×</strong> your follower count — nearly all your reach is the algorithm, not your following.</div>
      <div class="note">📡 <strong>Traffic source (overall):</strong> For You <strong>${ts['For You']}%</strong> · Profile ${ts['Personal profile']}% · Search ${ts['Search']}%.</div>
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
      const tv = sb.views || 1;
      const shareRate = Math.round((sb.shares / tv) * 1000) / 10;
      const commentRate = Math.round((sb.comments / tv) * 10000) / 100;
      const likeRate = Math.round((sb.likes / tv) * 1000) / 10;
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
          <div style=${{ display: 'flex', height: '24px', borderRadius: '6px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style=${{ width: likePct + '%', background: '#ec4899' }} title="Likes"></div>
            <div style=${{ width: commentPct + '%', background: '#3b82f6' }} title="Comments"></div>
            <div style=${{ width: sharePct + '%', background: '#22c55e' }} title="Shares"></div>
          </div>
          <div class="note">❤️ Likes <strong>${compact(sb.likes)}</strong> · 💬 Comments <strong>${compact(sb.comments)}</strong> · 🔁 Shares <strong>${compact(sb.shares)}</strong>.</div>
          <div class="note" style=${{ color: 'var(--muted)' }}>Shares spread you to new people (reach), comments build community, likes are passive approval — a healthy share slice is the best growth sign.</div>
        </div>
        <div class="eng-notes">
          <div class="eng-notes-title">Key rates (per view)</div>
          <div class="note">🔁 <strong>Share rate ${shareRate}%</strong> — of everyone who watched, this many sent it on. Shares are TikTok's strongest reach signal.</div>
          <div class="note">💬 <strong>Comment rate ${commentRate}%</strong> — how much conversation each video sparks.</div>
          <div class="note">❤️ <strong>Like rate ${likeRate}%</strong> · 📊 <strong>Avg. engagement rate ${a.avgER}%</strong> ${erTag(a.avgER)} — ${erVerdict}.</div>
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
          <div class="eng-notes-title">🔖 Most saved <span class="muted" style=${{ fontWeight: 400 }}>(highest-intent — from Studio)</span></div>
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
    ${showStudio && studioSummaryNotes.length
      ? html`<div class="eng-notes" style=${{ marginTop: '12px', borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📈 What your numbers are saying <span class="muted" style=${{ fontWeight: 400 }}>(from ${rows.filter((c) => c.studio).length} captured)</span></div>
          ${studioSummaryNotes.map((nt) => html`<div class="note" dangerouslySetInnerHTML=${{ __html: nt }}></div>`)}
        </div>`
      : ''}
    ${showStudio
      ? html`<div class="eng-notes" style=${{ marginTop: '12px' }}>
          <div class="eng-notes-title">📊 Hook / New viewers / New followers — what they mean</div>
          <div class="note">🪝 <strong>Hook 3s</strong> — % still watching at 3 seconds. <strong style=${{ color: '#0f7a4d' }}>60%+ strong</strong>, 40–59% okay, <strong style=${{ color: '#b4232a' }}>under 40% weak</strong>.</div>
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
    ${summary.length
      ? html`<div class="eng-notes" style=${{ borderLeft: '3px solid var(--gold-strong)' }}>
          <div class="eng-notes-title">📈 What your numbers are saying</div>
          ${summary.map((nt) => html`<div class="note" dangerouslySetInnerHTML=${{ __html: nt }}></div>`)}
        </div>`
      : ''}
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
      <div class="note">🪝 <strong>Hook 3s</strong> — % still watching at 3 seconds. <strong style=${{ color: '#0f7a4d' }}>60%+ strong</strong>, 40–59% okay, <strong style=${{ color: '#b4232a' }}>under 40% weak</strong>.</div>
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
