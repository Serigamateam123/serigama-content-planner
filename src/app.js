import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { html } from './lib/html.js';
import { store, isCloud, config } from './lib/store.js';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './features/Dashboard.js';
import { Calendar } from './features/Calendar.js';
import { Fundamental } from './features/Fundamental.js';
import { Analytics } from './features/Analytics.js';
import { AnalyticsDashboard } from './features/AnalyticsDashboard.js';
import { ContentModal } from './features/ContentModal.js';
import { Login } from './features/Login.js';

const ROUTES = ['dashboard', 'calendar', 'fundamental', 'overview', 'analytics'];

// Helper so a capture can be written straight to the cloud (and mirrored locally).
// Used when refreshing the manually-pulled Studio figures.
if (typeof window !== 'undefined') {
  window.serigamaCloud = {
    get: () => store.getKV(),
    set: async (k, v) => { localStorage.setItem(k, v); try { await store.setKV(k, v); return 'ok'; } catch (e) { return 'err: ' + (e.message || e.code || e); } },
    saveStudio: async (rows) => {
      if (!store.client) return 'no-client';
      const { data: { user } } = await store.client.auth.getUser();
      const ids = rows.map((r) => r.external_id);
      await store.client.from('studio_metrics').delete().eq('user_id', user.id).in('external_id', ids);
      const { error } = await store.client.from('studio_metrics').insert(rows.map((r) => ({ ...r, user_id: user.id })));
      return error ? 'err: ' + error.message : 'ok';
    },
  };
}

// Manually-captured figures that used to live only in this browser's localStorage.
// They are now mirrored to Supabase (table app_kv) so they appear on every device.
const KV_KEYS = [
  'serigama.monthly',
  'serigama.goal.views',
  'serigama.audience',
  'serigama.monthlyfollowers',
  'serigama.saves',
  'serigama.newfollowers',
  'serigama.fundamental',
];

// Supabase (app_kv) is the SOURCE OF TRUTH for these manually-captured figures.
// On every load we mirror the cloud value DOWN into localStorage, so every device
// shows the same latest data — and a device holding a stale copy can no longer
// push it up and clobber the cloud. A key the cloud doesn't have yet is seeded
// once from whichever browser first captured it. Writes (a capture, or the goal)
// go to the cloud via setKV, so the cloud always holds the freshest value.
// Runs before the analytics views read localStorage, so values are in place.
async function syncKV() {
  if (!isCloud || !store.getKV) return;
  let remote = {};
  try { remote = await store.getKV(); } catch (e) { return; }
  for (const k of KV_KEYS) {
    if (remote[k] != null) {
      if (localStorage.getItem(k) !== remote[k]) localStorage.setItem(k, remote[k]);
    } else {
      const local = localStorage.getItem(k);
      if (local != null) { try { await store.setKV(k, local); } catch (e) { /* keep going */ } }
    }
  }
}
const routeFromHash = () => {
  const r = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(r) ? r : 'dashboard';
};

