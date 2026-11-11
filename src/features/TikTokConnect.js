import { html } from '../lib/html.js';
import { useState, useEffect } from 'preact/hooks';
import { store, isCloud, config } from '../lib/store.js';
import { Icon } from '../components/ui.js';

// Send the browser to TikTok's approval page. `another`: make TikTok show its
// sign-in screen instead of silently approving whichever account this browser is
// already logged in to. Returns an error message, or nothing once redirecting.
export async function startTikTokConnect(another = false) {
  const { data } = await store.client.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) return 'Please sign in first.';
  const t = config.tiktok;
  window.location.href = t.authorizeUrl +
    '?client_key=' + encodeURIComponent(t.clientKey) +
    '&scope=' + encodeURIComponent(t.scopes) +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(t.redirectUri) +
    '&state=' + encodeURIComponent(uid) +
    (another ? '&disable_auto_auth=1' : '');
}

// Send the browser to Facebook Login for Business (Instagram via Facebook Pages). The user picks the Facebook
// Page(s) whose Instagram account the planner may read; instagram-callback stores
// one connection per Instagram account found.
export async function startInstagramConnect() {
  const { data } = await store.client.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) return 'Please sign in first.';
  const ig = config.instagram;
  if (!ig) return 'Instagram is not set up in config.js.';
  window.location.href = ig.authorizeUrl +
    '?client_id=' + encodeURIComponent(ig.appId) +
    '&config_id=' + encodeURIComponent(ig.configId) +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(ig.redirectUri) +
    '&state=' + encodeURIComponent(uid);
}

