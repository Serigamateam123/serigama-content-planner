// Supabase Edge Function: threads-sync  (verify_jwt OFF — called by cron and the planner)
// For every connected Threads account (integrations.platform = 'threads'):
//   • renews the long-lived token when it has under 15 days left (tokens last 60 days)
//   • posts + their numbers → `contents` / `content_metrics` (one snapshot per run)
//       views → views, likes → likes, replies → comments,
//       reposts + quotes + shares → shares (kept separately in app_kv `serigama.threadsposts`)
//   • followers today → `account_stats`
//   • account views this month and last → app_kv `serigama.monthly@<account id>`
//   • audience (country / age / gender, Threads gives it from 100 followers) →
//     app_kv `serigama.audience@<account id>`
// Safe to re-run. Body { user_id } limits it to one planner login.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.threads.net/v1.0";
const MYT = 8 * 3600 * 1000;
const FULL_INSIGHTS_DAYS = 120; // older posts keep their last snapshot once captured
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json;
}
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
async function kvGet(uid: string, k: string) {
  const { data } = await sb.from("app_kv").select("v").eq("user_id", uid).eq("k", k).maybeSingle();
  try { return data ? JSON.parse(data.v) : null; } catch (_) { return null; }
}
async function kvSet(uid: string, k: string, value: unknown) {
  await sb.from("app_kv").upsert({ user_id: uid, k, v: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: "user_id,k" });
}
const mytNow = () => new Date(Date.now() + MYT);
const ymKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const mytMidnight = (y: number, m: number, d: number) => Math.floor((Date.UTC(y, m, d) - MYT) / 1000);

