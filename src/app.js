import { render } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { html } from './lib/html.js';
import { store, isCloud, config } from './lib/store.js';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './features/Dashboard.js';
import { Calendar } from './features/Calendar.js';
import { Fundamental } from './features/Fundamental.js';
import { Analytics } from './features/Analytics.js';
import { AnalyticsDashboard } from './features/AnalyticsDashboard.js';
import { Targets } from './features/Targets.js';
import { ContentModal } from './features/ContentModal.js';
import { Login } from './features/Login.js';
import { readKV, writeKV, updateKVEntry } from './lib/kv.js';
import { findPlanMatches, applyPlanMatches } from './lib/reconcile.js';
import { initAccounts, setActiveAccount, accountOf, kvKey, kvBase, loadedAccounts, socialAccounts, accountColor } from './lib/account.js';

const ROUTES = ['dashboard', 'calendar', 'fundamental', 'overview', 'targets', 'analytics'];

// Planning fields kept per post in app_kv (key `serigama.contentmeta`, map of
// content id -> fields) rather than as columns, so they work without a database
// migration. Merged onto each content on load; split back out on save.
const META_KEY = 'serigama.contentmeta';
const META_FIELDS = ['funnel_stage', 'pillar', 'product', 'assignee', 'hook', 'cta', 'inspo1', 'inspo2'];

