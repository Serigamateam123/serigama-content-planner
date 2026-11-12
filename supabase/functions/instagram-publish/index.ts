// Supabase Edge Function: instagram-publish
// Posts planner items to Instagram at their scheduled time (Instagram Content
// Publishing API, through the same connection instagram-sync uses). Runs every
// 5 minutes (supabase/cron_publish.sql); it only acts on jobs the planner queued in
// `publish_jobs` (supabase/publish.sql), so calling it can't post anything else.
//
// Per job:  queued & due → upload container (video/photo fetched by Instagram from a
//           signed Storage link) → wait until Instagram has processed it → publish →
//           the planner item becomes the posted reel (status, link, external_id, so
//           the daily sync updates this same item) → the uploaded file is deleted.
// Trial reels use trial_params.graduation_strategy (MANUAL or SS_PERFORMANCE).
// "Also post to Story" (also_story): once the post is live, the same file goes up as a
// Story (media_type STORIES — its own post; stories videos max 60 s). A Story problem
// never undoes the post; it's noted in story_error. The file is deleted after both.
//
// Needs the Instagram connection to include instagram_content_publish (add it to the
// Facebook Login for Business configuration, then Reconnect Instagram).
// verify_jwt must be OFF (pg_cron calls it with the publishable key).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v25.0";
const BUCKET = "publish-media";
const LOCK_MS = 4 * 60 * 1000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function graph(method: "GET" | "POST", path: string, token: string, params: Record<string, string> = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}${body}`)
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.error_user_msg || json.error.message || JSON.stringify(json.error));
  return json;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

async function update(id: string, patch: Record<string, unknown>) {
  await sb.from("publish_jobs").update({ ...patch, updated_at: now() }).eq("id", id);
}

// Take a job for this run only (two overlapping runs must never post twice).
async function claim(id: string) {
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  const { data } = await sb.from("publish_jobs").update({ lock_until: until })
    .eq("id", id).or(`lock_until.is.null,lock_until.lt.${now()}`).select("id");
  return !!(data && data.length);
}

async function signed(path: string) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 24 * 3600);
  if (error || !data?.signedUrl) throw new Error("Couldn't read the uploaded file: " + (error?.message || "missing"));
  return data.signedUrl;
}

async function tokenFor(job: any) {
  const { data } = await sb.from("integrations").select("open_id,access_token,display_name")
    .eq("user_id", job.user_id).eq("platform", "instagram").eq("account_id", job.account_id).maybeSingle();
  if (!data) throw new Error("This Instagram account isn't connected — reconnect it in Post Performance.");
  return data;
}

async function createContainer(job: any, ig: any) {
  const p: Record<string, string> = { caption: job.caption || "" };
  if (job.kind === "image") {
    p.image_url = await signed(job.media_path);
  } else {
    p.media_type = "REELS";
    p.video_url = await signed(job.media_path);
    p.share_to_feed = job.trial ? "false" : String(job.share_to_feed !== false);
    if (job.cover_path) p.cover_url = await signed(job.cover_path);
    if (job.trial) p.trial_params = JSON.stringify({ graduation_strategy: job.trial });
  }
  const j = await graph("POST", `${ig.open_id}/media`, ig.access_token, p);
  return String(j.id);
}

// The post a PUBLISHED container became: the newest post since the scheduled time
// with the same caption (or simply the newest one since then).
async function findPosted(job: any, ig: any) {
  const j = await graph("GET", `${ig.open_id}/media?fields=id,caption,timestamp&limit=10`, ig.access_token);
  const since = new Date(job.scheduled_at).getTime() - 10 * 60e3;
  const recent = (j.data || []).filter((m: any) => new Date(m.timestamp).getTime() >= since);
  const same = recent.find((m: any) => (m.caption || "") === (job.caption || ""));
  return String((same || recent[0] || {}).id || "");
}

// Container → published post. Returns true when done (published or failed).
async function finish(job: any, ig: any, waitMs: number) {
  const deadline = Date.now() + waitMs;
  let already = false;
  for (;;) {
    const s = await graph("GET", `${job.container_id}?fields=status_code,status`, ig.access_token);
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      await update(job.id, { status: "failed", error: `Instagram couldn't process the file (${s.status || s.status_code}). Check it's an MP4/MOV reel (3 s – 15 min) or a JPG photo.`, lock_until: null });
      return true;
    }
    if (s.status_code === "PUBLISHED") { already = true; break; }
    if (Date.now() > deadline) return false; // still processing — next run continues
    await sleep(5000);
  }
  let mediaId = "";
  if (already) {
    mediaId = await findPosted(job, ig);
    if (!mediaId) throw new Error("Posted on Instagram, but couldn't find the post yet; will check again.");
  } else {
    const pub = await graph("POST", `${ig.open_id}/media_publish`, ig.access_token, { creation_id: job.container_id });
    mediaId = String(pub.id);
  }
  let permalink = "", ts = now();
  try {
    const m = await graph("GET", `${mediaId}?fields=permalink,timestamp`, ig.access_token);
    permalink = m.permalink || ""; ts = m.timestamp ? new Date(m.timestamp).toISOString() : ts;
  } catch (_) { /* filled in by the next daily sync */ }

  // If a sync already brought this post in as a separate item, drop that copy so the
  // planner item (with its plan, label and notes) becomes the post.
  const posted = {
    status: "published", published_at: ts, scheduled_at: ts, post_url: permalink,
    external_id: mediaId, platform: "instagram", has_final_caption: true,
    format: job.kind === "image" ? "feed" : "reel",
  };
  let saveErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await sb.from("contents").delete().eq("user_id", job.user_id).eq("platform", "instagram")
      .eq("external_id", mediaId).neq("id", job.content_id);
    const { error } = await sb.from("contents").update(posted).eq("id", job.content_id);
    saveErr = error;
    if (!error) break;
  }
  if (saveErr) console.error("instagram-publish: couldn't update planner item", job.content_id, saveErr);
  // A trial reel never goes to Story: that would show it to followers.
  if (job.also_story && !job.trial) {
    await update(job.id, { status: "published", media_id: mediaId, permalink, error: null, story_status: "queued" });
    job.status = "published"; job.story_status = "queued";
    await runStory(job, ig); // same run if there's time; otherwise the next run finishes it
  } else {
    await update(job.id, { status: "published", media_id: mediaId, permalink, error: null, lock_until: null });
    await sb.storage.from(BUCKET).remove([job.media_path, job.cover_path].filter(Boolean));
  }
  return true;
}

// The Story copy of a published post. Returns when done or out of time.
async function runStory(job: any, ig: any) {
  const done = async (patch: Record<string, unknown>) => {
    await update(job.id, { ...patch, lock_until: null });
    await sb.storage.from(BUCKET).remove([job.media_path, job.cover_path].filter(Boolean));
  };
  try {
    if (job.story_status === "queued") {
      const p: Record<string, string> = { media_type: "STORIES" };
      if (job.kind === "image") p.image_url = await signed(job.media_path);
      else p.video_url = await signed(job.media_path);
      const c = await graph("POST", `${ig.open_id}/media`, ig.access_token, p);
      job.story_container_id = String(c.id); job.story_status = "processing";
      await update(job.id, { story_status: "processing", story_container_id: job.story_container_id, story_error: null });
    }
    const deadline = Date.now() + 40000;
    for (;;) {
      const s = await graph("GET", `${job.story_container_id}?fields=status_code,status`, ig.access_token);
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
        await done({ story_status: "failed", story_error: `Instagram couldn't make the Story (${s.status || s.status_code}). Story videos must be 60 s or shorter.` });
        return;
      }
      if (Date.now() > deadline) { await update(job.id, { lock_until: null }); return; }
      await sleep(5000);
    }
    const pub = await graph("POST", `${ig.open_id}/media_publish`, ig.access_token, { creation_id: job.story_container_id });
    await done({ story_status: "published", story_media_id: String(pub.id), story_error: null });
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 300);
    if (job.story_status === "processing" && Date.now() - new Date(job.scheduled_at).getTime() < 23 * 3600e3) {
      await update(job.id, { story_error: msg, lock_until: null }); // try again next run
    } else {
      await done({ story_status: "failed", story_error: msg });
    }
  }
}

