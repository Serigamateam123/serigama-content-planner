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

// A readable random password: 3 words-ish chunks + digits, e.g. "Kopi-Rama-4821".
const genPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghijkmnopqrstuvwxyz', d = '23456789';
  const r = (s, n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => s[x % s.length]).join('');
  return r(a, 1) + r(b, 4) + '-' + r(a, 1) + r(b, 4) + '-' + r(d, 4);
};

// The member's starting password: masked, with show / hide, copy, and "set new".
function PasswordCell({ member, onSetNew }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(member.start_password); }
    catch (e) { const t = document.createElement('textarea'); t.value = member.start_password; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const save = async () => { setBusy(true); const ok = await onSetNew(member.email, draft); setBusy(false); if (ok) { setEditing(false); setDraft(''); setShow(true); } };

  if (editing) {
    return html`<div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="text" value=${draft} onInput=${(e) => setDraft(e.target.value)} placeholder="New password (8+ characters)" autocomplete="new-password"
        style=${{ width: '190px', fontFamily: 'ui-monospace, Consolas, monospace' }} />
      <button class="btn btn-sm" type="button" onClick=${() => setDraft(genPassword())} title="Make up a strong password">Generate</button>
      <button class="btn btn-gold btn-sm" type="button" disabled=${busy || draft.length < 8} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>
      <button class="btn btn-ghost btn-sm" type="button" onClick=${() => { setEditing(false); setDraft(''); }}>Cancel</button>
    </div>`;
  }
  const setNewBtn = html`<button class="btn btn-ghost btn-sm" type="button" onClick=${() => { setDraft(''); setEditing(true); }}>Set new</button>`;
  if (member.start_password) {
    return html`<div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <code style=${{ fontSize: '13px', padding: '3px 8px', borderRadius: '6px', background: 'var(--border-2, #eef0f6)', minWidth: '120px', letterSpacing: show ? 0 : '2px' }}>
        ${show ? member.start_password : '••••••••••'}
      </code>
      <button class="btn btn-sm" type="button" onClick=${() => setShow(!show)} aria-label=${show ? 'Hide password' : 'Show password'}>${show ? 'Hide' : 'Show'}</button>
      <button class="btn btn-sm" type="button" onClick=${copy}>${copied ? 'Copied ✓' : 'Copy'}</button>
      ${setNewBtn}
    </div>`;
  }
  return html`<div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
    <span class="muted" style=${{ fontSize: '12.5px' }}>${member.password_changed ? 'Changed by member' : 'Not saved'}</span>
    ${setNewBtn}
  </div>`;
}

export function Team({ store, ownerEmail, onPreview }) {
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
  const setNewPassword = async (email, password) => {
    setMsg(null);
    try {
      await store.teamInvite({ action: 'set_password', email, password });
      setMsg({ ok: true, text: `New password saved for ${email}. Send it to them privately — they sign in with it from now on.` });
      await load();
      return true;
    } catch (err) { setMsg({ ok: false, text: err.message || String(err) }); return false; }
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
              <button type="button" class="btn btn-sm" title="Make up a strong password" onClick=${() => { setForm({ ...form, password: genPassword() }); setShowPw(true); }}>Generate</button>
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
            <thead><tr><th>Email</th><th>Access</th><th>Password</th><th>Added</th><th></th></tr></thead>
            <tbody>${members.map((m) => html`<tr>
              <td style=${{ fontWeight: 600 }}>${m.email}</td>
              <td><select class="hdr-select" value=${m.role} onChange=${(e) => changeRole(m.email, e.target.value)} aria-label=${'Access for ' + m.email}>
                ${ROLES.map((r) => html`<option value=${r.id}>${r.label}</option>`)}
              </select></td>
              <td><${PasswordCell} member=${m} onSetNew=${setNewPassword} /></td>
              <td class="muted">${new Date(m.invited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td><button class="btn btn-danger btn-sm" onClick=${() => remove(m.email)}>Remove</button></td>
            </tr>`)}</tbody>
          </table></div>`}
      <p class="muted" style=${{ fontSize: '12px', marginTop: '10px' }}>Changes apply the next time they open or refresh the planner. Removing someone blocks their access to the data straight away.
        The password shown is the starting one you set; once a member changes it themselves it shows “Changed by member” (nobody can see their own choice — use “Set new” if they forget it).</p>
    </div>

    ${onPreview ? html`<div class="card card-pad section-gap">
      <div class="card-title">See what your team sees</div>
      <p class="muted" style=${{ fontSize: '13px', margin: '4px 0 12px' }}>Opens the planner with a team member's menu and page access. Exit any time from the banner at the top.</p>
      <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => onPreview('calendar')}>Preview as Calendar only</button>
        <button class="btn" onClick=${() => onPreview('full')}>Preview as Full access</button>
      </div>
    </div>` : ''}
  </div>`;
}
