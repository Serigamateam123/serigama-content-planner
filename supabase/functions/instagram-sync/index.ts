// Supabase Edge Function: instagram-sync
// For every connected Instagram professional account (integrations.platform =
// 'instagram', written by instagram-callback):
//   • posts + their numbers → `contents` / `content_metrics` (one snapshot per run)
//   • per-post saves → app_kv `serigama.saves` (shared, keyed by post id)
//   • followers today → `account_stats`
//   • account views this month and last → app_kv `serigama.monthly@<account id>`
//   • follows / unfollows → app_kv `serigama.monthlyfollowers@<account id>` and the
//     audience record `serigama.audience@<account id>` (with gender / age / country)
// so an Instagram account needs no manual Studio-style capture. Safe to re-run.
// If the request body has { user_id }, only that user's accounts sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v25.0";
const MYT = 8 * 3600 * 1000; // reports use Malaysia time for days and months
const FULL_INSIGHTS_DAYS = 120; // older posts keep their last snapshot after the first sync

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${token}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// --- app_kv helpers (same storage the planner's screens read) -----------------
async function kvGet(userId: string, k: string) {
  const { data } = await sb.from("app_kv").select("v").eq("user_id", userId).eq("k", k).maybeSingle();
  try { return data ? JSON.parse(data.v) : null; } catch (_) { return null; }
}
async function kvSet(userId: string, k: string, value: unknown) {
  await sb.from("app_kv").upsert({ user_id: userId, k, v: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: "user_id,k" });
}

// --- dates (Malaysia time) ---------------------------------------------------
const mytNow = () => new Date(Date.now() + MYT); // read with getUTC*
const ymKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Unix seconds for MYT midnight of y-m-d (month 0-based; day may overflow).
const mytMidnight = (y: number, m: number, d: number) => Math.floor((Date.UTC(y, m, d) - MYT) / 1000);

// Sum a daily total_value metric between two unix times, in ≤30-day windows.
async function totalBetween(igId: string, token: string, metric: string, since: number, until: number, breakdown?: string) {
  let sum = 0;
  const parts: Record<string, number> = {};
  for (let s = since; s < until; s += 30 * 86400) {
    const u = Math.min(until, s + 30 * 86400);
    const j = await graph(`${igId}/insights?metric=${metric}&period=day&metric_type=total_value` +
      (breakdown ? `&breakdown=${breakdown}` : "") + `&since=${s}&until=${u}`, token);
    const tv = j.data?.[0]?.total_value;
    sum += Number(tv?.value) || 0;
    for (const b of tv?.breakdowns?.[0]?.results || []) {
      const key = String(b.dimension_values?.[0] ?? "");
      parts[key] = (parts[key] || 0) + (Number(b.value) || 0);
    }
  }
  return { sum, parts };
}

// follows_and_unfollows split by follow_type → { follows, unfollows } (null if unavailable).
async function followFlow(igId: string, token: string, since: number, until: number) {
  try {
    const { parts } = await totalBetween(igId, token, "follows_and_unfollows", since, until, "follow_type");
    const follows = parts.FOLLOWER ?? null;
    const unfollows = parts.NON_FOLLOWER ?? null;
    if (follows == null && unfollows == null) return null;
    return { follows: follows || 0, unfollows: unfollows || 0 };
  } catch (_) {
    return null; // needs 100+ followers; never let it break the sync
  }
}

const COUNTRY: Record<string, string> = {
  MY: "Malaysia", SG: "Singapore", BN: "Brunei", ID: "Indonesia", TH: "Thailand", PH: "Philippines",
  US: "United States", GB: "United Kingdom", AU: "Australia", IN: "India", SA: "Saudi Arabia", AE: "United Arab Emirates",
};

async function demographics(igId: string, token: string, breakdown: string, metric = "follower_demographics", timeframe = "") {
  const j = await graph(`${igId}/insights?metric=${metric}&period=lifetime&metric_type=total_value&breakdown=${breakdown}` +
    (timeframe ? `&timeframe=${timeframe}` : ""), token);
  const rows = j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  const total = rows.reduce((n: number, r: any) => n + (Number(r.value) || 0), 0) || 1;
  return rows.map((r: any) => ({ key: String(r.dimension_values?.[0] ?? ""), pct: Math.round((Number(r.value) / total) * 1000) / 10 }))
    .sort((a: any, b: any) => b.pct - a.pct);
}

