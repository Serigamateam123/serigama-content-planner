// Supabase Edge Function: threads-callback  (verify_jwt OFF — Threads calls it)
// Threads sign-in redirects here after the user approves the planner (read-only:
// threads_basic + threads_manage_insights). We swap the one-time `code` for a
// long-lived token (~60 days; threads-sync renews it), read the profile, and store
// one connection per Threads account in `integrations` + `accounts`.
//
// Also answers Meta's "uninstall" and "delete data" pings (?event=uninstall|delete),
// which Meta requires for the Threads use case.
//
// Secrets (Supabase → Edge Functions → Secrets): THREADS_APP_SECRET, APP_URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const THREADS_APP_ID = "1447493470865177"; // public — Meta app "Serigama Content Planner", Threads use case
const REDIRECT_URI = "https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/threads-callback";
const GRAPH = "https://graph.threads.net";

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const appUrl = Deno.env.get("APP_URL") || "";
  const event = url.searchParams.get("event");

  // Meta's deauthorize / data-deletion pings (POST with a signed_request).
  if (event === "uninstall") return new Response("ok");
  if (event === "delete") {
    const code = crypto.randomUUID();
    return new Response(JSON.stringify({ url: `${appUrl}#/analytics`, confirmation_code: code }),
      { headers: { "Content-Type": "application/json" } });
  }

  // Threads appends "#_" to the code in some clients.
  const code = (url.searchParams.get("code") || "").replace(/#_$/, "");
  const state = url.searchParams.get("state"); // = planner user id
  if (!code || !state) return Response.redirect(`${appUrl}#/analytics?threads=error`, 302);

  try {
    const secret = Deno.env.get("THREADS_APP_SECRET");
    if (!secret) throw new Error("THREADS_APP_SECRET is not set in Supabase → Edge Functions → Secrets");

    // 1) Code → short-lived token (1h) → long-lived token (60 days).
    const short = await getJson(await fetch(`${GRAPH}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID, client_secret: secret, grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI, code,
      }),
    }));
    const long = await getJson(await fetch(`${GRAPH}/access_token?grant_type=th_exchange_token` +
      `&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(short.access_token)}`));

    // 2) Who is this?
    const me = await getJson(await fetch(`${GRAPH}/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(long.access_token)}`));

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: existing } = await sb.from("integrations").select("account_id")
      .eq("user_id", state).eq("platform", "threads").eq("open_id", String(me.id)).maybeSingle();
    let accountId = existing?.account_id ?? null;
    if (!accountId) {
      const { data: acct, error: accErr } = await sb.from("accounts").insert({
        user_id: state, platform: "threads", handle: me.username, display_name: `${me.username} (Threads)`,
      }).select("id").single();
      if (accErr) throw accErr;
      accountId = acct.id;
    }
    const { error: intErr } = await sb.from("integrations").upsert({
      user_id: state,
      platform: "threads",
      open_id: String(me.id),
      account_id: accountId,
      display_name: me.username,
      access_token: long.access_token,
      refresh_token: null,
      expires_at: new Date(Date.now() + (Number(long.expires_in) || 5184000) * 1000).toISOString(),
      scope: "threads_basic,threads_manage_insights",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,platform,open_id" });
    if (intErr) throw intErr;

    return Response.redirect(`${appUrl}#/analytics?threads=connected`, 302);
  } catch (e) {
    console.error(e);
    // A short reason (no tokens) so a failed connect can be diagnosed from the address bar.
    const reason = encodeURIComponent(String((e as any)?.message || e).replace(/[A-Za-z0-9_-]{40,}/g, "…").slice(0, 160));
    return Response.redirect(`${appUrl}#/analytics?threads=error&reason=${reason}`, 302);
  }
});
