// Supabase Edge Function: team-invite  (JWT verification ON — called from the planner)
// The data owner adds or removes a team member. Adding creates the member's login
// with a starting password (email already confirmed, so no email has to be sent —
// Supabase's built-in mailer only reaches pre-approved addresses). The member signs
// in with it and can change it with "Set password". An email that already has a
// login keeps its existing password. Access rules live in supabase/team.sql.
//
// Body: { action: "invite", email, role: "full" | "calendar", password }
//       { action: "remove", email }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user?.email) return json({ ok: false, error: "Please sign in again." }, 401);
    const me = user.email.toLowerCase();

    // Only a data owner may manage a team — never a member of someone else's team.
    const { data: asMember } = await admin.from("team_members").select("owner_id").eq("email", me).limit(1);
    if (asMember?.length) return json({ ok: false, error: "Only the planner owner can manage the team." }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "That doesn't look like an email address." }, 400);
    if (email === me) return json({ ok: false, error: "That's your own login." }, 400);

    if (body.action === "remove") {
      const { error } = await admin.from("team_members").delete().eq("owner_id", user.id).eq("email", email);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action !== "invite") return json({ ok: false, error: "Unknown action." }, 400);
    const role = body.role === "full" ? "full" : body.role === "calendar" ? "calendar" : null;
    if (!role) return json({ ok: false, error: "Pick a role." }, 400);
    const password = String(body.password || "");
    if (password.length < 8) return json({ ok: false, error: "Starting password needs at least 8 characters." }, 400);

    // Create the login; an existing login keeps its own password.
    let created = false;
    const { error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (ce) {
      const exists = /already|registered|exists/i.test(ce.message || "") || (ce as any).code === "email_exists";
      if (!exists) throw ce;
    } else created = true;

    const { error: ue } = await admin.from("team_members")
      .upsert({ owner_id: user.id, email, role }, { onConflict: "owner_id,email" });
    if (ue) throw ue;
    return json({ ok: true, created });
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
});