// Helper so a capture can be written straight to the cloud (and mirrored locally).
// Used when refreshing the manually-pulled Studio figures. `set` takes the exact
// key: use key(base, accountId) for a per-account figure of a non-primary account.
if (typeof window !== 'undefined') {
  window.serigamaCloud = {
    accounts: () => loadedAccounts().map((a) => ({ id: a.id, name: a.display_name || a.handle })),
    key: (base, accountId) => kvKey(base, accountId),
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
  'serigama.contentmeta',
  'serigama.goals',
  'serigama.reports',
  'serigama.targets',
  'serigama.reels', // Instagram reel extras (written by instagram-sync), keyed by post id
  'serigama.reelsweb', // Instagram per-reel follows / follower split read from instagram.com insights (Thursday capture)
];

// Supabase (app_kv) is the SOURCE OF TRUTH for these manually-captured figures.
// On every load we mirror the cloud value DOWN into localStorage, so every device
// shows the same latest data — and a device holding a stale copy can no longer
// push it up and clobber the cloud. A key the cloud doesn't have yet is seeded
// once from whichever browser first captured it. Writes (a capture, or the goal)
// go to the cloud via setKV, so the cloud always holds the freshest value.
// Runs before the analytics views read localStorage, so values are in place.
// Every account's copy of a key (`<key>@<account id>`, see lib/account.js) is
// mirrored down too; only the primary account's original keys are ever seeded up.
async function syncKV() {
  if (!isCloud || !store.getKV) return;
  let remote = {};
  try { remote = await store.getKV(); } catch (e) { return; }
  for (const [k, v] of Object.entries(remote)) {
    if (KV_KEYS.includes(kvBase(k)) && localStorage.getItem(k) !== v) localStorage.setItem(k, v);
  }
  for (const k of KV_KEYS) {
    if (remote[k] == null) {
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
  const [all, setData] = useState({ contents: [], accounts: [], accountStats: [], metricsHistory: [], studioMetrics: [] });
  // Calendar moves made in the last minute (id → new date). A data load that was
  // already in flight when a card was dropped would otherwise put it back on screen.
  const recentMoves = useRef(new Map());
  const [accountId, setAccountId] = useState(null); // TikTok account shown (sidebar switcher)
  // Content Calendar scope: 'all' = every account on one calendar, 'account' = the switcher's account.
  const [calScope, setCalScope] = useState(() => { try { return localStorage.getItem('serigama.calScope') === 'all' ? 'all' : 'account'; } catch (e) { return 'account'; } });
  const rememberCalScope = (s) => { setCalScope(s); try { localStorage.setItem('serigama.calScope', s); } catch (e) { /* per-browser preference only */ } };
  const [modal, setModal] = useState(null); // { content, defaultDate, prefill } | null
  const [dataVersion, setDataVersion] = useState(0); // bumps after each load so KV-backed views re-read
  const [loadingData, setLoadingData] = useState(false);
  const [pwModal, setPwModal] = useState(false); // "set password" dialog

  // --- routing via hash ---
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  // `r` may carry a query (e.g. 'analytics?from=…&to=…') for the page to read on open.
  const navigate = (r) => { location.hash = '/' + r; setRoute(r.split('?')[0]); };

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
    // Saved figures (app_kv → localStorage) download alongside the tables; nothing
    // below reads them until all of it has arrived.
    const [, contents, accounts, accountStats, metricsHistory, studioMetrics] = await Promise.all([
      syncKV(),
      store.listContents(),
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
    const metaBy = readKV(META_KEY, {});
    const withStudio = contents.map((c) => ({
      ...c,
      ...(metaBy[c.id] || {}),
      studio: c.external_id ? studioBy.get(String(c.external_id)) || null : null,
      saves: c.external_id ? Number(savesBy[String(c.external_id)]) || 0 : 0,
      newFollowers: c.external_id && newFollowersBy[String(c.external_id)] != null ? Number(newFollowersBy[String(c.external_id)]) : null,
    }));
    setAccountId(initAccounts(accounts));
    // A planned item whose video has now been posted (synced) is replaced by the
    // posted video, keeping the plan's script / pillar / notes on it (lib/reconcile.js).
    let finalContents = withStudio;
    if (isCloud) {
      const pairs = findPlanMatches(withStudio, accountOf);
      if (pairs.length) {
        try {
          const nextMeta = await applyPlanMatches(pairs, readKV(META_KEY, {}), store);
          await writeKV(META_KEY, nextMeta);
          const gone = new Set(pairs.map((p) => p.plan.id));
          const byPost = new Map(pairs.map((p) => [p.post.id, p]));
          finalContents = withStudio.filter((c) => !gone.has(c.id)).map((c) => (byPost.has(c.id)
            ? { ...c, ...(nextMeta[c.id] || {}), caption: c.caption || ['Plan: ' + byPost.get(c.id).plan.title, byPost.get(c.id).plan.caption].filter(Boolean).join('\n\n') }
            : c));
          console.info(`[planner] ${pairs.length} planned item(s) replaced by their posted video`);
        } catch (e) { console.warn('[planner] could not merge plans into posted videos', e); }
      }
    }
    const moves = recentMoves.current;
    if (moves.size) finalContents = finalContents.map((c) => (moves.has(c.id) ? { ...c, scheduled_at: moves.get(c.id) } : c));
    setData({ contents: finalContents, accounts, accountStats, metricsHistory, studioMetrics });
    setDataVersion((v) => v + 1);
    setLoadingData(false);
  }, []);

  useEffect(() => { if (session) loadData(); }, [session, loadData]);

  // --- mutations (optimistic-ish: mutate then reload) ---
  // Throws on failure so the form can show the error and keep what was typed.
  const saveContent = async (patch, id) => {
    const row = { ...patch };
    const meta = {};
    for (const k of META_FIELDS) { if (k in row) { meta[k] = row[k]; delete row[k]; } }
    let contentId = id;
    if (id) await store.updateContent(id, row);
    else contentId = (await store.createContent(row)).id;
    await updateKVEntry(META_KEY, contentId, meta);
    setModal(null);
    await loadData();
  };
  const deleteContent = async (id) => {
    await store.deleteContent(id);
    try { await updateKVEntry(META_KEY, id, null); } catch (e) { /* orphaned meta is harmless */ }
    setModal(null);
    await loadData();
  };
  // Calendar drag & drop: move a post to another day (or back to the backlog with null).
  // The card moves at once (optimistic) and the new date saves in the background;
  // only a failed save reloads, which puts the card back where it was.
  const rescheduleContent = async (id, scheduledAt) => {
    recentMoves.current.set(id, scheduledAt);
    setData((d) => ({ ...d, contents: d.contents.map((c) => (c.id === id ? { ...c, scheduled_at: scheduledAt } : c)) }));
    try {
      await store.updateContent(id, { scheduled_at: scheduledAt });
      setTimeout(() => { if (recentMoves.current.get(id) === scheduledAt) recentMoves.current.delete(id); }, 60000);
    } catch (e) {
      recentMoves.current.delete(id);
      alert('Could not move that post: ' + (e.message || e));
      await loadData();
    }
  };
  const saveMetrics = async (id, m) => { await store.saveMetrics(id, m); await loadData(); };

  const openNew = (defaultDate = null, prefill = null) => setModal({ content: null, defaultDate, prefill });
  const openEdit = (content) => setModal({ content, defaultDate: null, prefill: null });

  if (!ready) return html`<div class="boot">Loading…</div>`;
  if (isCloud && !session) return html`<${Login} config=${config}
    onSignIn=${(e) => store.signIn(e)}
    onPasswordSignIn=${(e, p) => store.signInWithPassword(e, p)} />`;

  // Every screen shows the account picked in the sidebar: its posts, their metric
  // history and its follower snapshots (per-account app_kv figures resolve in kv.js).
  const { accounts } = all;
  const contents = all.contents.filter((c) => accountOf(c) === accountId);
  const ids = new Set(contents.map((c) => c.id));
  const metricsHistory = all.metricsHistory.filter((m) => ids.has(m.content_id));
  const accountStats = all.accountStats.filter((s) => accountOf(s) === accountId);
  const switchAccount = (id) => { setActiveAccount(id); setAccountId(id); setDataVersion((v) => v + 1); rememberCalScope('account'); };
  // Sidebar Content Calendar sub-items: 'all', or an account id.
  const pickCalendar = (scope) => {
    if (scope === 'all') rememberCalScope('all');
    else if (scope !== accountId) switchAccount(scope);
    else rememberCalScope('account');
    navigate('calendar');
  };
  const socialIds = new Set(socialAccounts(accounts).map((a) => a.id));
  const allCalendar = calScope === 'all' && socialIds.size > 1;
  const calendarContents = allCalendar ? all.contents.filter((c) => socialIds.has(accountOf(c))) : contents;
  const accountTag = (c) => {
    const a = accounts.find((x) => x.id === accountOf(c));
    return a ? { id: a.id, label: '@' + (a.handle || a.display_name), color: accountColor(a.id, accounts) } : null;
  };

  return html`<div class="app">
    <${Sidebar}
      route=${route}
      onNavigate=${navigate}
      onNew=${() => openNew()}
      config=${config}
      accounts=${accounts}
      accountId=${accountId}
      onSwitchAccount=${switchAccount}
      calScope=${allCalendar ? 'all' : 'account'}
      onCalendarScope=${pickCalendar}
      session=${session}
      isCloud=${isCloud}
      onSetPassword=${() => setPwModal(true)}
      onSignOut=${async () => { await store.signOut(); setSession(null); }}
    />
    <main class="main">
      <div class="main-inner" key=${(route === 'calendar' && allCalendar ? 'all' : accountId) || 'none'}>
        ${route === 'dashboard'
          ? html`<${Dashboard} contents=${contents} config=${config}
              onNew=${() => openNew()} onOpen=${openEdit} onNavigate=${navigate} onRefresh=${loadData} />`
          : route === 'calendar'
          ? html`<${Calendar} contents=${calendarContents}
              accounts=${allCalendar ? socialAccounts(accounts).map((a) => ({ id: a.id, label: '@' + (a.handle || a.display_name), color: accountColor(a.id, accounts) })) : null}
              accountTag=${allCalendar ? accountTag : null}
              scopeLabel=${allCalendar ? 'All accounts' : (() => { const a = accounts.find((x) => x.id === accountId); return a ? '@' + (a.handle || a.display_name) : ''; })()}
              onNew=${() => openNew()} onOpen=${openEdit} onNewOnDate=${(d) => openNew(d)} onReschedule=${rescheduleContent} />`
          : route === 'fundamental'
          ? html`<${Fundamental} contents=${contents} dataVersion=${dataVersion} onPlan=${(prefill) => openNew(null, prefill)} />`
          : route === 'overview'
          ? html`<${AnalyticsDashboard} contents=${contents} accounts=${accounts} accountStats=${accountStats}
              onNavigate=${navigate} onRefresh=${loadData} />`
          : route === 'targets'
          ? html`<${Targets} contents=${contents} metricsHistory=${metricsHistory} />`
          : html`<${Analytics} contents=${contents} accounts=${accounts} accountStats=${accountStats} metricsHistory=${metricsHistory} onSaveMetrics=${saveMetrics} />`}
      </div>
    </main>

    ${modal
      ? html`<${ContentModal}
          content=${modal.content}
          defaultDate=${modal.defaultDate}
          prefill=${modal.prefill}
          contents=${contents}
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
