// Supabase Edge Function: tiktok-callback
// TikTok redirects here after the user approves. We exchange the one-time
// `code` for access + refresh tokens and store them in `integrations`.
//
// Secrets required (set in Supabase → Edge Functions → Secrets):
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI, APP_URL
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USERINFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // = app user id
  const appUrl = Deno.env.get("APP_URL") || "";

  if (!code || !state) {
    return Response.redirect(`${appUrl}#/analytics?tiktok=error`, 302);
  }

  try {
    // 1) Exchange the code for tokens.
    const body = new URLSearchParams({
      client_key: Deno.env.get("TIKTOK_CLIENT_KEY")!,
      client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET")!,
      code,
      grant_type: "authorization_code",
      redirect_uri: Deno.env.get("TIKTOK_REDIRECT_URI")!,
    });
    const tokRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tok = await tokRes.json();
    if (!tok.access_token) throw new Error("token exchange failed: " + JSON.stringify(tok));

    // 2) Fetch the display name (nice to show in the UI).
    let displayName = null;
    try {
      const uRes = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const u = await uRes.json();
      displayName = u?.data?.user?.display_name ?? null;
    } catch (_) { /* non-fatal */ }

    // 3) Store the connection (service role bypasses RLS).
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await sb.from("integrations").upsert({
      user_id: state,
      platform: "tiktok",
      open_id: tok.open_id,
      display_name: displayName,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + (tok.expires_in ?? 86400) * 1000).toISOString(),
      scope: tok.scope,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,platform" });

    // 4) Send the user back to the app.
    return Response.redirect(`${appUrl}#/analytics?tiktok=connected`, 302);
  } catch (e) {
    console.error(e);
    return Response.redirect(`${appUrl}#/analytics?tiktok=error`, 302);
  }
});
