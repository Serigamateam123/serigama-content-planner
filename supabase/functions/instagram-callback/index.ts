// Supabase Edge Function: instagram-callback
// Facebook Login for Business redirects here after the user approves. We swap the
// one-time `code` for a long-lived user token, find every Instagram professional
// account linked to the Pages the user manages, and store one connection per
// Instagram account (with that Page's token, which doesn't expire) in `integrations`.
//
// Secrets required (Supabase → Edge Functions → Secrets):
//   META_APP_SECRET, APP_URL (already set for TikTok)
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// verify_jwt must be OFF for this function — Facebook calls it without a JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v25.0";
const META_APP_ID = "1784689132823597"; // public, same as config.js
const REDIRECT_URI = "https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/instagram-callback";

async function getJson(url: string) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // = app user id
  const appUrl = Deno.env.get("APP_URL") || "";

  if (!code || !state) {
    return Response.redirect(`${appUrl}#/analytics?instagram=error`, 302);
  }

  try {
    // Saved in Supabase as META_APP_SECRET (or Meta_App_Secret — names are case-sensitive).
    const secret = Deno.env.get("META_APP_SECRET") ?? Deno.env.get("Meta_App_Secret");
    if (!secret) throw new Error("META_APP_SECRET is not set in Supabase → Edge Functions → Secrets");

    // 1) Code → short-lived user token → long-lived user token (~60 days).
    const short = await getJson(`${GRAPH}/oauth/access_token?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${secret}&code=${encodeURIComponent(code)}`);
    const long = await getJson(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${META_APP_ID}&client_secret=${secret}&fb_exchange_token=${short.access_token}`);

    // 2) Pages the user manages, with their linked Instagram account. A Page token
    //    obtained with a long-lived user token does not expire.
    const pages = await getJson(`${GRAPH}/me/accounts?limit=100` +
      `&fields=name,access_token,instagram_business_account{id,username,name}&access_token=${long.access_token}`);
    const linked = (pages.data || []).filter((p: any) => p.instagram_business_account);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    for (const p of linked) {
      const ig = p.instagram_business_account;
      const { data: existing } = await sb
        .from("integrations")
        .select("account_id")
        .eq("user_id", state)
        .eq("platform", "instagram")
        .eq("open_id", ig.id)
        .maybeSingle();
      let accountId = existing?.account_id ?? null;
      if (!accountId) {
        const { data: acct, error: accErr } = await sb.from("accounts").insert({
          user_id: state,
          platform: "instagram",
          handle: ig.username,
          display_name: `${ig.username} (Instagram)`,
        }).select("id").single();
        if (accErr) throw accErr;
        accountId = acct.id;
      }
      const { error: intErr } = await sb.from("integrations").upsert({
        user_id: state,
        platform: "instagram",
        open_id: ig.id,
        account_id: accountId,
        display_name: ig.username,
        access_token: p.access_token,
        refresh_token: null,
        expires_at: null, // Page tokens from a long-lived user token don't expire
        scope: "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,platform,open_id" });
      if (intErr) throw intErr;
    }

    const status = linked.length ? "connected" : "none";
    return Response.redirect(`${appUrl}#/analytics?instagram=${status}`, 302);
  } catch (e) {
    console.error(e);
    return Response.redirect(`${appUrl}#/analytics?instagram=error`, 302);
  }
});
