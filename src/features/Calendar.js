import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Platform } from '../components/ui.js';
import { monthMatrix, monthYear, isSameDay, isSameMonth, dayKey, time, addDays, startOfWeek } from '../lib/date.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Calendar({ contents, campaigns, onNew, onOpen, onNewOnDate }) {
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState('month');
  const campColor = (id) => (campaigns.find((c) => c.id === id) || {}).color || 'var(--muted-2)';

  const scheduled = contents.filter((c) => c.scheduled_at);
  const backlog = contents.filter((c) => !c.scheduled_at);
  const byDay = new Map();
  for (const c of scheduled) {
    const k = dayKey(c.scheduled_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(c);
  }
  for (const list of byDay.values()) list.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const go = (delta) => {
    const d = new Date(cursor);
    if (view === 'month') d.setMonth(d.getMonth() + delta);
    else d.setDate(d.getDate() + delta * 7);
    setCursor(d);
  };

  const weeks = view === 'month' ? monthMatrix(cursor) : [Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))];

  const eventEl = (c) => html`<div class="cal-event" style=${{ borderLeftColor: campColor(c.campaign_id) }} onClick=${(e) => { e.stopPropagation(); onOpen(c); }}>
    <div class="t">${c.title}</div>
    <div class="m">${time(c.scheduled_at)} · ${_platformShort(c.platform)}</div>
  </div>`;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Planning</div>
        <h1 class="page-title">Content Calendar</h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-gold" onClick=${onNew}><${Icon} name="plus" size=${15} /> Add content</button>
      </div>
    </div>

    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="icon-btn" onClick=${() => go(-1)} aria-label="Previous"><${Icon} name="chevronLeft" size=${16} /></button>
        <button class="icon-btn" onClick=${() => go(1)} aria-label="Next"><${Icon} name="chevronRight" size=${16} /></button>
      </div>
      <div class="cal-month">${monthYear(cursor)}</div>
      <button class="btn btn-sm" onClick=${() => setCursor(new Date())}>Today</button>
      <div style=${{ flex: 1 }}></div>
      <div class="seg">
        <button class=${view === 'month' ? 'active' : ''} onClick=${() => setView('month')}>Month</button>
        <button class=${view === 'week' ? 'active' : ''} onClick=${() => setView('week')}>Week</button>
      </div>
    </div>

    <div class="legend" style=${{ marginBottom: '14px' }}>
      ${campaigns.map((c) => html`<span class="legend-item"><span class="dot" style=${{ background: c.color }}></span>${c.name}</span>`)}
    </div>

    ${backlog.length > 0
      ? html`<div class="backlog card card-pad">
          <div class="backlog-head">
            <div class="card-title">Unscheduled <span class="muted">(${backlog.length})</span></div>
            <span class="muted" style=${{ fontSize: '12px' }}>Click a card to schedule it</span>
          </div>
          <div class="backlog-strip">
            ${backlog.map(
              (c) => html`<div class="chip" style=${{ borderLeftColor: campColor(c.campaign_id) }} onClick=${() => onOpen(c)}>
                <div class="chip-title">${c.title}</div>
                <div class="chip-meta"><span class="badge badge-draft">Draft</span> <${Platform} id=${c.platform} /></div>
              </div>`
            )}
          </div>
        </div>`
      : null}

    <div class=${'cal section-gap' + (view === 'week' ? ' week-view' : '')}>
      <div class="cal-dow">${DOW.map((d) => html`<div>${d}</div>`)}</div>
      <div class="cal-grid">
        ${weeks.flat().map((day) => {
          const k = dayKey(day);
          const items = byDay.get(k) || [];
          const cls =
            'cal-cell' +
            (view === 'month' && !isSameMonth(day, cursor) ? ' other' : '') +
            (isSameDay(day, new Date()) ? ' today' : '');
          return html`<div class=${cls} onClick=${() => onNewOnDate(day)}>
            <div class="cal-daynum">${day.getDate()}</div>
            <button class="cal-add" onClick=${(e) => { e.stopPropagation(); onNewOnDate(day); }} aria-label="Add">+</button>
            ${items.map(eventEl)}
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function _platformShort(id) {
  return { tiktok: 'TikTok', instagram: 'IG', youtube: 'YouTube', facebook: 'FB', threads: 'Threads' }[id] || id;
}
