// CLOUD SYNC backend: talks to Supabase (Postgres + Auth). Active when config.js
// has a supabaseUrl + anon key. Same async interface as the local store.
//
// Data lives in four tables (see supabase/schema.sql): accounts, campaigns,
// contents, content_metrics. Row Level Security scopes every row to auth.uid(),
// so each signed-in user only ever sees their own data.

import { createClient } from '@supabase/supabase-js';

export function makeSupabaseStore(url, anonKey) {
  const sb = createClient(url, anonKey);
  let userId = null;

  const requireUser = () => {
    if (!userId) throw new Error('Not signed in');
    return userId;
  };

  // Attach the latest metric row to each content as `.metrics` (or null).
  // Read a whole table past PostgREST's 1000-rows-per-response cap: count it first,
  // then fetch the pages in parallel (6 at a time) instead of one after another.
  const PAGE = 1000;
  async function fetchAllRows(table, columns, orderCol) {
    const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true });
    if (error) throw error;
    const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
    const out = new Array(pages);
    let next = 0;
    const worker = async () => {
      while (next < pages) {
        const p = next++;
        const { data, error: e } = await sb.from(table).select(columns)
          .order(orderCol, { ascending: true }).order('id', { ascending: true })
          .range(p * PAGE, p * PAGE + PAGE - 1);
        if (e) throw e;
        out[p] = data || [];
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pages) }, worker));
    return out.flat();
  }
  // content_metrics (~1 row per video per day) is needed by both listContents (latest
  // per video) and listMetricsHistory (all rows). Download it once per data load,
  // with only the columns the screens use.
  const METRIC_COLS = 'content_id,reach,impressions,views,likes,comments,shares,engagement,engagement_rate,source,fetched_at';
  let metricsInFlight = null;
  function metricRowsOnce() {
    if (!metricsInFlight) {
      metricsInFlight = fetchAllRows('content_metrics', METRIC_COLS, 'fetched_at').catch(() => []);
      metricsInFlight.finally(() => setTimeout(() => { metricsInFlight = null; }, 3000));
    }
    return metricsInFlight;
  }

  function attachMetrics(contents, metricRows) {
    const latest = new Map();
    for (const m of metricRows || []) {
      const prev = latest.get(m.content_id);
      if (!prev || new Date(m.fetched_at) > new Date(prev.fetched_at)) latest.set(m.content_id, m);
    }
    return contents.map((c) => ({ ...c, metrics: latest.get(c.id) || null }));
  }

  return {
    isCloud: true,
    client: sb,

    // --- auth (magic-link / OTP email) ---
    async getSession() {
      const { data } = await sb.auth.getSession();
      userId = data?.session?.user?.id || null;
      return data?.session || null;
    },
    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: 'Check your email for the sign-in link.' };
    },
    // Password sign-in — no email sent, so it never hits the email rate limit.
    async signInWithPassword(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, message: error.message };
      userId = data?.user?.id || null;
      return { ok: true };
    },
    // Set/change the password for the currently signed-in user (no email needed).
    async setPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: 'Password saved — you can now sign in with email + password.' };
    },
    async signOut() {
      await sb.auth.signOut();
      userId = null;
      return { ok: true };
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => {
        userId = session?.user?.id || null;
        cb(session);
      });
      return () => data?.subscription?.unsubscribe();
    },

    // --- key/value settings (app_kv) ---
    // Small per-user store for manually-captured figures that used to live only in
    // browser localStorage (monthly report, goal, audience, saves, …). Backing them
    // with Supabase makes them show up on every device, not just the browser they
    // were captured in. Values are stored as the raw localStorage string.
    async getKV() {
      const { data, error } = await sb.from('app_kv').select('k,v');
      if (error) return {}; // table may not exist yet on older projects
      const out = {};
      for (const r of data || []) out[r.k] = r.v;
      return out;
    },
    async setKV(k, v) {
      const { error } = await sb
        .from('app_kv')
        .upsert({ user_id: requireUser(), k, v, updated_at: new Date().toISOString() }, { onConflict: 'user_id,k' });
      if (error) throw error;
      return { ok: true };
    },

    // --- reads ---
    async listAccounts() {
      const { data, error } = await sb.from('accounts').select('*').order('display_name');
      if (error) throw error;
      return data;
    },
    async listCampaigns() {
      const { data, error } = await sb.from('campaigns').select('*').order('start_date');
      if (error) throw error;
      return data;
    },
    async listAccountStats() {
      // Daily follower/like snapshots (written server-side by tiktok-sync). The
      // table may not exist yet on older projects — treat that as "no data".
      const { data, error } = await sb.from('account_stats').select('*').order('day');
      if (error) return [];
      return data || [];
    },
    async listStudioMetrics() {
      // Richer per-video metrics captured from TikTok Studio (hook, watch time,
      // new vs returning, etc.). Table may not exist yet — treat as "no data".
      const { data, error } = await sb.from('studio_metrics').select('*');
      if (error) return [];
      return data || [];
    },
    async listMetricsHistory() {
      // Every snapshot row (not just the latest) so we can compute period deltas.
      const rows = await metricRowsOnce();
      return [...rows].sort((a, b) => (a.fetched_at < b.fetched_at ? -1 : a.fetched_at > b.fetched_at ? 1 : 0));
    },
    async listContents() {
      // contents passed 1000 rows (Nov 2026: ~1,400 with serigama.hq), and PostgREST
      // caps one response at 1000 — so read it in pages too, or items go missing.
      const [contents, metricRows] = await Promise.all([
        fetchAllRows('contents', '*', 'created_at'),
        metricRowsOnce(),
      ]);
      return attachMetrics(contents, metricRows);
    },

    // --- content ---
    async createContent(data) {
      const { metrics, ...row } = data;
      const { data: created, error } = await sb
        .from('contents')
        .insert({ ...row, user_id: requireUser() })
        .select()
        .single();
      if (error) throw error;
      return { ...created, metrics: null };
    },
    async updateContent(id, patch) {
      const { metrics, ...row } = patch;
      const { data, error } = await sb.from('contents').update(row).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async deleteContent(id) {
      const { error } = await sb.from('contents').delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    },
    async saveMetrics(id, metrics) {
      const { error } = await sb.from('content_metrics').insert({
        content_id: id,
        user_id: requireUser(),
        source: 'manual',
        fetched_at: new Date().toISOString(),
        ...metrics,
      });
      if (error) throw error;
      return { ok: true };
    },

    // --- campaigns ---
    async createCampaign(data) {
      const { data: created, error } = await sb
        .from('campaigns')
        .insert({ status: 'active', ...data, user_id: requireUser() })
        .select()
        .single();
      if (error) throw error;
      return created;
    },
    async updateCampaign(id, patch) {
      const { data, error } = await sb.from('campaigns').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async deleteCampaign(id) {
      const { error } = await sb.from('campaigns').delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    },

    // --- accounts ---
    async createAccount(data) {
      const { data: created, error } = await sb
        .from('accounts')
        .insert({ ...data, user_id: requireUser() })
        .select()
        .single();
      if (error) throw error;
      return created;
    },
    async deleteAccount(id) {
      const { error } = await sb.from('accounts').delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    },
  };
}
