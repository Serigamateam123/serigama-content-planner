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
   A new account shows the change as "--": store `null`. If it is under 28 days old, also store
   `net28dDays` (the days the 28-day net actually covers) so the follower-pace forecast is right.
6. **Audience** — Followers tab → gender, age, locations.
7. **Traffic source** — Overview tab → For You / Profile / Search / Following.
   ⚠️ This is **one account-level figure** — TikTok does **not** split it by date range.

Every value is written to the cloud via `window.serigamaCloud.set(...)` (see §5).

**More than one TikTok account:** do steps 1–7 once per account (switch accounts in TikTok
Studio first). Per-video figures go in the shared keys as usual. The account-level figures
(steps 3–7) go in that account's keys: get the account ids with `window.serigamaCloud.accounts()`
and the key with `window.serigamaCloud.key('serigama.monthly', <account id>)`.

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
- **Per-account keys** (`src/lib/account.js`): `serigama.monthly`, `serigama.audience`,
  `serigama.monthlyfollowers`, `serigama.goals`, `serigama.reports`, `serigama.targets` (and the
  retired `serigama.goal.views`) belong to one TikTok account. The **primary** account (the
  login's first TikTok account, serigama.daily) uses the plain key names; every other account
  uses `<key>@<account id>`. The rest (`saves`, `newfollowers`, `contentmeta`, `fundamental`)
  are keyed by video / content id and shared by all accounts. The sidebar switcher picks the
  account every screen shows; `readKV` / `writeKV` resolve the key for it.
- `syncKV()` — **cloud-authoritative**: for each key (every account's copy), the cloud value is
  mirrored down to localStorage; a primary key the cloud does not have yet is seeded **once**
  from this browser. Runs before the analytics views read localStorage.
- `window.serigamaCloud.set(k, v)` — writes **localStorage AND cloud** (`app_kv`).
  **All captures MUST use this**, never bare `localStorage.setItem` (which only touches one browser).

- `window.serigamaCloud.accounts()` / `.key(base, accountId)` — list the TikTok accounts and
  name a per-account key, for captures of a non-primary account.

**`src/lib/supabase-store.js`** — `getKV()` / `setKV()` read/write `app_kv` (RLS scoped to the user).

**Auto data, several accounts** (`supabase/multi_account.sql`) — each TikTok connection
(`integrations`, one per `open_id`) points at its `accounts` row; `tiktok-sync` tags every
synced video (`contents.account_id`) and daily follower snapshot (`account_stats`, one per
account per day) with it. Connect another account from Post Performance → *Connect another
TikTok account*.

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

## 5b. Instagram (fully automatic — no Thursday capture)

- Connected through **Facebook Login for Business** (Meta app "Serigama Content Planner",
  ID 1784689132823597, login configuration 1422746343402021 — read-only permissions:
  instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement,
  business_management). Connect from the sidebar → *+ Add Instagram account…*; pick the
  **Serigama HQ** Page and the **Mejustif Sdn. Bhd.** business.
- `supabase/functions/instagram-callback` stores one connection per Instagram account (Page token,
  doesn't expire). Needs the Supabase secret `META_APP_SECRET` (saved as `Meta_App_Secret`; the
  function reads either). JWT verification is **off** (Facebook calls it).
- `supabase/functions/instagram-sync` runs daily at **22:05 UTC (6:05 AM MYT)** (cron job
  `instagram-daily-sync`, copied from the TikTok job) and from the Refresh button. JWT off. It writes
  posts + metrics, saves (`serigama.saves`), followers (`account_stats`), and the account's
  `serigama.monthly@<id>`, `serigama.monthlyfollowers@<id>` and `serigama.audience@<id>` —
  including **real follows / unfollows** (Instagram reports both; TikTok doesn't).
- **Feed vs Reels** (Post Performance, Instagram account only): per reel it saves average and total
  watch time + reach to `serigama.reels` (shared, keyed by post id). Each month in
  `serigama.monthly@<id>` also gets `viewsByFollowType` (FOLLOWER / NON_FOLLOWER) and
  `viewsByFormat` (REEL / POST / CAROUSEL_CONTAINER / STORY / AD).
- API limits (tested 2026-11-06, v25.0): Instagram does **not** give followers gained, profile
  visits, followers-vs-non-followers or view sources (Explore / Reels tab / profile) **per reel** —
  only account-wide, so the Reels section labels those panels "whole account".
- **Thursday web capture (per-reel follows)**: instagram.com (Chrome is signed in as @serigamahq)
  shows each reel's **Follows** and followers / non-followers split, which the API doesn't. Page:
  `https://www.instagram.com/insights/media/<pk>/`, where `<pk>` = the reel's shortcode (from
  `post_url`) decoded as base-64 digits over `A–Z a–z 0–9 - _` (BigInt). Read the page text
  (Views → Followers %, Profile → Follows). Save `serigama.newfollowers[<graph id>] = follows`
  and `serigama.reelsweb[<graph id>] = { follows, followerViewsPct, nonFollowerViewsPct,
  accountsEngaged, capturedAt, source: 'instagram-web' }` (merge, never replace). Weekly: the
  last ~10 weeks' reels are enough (older ones barely change). First capture 2026-11-06: all 45
  reels of 2026. Demographics per reel exist only in the phone app.
- **Who saw your content**: `reached_audience_demographics` (gender / age / country / city) for
  `this_week` and `this_month`, saved as `viewers` in `serigama.audience@<id>`. There is no per-post
  demographics API; when one post makes ≥50% of the month's views the panel says the figures are
  mostly that post's audience.
- The Meta app's **App domains** must include `acfscrvvlzjtbsxturkx.supabase.co` and Facebook
  Login for Business → **Valid OAuth Redirect URIs** must include the instagram-callback URL.

---

## 5b-2. Threads @serigamahq (connected 2026-11-12, fully automatic)

- Same Meta app, use case **Access the Threads API** (own Threads app ID 1447493470865177;
  read-only `threads_basic` + `threads_manage_insights`). Redirect / uninstall / delete callback
  URLs point at `threads-callback`. @serigamahq is a **Threads Tester** (app in development mode).
- Supabase secret `THREADS_APP_SECRET` (copy it only after clicking **Show** on Meta — the masked
  ●●●● value fails with "Invalid client_secret"). `threads-callback` and `threads-sync` have
  verify_jwt **off**; cron `threads-daily-sync` at 22:10 UTC (6:10 AM MYT), `supabase/cron_threads_sync.sql`.
- Tokens last 60 days; `threads-sync` renews them when < 15 days remain. Per post: views, likes,
  replies (→ comments), reposts + quotes + shares (→ shares; split kept in `serigama.threadsposts`).
  Account: followers → `account_stats`, views per month → `serigama.monthly@<id>`, audience
  (needs 100+ followers) → `serigama.audience@<id>`.
- If Instagram/Threads syncs fail with "Cannot call API for app … on behalf of user", check
  developers.facebook.com: Meta paused the developer account once (Nov 2026, "Account
  confirmation needed") until the owner confirmed it.

## 5c. Planned item → posted video (automatic)

Each time the planner loads (cloud mode), `src/lib/reconcile.js` looks for a planned item
(Idea … Scheduled, no `external_id`) and a synced posted video **of the same account on the
same day** (Malaysia time). One plan + one unlinked video that day = a pair; with several, they
pair by title similarity. A day apart only counts when the titles clearly agree. The plan's
pillar / funnel / hook / product / assignee / CTA / Notion id move to the video's
`serigama.contentmeta` entry (plus `plan_title`), its notes go into the video's notes if empty,
and the plan is deleted. Videos that already carry a plan (`plan_title` / `notion_id` / hook /
pillar) are never merged into again. A video posted on a different day than planned is not
matched — move or delete that plan by hand.

Display order of accounts (switcher, sidebar, All accounts calendar): HQ on top, daily in the
centre, intern at the bottom (by handle ending: hq → daily → intern; Instagram before TikTok
within a brand) — serigamahq, serigama.hq, serigama.daily, serigama.intern. The **primary** account is
still the oldest TikTok account (serigama.daily), whatever the display order.

---

## 5d. Load speed (2026-11-11)

`contents` (~1,400 rows) and `content_metrics` (~17,000 rows, +~800/day with four accounts) are
both past PostgREST's 1000-rows-per-response cap. `src/lib/supabase-store.js` counts each table,
then fetches its pages in parallel (`fetchAllRows`), and downloads `content_metrics` **once** per
load for both the latest-per-post numbers and the history. Opening took ~10 s (and silently
dropped ~370 content items over the cap); now ~3 s with everything loaded. If it slows again as
`content_metrics` grows, add a database view for the latest snapshot per post and load history
only for recent months.

---

## 5e. Team access (2026-11-11)

The owner login (serigamateam@gmail.com) adds people on **Settings → Team** with a role:
**Calendar only** (content plan for all accounts — add / edit / drag — no reports or figures) or
**Full access** (everything except connecting accounts and the Team page). Rules live in
`supabase/team.sql` (run once, already applied): `team_members` + extra RLS policies next to the
owner's own ones; connection tokens (`integrations`) stay owner-only. Logins are created by the
Edge Function `team-invite` (JWT on) with a starting password the owner types — no email is sent,
because Supabase's built-in mailer only reaches pre-approved addresses. Members save into the
owner's data (`dataOwnerId` in `supabase-store.js`). Tested 2026-11-11 with a rolled-back SQL
transaction acting as a calendar / full / removed member.

---

## 6. Known limits (by design, not bugs)

- **Traffic source** — account-level only; identical for any date range.
- **Hook / retention per video** — measured in a video's first days; effectively final once set.
- **Auto data** still needs the daily sync (or a Refresh click) — Claude does not pull views/likes by hand.
