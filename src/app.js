import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { html } from './lib/html.js';
import { store, isCloud, config } from './lib/store.js';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './features/Dashboard.js';
import { Calendar } from './features/Calendar.js';
import { Campaigns } from './features/Campaigns.js';
import { Analytics } from './features/Analytics.js';
import { AnalyticsDashboard } from './features/AnalyticsDashboard.js';
import { ContentModal } from './features/ContentModal.js';
import { Login } from './features/Login.js';

const ROUTES = ['dashboard', 'calendar', 'campaigns', 'overview', 'analytics'];
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
  if (isCloud && !session) return html`<${Login} config=${config} onSignIn=${(e) => store.signIn(e)} />`;

  const { contents, campaigns, accounts, accountStats, metricsHistory } = data;

  return html`<div class="app">
    <${Sidebar}
      route=${route}
      onNavigate=${navigate}
      onNew=${() => openNew()}
      config=${config}
      session=${session}
      isCloud=${isCloud}
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
          : route === 'campaigns'
          ? html`<${Campaigns} contents=${contents} campaigns=${campaigns}
              onCreate=${createCampaign} onUpdate=${updateCampaign} onDelete=${deleteCampaign} onOpenContent=${openEdit} />`
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
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