// Long-lived Threads tokens last 60 days and can be renewed once they're a day old.
async function freshToken(row: any) {
  const left = row.expires_at ? new Date(row.expires_at).getTime() - Date.now() : 0;
  if (left > 15 * 86400000) return row.access_token;
  try {
    const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(row.access_token)}`);
    const j = await res.json();
    if (j.access_token) {
      await sb.from("integrations").update({
        access_token: j.access_token,
        expires_at: new Date(Date.now() + (Number(j.expires_in) || 5184000) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      return j.access_token;
    }
  } catch (_) { /* fall back to the current token */ }
  return row.access_token;
}

// Sum of a daily account metric (e.g. views) between two unix times (≤ 90-day windows).
async function sumDaily(token: string, metric: string, since: number, until: number) {
  let sum = 0;
  for (let s = since; s < until; s += 90 * 86400) {
    const u = Math.min(until, s + 90 * 86400);
    const j = await graph(`me/threads_insights?metric=${metric}&since=${s}&until=${u}`, token);
    const d = (j.data || [])[0];
    if (d?.total_value) sum += Number(d.total_value.value) || 0;
    else for (const v of d?.values || []) sum += Number(v.value) || 0;
  }
  return sum;
}

async function demographics(token: string, breakdown: string) {
  const j = await graph(`me/threads_insights?metric=follower_demographics&breakdown=${breakdown}`, token);
  const rows = j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  const total = rows.reduce((n: number, r: any) => n + (Number(r.value) || 0), 0) || 1;
  return rows.map((r: any) => ({ key: String(r.dimension_values?.[0] ?? ""), pct: Math.round((Number(r.value) / total) * 1000) / 10 }))
    .sort((a: any, b: any) => b.pct - a.pct);
}

async function syncOne(row: any) {
  const uid = row.user_id, accountId = row.account_id;
  const token = await freshToken(row);
  const result: Record<string, unknown> = {};
  const today = new Date().toISOString().slice(0, 10);

  // 1) Followers today.
  try {
    const f = await graph("me/threads_insights?metric=followers_count", token);
    const followers = Number(f.data?.[0]?.total_value?.value ?? NaN);
    if (Number.isFinite(followers)) {
      await sb.from("account_stats").upsert({
        user_id: uid, account_id: accountId, platform: "threads",
        follower_count: followers, following_count: null, likes_count: null, video_count: null,
        captured_at: new Date().toISOString(), day: today,
      }, { onConflict: "user_id,platform,account_id,day" });
      result.followers = followers;
    }
  } catch (e) { result.followersError = String(e).slice(0, 160); }

  // 2) All posts (newest first). Replies to others aren't listed by /threads.
  const posts: any[] = [];
  let next = "me/threads?fields=id,media_product_type,media_type,permalink,text,timestamp,shortcode,is_quote_post&limit=100";
  for (let page = 0; next && page < 30; page++) {
    const j = await graph(next, token);
    posts.push(...(j.data || []));
    const after = j.paging?.cursors?.after;
    next = j.paging?.next && after ? `me/threads?fields=id,media_product_type,media_type,permalink,text,timestamp,shortcode,is_quote_post&limit=100&after=${after}` : "";
  }

  const { data: known } = await sb.from("contents").select("external_id").eq("user_id", uid).eq("platform", "threads");
  const seen = new Set((known || []).map((c: any) => String(c.external_id)));
  const cutoff = Date.now() - FULL_INSIGHTS_DAYS * 86400000;
  const todo = posts.filter((p) => !seen.has(String(p.id)) || !p.timestamp || new Date(p.timestamp).getTime() >= cutoff);
  const extra: Record<string, unknown> = {};

  // 3) Numbers per post, then save in batches.
  const withNums = await mapLimit(todo, 8, async (p: any) => {
    const n: Record<string, number> = {};
    try {
      const j = await graph(`${p.id}/insights?metric=views,likes,replies,reposts,quotes,shares`, token);
      for (const d of j.data || []) n[d.name] = Number(d.values?.[0]?.value ?? d.total_value?.value) || 0;
    } catch (_) { /* reposts of others' posts have no insights */ }
    return { p, n };
  });
  for (let i = 0; i < withNums.length; i += 50) {
    const batch = withNums.slice(i, i + 50);
    const { data: saved, error } = await sb.from("contents").upsert(batch.map(({ p }) => {
      const ts = p.timestamp ? new Date(p.timestamp).toISOString() : null;
      const text = String(p.text || "").trim();
      return {
        user_id: uid, platform: "threads", account_id: accountId, external_id: String(p.id),
        title: (text || (p.media_type === "REPOST_FACADE" ? "(Repost)" : "(Threads post)")).slice(0, 300),
        status: "published", published_at: ts, scheduled_at: ts, post_url: p.permalink || "",
        has_final_caption: true,
        format: p.media_type === "VIDEO" ? "video" : p.media_type === "CAROUSEL_ALBUM" ? "carousel" : "feed",
      };
    }), { onConflict: "user_id,platform,external_id" }).select("id, external_id");
    if (error) throw error;
    const idOf = new Map((saved || []).map((c: any) => [String(c.external_id), c.id]));
    const now = new Date().toISOString();
    const metrics = batch.filter(({ p }) => idOf.has(String(p.id))).map(({ p, n }) => {
      const views = n.views || 0, likes = n.likes || 0, comments = n.replies || 0;
      const shares = (n.reposts || 0) + (n.quotes || 0) + (n.shares || 0);
      const engagement = likes + comments + shares;
      extra[String(p.id)] = { reposts: n.reposts || 0, quotes: n.quotes || 0, shares: n.shares || 0, replies: comments };
      return {
        content_id: idOf.get(String(p.id)), user_id: uid, views, likes, comments, shares, reach: 0,
        engagement, engagement_rate: views ? Math.round((engagement / views) * 1000) / 10 : 0,
        source: "threads", fetched_at: now,
      };
    });
    if (metrics.length) await sb.from("content_metrics").insert(metrics);
  }
  if (Object.keys(extra).length) {
    const all = (await kvGet(uid, "serigama.threadsposts")) || {};
    await kvSet(uid, "serigama.threadsposts", { ...all, ...extra });
  }
  result.posts = posts.length;
  result.pulled = todo.length;

  // 4) Account views this month and last (Malaysia time, whole days up to yesterday).
  const now = mytNow();
  const y = now.getUTCFullYear(), mo = now.getUTCMonth(), d = now.getUTCDate();
  const yesterdayEnd = mytMidnight(y, mo, d);
  const monthly = (await kvGet(uid, `serigama.monthly@${accountId}`)) || { months: {} };
  for (const back of [1, 0]) {
    const start = new Date(Date.UTC(y, mo - back, 1));
    const key = ymKey(start);
    if (back === 1 && monthly.months?.[key]?.complete) continue;
    const since = mytMidnight(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const monthEnd = mytMidnight(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    const until = Math.min(monthEnd, yesterdayEnd);
    if (until <= since) continue;
    try {
      const views = await sumDaily(token, "views", since, until);
      monthly.months = monthly.months || {};
      monthly.months[key] = { label: MONTHS[start.getUTCMonth()], views, days: Math.round((until - since) / 86400), complete: until === monthEnd };
    } catch (e) { result.viewsError = String(e).slice(0, 160); }
  }
  monthly.updated = today;
  await kvSet(uid, `serigama.monthly@${accountId}`, monthly);

  // 5) Audience (only once the account has 100+ followers).
  const aud: Record<string, unknown> = { capturedAt: today, totalFollowers: result.followers ?? null, source: "threads-api" };
  try {
    const g = await demographics(token, "gender");
    const name: Record<string, string> = { F: "Female", M: "Male", U: "Other", female: "Female", male: "Male" };
    aud.gender = g.map((x: any) => ({ label: name[x.key] || x.key, pct: x.pct }));
    aud.age = (await demographics(token, "age")).map((x: any) => ({ label: x.key.replace("-", "–"), pct: x.pct }));
    const c = await demographics(token, "country");
    aud.locations = c.slice(0, 5).map((x: any) => ({ name: x.key, pct: x.pct }));
  } catch (e) { result.audienceError = String(e).slice(0, 160); }
  await kvSet(uid, `serigama.audience@${accountId}`, aud);

  await sb.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let targetUser: string | null = null;
    try { targetUser = (await req.json())?.user_id ?? null; } catch (_) { /* no body */ }
    let q = sb.from("integrations").select("*").eq("platform", "threads");
    if (targetUser) q = q.eq("user_id", targetUser);
    const { data: rows, error } = await q;
    if (error) throw error;
    const results = await Promise.all((rows ?? []).map(async (row: any) => {
      try { return { user_id: row.user_id, account: row.display_name, ...(await syncOne(row)) }; }
      catch (e) { return { user_id: row.user_id, account: row.display_name, error: String(e) }; }
    }));
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
