// Read/write helpers for the small JSON values kept in app_kv (see DATA-SYNC.md).
// localStorage is only a per-browser cache; a value counts as saved once the cloud
// write succeeds, so writeKV THROWS when the cloud rejects it — callers must show
// that to the user instead of silently keeping the change on one device.

import { store, isCloud } from './store.js';

export function readKV(key, fallback = null) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export async function writeKV(key, value) {
  const json = JSON.stringify(value);
  try { localStorage.setItem(key, json); } catch (e) { /* cache only */ }
  if (isCloud) await store.setKV(key, json);
}

// Merge-update one entry of a map-shaped key ({ [id]: {...} }). Re-reads the cloud
// copy first so an edit on one device can't wipe entries added on another.
// `patch` null removes the entry.
export async function updateKVEntry(key, id, patch) {
  let map = readKV(key, {});
  if (isCloud) {
    const remote = await store.getKV();
    if (remote[key] != null) { try { map = JSON.parse(remote[key]) || {}; } catch (e) { /* keep local */ } }
  }
  const next = { ...map };
  if (patch == null) delete next[id];
  else next[id] = { ...(next[id] || {}), ...patch };
  await writeKV(key, next);
  return next;
}
