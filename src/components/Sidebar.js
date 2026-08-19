import { html } from '../lib/html.js';
import { Icon } from './ui.js';

const NAV = [
  { id: 'dashboard', label: 'Content Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Content Calendar', icon: 'calendar' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaign' },
  { id: 'overview', label: 'Analytics Dashboard', icon: 'analytics' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
];

export function Sidebar({ route, onNavigate, onNew, config, session, isCloud, onSignOut }) {
  const owner = config.ownerName || 'Serigama';
  const initial = owner.trim().charAt(0).toUpperCase() || 'S';
  return html`<aside class="sidebar">
    <div class="brand">
      <div class="brand-name">${config.brandName || 'Serigama'}</div>
      <div class="brand-sub">Content Planner</div>
    </div>

    <button class="btn-new" onClick=${onNew}>
      <${Icon} name="plus" size=${16} /><span>New content</span>
    </button>

    <nav class="nav">
      ${NAV.map(
        (n) => html`<button
          class=${'nav-item' + (route === n.id ? ' active' : '')}
          onClick=${() => onNavigate(n.id)}
        >
          <${Icon} name=${n.icon} size=${17} /><span>${n.label}</span>
        </button>`
      )}
    </nav>

    <div class="user">
      <div class="avatar">${initial}</div>
      <div>
        <div class="user-name">${owner}</div>
        <div class="user-role">${isCloud ? session?.user?.email || config.ownerRole : config.ownerRole || 'Local demo'}</div>
      </div>
      ${isCloud
        ? html`<button class="signout" onClick=${onSignOut} title="Sign out">Sign out</button>`
        : null}
    </div>
  </aside>`;
}
