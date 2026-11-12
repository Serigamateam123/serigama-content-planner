import { html } from '../lib/html.js';
import { Icon } from './ui.js';
import { socialAccounts, PLATFORM_NAME, PLATFORM_SHORT, accountColor } from '../lib/account.js';
import { startTikTokConnect, startInstagramConnect, startThreadsConnect } from '../features/TikTokConnect.js';

const ADD = '__add_tiktok__';
const ADD_IG = '__add_instagram__';
const ADD_TH = '__add_threads__';

const NAV = [
  { section: 'Plan' },
  { id: 'dashboard', label: 'Content Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Content Calendar', icon: 'calendar' },
  { id: 'fundamental', label: 'Content Funnel', icon: 'funnel' },
  { section: 'Report' },
  { id: 'overview', label: 'Monthly Report', icon: 'report' },
  { id: 'analytics', label: 'Post Performance', icon: 'analytics' },
  { id: 'targets', label: 'Targets', icon: 'target' },
  { section: 'Settings', owner: true },
  { id: 'team', label: 'Team', icon: 'users', owner: true },
];

// role: 'owner' | 'full' | 'calendar' (supabase/team.sql). Everyone sees the whole
// menu; pages their role can't open (`locked`) show a lock and open a "no access"
// notice instead. Only the owner can connect accounts.
export function Sidebar({ open = false, route, role = 'owner', locked = [], onNavigate, onNew, config, accounts, accountId, onSwitchAccount, calScope, onCalendarScope, session, isCloud, onSetPassword, onSignOut }) {
  const nav = NAV;
  const isLocked = (id) => locked.includes(id);
  const canConnect = isCloud && role === 'owner';
  const owner = config.ownerName || 'Serigama';
  const initial = owner.trim().charAt(0).toUpperCase() || 'S';
  const social = socialAccounts(accounts);
  const hasTikTok = social.some((a) => a.platform === 'tiktok');
  const current = social.find((a) => a.id === accountId);
  // "+ Add … account" starts that platform's sign-in (so another account can be
  // picked); the select snaps back to the current account meanwhile.
  const pickAccount = async (e) => {
    const v = e.target.value;
    if (v !== ADD && v !== ADD_IG && v !== ADD_TH) { onSwitchAccount(v); return; }
    e.target.value = accountId || '';
    const err = v === ADD ? await startTikTokConnect(hasTikTok) : v === ADD_TH ? await startThreadsConnect() : await startInstagramConnect();
    if (err) alert(err);
  };
  // Content Calendar sub-items: every account together, or one account's calendar.
  const onCal = route === 'calendar';
  const calSubs = social.length > 1 && onCalendarScope
    ? html`<div class="nav-subs">
        <button class=${'nav-item nav-sub' + (onCal && calScope === 'all' ? ' active' : '')}
          onClick=${() => onCalendarScope('all')} title="Every account's content on one calendar">
          <span class="acct-dots">${social.slice(0, 3).map((a) => html`<i style=${{ background: accountColor(a.id, accounts) }}></i>`)}</span>
          <span>All accounts</span>
        </button>
        ${social.map((a) => html`<button class=${'nav-item nav-sub' + (onCal && calScope !== 'all' && a.id === accountId ? ' active' : '')}
            onClick=${() => onCalendarScope(a.id)} title=${`@${a.handle || a.display_name} · ${PLATFORM_NAME[a.platform]}`}>
            <span class="acct-dots"><i style=${{ background: accountColor(a.id, accounts) }}></i></span>
            <span>${a.handle || a.display_name} <span class="muted" style=${{ fontSize: '11px' }}>${PLATFORM_SHORT[a.platform] || ''}</span></span>
          </button>`)}
      </div>`
    : null;
  return html`<aside class=${'sidebar' + (open ? ' open' : '')}>
    <div class="brand">
      <div class="brand-name">${config.brandName || 'Serigama'}</div>
      <div class="brand-sub">Content Planner & Reporting</div>
    </div>

    ${social.length || isCloud
      ? html`<label class="acct-switch">
          <span class="nav-label">Account</span>
          <select value=${accountId || ''} onChange=${pickAccount}
            title=${current ? `${PLATFORM_NAME[current.platform]} account: @${current.handle || current.display_name}` : 'No account connected'}>
            ${social.length ? '' : html`<option value="">No account connected</option>`}
            ${social.map((a) => html`<option value=${a.id}>@${a.handle || a.display_name} · ${PLATFORM_NAME[a.platform]}</option>`)}
            ${canConnect ? html`<option value=${ADD}>+ Add TikTok account…</option>` : ''}
            ${canConnect ? html`<option value=${ADD_IG}>+ Add Instagram account…</option>` : ''}
            ${canConnect ? html`<option value=${ADD_TH}>+ Add Threads account…</option>` : ''}
          </select>
        </label>`
      : null}

    <button class="btn-new" onClick=${onNew}>
      <${Icon} name="plus" size=${16} /><span>New content</span>
    </button>

    <nav class="nav">
      ${nav.map(
        (n) => n.section
          ? html`<div class="nav-label">${n.section}</div>`
          : html`<button
          class=${'nav-item' + (route === n.id && !(n.id === 'calendar' && calSubs) ? ' active' : '') + (route === n.id ? ' current' : '') + (isLocked(n.id) ? ' locked' : '')}
          onClick=${() => onNavigate(n.id)}
          title=${isLocked(n.id) ? "You don't have access to this page" : ''}
        >
          <${Icon} name=${n.icon} size=${17} /><span>${n.label}</span>
          ${isLocked(n.id) ? html`<span class="nav-lock" aria-label="No access"><${Icon} name="lock" size=${13} /></span>` : ''}
        </button>
        ${n.id === 'calendar' && calSubs ? calSubs : ''}`
      )}
    </nav>

    <div class="user">
      <div class="avatar">${initial}</div>
      <div>
        <div class="user-name">${owner}</div>
        <div class="user-role">${isCloud ? session?.user?.email || config.ownerRole : config.ownerRole || 'Local demo'}</div>
      </div>
      ${isCloud
        ? html`<div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: 'auto' }}>
            ${onSetPassword ? html`<button class="signout" onClick=${onSetPassword} title="Set a password">Set password</button>` : null}
            <button class="signout" onClick=${onSignOut} title="Sign out">Sign out</button>
          </div>`
        : null}
    </div>
  </aside>`;
}
