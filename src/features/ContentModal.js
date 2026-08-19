import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Modal } from '../components/ui.js';
import { PLATFORMS, STATUSES, FORMATS } from '../lib/constants.js';
import { toDatetimeLocal, fromDatetimeLocal } from '../lib/date.js';

// Add / edit a piece of content. `content` is null when creating.
export function ContentModal({ content, campaigns, accounts, defaultDate, onSubmit, onDelete, onClose }) {
  const c = content || {};
  const [form, setForm] = useState({
    title: c.title || '',
    platform: c.platform || (PLATFORMS[0] && PLATFORMS[0].id),
    account_id: c.account_id || '',
    campaign_id: c.campaign_id || '',
    format: c.format || 'feed',
    status: c.status || 'scheduled',
    scheduled_local: toDatetimeLocal(c.scheduled_at) || (defaultDate ? toDatetimeLocal(defaultDate) : ''),
    has_final_caption: !!c.has_final_caption,
    post_url: c.post_url || '',
    caption: c.caption || '',
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    const scheduled_at = fromDatetimeLocal(form.scheduled_local);
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
        form.status === 'published' ? c.published_at || scheduled_at || new Date().toISOString() : null,
    };
    await onSubmit(patch, c.id || null);
    setBusy(false);
  };

  const footer = html`
    <div>
      ${content
        ? html`<button class="btn btn-danger btn-sm" onClick=${() => onDelete(c.id)}>Delete</button>`
        : html`<span></span>`}
    </div>
    <div style=${{ display: 'flex', gap: '8px' }}>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-gold" onClick=${submit} disabled=${busy}>
        ${busy ? 'Saving…' : content ? 'Save changes' : 'Add content'}
      </button>
    </div>`;

  return html`<${Modal} title=${content ? 'Edit content' : 'New content'} onClose=${onClose} footer=${footer}>
    <div class="field">
      <label>Title</label>
      <input value=${form.title} onInput=${set('title')} placeholder="e.g. New arrival teaser" autofocus />
    </div>

    <div class="field-row">
      <div class="field">
        <label>Platform</label>
        <select value=${form.platform} onChange=${set('platform')}>
          ${PLATFORMS.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
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

    <div class="field-row">
      <div class="field">
        <label>Campaign</label>
        <select value=${form.campaign_id} onChange=${set('campaign_id')}>
          <option value="">No campaign</option>
          ${campaigns.map((cam) => html`<option value=${cam.id}>${cam.name}</option>`)}
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

    <div class="field">
      <label class="check">
        <input type="checkbox" checked=${form.has_final_caption} onChange=${set('has_final_caption')} />
        Final caption is ready
      </label>
    </div>

    <div class="field">
      <label>Caption / notes</label>
      <textarea value=${form.caption} onInput=${set('caption')} placeholder="Draft your caption or add notes…"></textarea>
    </div>

    <div class="field">
      <label>Post link (once published)</label>
      <input value=${form.post_url} onInput=${set('post_url')} placeholder="https://…  (used later for auto-syncing metrics)" />
    </div>
  <//>`;
}
