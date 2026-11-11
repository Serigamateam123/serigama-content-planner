// Team page (owner only): invite people by email with a role, change roles, remove.
// Data rules: supabase/team.sql. Logins are created by the Edge Function team-invite
// with a starting password the owner chooses (no email is sent).
import { html } from '../lib/html.js';
import { useState, useEffect } from 'preact/hooks';

const ROLES = [
  { id: 'calendar', label: 'Calendar only', desc: 'Content Calendar for all accounts — add ideas, edit details, drag to other dates. No reports or stats.' },
  { id: 'full', label: 'Full access', desc: 'Everything you see (calendar, dashboard, reports, targets), except connecting TikTok / Instagram accounts and this Team page.' },
];
const roleLabel = (id) => (ROLES.find((r) => r.id === id) || {}).label || id;

export function Team({ store, ownerEmail }) {
  const [members, setMembers] = useState(null);
  const [form, setForm] = useState({ email: '', role: 'calendar', password: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [showPw, setShowPw] = useState(false);

  const load = async () => {
    try { setMembers(await store.listTeam()); }
    catch (e) { setMembers([]); setMsg({ ok: false, text: 'Could not load the team: ' + (e.message || e) }); }
  };
  useEffect(() => { load(); }, []);

  const invite = async (e) => {
    e && e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const email = form.email.trim().toLowerCase();
      const res = await store.teamInvite({ action: 'invite', email, role: form.role, password: form.password });
      setMsg({ ok: true, text: res && res.created
        ? `Added ${email} (${roleLabel(form.role)}). Send them the link, their email and the starting password privately.`
        : `Added ${email} (${roleLabel(form.role)}). They already had a login, so they sign in with their existing password.` });
      setForm({ email: '', role: form.role, password: '' });
      await load();
    } catch (err) { setMsg({ ok: false, text: err.message || String(err) }); }
    setBusy(false);
  };
  const changeRole = async (email, role) => {
    setMsg(null);
    try { await store.setTeamRole(email, role); setMsg({ ok: true, text: `${email} is now ${roleLabel(role)}.` }); await load(); }
    catch (err) { setMsg({ ok: false, text: err.message || String(err) }); }
  };
  const remove = async (email) => {
    if (!confirm(`Remove ${email} from the team? They lose access straight away.`)) return;
    setMsg(null);
    try { await store.teamInvite({ action: 'remove', email }); setMsg({ ok: true, text: `${email} no longer has access.` }); await load(); }
    catch (err) { setMsg({ ok: false, text: err.message || String(err) }); }
  };

  const link = location.origin.includes('localhost') ? 'https://serigama-content-planner.vercel.app' : location.origin;

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Settings</div>
        <h1 class="page-title">Team</h1>
      </div>
    </div>

    <div class="card card-pad section-gap">
      <div class="card-title">Add a team member</div>
      <p class="muted" style=${{ fontSize: '13px', margin: '4px 0 14px' }}>
        They sign in at <strong>${link}</strong> with their own email and the starting password you set here, and can change it with
        “Set password” afterwards. Only you (${ownerEmail || 'the owner'}) can see this page.
      </p>
      <form onSubmit=${invite}>
        <div class="field-row">
          <div class="field">
            <label>Email</label>
            <input type="email" required value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
          </div>
          <div class="field">
            <label>Starting password</label>
            <div style=${{ display: 'flex', gap: '6px' }}>
              <input type=${showPw ? 'text' : 'password'} required minLength="8" autocomplete="new-password" value=${form.password}
                onInput=${(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" style=${{ flex: 1, minWidth: 0 }} />
              <button type="button" class="btn btn-sm" onClick=${() => setShowPw(!showPw)}>${showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Access</label>
          <div style=${{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            ${ROLES.map((r) => html`<label class="card" style=${{ padding: '10px 12px', cursor: 'pointer', boxShadow: 'none', border: '1.5px solid ' + (form.role === r.id ? 'var(--accent, #4f46e5)' : 'var(--border-2, #e5e7eb)') }}>
              <div style=${{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600 }}>
                <input type="radio" name="role" checked=${form.role === r.id} onChange=${() => setForm({ ...form, role: r.id })} /> ${r.label}
              </div>
              <div class="muted" style=${{ fontSize: '12px', marginTop: '4px' }}>${r.desc}</div>
            </label>`)}
          </div>
        </div>
        <button class="btn btn-gold" type="submit" disabled=${busy}>${busy ? 'Adding…' : 'Add to team'}</button>
      </form>
      ${msg ? html`<div class=${'toast ' + (msg.ok ? 'toast-ok' : 'toast-err')} style=${{ marginTop: '12px' }}>${msg.text}</div>` : ''}
    </div>

    <div class="card card-pad section-gap">
      <div class="card-title">Team members ${members ? html`<span class="muted" style=${{ fontWeight: 400 }}>(${members.length})</span>` : ''}</div>
      ${members == null ? html`<p class="muted">Loading…</p>`
        : !members.length ? html`<p class="muted" style=${{ fontSize: '13px' }}>Nobody yet — add someone above.</p>`
        : html`<div style=${{ overflowX: 'auto' }}><table class="atable">
            <thead><tr><th>Email</th><th>Access</th><th>Added</th><th></th></tr></thead>
            <tbody>${members.map((m) => html`<tr>
              <td style=${{ fontWeight: 600 }}>${m.email}</td>
              <td><select class="hdr-select" value=${m.role} onChange=${(e) => changeRole(m.email, e.target.value)} aria-label=${'Access for ' + m.email}>
                ${ROLES.map((r) => html`<option value=${r.id}>${r.label}</option>`)}
              </select></td>
              <td class="muted">${new Date(m.invited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td><button class="btn btn-danger btn-sm" onClick=${() => remove(m.email)}>Remove</button></td>
            </tr>`)}</tbody>
          </table></div>`}
      <p class="muted" style=${{ fontSize: '12px', marginTop: '10px' }}>Changes apply the next time they open or refresh the planner. Removing someone blocks their access to the data straight away.</p>
    </div>
  </div>`;
}