function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(routeFromHash());
  const [data, setData] = useState({ contents: [], campaigns: [], accounts: [], accountStats: [], metricsHistory: [], studioMetrics: [] });
  const [modal, setModal] = useState(null); // { content, defaultDate } | null
  const [loadingData, setLoadingData] = useState(false);
  const [pwModal, setPwModal] = useState(false); // "set password" dialog

  // --- routing via hash ---
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (r) => { location.hash = '/' + r; setRoute(r); };

  // --- auth bootstrap ---
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const s = await store.getSession();
      setSession(s);
      setReady(true);
      unsub = store.onAuthChange((ns) => setSession(ns));
    })();
    return () => unsub();
  }, []);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    await syncKV(); // hydrate localStorage-backed figures from Supabase before reading them
    const [contents, campaigns, accounts, accountStats, metricsHistory, studioMetrics] = await Promise.all([
      store.listContents(),
      store.listCampaigns(),
      store.listAccounts(),
      store.listAccountStats(),
      store.listMetricsHistory(),
      store.listStudioMetrics(),
    ]);
    const studioBy = new Map((studioMetrics || []).map((s) => [String(s.external_id), s]));
    let savesBy = {};
    let newFollowersBy = {};
    try { savesBy = JSON.parse(localStorage.getItem('serigama.saves') || '{}'); } catch (e) { savesBy = {}; }
    try { newFollowersBy = JSON.parse(localStorage.getItem('serigama.newfollowers') || '{}'); } catch (e) { newFollowersBy = {}; }
    const withStudio = contents.map((c) => ({
      ...c,
      studio: c.external_id ? studioBy.get(String(c.external_id)) || null : null,
      saves: c.external_id ? Number(savesBy[String(c.external_id)]) || 0 : 0,
      newFollowers: c.external_id && newFollowersBy[String(c.external_id)] != null ? Number(newFollowersBy[String(c.external_id)]) : null,
    }));
    setData({ contents: withStudio, campaigns, accounts, accountStats, metricsHistory, studioMetrics });
    setLoadingData(false);
  }, []);

  useEffect(() => { if (session) loadData(); }, [session, loadData]);

  // --- mutations (optimistic-ish: mutate then reload) ---
  const saveContent = async (patch, id) => {
    if (id) await store.updateContent(id, patch);
    else await store.createContent(patch);
    setModal(null);
    await loadData();
  };
  const deleteContent = async (id) => { await store.deleteContent(id); setModal(null); await loadData(); };
  const saveMetrics = async (id, m) => { await store.saveMetrics(id, m); await loadData(); };
  const createCampaign = async (d) => { await store.createCampaign(d); await loadData(); };
  const updateCampaign = async (id, d) => { await store.updateCampaign(id, d); await loadData(); };
  const deleteCampaign = async (id) => { await store.deleteCampaign(id); await loadData(); };

  const openNew = (defaultDate = null) => setModal({ content: null, defaultDate });
  const openEdit = (content) => setModal({ content, defaultDate: null });

  if (!ready) return html`<div class="boot">Loading…</div>`;
  if (isCloud && !session) return html`<${Login} config=${config}
    onSignIn=${(e) => store.signIn(e)}
    onPasswordSignIn=${(e, p) => store.signInWithPassword(e, p)} />`;

  const { contents, campaigns, accounts, accountStats, metricsHistory } = data;

  return html`<div class="app">
    <${Sidebar}
      route=${route}
      onNavigate=${navigate}
      onNew=${() => openNew()}
      config=${config}
      session=${session}
      isCloud=${isCloud}
      onSetPassword=${() => setPwModal(true)}
      onSignOut=${async () => { await store.signOut(); setSession(null); }}
    />
    <main class="main">
      <div class="main-inner">
        ${route === 'dashboard'
          ? html`<${Dashboard} contents=${contents} campaigns=${campaigns} config=${config}
              onNew=${() => openNew()} onOpen=${openEdit} onNavigate=${navigate} onRefresh=${loadData} />`
          : route === 'calendar'
          ? html`<${Calendar} contents=${contents} campaigns=${campaigns}
              onNew=${() => openNew()} onOpen=${openEdit} onNewOnDate=${(d) => openNew(d)} />`
          : route === 'fundamental'
          ? html`<${Fundamental} />`
          : route === 'overview'
          ? html`<${AnalyticsDashboard} contents=${contents} campaigns=${campaigns} accounts=${accounts} accountStats=${accountStats}
              onNavigate=${navigate} onRefresh=${loadData} />`
          : html`<${Analytics} contents=${contents} campaigns=${campaigns} accounts=${accounts} accountStats=${accountStats} metricsHistory=${metricsHistory} onSaveMetrics=${saveMetrics} />`}
      </div>
    </main>

    ${modal
      ? html`<${ContentModal}
          content=${modal.content}
          defaultDate=${modal.defaultDate}
          campaigns=${campaigns}
          accounts=${accounts}
          onSubmit=${saveContent}
          onDelete=${deleteContent}
          onClose=${() => setModal(null)}
        />`
      : null}

    ${pwModal ? html`<${PasswordModal} onSave=${(pw) => store.setPassword(pw)} onClose=${() => setPwModal(false)} />` : null}
  </div>`;
}

// Small dialog to set/change the account password (works because the user is
// already signed in — no email is sent, so it never hits the email rate limit).
function PasswordModal({ onSave, onClose }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (pw.length < 6) { setMsg({ ok: false, text: 'Use at least 6 characters.' }); return; }
    if (pw !== pw2) { setMsg({ ok: false, text: 'The two passwords do not match.' }); return; }
    setBusy(true);
    let res;
    try { res = await onSave(pw); } catch (err) { res = { ok: false, message: (err && err.message) || 'Could not save.' }; }
    setBusy(false);
    setMsg({ ok: res.ok, text: res.message || (res.ok ? 'Password saved.' : 'Could not save.') });
    if (res.ok) setTimeout(onClose, 1400);
  };

  return html`<div class="overlay" onClick=${onClose}>
    <div class="modal" style=${{ maxWidth: '380px' }} onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head"><h3>Set a password</h3></div>
      <form onSubmit=${save} style=${{ padding: '18px 22px' }}>
        <p class="muted" style=${{ fontSize: '13px', marginTop: 0 }}>Set a password so you can sign in without waiting for an email link.</p>
        <div class="field"><label>New password</label>
          <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} placeholder="At least 6 characters" autofocus /></div>
        <div class="field"><label>Confirm password</label>
          <input type="password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} placeholder="Re-type it" /></div>
        ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')}>${msg.text}</div>` : null}
        <div style=${{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button type="button" class="btn" onClick=${onClose}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled=${busy}>${busy ? 'Saving…' : 'Save password'}</button>
        </div>
      </form>
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