async function runJob(job: any) {
  if (!(await claim(job.id))) return { id: job.id, skipped: "busy" };
  if (job.status === "published") { // only its Story is left
    try { await runStory(job, await tokenFor(job)); } catch (e) { await update(job.id, { story_status: "failed", story_error: String(e).slice(0, 300), lock_until: null }); }
    return { id: job.id, story: true };
  }
  try {
    if (job.status === "queued") {
      const { data: item } = await sb.from("contents").select("scheduled_at").eq("id", job.content_id).maybeSingle();
      if (!item) { await update(job.id, { status: "cancelled", error: "The planner item was deleted.", lock_until: null }); return { id: job.id, cancelled: true }; }
      if (!item.scheduled_at) { await update(job.id, { status: "cancelled", error: "The planner item was unscheduled.", lock_until: null }); return { id: job.id, cancelled: true }; }
      const moved = Math.abs(new Date(item.scheduled_at).getTime() - new Date(job.scheduled_at).getTime()) > 60e3;
      if (moved) {
        await update(job.id, { scheduled_at: item.scheduled_at, lock_until: null });
        if (new Date(item.scheduled_at).getTime() > Date.now()) return { id: job.id, moved: item.scheduled_at };
      }
    }
    const ig = await tokenFor(job);
    if (job.status === "queued") {
      const containerId = await createContainer(job, ig);
      job.container_id = containerId;
      job.status = "processing";
      await update(job.id, { status: "processing", container_id: containerId, attempts: (job.attempts || 0) + 1, error: null });
    } else if (Date.now() - new Date(job.scheduled_at).getTime() > 23 * 3600e3) {
      await update(job.id, { status: "failed", error: "Instagram didn't finish processing the file within a day.", lock_until: null });
      return { id: job.id, failed: true };
    }
    const done = await finish(job, ig, 40000);
    if (!done) await update(job.id, { lock_until: null });
    return { id: job.id, done };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 400);
    const attempts = (job.attempts || 0) + (job.status === "queued" ? 1 : 0);
    // A failed upload is retried on the next run (up to 3 tries); then it's marked failed.
    // While processing, a hiccup just waits for the next run (the one-day limit above
    // stops it eventually).
    if (job.status === "processing") await update(job.id, { error: msg, lock_until: null });
    else if (attempts < 3) await update(job.id, { attempts, error: msg, lock_until: null });
    else await update(job.id, { status: "failed", attempts, error: msg, lock_until: null });
    return { id: job.id, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // { probe: true } → read-only check that posting is allowed (posts nothing).
    let probe = false;
    try { probe = !!(await req.json())?.probe; } catch (_) { /* no body */ }
    if (probe) {
      const { data: rows } = await sb.from("integrations").select("open_id,access_token,display_name").eq("platform", "instagram");
      const out: Record<string, unknown> = {};
      for (const r of rows || []) {
        try { out[r.display_name] = await graph("GET", `${r.open_id}/content_publishing_limit?fields=quota_usage,config`, r.access_token); }
        catch (e) { out[r.display_name] = "ERR " + String((e as Error).message || e).slice(0, 200); }
      }
      return new Response(JSON.stringify({ ok: true, probe: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: jobs, error } = await sb.from("publish_jobs").select("*")
      .in("status", ["queued", "processing"]).lte("scheduled_at", now())
      .order("scheduled_at").limit(10);
    if (error) throw error;
    const { data: stories } = await sb.from("publish_jobs").select("*")
      .eq("status", "published").in("story_status", ["queued", "processing"]).limit(10);
    const results = [];
    const started = Date.now();
    for (const job of [...(jobs || []), ...(stories || [])]) {
      if (Date.now() - started > 60000) { results.push({ id: job.id, later: true }); continue; } // next run (5 min)
      results.push(await runJob(job));
    }
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
