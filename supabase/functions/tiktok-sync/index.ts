// Supabase Edge Function: tiktok-sync
// Pulls ALL of a connected account's videos + their public metrics and writes
// them into `contents` (one row per video) and `content_metrics`. Safe to run
// repeatedly — videos are matched by external_id so rows update, not duplicate.
//
// Run on a schedule (Supabase → Database → Cron) or on demand. If the request
// body has { user_id }, only that connection syncs; otherwise all do.
//
// Secrets: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (for token refresh).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const VIDEO_FIELDS = "id,title,view_count,like_count,comment_count,share_count,create_time,share_url";
const VIDEO_LIST_URL = `https://open.tiktokapis.com/v2/video/list/?fields=${VIDEO_FIELDS}`;
const USER_FIELDS = "open_id,follower_count,following_count,likes_count,video_count";
const USER_INFO_URL = `https://open.tiktokapis.com/v2/user/info/?fields=${USER_FIELDS}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function refreshIfNeeded(row: any) {
  if (row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60_000)) {
    return row.access_token; // still valid
  }
  const body = new URLSearchParams({
    client_key: Deno.env.get("TIKTOK_CLIENT_KEY")!,
    client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET")!,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const t = await res.json();
  if (!t.access_token) throw new Error("refresh failed: " + JSON.stringify(t));
  await sb.from("integrations").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? row.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in ?? 86400) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  return t.access_token;
}

// Snapshot today's follower/like totals (upsert keeps one row per day).
async function snapshotStats(row: any, token: string) {
  try {
    const res = await fetch(USER_INFO_URL, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    const u = json?.data?.user;
    if (!u) return null;
    const { data: acct } = await sb
      .from("accounts")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("platform", "tiktok")
      .limit(1)
      .maybeSingle();
    await sb.from("account_stats").upsert({
      user_id: row.user_id,
      account_id: acct?.id ?? null,
      platform: "tiktok",
      follower_count: u.follower_count ?? null,
      following_count: u.following_count ?? null,
      likes_count: u.likes_count ?? null,
      video_count: u.video_count ?? null,
      captured_at: new Date().toISOString(),
      day: new Date().toISOString().slice(0, 10),
    }, { onConflict: "user_id,platform,day" });
    return u.follower_count ?? null;
  } catch (_) {
    return null; // never let a stats hiccup break the video sync
  }
}

async function syncOne(row: any) {
  const token = await refreshIfNeeded(row);
  const followers = await snapshotStats(row, token);
  let cursor: number | undefined;
  let pulled = 0;

  do {
    const res = await fetch(VIDEO_LIST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    });
    const json = await res.json();
    const videos = json?.data?.videos ?? [];
    for (const v of videos) {
      const likes = v.like_count ?? 0, comments = v.comment_count ?? 0, shares = v.share_count ?? 0;
      const views = v.view_count ?? 0;
      const engagement = likes + comments + shares;
      const er = views ? Math.round((engagement / views) * 1000) / 10 : 0;
      const publishedAt = v.create_time ? new Date(v.create_time * 1000).toISOString() : null;

      // Upsert the content row (matched by external_id).
      const { data: content } = await sb.from("contents").upsert({
        user_id: row.user_id,
        platform: "tiktok",
        external_id: String(v.id),
        title: v.title || "(untitled TikTok video)",
        status: "published",
        published_at: publishedAt,
        scheduled_at: publishedAt,
        post_url: v.share_url || "",
        has_final_caption: true,
      }, { onConflict: "user_id,platform,external_id" }).select("id").single();

      if (content) {
        await sb.from("content_metrics").insert({
          content_id: content.id,
          user_id: row.user_id,
          views, likes, comments, shares,
          engagement, engagement_rate: er,
          source: "tiktok",
          fetched_at: new Date().toISOString(),
        });
      }
      pulled++;
    }
    cursor = json?.data?.has_more ? json.data.cursor : undefined;
  } while (cursor);

  await sb.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", row.id);
  return { pulled, followers };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let targetUser: string | null = null;
    try { targetUser = (await req.json())?.user_id ?? null; } catch (_) { /* no body */ }

    let q = sb.from("integrations").select("*").eq("platform", "tiktok");
    if (targetUser) q = q.eq("user_id", targetUser);
    const { data: rows, error } = await q;
    if (error) throw error;

    const results = [];
    for (const row of rows ?? []) {
      try {
        const { pulled, followers } = await syncOne(row);
        results.push({ user_id: row.user_id, pulled, followers });
      } catch (e) { results.push({ user_id: row.user_id, error: String(e) }); }
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
