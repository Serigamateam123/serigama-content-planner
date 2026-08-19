// Small shared UI building blocks used across screens.
import { html } from '../lib/html.js';
import { PLATFORM_LABEL, STATUS_LABEL } from '../lib/constants.js';

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  campaign: '<path d="M4 22V4M4 4h12l-2 4 2 4H4"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
};

export function Icon({ name, size = 18, stroke = 2 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round"
    dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }}></svg>`;
}

export function Kpi({ label, value, sub, gold, active, onClick }) {
  const clickable = typeof onClick === 'function';
  return html`<div
    class=${'kpi' + (gold || active ? ' kpi-gold' : '') + (clickable ? ' kpi-click' : '')}
    onClick=${onClick}
    role=${clickable ? 'button' : null}>
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? html`<div class="kpi-sub">${sub}</div>` : null}
  </div>`;
}

export function Dot({ color }) {
  return html`<span class="dot" style=${{ background: color || 'var(--muted-2)' }}></span>`;
}

export function Badge({ status }) {
  return html`<span class=${'badge badge-' + status}>${STATUS_LABEL[status] || status}</span>`;
}

export function Platform({ id }) {
  return html`<span class="platform">${PLATFORM_LABEL[id] || id}</span>`;
}

export function Progress({ pct, color }) {
  return html`<div class="progress"><i style=${{ width: Math.max(2, pct) + '%', background: color || 'var(--blue-1)' }}></i></div>`;
}

export function Modal({ title, onClose, children, footer }) {
  const stop = (e) => e.stopPropagation();
  return html`<div class="overlay" onClick=${onClose}>
    <div class="modal" onClick=${stop} role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="x-btn" onClick=${onClose} aria-label="Close">×</button>
      </div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : null}
    </div>
  </div>`;
}

export function Empty({ title, children }) {
  return html`<div class="empty"><h3>${title}</h3><div>${children}</div></div>`;
}
