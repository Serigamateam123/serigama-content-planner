import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';

// Magic-link sign in, shown only in cloud (Supabase) mode when not authenticated.
export function Login({ config, onSignIn }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const res = await onSignIn(email.trim());
    setBusy(false);
    setMsg({ ok: res.ok, text: res.message });
  };

  return html`<div class="login-wrap">
    <div class="login-card">
      <h1>${config.brandName || 'Serigama'} Content Planner</h1>
      <p>Sign in to reach your content plan from any device.</p>
      <form onSubmit=${submit}>
        <div class="field">
          <label>Email</label>
          <input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="you@example.com" autofocus />
        </div>
        <button class="btn btn-primary" style=${{ width: '100%', justifyContent: 'center' }} disabled=${busy}>
          ${busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')}>${msg.text}</div>` : null}
      <div class="login-note">We’ll email you a secure one-time link — no password to remember.</div>
    </div>
  </div>`;
}
