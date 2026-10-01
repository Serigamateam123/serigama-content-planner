# Serigama Content Planner

A simple, private planner for your social content — a **calendar**, **production pipeline**, and
**performance dashboard** in one page. Built to run with no build tools and no monthly fees.

Six screens, in two groups:

**Plan**
- **Content Dashboard** — what's due, what needs attention, the production pipeline
  (Idea → Scripting → Filming → Editing → Ready → Scheduled).
- **Content Calendar** — month/week grid + an unscheduled backlog. Filter by platform, status or
  funnel stage; drag a post to another day to reschedule it.
- **Content Funnel** — an inspiration library by funnel stage; turn any clip into a planned post.

**Report**
- **Monthly Report** — the one-glance summary for meetings: pick any month or date range and every
  number follows it — goals and pace, headline numbers, what kind of
  content works (by funnel stage / pillar / product), and **saved report snapshots**.
- **Targets** — the team's monthly *views in the month* target (563K in Oct 2026, +5% a month
  from November; Jan–Sep 2026 get faded *reference* targets counted backwards, for comparison only).
  *This month — pace* shows views added up day by day against a straight line to the target, with
  ahead/behind, views needed per day and a forecast; *Month by month* shows green/red bars vs target
  with an editable table; a *Weekly check* compares last week and this week for the Friday meeting.
- **Post Performance** — every post's numbers in detail, trends, hashtags, followers, audience.

---

## 1. Run it on your Mac (demo mode — nothing to set up)

The app works immediately in **local demo mode**: your data is saved in the browser, no account
needed. It comes pre-filled with sample data so you can see how everything looks.

Start the little local server (already included):

```bash
python3 ~/Projects/serigama-content-planner/serve.py
```

Then open **http://localhost:8777** in your browser.

> Demo mode data lives only in this one browser on this Mac. To use it from your phone and
> anywhere else, turn on cloud sync (next section).

---

## 2. Turn on cloud sync (access from any device) — ~10 minutes, free

This uses **Supabase** — a free service that stores your data online. You only do this once.

1. **Create a free account** at https://supabase.com → **New project**. Pick any name and a
   database password (save it somewhere). Wait ~2 minutes for it to finish setting up.
2. **Create the tables.** In the left menu open **SQL Editor** → **New query**. Open the file
   `supabase/schema.sql` from this project, copy everything, paste it in, and click **Run**.
   You should see “Success”.
3. **Get your keys.** Left menu → **Project Settings** → **API**. Copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)
4. **Paste them into `config.js`** (in the project folder):

   ```js
   window.PLANNER_CONFIG = {
     supabaseUrl: 'https://abcd1234.supabase.co',
     supabaseAnonKey: 'paste-the-long-anon-key-here',
     brandName: 'Serigama',
     ownerName: 'Serigama',
     ownerRole: 'Social media',
   };
   ```
5. **Allow email sign-in.** In Supabase: **Authentication** → **Providers** → make sure **Email**
   is enabled (it is by default).

Now reload the app. Instead of demo mode you'll see a **sign-in screen** — enter your email,
click the link Supabase emails you, and you're in. Your data now syncs everywhere you sign in.

> The anon key is safe to keep in `config.js`. The database's security rules (set up by
> `schema.sql`) make sure each signed-in person can only see their own data.

---

## 3. Put it online (so the link works anywhere)

Once cloud sync is on, host the folder so you can open it from your phone. Easiest free options —
pick one:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the whole
  `serigama-content-planner` folder onto the page. You get a public link in seconds.
- **Cloudflare Pages** or **Vercel** — also free; connect the folder or a Git repo.

After deploying, add your live URL to Supabase under **Authentication → URL Configuration →
Site URL / Redirect URLs**, so the email sign-in link brings you back to the right place.

> The whole app is just static files (`index.html`, `config.js`, `src/…`). Any static host works.
> No server, no Node, no build step.

---

## 4. Everyday use

- **Add a post:** click **New content** (or a day on the calendar). Give it a title, platform,
  funnel stage, pillar, product, who it's assigned to, and a date/time. Leave the date blank to park
  it in the **unscheduled backlog**.
- **Move it through production:** update the status as you go — Scripting → Filming → Editing →
  Ready → Scheduled. The Dashboard's pipeline shows where everything is and flags anything late.
- **Mark it done:** set status to **Published** — it then counts in your reports and goals.
- **Enter numbers:** on **Post Performance** click **Update numbers** and type each post's reach / views /
  likes / comments / shares. The engagement rate is calculated for you.
- **Report:** on **Monthly Report** set your monthly goals, then click **Save this report** before a
  meeting to keep a snapshot, and **Print / PDF** to send it (uses your browser's "Save as PDF").

Reset the sample data any time (demo mode): open the browser console on the page and run
`localStorage.removeItem('serigama-planner-v1')`, then reload.

---

## 5. Coming later — automatic numbers (Phase 2)

Right now you type in the performance numbers. Phase 2 will pull them **automatically** from
TikTok and Instagram. That work needs developer-app approvals from those platforms (which take
time and are outside our control), so it's built as a follow-on. Every post already has a
**Post link** field — fill that in when you publish, and the future auto-sync will use it to fetch
that post's stats. Nothing you enter now is wasted.

---

## Project layout

```
index.html            App shell + module import map (loads Preact/htm/Supabase from a CDN)
config.js             Your settings (Supabase keys, brand name) — the only file you edit
serve.py              Tiny local server for previewing on your Mac
src/
  app.js              Root: routing, auth gate, data loading
  lib/                store (local + Supabase), metrics, dates, constants, seed data
  components/         Sidebar + shared UI pieces
  features/           Dashboard, Calendar, Fundamental (Content Funnel), Goals, AnalyticsDashboard (Monthly Report), Analytics (Post Performance), ContentModal, Login
  styles.css          Design system (blue sidebar, gold accents)
supabase/
  schema.sql          Run once in Supabase to create the tables + security rules
```
