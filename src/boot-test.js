import { render } from 'preact';
import { useState } from 'preact/hooks';
import { html } from './lib/html.js';
import { createClient } from '@supabase/supabase-js';

function Test() {
  const [n, setN] = useState(0);
  const supabaseOk = typeof createClient === 'function';
  return html`
    <div class="boot">
      <h1>Render OK ✓</h1>
      <p>Preact + htm + hooks working.</p>
      <p>supabase-js loaded: ${supabaseOk ? 'yes ✓' : 'no ✗'}</p>
      <button onClick=${() => setN(n + 1)}>Clicked ${n} times</button>
    </div>
  `;
}

render(html`<${Test} />`, document.getElementById('app'));
