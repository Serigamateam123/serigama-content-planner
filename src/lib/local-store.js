// LOCAL DEMO MODE backend: persists everything to localStorage. Used when no
// Supabase config is present. Mirrors the async interface of the Supabase store
// so the rest of the app doesn't care which one is active.

import { buildSeed } from './seed.js';

const KEY = 'serigama-planner-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* fall through to seed */
  }
  const seeded = buildSeed(new Date());
  save(seeded);
  return seeded;
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

let db = null;
const ensure = () => (db = db || load());
const clone = (x) => JSON.parse(JSON.stringify(x));
const ok = (x) => Promise.resolve(clone(x));

export const localStore = {
  isCloud: false,

  // --- auth (demo: always "signed in" as a local user) ---
  async getSession() {
    return { user: { email: 'Local demo' } };
  },
  async signIn() {
    return { ok: true, message: 'Local demo mode — no sign-in needed.' };
  },
  async signOut() {
    return { ok: true };
  },
  onAuthChange() {
    return () => {};
  },

  // --- reads ---
  async listAccounts() {
    return ok(ensure().accounts);
  },
  async listCampaigns() {
    return ok(ensure().campaigns);
  },
  async listAccountStats() {
    return ok(ensure().accountStats || []);
  },
  async listMetricsHistory() {
    return ok(ensure().metricsHistory || []);
  },
  async listStudioMetrics() {
    return ok(ensure().studioMetrics || []);
  },
  async listContents() {
    return ok(ensure().contents);
  },

  // --- content ---
  async createContent(data) {
    ensure();
    const row = { id: uid(), has_final_caption: false, metrics: null, post_url: '', caption: '', ...data };
    db.contents.push(row);
    save(db);
    return clone(row);
  },
  async updateContent(id, patch) {
    ensure();
    const c = db.contents.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    save(db);
    return clone(c);
  },
  async deleteContent(id) {
    ensure();
    db.contents = db.contents.filter((x) => x.id !== id);
    save(db);
    return { ok: true };
  },
  async saveMetrics(id, metrics) {
    return this.updateContent(id, { metrics: { source: 'manual', fetched_at: new Date().toISOString(), ...metrics } });
  },

  // --- campaigns ---
  async createCampaign(data) {
    ensure();
    const row = { id: uid(), status: 'active', ...data };
    db.campaigns.push(row);
    save(db);
    return clone(row);
  },
  async updateCampaign(id, patch) {
    ensure();
    const c = db.campaigns.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    save(db);
    return clone(c);
  },
  async deleteCampaign(id) {
    ensure();
    db.campaigns = db.campaigns.filter((x) => x.id !== id);
    db.contents.forEach((c) => {
      if (c.campaign_id === id) c.campaign_id = null;
    });
    save(db);
    return { ok: true };
  },

  // --- accounts ---
  async createAccount(data) {
    ensure();
    const row = { id: uid(), ...data };
    db.accounts.push(row);
    save(db);
    return clone(row);
  },
  async deleteAccount(id) {
    ensure();
    db.accounts = db.accounts.filter((x) => x.id !== id);
    save(db);
    return { ok: true };
  },

  // --- danger: wipe & reseed (used by the "reset demo data" button) ---
  async resetDemo() {
    db = buildSeed(new Date());
    save(db);
    return { ok: true };
  },
};
