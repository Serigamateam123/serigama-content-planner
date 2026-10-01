import { html } from '../lib/html.js';
import { useRemembered } from '../lib/remember.js';
import { useState } from 'preact/hooks';
import { Kpi, Badge, Platform, Icon, Empty } from '../components/ui.js';
import { dashboard, erOf, compact } from '../lib/metrics.js';
import { STATUS_LABEL, FUNNELS } from '../lib/constants.js';

// "🛒 Bottom Funnel · " prefix for a post's meta line (empty when untagged).
const funnelTag = (c) => { const f = FUNNELS.find((x) => x.id === c.funnel_stage); return f ? `${f.emoji} ${f.name} · ` : ''; };
import { longDate, shortMonth, shortDate, parse, startOfDay, addDays, startOfMonth, endOfMonth, startOfWeek } from '../lib/date.js';

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: '7', label: 'Next 7 days' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: '30', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
];

function rangeFor(key, now) {
  const sod = startOfDay(now);
  const eod = (dd) => { const x = new Date(dd); x.setHours(23, 59, 59, 999); return x; };
  switch (key) {
    case 'today': return { from: sod, to: eod(sod) };
    case 'tomorrow': { const t = addDays(sod, 1); return { from: t, to: eod(t) }; }
    case '7': return { from: sod, to: eod(addDays(sod, 6)) };
    case 'week': { const w = startOfWeek(now); return { from: w, to: eod(addDays(w, 6)) }; }
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) };
    case '30': return { from: addDays(sod, -29), to: eod(sod) };
    default: return { from: null, to: null };
  }
}

// A small up/down/flat chip for period-over-period deltas.
function cmpChip(label, delta, unit) {
  if (delta == null) return '';
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '±';
  const mag = Math.abs(delta);
  const val = unit === '%' ? mag + '%' : unit === 'pts' ? mag + ' pts' : mag;
  return html`<span class=${'cmp-chip ' + cls}>${label} ${arrow} ${val}</span>`;
}