async function syncOne(row: any) {
  const token = row.access_token;
  const igId = row.open_id;
  const accountId = row.account_id;
  const uid = row.user_id;
  const result: Record<string, unknown> = {};

  // 1) Profile → today's follower snapshot.
  const prof = await graph(`${igId}?fields=username,followers_count,follows_count,media_count`, token);
  const today = new Date().toISOString().slice(0, 10);
  await sb.from("account_stats").upsert({
    user_id: uid, account_id: accountId, platform: "instagram",
    follower_count: prof.followers_count ?? null, following_count: prof.follows_count ?? null,
    likes_count: null, video_count: prof.media_count ?? null,
    captured_at: new Date().toISOString(), day: today,
  }, { onConflict: "user_id,platform,account_id,day" });
  result.followers = prof.followers_count;

  // 2) All posts (newest first).
  const media: any[] = [];
  let next = `${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=50`;
  for (let page = 0; next && page < 40; page++) {
    const j = await graph(next, token);
    media.push(...(j.data || []));
    const after = j.paging?.cursors?.after;
    next = j.paging?.next && after ? `${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=50&after=${after}` : "";
  }

  const { data: known } = await sb.from("contents").select("external_id").eq("user_id", uid).eq("platform", "instagram");
  const seen = new Set((known || []).map((c: any) => String(c.external_id)));
  const cutoff = Date.now() - FULL_INSIGHTS_DAYS * 86400000;
  const saves: Record<string, number> = {};
  const reels: Record<string, Record<string, unknown>> = {};

  // Reel-only extras. Tested 2026-11-06 (v25.0): per reel the API gives average and
  // total watch time; it does NOT give follows, profile visits, or a followers /
  // non-followers or source breakdown for reels ("not supported for this media
  // product type") — those are only available account-wide (step 4).
  async function reelExtras(id: string) {
    const x: Record<string, unknown> = {};
    try {
      const j = await graph(`${id}/insights?metric=ig_reels_avg_watch_time,ig_reels_video_view_total_time`, token);
      for (const d of j.data || []) {
        const v = Number(d?.values?.[0]?.value ?? d?.total_value?.value);
        if (Number.isFinite(v)) x[d.name] = v; // milliseconds
      }
    } catch (_) { /* not available for this reel */ }
    return x;
  }

  await mapLimit(media, 8, async (m: any) => {
    const ts = m.timestamp ? new Date(m.timestamp).toISOString() : null;
    const fresh = !ts || new Date(ts).getTime() >= cutoff;
    if (!fresh && seen.has(String(m.id))) return; // old post already has a snapshot

    let ins: Record<string, number> = {};
    for (const metrics of ["views,reach,saved,shares", "reach,saved,shares", "reach,saved"]) {
      try {
        const j = await graph(`${m.id}/insights?metric=${metrics}`, token);
        for (const d of j.data || []) ins[d.name] = Number(d.values?.[0]?.value ?? d.total_value?.value) || 0;
        break;
      } catch (_) { ins = {}; }
    }
    const likes = m.like_count ?? 0, comments = m.comments_count ?? 0, shares = ins.shares ?? 0;
    const views = ins.views ?? 0;
    const engagement = likes + comments + shares;
    const er = views ? Math.round((engagement / views) * 1000) / 10 : 0;
    if (ins.saved != null) saves[String(m.id)] = ins.saved;
    if (m.media_product_type === "REELS") {
      const x = await reelExtras(m.id);
      if (Object.keys(x).length) reels[String(m.id)] = { ...x, reach: ins.reach ?? null, capturedAt: new Date().toISOString().slice(0, 10) };
    }

    const format = m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : "feed";
    const { data: content } = await sb.from("contents").upsert({
      user_id: uid, platform: "instagram", account_id: accountId, external_id: String(m.id),
      title: (m.caption || "(Instagram post)").slice(0, 300), status: "published",
      published_at: ts, scheduled_at: ts, post_url: m.permalink || "", has_final_caption: true, format,
    }, { onConflict: "user_id,platform,external_id" }).select("id").single();
    if (content) {
      await sb.from("content_metrics").insert({
        content_id: content.id, user_id: uid, views, likes, comments, shares,
        reach: ins.reach ?? 0, engagement, engagement_rate: er, source: "instagram",
        fetched_at: new Date().toISOString(),
      });
    }
  });
  result.posts = media.length;

  // 3) Saves → the shared per-post map the planner reads.
  if (Object.keys(saves).length) {
    const all = (await kvGet(uid, "serigama.saves")) || {};
    await kvSet(uid, "serigama.saves", { ...all, ...saves });
  }
  // Reel extras (watch time) → shared per-post map the Reels section reads.
  if (Object.keys(reels).length) {
    const all = (await kvGet(uid, "serigama.reels")) || {};
    await kvSet(uid, "serigama.reels", { ...all, ...reels });
  }
  result.reelsWithExtras = Object.keys(reels).length;

  // 4) Account views + follows/unfollows for this month and last (Malaysia time),
  //    counted up to the end of yesterday so a month's figure is whole days.
  const now = mytNow();
  const y = now.getUTCFullYear(), mo = now.getUTCMonth(), d = now.getUTCDate();
  const yesterdayEnd = mytMidnight(y, mo, d);
  const monthly = (await kvGet(uid, `serigama.monthly@${accountId}`)) || { months: {} };
  const mfollow = (await kvGet(uid, `serigama.monthlyfollowers@${accountId}`)) || {};
  const flows: Record<string, unknown> = {};
  for (const back of [1, 0]) {
    const start = new Date(Date.UTC(y, mo - back, 1));
    const key = ymKey(start);
    if (back === 1 && monthly.months?.[key]?.complete) continue;
    const since = mytMidnight(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const monthEnd = mytMidnight(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    const until = Math.min(monthEnd, yesterdayEnd);
    if (until <= since) continue;
    try {
      const { sum } = await totalBetween(igId, token, "views", since, until);
      const days = Math.round((until - since) / 86400);
      monthly.months = monthly.months || {};
      monthly.months[key] = { label: MONTHS[start.getUTCMonth()], views: sum, days, complete: until === monthEnd };
    } catch (e) { result.viewsError = String(e); }
    const f = await followFlow(igId, token, since, until);
    if (f) { mfollow[key] = f.follows - f.unfollows; flows[key] = f; }
    // Account-wide "from where": views split by followers / non-followers and by
    // format (Reels / Feed / Stories). Kept only if the API supports the breakdown.
    for (const [field, breakdown] of [["viewsByFollowType", "follow_type"], ["viewsByFormat", "media_product_type"]]) {
      try {
        const { parts } = await totalBetween(igId, token, "views", since, until, breakdown);
        if (Object.keys(parts).length && monthly.months?.[key]) monthly.months[key][field] = parts;
      } catch (e) { result[field + "Error"] = String(e).slice(0, 160); }
    }
  }
  result.flows = flows;
  monthly.updated = today;
  await kvSet(uid, `serigama.monthly@${accountId}`, monthly);
  if (Object.keys(mfollow).length) await kvSet(uid, `serigama.monthlyfollowers@${accountId}`, mfollow);

  // 5) Audience: followers, 7/28-day follow flow, gender / age / country.
  const aud: Record<string, unknown> = { capturedAt: today, totalFollowers: prof.followers_count ?? null, source: "instagram-api" };
  const f7 = await followFlow(igId, token, yesterdayEnd - 7 * 86400, yesterdayEnd);
  const f28 = await followFlow(igId, token, yesterdayEnd - 28 * 86400, yesterdayEnd);
  if (f7) { aud.net7d = f7.follows - f7.unfollows; aud.follows7d = f7.follows; aud.unfollows7d = f7.unfollows; aud.net7dChangePct = null; }
  if (f28) { aud.net28d = f28.follows - f28.unfollows; aud.follows28d = f28.follows; aud.unfollows28d = f28.unfollows; aud.net28dChangePct = null; }
  try {
    const g = await demographics(igId, token, "gender");
    const name: Record<string, string> = { F: "Female", M: "Male", U: "Other" };
    aud.gender = ["F", "M", "U"].map((k) => ({ label: name[k], pct: (g.find((x: any) => x.key === k) || { pct: 0 }).pct }));
    aud.age = (await demographics(igId, token, "age")).map((x: any) => ({ label: x.key.replace("-", "–"), pct: x.pct }));
    const c = await demographics(igId, token, "country");
    const top = c.slice(0, 5).map((x: any) => ({ name: COUNTRY[x.key] || x.key, pct: x.pct, ...(x.pct < 1 ? { lt1: true } : {}) }));
    const rest = Math.round((100 - top.reduce((n: number, x: any) => n + x.pct, 0)) * 10) / 10;
    aud.locations = rest > 0.05 ? [...top, { name: "Others", pct: rest }] : top;
  } catch (e) { result.audienceError = String(e); } // needs 100+ followers

  // 6) Who SAW the account's content (not just followers): age / gender / country / city
  //    for a period. Instagram has no per-post demographics, so when one post carries most
  //    of a period's views, this is effectively that post's audience.
  const viewers: Record<string, unknown> = {};
  for (const tf of ["this_week", "this_month"]) {
    try {
      const pick = (rows: any[], n: number) => rows.slice(0, n).map((x: any) => ({ name: x.key, pct: x.pct }));
      const g = await demographics(igId, token, "gender", "reached_audience_demographics", tf);
      const a = await demographics(igId, token, "age", "reached_audience_demographics", tf);
      const c = await demographics(igId, token, "country", "reached_audience_demographics", tf);
      let ci: any[] = [];
      try { ci = await demographics(igId, token, "city", "reached_audience_demographics", tf); } catch (_) { /* optional */ }
      if (!g.length && !a.length && !c.length) continue;
      const gname: Record<string, string> = { F: "Female", M: "Male", U: "Other" };
      viewers[tf] = {
        gender: ["F", "M", "U"].map((k) => ({ label: gname[k], pct: (g.find((x: any) => x.key === k) || { pct: 0 }).pct })),
        age: a.map((x: any) => ({ label: x.key.replace("-", "–"), pct: x.pct })),
        countries: pick(c, 6).map((x: any) => ({ ...x, name: COUNTRY[x.name] || x.name })),
        cities: pick(ci, 6),
      };
    } catch (e) { result[`viewers_${tf}Error`] = String(e).slice(0, 160); }
  }
  if (Object.keys(viewers).length) aud.viewers = { ...viewers, capturedAt: today };
  result.viewerTimeframes = Object.keys(viewers);
  await kvSet(uid, `serigama.audience@${accountId}`, aud);

  await sb.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let targetUser: string | null = null;
    let probe = false;
    try { const b = await req.json(); targetUser = b?.user_id ?? null; probe = !!b?.probe; } catch (_) { /* no body */ }

    let q = sb.from("integrations").select("*").eq("platform", "instagram");
    if (targetUser) q = q.eq("user_id", targetUser);
    const { data: rows, error } = await q;
    if (error) throw error;

    // { probe: true } → read-only: which per-reel insight queries does the API accept?
    if (probe) {
      const out: Record<string, unknown> = {};
      for (const row of rows ?? []) {
        const list = await graph(`${row.open_id}/media?fields=id,media_product_type,timestamp&limit=25`, row.access_token);
        const reel = (list.data || []).find((m: any) => m.media_product_type === "REELS");
        if (!reel) { out[row.display_name] = "no reel found"; continue; }
        const tries = [
          "views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
          "follows", "profile_visits", "profile_activity", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time",
          "views&breakdown=follow_type", "reach&breakdown=follow_type", "views&breakdown=source",
          "views&breakdown=surface_type", "views&breakdown=media_surface", "profile_activity&breakdown=action_type",
        ];
        const res: Record<string, unknown> = { reel: reel.id, posted: reel.timestamp };
        for (const t of tries) {
          try {
            const j = await graph(`${reel.id}/insights?metric=${t}`, row.access_token);
            const d = j.data?.[0];
            res[t] = d?.total_value?.breakdowns ? d.total_value.breakdowns : (d?.values?.[0]?.value ?? d?.total_value?.value ?? d);
          } catch (e) { res[t] = "ERR " + String(e).slice(0, 140); }
        }
        out[row.display_name] = res;
      }
      return new Response(JSON.stringify({ ok: true, probe: out }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];
    for (const row of rows ?? []) {
      try {
        const r = await syncOne(row);
        results.push({ user_id: row.user_id, account: row.display_name, pulled: r.posts, ...r });
      } catch (e) { results.push({ user_id: row.user_id, account: row.display_name, error: String(e) }); }
    }
    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
