# Serigama Content Planner — Data Sync Process

This is the fixed, agreed process for how data stays current across every device.
**Do not change this process.** The code below enforces it; keep the code matching this doc.

---

## 1. Two kinds of data

| Kind | Examples | Source | Syncs by itself? |
|------|----------|--------|------------------|
| **Auto** | Views, likes, comments, shares, follower count | TikTok Display API | ✅ Yes — daily server sync + the **Refresh** button |
| **Manual** | Saves, hook/retention, new viewers, new followers, monthly views, monthly followers, audience (gender/age/location), traffic source | TikTok **Studio** only (not in the public API) | ❌ No — Claude pulls these from Studio on request |

Both kinds are stored in **Supabase (the cloud)** — so both show on **every device and browser**.

---

## 2. Source of truth = the cloud

- **Auto data** → Supabase tables `contents`, `content_metrics`, `account_stats`.
- **Manual data** → Supabase table **`app_kv`** (key → JSON), the single source of truth.

On every page load, the app **mirrors the cloud DOWN into the browser** (`syncKV()` in `src/app.js`).
A device holding an old copy **cannot** overwrite the cloud — it just gets corrected to the latest.
This is the fix that makes the manual figures appear on all devices, not just one browser.

---

## 3. The weekly routine (agreed)

1. **Thursday ~5:30 PM** — automated reminder pings you.
2. **You ping Claude:** *"Refresh all my manual TikTok Studio data for the Serigama Content Planner."*
   (Keep TikTok Studio open and logged in in your browser.)
3. **Claude does the full pull** (see §4) and writes every figure to the **cloud**.
4. **You reload the app** (⌘R) on any device → the fresh numbers show everywhere.
5. Friday 10:30 AM meeting → you present with current data.

For the latest **auto** numbers too, click the gold **Refresh** button after logging in.

---

## 4. Exactly what Claude captures each time

1. **Full post list** — Studio → **Posts** page (`/tiktokstudio/content`). Read **every** upload for the
   month (the "top posts by views" view hides some — always use the full Posts list).
2. **Per video** — open each video's Overview (`/tiktokstudio/analytics/<id>/overview`):
   - Header numbers, in order: **views · likes · comments · shares · saves** (5th = saves).
   - **New followers** stat.
3. **Monthly views** — Overview tab with a custom date range set to the month → "Video views".
4. **Monthly followers** — Followers tab, custom range = the month → "Net followers".
5. **Growth pace** — Followers tab, Last 7 days and Last 28 days → net + change %.
6. **Audience** — Followers tab → gender, age, locations.
7. **Traffic source** — Overview tab → For You / Profile / Search / Following.
   ⚠️ This is **one account-level figure** — TikTok does **not** split it by date range.

Every value is written to the cloud via `window.serigamaCloud.set(...)` (see §5).

---

## 5. The code contract (keep these intact)

**`src/app.js`**

- `KV_KEYS` — every key mirrored between the cloud and the browser:
  - the six Studio figures: `serigama.monthly` (months + `trafficSourceOverall`), `serigama.goal.views`,
    `serigama.audience`, `serigama.monthlyfollowers`, `serigama.saves`, `serigama.newfollowers`;
  - planner data you enter in the app: `serigama.fundamental` (Content Funnel inspo clips),
    `serigama.contentmeta` (per-post funnel stage / pillar / product / assigned-to / hook / CTA,
    keyed by content id), `serigama.goals` (monthly goals for posts / followers / engagement), `serigama.reports` (saved report snapshots),
    `serigama.targets` (the Targets page's views-in-the-month target: start month, start value,
    monthly growth % and any months set by hand).
- `syncKV()` — **cloud-authoritative**: for each key, the cloud value is mirrored down to
  localStorage; a key the cloud does not have yet is seeded **once** from this browser.
  Runs before the analytics views read localStorage.
- `window.serigamaCloud.set(k, v)` — writes **localStorage AND cloud** (`app_kv`).
  **All captures MUST use this**, never bare `localStorage.setItem` (which only touches one browser).

**`src/lib/supabase-store.js`** — `getKV()` / `setKV()` read/write `app_kv` (RLS scoped to the user).

**`src/lib/kv.js`** — `writeKV()` / `updateKVEntry()` are how the app's own screens save these keys.
They **throw** if the cloud write fails, and every screen shows that as an error — a change is never
silently kept on one browser only. `updateKVEntry()` re-reads the cloud copy before merging, so an
edit on one device can't wipe entries added on another.

**`src/features/Goals.js`** — `GoalsCard` writes `serigama.goals` (posts per week, new followers,
engagement rate). The **views** target is not set there: it comes from `serigama.targets` (the
Targets page, *views in the month*), so there is one views target. The old `serigama.goal.views`
key is no longer read.

> Rule of thumb: **a manual figure is only "saved" once it is in `app_kv`.** localStorage alone is a
> per-browser cache, nothing more.

---

## 6. Known limits (by design, not bugs)

- **Traffic source** — account-level only; identical for any date range.
- **Hook / retention per video** — measured in a video's first days; effectively final once set.
- **Auto data** still needs the daily sync (or a Refresh click) — Claude does not pull views/likes by hand.