// Connections card shown on the Analytics screen. Cloud mode only (needs a
// signed-in user id to tie the connection + synced posts to). A login can connect
// several TikTok and Instagram accounts; Refresh syncs all of them.
export function TikTokConnect({ onSynced }) {
  const [conns, setConns] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  // Collapsed to one slim line by default; "Details" shows each account + reconnect links.
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('serigama.connOpen') === '1'; } catch (e) { return false; } });
  const toggle = () => { const n = !open; setOpen(n); try { localStorage.setItem('serigama.connOpen', n ? '1' : '0'); } catch (e) { /* preference only */ } };

  const load = async () => {
    if (!isCloud || !store.client) return;
    try {
      const [{ data }, { data: accts }] = await Promise.all([
        store.client.from('integrations').select('platform,display_name,last_synced_at,account_id')
          .in('platform', ['tiktok', 'instagram']).order('created_at'),
        store.client.from('accounts').select('id,handle'),
      ]);
      // Show the planner's handle (e.g. serigama.hq) rather than TikTok's display name.
      const handleOf = new Map((accts || []).map((a) => [a.id, a.handle]));
      setConns((data || []).map((c) => ({ ...c, display_name: handleOf.get(c.account_id) || c.display_name })));
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    const h = location.hash || '';
    if (h.includes('tiktok=connected')) setMsg({ ok: true, text: 'TikTok connected! Click “Refresh” to pull its videos.' });
    else if (h.includes('tiktok=error')) setMsg({ ok: false, text: 'TikTok connection failed — please try Connect again.' });
    else if (h.includes('instagram=connected')) setMsg({ ok: true, text: 'Instagram connected! Click “Refresh” to pull its posts.' });
    else if (h.includes('instagram=none')) setMsg({ ok: false, text: 'Facebook connected, but none of the Pages you picked has an Instagram professional account linked. Link the Instagram account to its Facebook Page, then connect again.' });
    else if (h.includes('instagram=error')) setMsg({ ok: false, text: 'Instagram connection failed — please try again.' });
    load();
  }, []);
  const tiktokConns = conns.filter((c) => c.platform === 'tiktok');
  const igConns = conns.filter((c) => c.platform === 'instagram');

  if (!isCloud) {
    return html`<div class="card card-pad section-gap">
      <div class="card-title">Connect TikTok</div>
      <p class="muted" style=${{ fontSize: '13px', marginBottom: 0 }}>Turn on cloud sync to auto-pull your TikTok numbers.</p>
    </div>`;
  }

  const connect = async (another = false) => {
    const err = await startTikTokConnect(another);
    if (err) setMsg({ ok: false, text: err });
  };

  const connectInstagram = async () => {
    const err = await startInstagramConnect();
    if (err) setMsg({ ok: false, text: err });
  };

  // Sync every platform that has a connection; report each one's result.
  const syncNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data: s } = await store.client.auth.getSession();
      const body = { user_id: s?.session?.user?.id };
      const fns = [tiktokConns.length ? 'tiktok-sync' : null, igConns.length ? 'instagram-sync' : null].filter(Boolean);
      const replies = await Promise.all(fns.map((fn) => store.client.functions.invoke(fn, { body })));
      const failedFn = replies.find((r) => r.error);
      if (failedFn) throw failedFn.error;
      const results = replies.flatMap((r) => r.data?.results || []);
      const pulled = results.reduce((n, r) => n + (r.pulled || 0), 0);
      const failed = results.filter((r) => r.error);
      setMsg(failed.length
        ? { ok: false, text: `Synced ${pulled} post${pulled === 1 ? '' : 's'}, but ${failed.map((r) => r.account || 'an account').join(', ')} failed — try reconnecting it.` }
        : { ok: true, text: `Synced ✓ — pulled ${pulled} post${pulled === 1 ? '' : 's'} from ${results.length} account${results.length === 1 ? '' : 's'}.` });
      await load();
      onSynced && onSynced();
    } catch (e) {
      setMsg({ ok: false, text: 'Sync failed: ' + String(e.message || e) });
    }
    setBusy(false);
  };

  const line = (c) => html`<div class="muted" style=${{ fontSize: '12.5px', marginTop: '2px' }}>
    ${c.platform === 'instagram' ? 'Instagram' : 'TikTok'} · connected as ${c.display_name || 'account'}
    ${c.last_synced_at ? ' · last synced ' + new Date(c.last_synced_at).toLocaleString() : ' · not synced yet'}
  </div>`;
  const link = (label, onClick, title) => html`<span onClick=${onClick} title=${title || ''} style=${{ cursor: 'pointer', textDecoration: 'underline' }}>${label}</span>`;

  // Slim line: when the numbers were last updated, Refresh, and a Details toggle.
  if (conns.length) {
    const latest = conns.map((c) => c.last_synced_at).filter(Boolean).sort().pop();
    const when = latest ? new Date(latest) : null;
    const whenText = when ? (when.toDateString() === new Date().toDateString()
      ? 'today ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'not yet';
    // An account whose daily sync hasn't succeeded for 2+ days (e.g. Facebook withdrew
    // the planner's access) is called out here, since the details are tucked away.
    const stale = conns.filter((c) => !c.last_synced_at || Date.now() - new Date(c.last_synced_at).getTime() > 2 * 86400000);
    const staleWarn = stale.length ? html`<div class="toast toast-err" style=${{ flexBasis: '100%', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span>⚠ ${stale.map((c) => `${c.platform === 'instagram' ? 'Instagram' : 'TikTok'} @${c.display_name}`).join(', ')}${stale.length === 1 ? " hasn't" : " haven't"} updated since ${stale.map((c) => c.last_synced_at ? new Date(c.last_synced_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'connecting').join(' / ')} — the connection needs renewing.</span>
      ${stale.some((c) => c.platform === 'instagram') ? html`<button class="btn btn-sm" onClick=${connectInstagram}>Reconnect Instagram</button>` : ''}
      ${stale.some((c) => c.platform === 'tiktok') ? html`<button class="btn btn-sm" onClick=${() => connect(true)}>Reconnect TikTok</button>` : ''}
    </div>` : '';
    return html`<div class="section-gap" style=${{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px' }}>
      <span class="muted">Numbers update every morning · last updated ${whenText} · ${conns.length} account${conns.length === 1 ? '' : 's'}</span>
      <button class="btn btn-sm" onClick=${syncNow} disabled=${busy}><${Icon} name="refresh" size=${13} /> ${busy ? 'Refreshing…' : 'Refresh'}</button>
      <button class="btn btn-ghost btn-sm" onClick=${toggle} aria-expanded=${open}>${open ? 'Hide details ▴' : 'Details ▾'}</button>
      ${open ? html`<div class="card card-pad" style=${{ flexBasis: '100%', marginTop: '2px' }}>
        <div class="card-title" style=${{ fontSize: '13.5px' }}>Connected accounts</div>
        ${conns.map(line)}
        <div class="muted" style=${{ fontSize: '12.5px', marginTop: '6px' }}>
          ${link('Connect another TikTok account', () => connect(true))}
          · ${link(igConns.length ? 'Connect another Instagram account' : 'Connect Instagram', connectInstagram)}
          · ${link('reconnect TikTok', () => connect(true), 'Sign in again to a connected TikTok account')}
          ${igConns.length ? html` · ${link('reconnect Instagram', connectInstagram)}` : ''}
        </div>
      </div>` : ''}
      ${staleWarn}
      ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')} style=${{ flexBasis: '100%', marginTop: '2px' }}>${msg.text}</div>` : null}
    </div>`;
  }

  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
      <div>
        <div class="card-title">Connected accounts</div>
        ${conns.length
          ? conns.map(line)
          : html`<div class="muted" style=${{ fontSize: '12.5px', marginTop: '2px' }}>Not connected yet — connect serigama.daily to auto-pull views, likes, comments & shares.</div>`}
        ${conns.length
          ? html`<div class="muted" style=${{ fontSize: '12.5px', marginTop: '4px' }}>
              ${link('Connect another TikTok account', () => connect(true))}
              · ${link(igConns.length ? 'Connect another Instagram account' : 'Connect Instagram', connectInstagram)}
              · ${link('reconnect TikTok', () => connect(true), 'Sign in again to a connected TikTok account')}
              ${igConns.length ? html` · ${link('reconnect Instagram', connectInstagram)}` : ''}
            </div>`
          : ''}
      </div>
      <div style=${{ display: 'flex', gap: '8px' }}>
        ${conns.length
          ? html`<button class="btn btn-gold" onClick=${syncNow} disabled=${busy}><${Icon} name="refresh" size=${15} /> ${busy ? 'Refreshing…' : 'Refresh'}</button>`
          : html`<button class="btn btn-gold" onClick=${() => connect(false)}>Connect TikTok</button>`}
      </div>
    </div>
    ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')} style=${{ marginTop: '12px' }}>${msg.text}</div>` : null}
  </div>`;
}
