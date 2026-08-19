// Picks the data backend based on config.js: Supabase when configured, otherwise
// the local demo store. The rest of the app imports `store` and never branches.

import { localStore } from './local-store.js';
import { makeSupabaseStore } from './supabase-store.js';

const cfg = (typeof window !== 'undefined' && window.PLANNER_CONFIG) || {};

export const isCloud = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

export const store = isCloud
  ? makeSupabaseStore(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : localStore;

export const config = cfg;