export function Dashboard({ contents, config, onNew, onOpen, onNavigate, onRefresh }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // A single date-range filter drives every tile, so the overview stays consistent.
  const [rangeKey, setRangeKey] = useRemembered('dashboard.range', 'month');
  const rangeLabel = (RANGES.find((r) => r.key === rangeKey) || {}).label || '';
  const d = dashboard(contents, now, rangeFor(rangeKey, now));

  // Clickable KPI tiles: clicking one highlights it (yellow) and lists its content below.
  const [sel, setSel] = useState(null);
  const kpis = [
    { kind: 'month', label: 'Content', value: d.contentThisMonth, sub: rangeLabel.toLowerCase() },
    { kind: 'scheduled', label: 'Scheduled', value: d.scheduledCount, sub: 'ready to post' },
    { kind: 'published', label: 'Published', value: d.publishedThisMonth, sub: rangeLabel.toLowerCase() },
    { kind: 'ideas', label: 'Ideas', value: d.ideasCount, sub: 'in the backlog' },
    { kind: 'engagement', label: 'Avg. engagement', value: d.avgER + '%', sub: rangeLabel.toLowerCase() },
  ];
  const selList = sel ? d.lists[sel] || [] : [];
  const selLabel = sel ? (kpis.find((k) => k.kind === sel) || {}).label : '';
  const [stage, setStage] = useState(null); // pipeline stage being listed
  const stageItems = stage ? (d.pipeline.find((p) => p.id === stage) || { items: [] }).items : [];

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Overview</div>
        <h1 class="page-title">${greeting}, ${config.ownerName || 'there'}</h1>
        <div class="page-sub">${longDate(now)}</div>
      </div>
      <div class="page-actions">
        <select class="hdr-select" value=${rangeKey} onChange=${(e) => setRangeKey(e.target.value)} title="Date range">
          ${RANGES.map((r) => html`<option value=${r.key}>${r.label}</option>`)}
        </select>
        <button class="btn" onClick=${onRefresh}><${Icon} name="refresh" size=${15} /> Refresh</button>
        <button class="btn" onClick=${() => onNavigate('calendar')}><${Icon} name="calendar" size=${15} /> Open calendar</button>
        <button class="btn btn-gold" onClick=${onNew}><${Icon} name="plus" size=${15} /> New content</button>
      </div>
    </div>

    <div class="kpi-row kpi-5">
      ${kpis.map((k) => html`<${Kpi}
        label=${k.label} value=${k.value} sub=${k.sub}
        active=${sel === k.kind}
        onClick=${() => setSel((s) => (s === k.kind ? null : k.kind))}
      />`)}
    </div>

    ${sel
      ? html`<div class="card card-pad section-gap">
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div class="card-title">${selLabel} <span class="muted">(${selList.length})</span></div>
            <button class="btn btn-ghost btn-sm" onClick=${() => setSel(null)}>Close</button>
          </div>
          ${selList.length === 0
            ? html`<${Empty} title="Nothing here yet">No content in this group.</${Empty}>`
            : sel === 'engagement'
            ? html`<div>
                <div class="score-strip">
                  ${[
                    ['Total views', d.scoreboard.views],
                    ['Likes', d.scoreboard.likes],
                    ['Comments', d.scoreboard.comments],
                    ['Shares', d.scoreboard.shares],
                    ['Total engagement', d.scoreboard.engagement],
                  ].map(([k, v]) => html`<div class="score">
                    <div class="score-v">${compact(v)}</div>
                    <div class="score-k">${k}</div>
                  </div>`)}
                </div>
                ${d.comparison
                  ? html`<div class="cmp-row">
                      <span class="cmp-label">vs previous period</span>
                      ${cmpChip('Views', d.comparison.viewsPct, '%')}
                      ${cmpChip('Eng. rate', d.comparison.erDelta, 'pts')}
                      ${cmpChip('Posts', d.comparison.curPosts - d.comparison.prevPosts, '')}
                    </div>`
                  : ''}
                ${d.engNotes && d.engNotes.length
                  ? html`<div class="eng-notes">
                      <div class="eng-notes-title">📝 Notes — what to improve</div>
                      ${d.engNotes.map((nt) => html`<div class="note">${nt}</div>`)}
                    </div>`
                  : ''}
                <div style=${{ overflowX: 'auto' }}>
                <table class="atable">
                  <thead><tr>
                    <th>Video</th><th>Views</th><th>ER</th><th>Likes</th><th>Shares</th><th>Comments</th>
                  </tr></thead>
                  <tbody>
                    ${selList.map((c) => {
                      const m = c.metrics || {};
                      return html`<tr>
                        <td class="atable-title">
                          ${c.post_url
                            ? html`<a href=${c.post_url} target="_blank" rel="noopener noreferrer">${c.title}</a>`
                            : html`<span onClick=${() => onOpen(c)} style=${{ cursor: 'pointer', color: 'var(--blue-1)' }}>${c.title}</span>`}
                        </td>
                        <td>${compact(Number(m.views) || 0)}</td>
                        <td>${Math.round(erOf(m) * 10) / 10}%</td>
                        <td>${compact(Number(m.likes) || 0)}</td>
                        <td>${compact(Number(m.shares) || 0)}</td>
                        <td>${compact(Number(m.comments) || 0)}</td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
                </div>
              </div>`
            : html`<div class="list">
                ${selList.map((c) => {
                  const dt = parse(c.scheduled_at || c.published_at);
                  return html`<div class="sched-item" style=${{ cursor: 'pointer' }} onClick=${() => onOpen(c)}>
                    <div class="sched-main">
                      <div class="sched-title">${c.title}</div>
                      <div class="sched-meta">
                        ${funnelTag(c)}<${Platform} id=${c.platform} />${dt ? ' · ' + shortDate(dt) : ''}
                        ${c.metrics
                          ? html` · <b>${compact(Number(c.metrics.views) || 0)}</b> views · ${Math.round(erOf(c.metrics) * 10) / 10}% ER`
                          : ''}
                      </div>
                    </div>
                    <${Badge} status=${c.status} />
                  </div>`;
                })}
              </div>`}
        </div>`
      : null}

    ${d.actionNeeded > 0
      ? html`<div class="alert">
          <div class="alert-dot"><${Icon} name="alert" size=${15} /></div>
          <div class="alert-text">
            <b>Needs attention:</b> ${d.overdue.length} ${d.overdue.length === 1 ? 'post is' : 'posts are'} past
            the planned date and not posted yet${d.missingCaption.length ? html` and ${d.missingCaption.length} scheduled ${d.missingCaption.length === 1 ? 'post is' : 'posts are'} missing a final caption` : ''}.
          </div>
          <button class="btn btn-sm" onClick=${() => onNavigate('calendar')}>Review</button>
        </div>`
      : null}

    <div class="card card-pad section-gap">
      <div class="card-title" style=${{ marginBottom: '10px' }}>Production pipeline <span class="muted" style=${{ fontWeight: 400 }}>— where every post is right now</span></div>
      <div class="pipeline">
        ${d.pipeline.map((p, i) => html`<button class=${'pipe-step' + (stage === p.id ? ' active' : '')} onClick=${() => setStage((s) => (s === p.id ? null : p.id))}>
          <span class="pipe-n">${p.items.length}</span>
          <span class="pipe-l">${STATUS_LABEL[p.id]}</span>
          ${i < d.pipeline.length - 1 ? html`<span class="pipe-arrow">›</span>` : ''}
        </button>`)}
      </div>
      ${stage
        ? stageItems.length === 0
          ? html`<div class="muted" style=${{ fontSize: '12.5px', paddingTop: '10px' }}>Nothing at this stage.</div>`
          : html`<div class="list" style=${{ marginTop: '8px' }}>
              ${stageItems.map((c) => {
                const dt = parse(c.scheduled_at);
                const late = dt && dt < now;
                return html`<div class="sched-item" style=${{ cursor: 'pointer' }} onClick=${() => onOpen(c)}>
                  <div class="sched-main">
                    <div class="sched-title">${c.title}</div>
                    <div class="sched-meta">
                      <${Platform} id=${c.platform} />
                      ${dt ? html` · <span style=${late ? { color: 'var(--red)', fontWeight: 600 } : {}}>${late ? 'was due ' : 'due '}${shortDate(dt)}</span>` : ' · no date yet'}
                      ${c.assignee ? html` · 👤 ${c.assignee}` : ''}
                    </div>
                  </div>
                  <${Badge} status=${c.status} />
                </div>`;
              })}
            </div>`
        : ''}
    </div>

    <div class="card card-pad section-gap">
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div class="card-title">Next 7 days</div>
          <button class="btn btn-ghost btn-sm" onClick=${() => onNavigate('calendar')}>View all</button>
        </div>
        ${d.next7.length === 0
          ? html`<${Empty} title="Nothing scheduled">Add content and set a date to see it here.</${Empty}>`
          : html`<div class="list">
              ${d.next7.map((c) => {
                const dt = parse(c.scheduled_at);
                return html`<div class="sched-item" onClick=${() => onOpen(c)} style=${{ cursor: 'pointer' }}>
                  <div class="sched-date">
                    <div class="d">${dt.getDate()}</div>
                    <div class="m">${shortMonth(dt)}</div>
                  </div>
                  <div class="sched-main">
                    <div class="sched-title">${c.title}</div>
                    <div class="sched-meta">
                      ${funnelTag(c)}<${Platform} id=${c.platform} />${c.assignee ? html` · 👤 ${c.assignee}` : ''}
                    </div>
                  </div>
                  <${Badge} status=${c.status} />
                </div>`;
              })}
            </div>`}
    </div>
  </div>`;
}
