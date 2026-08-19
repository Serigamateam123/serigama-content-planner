import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';

// Sign in — password by default (no email, so no rate limit), with a magic-link
// fallback. Shown only in cloud (Supabase) mode when not authenticated.
export function Login({ config, onSignIn, onPasswordSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('password'); // 'password' | 'link'
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) { setMsg({ ok: false, text: 'Enter your email address first.' }); return; }
    setBusy(true);
    try {
      if (mode === 'password') {
        if (!password) { setBusy(false); setMsg({ ok: false, text: 'Enter your password.' }); return; }
        const res = await onPasswordSignIn(addr, password);
        // On success the app swaps to the dashboard automatically; only surface failures.
        if (!res.ok) setMsg({ ok: false, text: res.message || 'Sign-in failed. Check your email and password.' });
      } else {
        const res = await onSignIn(addr);
        setMsg({ ok: res.ok, text: res.message });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err && err.message) || 'Something went wrong — please try again.' });
    }
    setBusy(false);
  };

  const switchTo = (m) => { setMode(m); setMsg(null); };

  return html`<div class="login-wrap">
    <div class="login-card">
      <h1>${config.brandName || 'Serigama'} Content Planner</h1>
      <p>Sign in to reach your content plan from any device.</p>
      <form onSubmit=${submit}>
        <div class="field">
          <label>Email</label>
          <input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="you@example.com" autofocus />
        </div>
        ${mode === 'password'
          ? html`<div class="field">
              <label>Password</label>
              <input type="password" value=${password} onInput=${(e) => setPassword(e.target.value)} placeholder="Your password" />
            </div>`
          : null}
        <button class="btn btn-primary" style=${{ width: '100%', justifyContent: 'center' }} disabled=${busy}>
          ${busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
        </button>
      </form>
      ${msg ? html`<div class=${'toast' + (msg.ok ? '' : ' toast-err')}>${msg.text}</div>` : null}
      <div class="login-note">
        ${mode === 'password'
          ? html`<span onClick=${() => switchTo('link')} style=${{ cursor: 'pointer', textDecoration: 'underline' }}>Email me a sign-in link instead</span>`
          : html`<span onClick=${() => switchTo('password')} style=${{ cursor: 'pointer', textDecoration: 'underline' }}>Sign in with a password instead</span>`}
      </div>
    </div>
  </div>`;
}
