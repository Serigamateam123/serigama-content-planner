import { html } from '../lib/html.js';
import { useState, useEffect } from 'preact/hooks';
import { store, isCloud, config } from '../lib/store.js';
import { Icon } from '../components/ui.js';

// TikTok connection card shown on the Analytics screen. Cloud mode only
// (needs a signed-in user id to tie the connection + synced videos to).
export function TikTokConnect({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!isCloud || !store.client) return;
    try {
      const { data } = await store.client
        .from('integrations')
        .select('display_name,last_synced_at')
        .eq('platform', 'tiktok')
        .maybeSingle();
      setStatus(data || null);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    const h = location.hash || '';
    if (h.includes('tiktok=connected')) setMsg({ ok: true, text: 'TikTok connected! Click “Sync now” to pull your videos.' });
    else if (h.includes('tiktok=error')) setMsg({ ok: false, text: 'TikTok connection failed — please try Connect again.' });
    load();
  }, []);

  if (!isCloud) {
    return html`<div class="card card-pad section-gap">
      <div class="card-title">Connect TikTok</div>
      <p class="muted" style=${{ fontSize: '13px', marginBottom: 0 }}>Turn on cloud sync to auto-pull your TikTok numbers.</p>
    </div>`;
  }

  const connect = async () => {
    const { data } = await store.client.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) { setMsg({ ok: false, text: 'Please sign in first.' }); return; }
    const t = config.tiktok;
    const url = t.authorizeUrl +
      '?client_key=' + encodeURIComponent(t.clientKey) +
      '&scope=' + encodeURIComponent(t.scopes) +
      '&response_type=code' +
      '&redirect_uri=' + encodeURIComponent(t.redirectUri) +
      '&state=' + encodeURIComponent(uid);
    window.location.href = url;
  };

  const syncNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data: s } = await store.client.auth.getSession();
      const { data, error } = await store.client.functions.invoke('tiktok-sync', {
        body: { user_id: s?.session?.user?.id },
      });
      if (error) throw error;
      const pulled = (data?.results || []).reduce((n, r) => n + (r.pulled || 0), 0);
      setMsg({ ok: true, text: `Synced ✓ — pulled ${pulled} video${pulled === 1 ? '' : 's'} from TikTok.` });
      await load();
      onSynced && onSynced();
    } catch (e) {
      setMsg({ ok: false, text: 'Sync failed: ' + String(e.message || e) });
    }
    setBusy(false);
  };

  return html`<div class="card card-pad section-gap">
    <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
      <div>
        <div class="card-title">TikTok connection</div>
        <div class="muted" style=${{ fontSize: '12.5px', marginTop: '2px' }}>
          ${status
            ? 'Connected' + (status.display_name ? ' as ' + status.display_name : '') +
              (status.last_synced_at ? ' · last synced ' + new Date(status.last_synced_at).toLocaleString() : ' · not synced yet')
            : 'Not connected yet — connect serigama.daily to auto-pull views, likes, comments & shares.'}
          ${status ? html` · <span onClick=${connect} title="Reconnect TikTok" style=${{ cursor: 'pointer', textDecoration: 'underline' }}>reconnect</span>` : ''}
        </div>
      </div>
      <div style=${{ display: 'flex', gap: '8px' }}>
        ${status
          ? html`<button class="btn btn-gold" onClick=${syncNow} disabled=${busy}><${Icon} name="refresh" size=${15} /> ${busy ? 'Refreshing…' : 'Refresh'}</button>`
          : html`<button class="btn btn-gold" onClick=${connect}>Connect TikTok</button>`}
      </div>
    </div>
    ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')} style=${{ marginTop: '12px' }}>${msg.text}</div>` : null}
  </div>`;
}
