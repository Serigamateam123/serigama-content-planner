import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Modal } from '../components/ui.js';
import { PLATFORMS, STATUSES, FORMATS, FUNNELS, PILLAR_SUGGESTIONS } from '../lib/constants.js';
import { toDatetimeLocal, fromDatetimeLocal } from '../lib/date.js';

// Distinct non-empty values already used for a field, for the type-ahead lists.
const usedValues = (contents, key, extra = []) =>
  [...new Set([...extra, ...(contents || []).map((c) => (c[key] || '').trim()).filter(Boolean)])].sort();

// Add / edit a piece of content. `content` is null when creating; `prefill` seeds a
// new post (e.g. "Plan a post" from a Content Funnel inspo clip).
export function ContentModal({ content, contents, campaigns, accounts, defaultDate, prefill, onSubmit, onDelete, onClose }) {
  const c = content || prefill || {};
  const [form, setForm] = useState({
    title: c.title || '',
    platform: c.platform || (PLATFORMS[0] && PLATFORMS[0].id),
    account_id: c.account_id || '',
    campaign_id: c.campaign_id || '',
    format: c.format || 'feed',
    status: c.status || (defaultDate ? 'scheduled' : 'idea'),
    scheduled_local: toDatetimeLocal(c.scheduled_at) || (defaultDate ? toDatetimeLocal(defaultDate) : ''),
    has_final_caption: !!c.has_final_caption,
    post_url: c.post_url || '',
    caption: c.caption || '',
    funnel_stage: c.funnel_stage || '',
    pillar: c.pillar || '',
    product: c.product || '',
    assignee: c.assignee || '',
    hook: c.hook || '',
    cta: c.cta || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async () => {
    if (!form.title.trim()) { setErr('Give the post a title first.'); return; }
    setBusy(true);
    setErr('');
    const scheduled_at = fromDatetimeLocal(form.scheduled_local);
    const prev = content || {};
    const patch = {
      title: form.title.trim(),
      platform: form.platform,
      account_id: form.account_id || null,
      campaign_id: form.campaign_id || null,
      format: form.format,
      status: form.status,
      scheduled_at,
      has_final_caption: form.has_final_caption,
      post_url: form.post_url.trim(),
      caption: form.caption,
      // When marking published, stamp published_at if not already set.
      published_at:
        form.status === 'published' ? prev.published_at || scheduled_at || new Date().toISOString() : null,
      funnel_stage: form.funnel_stage,
      pillar: form.pillar.trim(),
      product: form.product.trim(),
      assignee: form.assignee.trim(),
      hook: form.hook,
      cta: form.cta.trim(),
    };
    try {
      await onSubmit(patch, content ? content.id : null);
    } catch (e) {
      setErr('Could not save — ' + ((e && e.message) || 'please check your connection and try again.'));
    }
    setBusy(false);
  };

  const footer = html`
    <div>
      ${content
        ? html`<button class="btn btn-danger btn-sm" onClick=${() => { if (confirm('Delete this post?')) onDelete(content.id); }}>Delete</button>`
        : html`<span></span>`}
    </div>
    <div style=${{ display: 'flex', gap: '8px' }}>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-gold" onClick=${submit} disabled=${busy}>
        ${busy ? 'Saving…' : content ? 'Save changes' : 'Add content'}
      </button>
    </div>`;

  const list = (id, values) => html`<datalist id=${id}>${values.map((v) => html`<option value=${v} />`)}</datalist>`;

  return html`<${Modal} title=${content ? 'Edit content' : 'New content'} onClose=${onClose} footer=${footer}>
    ${err ? html`<div class="toast toast-err" style=${{ marginBottom: '12px' }}>${err}</div>` : ''}
    <div class="field">
      <label>Title</label>
      <input value=${form.title} onInput=${set('title')} placeholder="e.g. New arrival teaser" autofocus />
    </div>

    <div class="field-row">
      <div class="field">
        <label>Status</label>
        <select value=${form.status} onChange=${set('status')}>
          ${STATUSES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
        </select>
      </div>
      <div class="field">
        <label>Scheduled date & time</label>
        <input type="datetime-local" value=${form.scheduled_local} onInput=${set('scheduled_local')} />
        <div class="help">Leave blank to keep it in the unscheduled backlog.</div>
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Platform</label>
        <select value=${form.platform} onChange=${set('platform')}>
          ${PLATFORMS.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
        </select>
      </div>
      <div class="field">
        <label>Format</label>
        <select value=${form.format} onChange=${set('format')}>
          ${FORMATS.map((f) => html`<option value=${f.id}>${f.label}</option>`)}
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Funnel stage</label>
        <select value=${form.funnel_stage} onChange=${set('funnel_stage')}>
          <option value="">— Not set</option>
          ${FUNNELS.map((f) => html`<option value=${f.id}>${f.emoji} ${f.name} (${f.tag})</option>`)}
        </select>
      </div>
      <div class="field">
        <label>Content pillar</label>
        <input value=${form.pillar} onInput=${set('pillar')} list="dl-pillar" placeholder="e.g. Testimonial" />
        ${list('dl-pillar', usedValues(contents, 'pillar', PILLAR_SUGGESTIONS))}
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Product featured</label>
        <input value=${form.product} onInput=${set('product')} list="dl-product" placeholder="e.g. Jeli Gamat" />
        ${list('dl-product', usedValues(contents, 'product'))}
      </div>
      <div class="field">
        <label>Assigned to</label>
        <input value=${form.assignee} onInput=${set('assignee')} list="dl-assignee" placeholder="Who is making it?" />
        ${list('dl-assignee', usedValues(contents, 'assignee'))}
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Campaign</label>
        <select value=${form.campaign_id} onChange=${set('campaign_id')}>
          <option value="">No campaign</option>
          ${campaigns.map((cam) => html`<option value=${cam.id}>${cam.name}</option>`)}
        </select>
      </div>
      <div class="field">
        <label>Account</label>
        <select value=${form.account_id} onChange=${set('account_id')}>
          <option value="">—</option>
          ${accounts.map((a) => html`<option value=${a.id}>${a.display_name || a.handle}</option>`)}
        </select>
      </div>
    </div>

    <div class="field">
      <label>Hook / script</label>
      <textarea rows="3" value=${form.hook} onInput=${set('hook')} placeholder="Opening line for the first 2 seconds, then the script or shot list…"></textarea>
    </div>

    <div class="field">
      <label>Call-to-action</label>
      <input value=${form.cta} onInput=${set('cta')} placeholder="e.g. Tap the yellow basket · Comment 'NAK' for the link" />
    </div>

    <div class="field">
      <label>Caption / notes</label>
      <textarea value=${form.caption} onInput=${set('caption')} placeholder="Draft your caption or add notes…"></textarea>
    </div>

    <div class="field">
      <label class="check">
        <input type="checkbox" checked=${form.has_final_caption} onChange=${set('has_final_caption')} />
        Final caption is ready
      </label>
    </div>

    <div class="field">
      <label>Post link (once published)</label>
      <input value=${form.post_url} onInput=${set('post_url')} placeholder="https://…  (used for auto-syncing metrics)" />
    </div>
  <//>`;
}
