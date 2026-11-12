// Read/write helpers for the small JSON values kept in app_kv (see DATA-SYNC.md).
// localStorage is only a per-browser cache; a value counts as saved once the cloud
// write succeeds, so writeKV THROWS when the cloud rejects it — callers must show
// that to the user instead of silently keeping the change on one device.
// Per-account keys (lib/account.js) resolve to the active account's copy.

import { store, isCloud } from './store.js';
import { kvKey } from './account.js';

export function readKV(key, fallback = null) {
  try {
    const v = JSON.parse(localStorage.getItem(kvKey(key)) || 'null');
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export async function writeKV(key, value) {
  const k = kvKey(key);
  const json = JSON.stringify(value);
  try { localStorage.setItem(k, json); } catch (e) { /* cache only */ }
  if (isCloud) await store.setKV(k, json);
}

// The cloud copy of a key (falls back to this browser's copy). Read it right before a
// read-modify-write of a whole map, so another device's recent edits aren't overwritten.
export async function readKVFresh(key, fallback = null) {
  const local = readKV(key, fallback);
  if (!isCloud) return local;
  try {
    const remote = await store.getKV();
    const raw = remote[kvKey(key)];
    return raw != null ? JSON.parse(raw) || fallback : local;
  } catch (e) { return local; }
}

// Merge-update one entry of a map-shaped key ({ [id]: {...} }). Re-reads the cloud
// copy first so an edit on one device can't wipe entries added on another.
// `patch` null removes the entry.
export async function updateKVEntry(key, id, patch) {
  const k = kvKey(key);
  let map = readKV(key, {});
  if (isCloud) {
    const remote = await store.getKV();
    if (remote[k] != null) { try { map = JSON.parse(remote[k]) || {}; } catch (e) { /* keep local */ } }
  }
  const next = { ...map };
  if (patch == null) delete next[id];
  else next[id] = { ...(next[id] || {}), ...patch };
  await writeKV(key, next);
  return next;
}
