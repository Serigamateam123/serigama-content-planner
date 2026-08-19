import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Progress, Modal, Empty, Badge, Platform } from '../components/ui.js';
import { CAMPAIGN_COLORS } from '../lib/constants.js';

export function Campaigns({ contents, campaigns, onCreate, onUpdate, onDelete, onOpenContent }) {
  const [editing, setEditing] = useState(null); // campaign object or {} for new

  const stats = (cam) => {
    const items = contents.filter((c) => c.campaign_id === cam.id);
    const done = items.filter((c) => c.status === 'published').length;
    const target = cam.target_count || items.length || 0;
    return { items, done, target, pct: target ? Math.min(100, (done / target) * 100) : 0 };
  };

  return html`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Planning</div>
        <h1 class="page-title">Campaigns</h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-gold" onClick=${() => setEditing({})}><${Icon} name="plus" size=${15} /> New campaign</button>
      </div>
    </div>

    ${campaigns.length === 0
      ? html`<div class="card card-pad"><${Empty} title="No campaigns yet">Group your content into campaigns to track progress toward a goal.</${Empty}></div>`
      : html`<div class="grid-cols" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          ${campaigns.map((cam) => {
            const s = stats(cam);
            return html`<div class="card card-pad">
              <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span class="dot" style=${{ width: '12px', height: '12px', background: cam.color }}></span>
                <div class="card-title" style=${{ flex: 1 }}>${cam.name}</div>
                <button class="btn btn-ghost btn-sm" onClick=${() => setEditing(cam)}><${Icon} name="pencil" size=${14} /></button>
              </div>
              <div class="progress-row" style=${{ padding: 0 }}>
                <span class="progress-name muted" style=${{ fontSize: '12.5px' }}>${s.done} of ${s.target} published</span>
                <span class="progress-count">${Math.round(s.pct)}%</span>
              </div>
              <${Progress} pct=${s.pct} color=${cam.color} />
              <div class="list" style=${{ marginTop: '12px' }}>
                ${s.items.slice(0, 4).map(
                  (c) => html`<div class="sched-item" style=${{ padding: '8px 0', cursor: 'pointer' }} onClick=${() => onOpenContent(c)}>
                    <div class="sched-main">
                      <div class="sched-title" style=${{ fontSize: '13px' }}>${c.title}</div>
                      <div class="sched-meta"><${Platform} id=${c.platform} /></div>
                    </div>
                    <${Badge} status=${c.status} />
                  </div>`
                )}
                ${s.items.length > 4 ? html`<div class="muted" style=${{ fontSize: '12px', paddingTop: '8px' }}>+ ${s.items.length - 4} more</div>` : ''}
                ${s.items.length === 0 ? html`<div class="muted" style=${{ fontSize: '12.5px', paddingTop: '4px' }}>No content assigned yet.</div>` : ''}
              </div>
            </div>`;
          })}
        </div>`}

    ${editing
      ? html`<${CampaignModal}
          campaign=${editing.id ? editing : null}
          onClose=${() => setEditing(null)}
          onSubmit=${async (data, id) => { id ? await onUpdate(id, data) : await onCreate(data); setEditing(null); }}
          onDelete=${async (id) => { await onDelete(id); setEditing(null); }}
        />`
      : null}
  </div>`;
}

function CampaignModal({ campaign, onClose, onSubmit, onDelete }) {
  const c = campaign || {};
  const [name, setName] = useState(c.name || '');
  const [target, setTarget] = useState(c.target_count || 12);
  const [color, setColor] = useState(c.color || CAMPAIGN_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onSubmit({ name: name.trim(), target_count: Number(target) || 0, color }, c.id || null);
  };

  const footer = html`
    <div>${campaign ? html`<button class="btn btn-danger btn-sm" onClick=${() => onDelete(c.id)}>Delete</button>` : html`<span></span>`}</div>
    <div style=${{ display: 'flex', gap: '8px' }}>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-gold" onClick=${submit} disabled=${busy}>${busy ? 'Saving…' : campaign ? 'Save' : 'Create'}</button>
    </div>`;

  return html`<${Modal} title=${campaign ? 'Edit campaign' : 'New campaign'} onClose=${onClose} footer=${footer}>
    <div class="field">
      <label>Campaign name</label>
      <input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. New Arrivals Launch" autofocus />
    </div>
    <div class="field">
      <label>Target number of posts</label>
      <input type="number" min="0" value=${target} onInput=${(e) => setTarget(e.target.value)} />
      <div class="help">Used for the progress bar (published ÷ target).</div>
    </div>
    <div class="field">
      <label>Colour</label>
      <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        ${CAMPAIGN_COLORS.map(
          (col) => html`<button
            onClick=${() => setColor(col)}
            style=${{ width: '30px', height: '30px', borderRadius: '50%', background: col, border: color === col ? '3px solid #1f2430' : '3px solid transparent', cursor: 'pointer' }}
            aria-label=${col}
          ></button>`
        )}
      </div>
    </div>
  <//>`;
}
