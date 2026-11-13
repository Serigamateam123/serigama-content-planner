import { html } from '../lib/html.js';
import { useRemembered } from '../lib/remember.js';
import { useState, useEffect } from 'preact/hooks';
import { PLATFORM_SHORT } from '../lib/account.js';
import { Icon, Platform, Badge } from '../components/ui.js';
import { PLATFORMS, STATUSES, FUNNELS } from '../lib/constants.js';
import { monthMatrix, monthYear, isSameDay, isSameMonth, dayKey, time, addDays, startOfWeek, parse } from '../lib/date.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_HOUR = 10; // time given to a backlog post dropped onto a day

// accounts / accountTag are set only in the "All accounts" view: each post then
// shows which account it belongs to, and there's an account filter + legend.
export function Calendar({ contents, accounts = null, accountTag = null, scopeLabel = '', onNew, onOpen, onNewOnDate, onReschedule, onGuide = null }) {
  const [acctFilter, setAcctFilter] = useState('all');
  if (accounts && acctFilter !== 'all') contents = contents.filter((c) => { const t = accountTag && accountTag(c); return t && t.id === acctFilter; });
  const tagEl = (c) => { const t = accountTag && accountTag(c); return t ? html`<span class="cal-acct" style=${{ color: t.color }}><i style=${{ background: t.color }}></i>${t.label}</span>` : null; };
  const [cursor, setCursor] = useRemembered('calendar.month', () => new Date(), { revive: (v) => new Date(v) });
  const [view, setView] = useRemembered('calendar.view', 'month');
  // status 'active' = everything except taken-down posts (the default).
  const [filters, setFilters] = useRemembered('calendar.filters', { platform: 'all', status: 'active', funnel: 'all' });
  const [dragId, setDragId] = useState(null);
  const [overKey, setOverKey] = useState(null); // day (or 'backlog') being dragged over
  // Phone agenda: open at today rather than the 1st of the month.
  useEffect(() => {
    if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
    const t = setTimeout(() => {
      const el = document.querySelector('.cal-cell.today:not(.other)');
      const main = document.querySelector('.main');
      if (el && main) main.scrollTo({ top: el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 72, behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [String(cursor), view]);
  // Card edge colour = the post's funnel stage (grey when untagged).
  const funnelColor = (id) => (FUNNELS.find((f) => f.id === id) || {}).accent || 'var(--muted-2)';
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const visible = contents.filter((c) => {
    if (filters.platform !== 'all' && c.platform !== filters.platform) return false;
    if (filters.status === 'active' ? c.status === 'takedown' : filters.status !== 'all' && c.status !== filters.status) return false;
    if (filters.funnel === 'none' ? c.funnel_stage : filters.funnel !== 'all' && c.funnel_stage !== filters.funnel) return false;
    return true;
  });
  const filtered = filters.platform !== 'all' || filters.status !== 'active' || filters.funnel !== 'all';

  const scheduled = visible.filter((c) => c.scheduled_at);
  const backlog = visible.filter((c) => !c.scheduled_at);
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

  // --- drag & drop (published posts stay put: their date is the real post date) ---
  const canDrag = (c) => c.status !== 'published' && !!onReschedule;
  const dragProps = (c) => (canDrag(c)
    ? {
        draggable: true,
        onDragStart: (e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragId(c.id); },
        onDragEnd: () => { setDragId(null); setOverKey(null); },
      }
    : {});
  const dropProps = (key, onDropId) => ({
    onDragOver: (e) => { if (!dragId) return; e.preventDefault(); if (overKey !== key) setOverKey(key); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverKey((k) => (k === key ? null : k)); },
    onDrop: (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragId;
      setDragId(null); setOverKey(null);
      if (id) onDropId(id);
    },
  });
  const moveToDay = (day) => (id) => {
    const c = contents.find((x) => x.id === id);
    if (!c) return;
    const prev = parse(c.scheduled_at);
    if (prev && isSameDay(prev, day)) return;
    const d = new Date(day);
    if (prev) d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    else d.setHours(DEFAULT_HOUR, 0, 0, 0);
    onReschedule(id, d.toISOString());
  };
  const moveToBacklog = (id) => {
    const c = contents.find((x) => x.id === id);
    if (c && c.scheduled_at) onReschedule(id, null);
  };

  const eventEl = (c) => html`<div class=${'cal-event' + (c.id === dragId ? ' dragging' : '') + (c.status === 'takedown' ? ' is-takedown' : '')}
    style=${{ borderLeftColor: funnelColor(c.funnel_stage) }}
    title=${canDrag(c) ? 'Drag to another day to reschedule' : ''}
    ...${dragProps(c)}
    onClick=${(e) => { e.stopPropagation(); onOpen(c); }}>
    <div class="t">${c.format === 'reply' ? html`<span class="reply-tag">Reply</span> ` : ''}${c.trial ? html`<span class="trial-tag">Trial reel</span> ` : ''}${c.title}</div>
    <div class="m">${time(c.scheduled_at)} · ${tagEl(c) || _platformShort(c.platform)}${c.status ? html` <span class=${'st-pill st-' + c.status}>${_statusShort(c.status)}</span>` : ''}${_jobPill(c.publishJob)}</div>
  </div>`;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Planning</div>
        <h1 class="page-title">Content Calendar${scopeLabel ? html` <span class="muted" style=${{ fontWeight: 500, fontSize: '0.6em' }}>· ${scopeLabel}</span>` : ''}</h1>
      </div>
      <div class="page-actions">
        ${onGuide ? html`<button class="btn" onClick=${onGuide} title="How to be active on Threads, with examples">📘 Threads guide</button>` : ''}
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

    <div class="cal-filters">
      ${accounts ? html`<select class="hdr-select" value=${acctFilter} onChange=${(e) => setAcctFilter(e.target.value)} aria-label="Account">
        <option value="all">All accounts</option>
        ${accounts.map((a) => html`<option value=${a.id}>${a.label}</option>`)}
      </select>` : ''}
      <select class="hdr-select" value=${filters.platform} onChange=${setF('platform')} aria-label="Platform">
        <option value="all">All platforms</option>
        ${PLATFORMS.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
      </select>
      <select class="hdr-select" value=${filters.status} onChange=${setF('status')} aria-label="Status">
        <option value="active">All statuses (hide taken down)</option>
        <option value="all">All statuses (incl. taken down)</option>
        ${STATUSES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
      </select>
      <select class="hdr-select" value=${filters.funnel} onChange=${setF('funnel')} aria-label="Funnel stage">
        <option value="all">All funnel stages</option>
        ${FUNNELS.map((f) => html`<option value=${f.id}>${f.emoji} ${f.name}</option>`)}
        <option value="none">Not tagged</option>
      </select>
      ${filtered ? html`<button class="btn btn-ghost btn-sm" onClick=${() => setFilters({ platform: 'all', status: 'active', funnel: 'all' })}>Clear filters</button>` : ''}
      <span class="muted cal-hint">Tip: drag a post to another day to reschedule it.</span>
    </div>

    <div class="legend" style=${{ marginBottom: '14px' }}>
      ${FUNNELS.map((f) => html`<span class="legend-item"><span class="dot" style=${{ background: f.accent }}></span>${f.name}</span>`)}
      <span class="legend-item"><span class="dot" style=${{ background: 'var(--muted-2)' }}></span>Not tagged</span>
      ${accounts ? html`<span class="legend-item" style=${{ marginLeft: '8px', fontWeight: 600 }}>Accounts:</span>
        ${accounts.map((a) => html`<span class="legend-item"><span class="dot" style=${{ background: a.color }}></span>${a.label}</span>`)}` : ''}
    </div>

    ${backlog.length > 0 || dragId
      ? html`<div class=${'backlog card card-pad' + (overKey === 'backlog' ? ' drop-over' : '')} ...${dropProps('backlog', moveToBacklog)}>
          <div class="backlog-head">
            <div class="card-title">Unscheduled <span class="muted">(${backlog.length})</span></div>
            <span class="muted" style=${{ fontSize: '12px' }}>${dragId ? 'Drop here to unschedule' : 'Click a card to schedule it, or drag it onto a day'}</span>
          </div>
          <div class="backlog-strip">
            ${backlog.map(
              (c) => html`<div class=${'chip' + (c.id === dragId ? ' dragging' : '')} style=${{ borderLeftColor: funnelColor(c.funnel_stage) }} ...${dragProps(c)} onClick=${() => onOpen(c)}>
                <div class="chip-title">${c.trial ? html`<span class="trial-tag">Trial reel</span> ` : ''}${c.title}</div>
                <div class="chip-meta"><${Badge} status=${c.status} /> ${tagEl(c) || html`<${Platform} id=${c.platform} />`}</div>
              </div>`
            )}
          </div>
        </div>`
      : null}

    ${(() => {
      // Phone agenda: a month with nothing scheduled would otherwise look blank.
      const inView = weeks.flat(); // includes the neighbouring-month days the grid shows
      return inView.some((d) => (byDay.get(dayKey(d)) || []).length) ? '' : html`<p class="cal-agenda-empty muted">Nothing scheduled ${view === 'month' ? 'this month' : 'this week'} yet.</p>`;
    })()}
    <div class=${'cal section-gap' + (view === 'week' ? ' week-view' : '')}>
      <div class="cal-dow">${DOW.map((d) => html`<div>${d}</div>`)}</div>
      <div class="cal-grid">
        ${weeks.flat().map((day) => {
          const k = dayKey(day);
          const items = byDay.get(k) || [];
          const today = isSameDay(day, new Date());
          const cls =
            'cal-cell' +
            (view === 'month' && !isSameMonth(day, cursor) ? ' other' : '') +
            (today ? ' today' : '') +
            (items.length ? ' has-items' : '') +
            (overKey === k ? ' drop-over' : '');
          // data-label: the full date, shown instead of the bare number in the phone agenda.
          const label = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + (today ? ' · Today' : '');
          return html`<div class=${cls} onClick=${() => onNewOnDate(day)} ...${dropProps(k, moveToDay(day))}>
            <div class="cal-daynum" data-label=${label}>${day.getDate()}</div>
            <button class="cal-add" onClick=${(e) => { e.stopPropagation(); onNewOnDate(day); }} aria-label="Add">+</button>
            ${items.map(eventEl)}
            ${items.length ? '' : html`<div class="cal-empty">Nothing planned — tap + to add</div>`}
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function _platformShort(id) {
  return PLATFORM_SHORT[id] || id;
}

function _statusShort(id) {
  return { idea: 'Idea', draft: 'Draft', scripting: 'Script', filming: 'Filming', editing: 'Editing', ready: 'Ready', scheduled: 'Scheduled', published: 'Posted', takedown: 'Taken down' }[id] || id;
}

// Auto-post state (supabase/publish.sql), shown next to the status badge.
function _jobPill(j) {
  if (!j || j.status === 'cancelled' || j.status === 'published') return '';
  if (j.status === 'failed') return html` <span class="st-pill ap-pill-bad" title=${j.error || ''}>⚠ Post failed</span>`;
  if (j.status === 'processing') return html` <span class="st-pill ap-pill">⏳ Posting</span>`;
  return html` <span class="st-pill ap-pill" title="Posts to Instagram automatically">📤 Auto-post</span>`;
}
