import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon, Modal, Empty } from '../components/ui.js';
import { store, isCloud } from '../lib/store.js';

// Fundamental Content — an inspiration library organised by marketing funnel.
// Three funnels (top / middle / bottom); each holds inspo clips (a TikTok link
// that plays inline) with a note describing the idea. Stored in the cloud under
// the app_kv key `serigama.fundamental` so it syncs across devices, exactly like
// the manually-captured Studio figures.
const KV = 'serigama.fundamental';

const FUNNELS = [
  { id: 'top', emoji: '🔝', name: 'Top Funnel', tag: 'Awareness', accent: '#2f6df6',
    desc: 'Reach new people — scroll-stopping hooks, trends, and relatable skits that get discovered.' },
  { id: 'middle', emoji: '🎯', name: 'Middle Funnel', tag: 'Consideration', accent: '#e0a419',
    desc: 'Build trust — product education, demos, behind-the-scenes, and testimonials.' },
  { id: 'bottom', emoji: '🛒', name: 'Bottom Funnel', tag: 'Conversion', accent: '#0f9d58',
    desc: 'Drive action — offers, reviews, urgency, and clear calls-to-action to buy.' },
];

const emptyData = () => ({ top: [], middle: [], bottom: [] });

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(KV) || 'null');
    if (d && Array.isArray(d.top)) return { ...emptyData(), ...d };
  } catch (e) { /* fall through */ }
  return emptyData();
}

function persist(data) {
  const json = JSON.stringify(data);
  try { localStorage.setItem(KV, json); } catch (e) { /* ignore */ }
  if (isCloud && store.setKV) store.setKV(KV, json).catch(() => {});
}

// Pull the numeric video id out of a pasted TikTok URL (…/video/1234567890) or a
// bare id. Short links (vm.tiktok.com/…) don't carry the id, so those fall back
// to an "Open ↗" link instead of the inline player.
function tiktokId(url) {
  const s = String(url || '').trim();
  const m = s.match(/\/video\/(\d+)/) || s.match(/^(\d{6,})$/);
  return m ? m[1] : null;
}

// A link we can play inside the app: TikTok videos and Instagram reels/posts.
// Returns an embeddable iframe src, or null (then we show a plain "Open ↗" link).
function embedSrc(url) {
  const s = String(url || '').trim();
  const tid = tiktokId(s);
  if (tid) return `https://www.tiktok.com/player/v1/${tid}?rel=0&description=0&music_info=0`;
  const ig = s.match(/instagram\.com\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  if (ig) { const kind = ig[1] === 'reels' ? 'reel' : ig[1]; return `https://www.instagram.com/${kind}/${ig[2]}/embed`; }
  return null;
}

const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function Fundamental() {
  const [data, setData] = useState(loadData);
  const [open, setOpen] = useState(null);        // funnel id when drilled in
  const [playing, setPlaying] = useState(null);   // inspo item being played
  const [editing, setEditing] = useState(null);   // { item } | { item: null } for new

  const update = (next) => { setData(next); persist(next); };

  const addOrSave = (funnelId, item) => {
    const list = data[funnelId] || [];
    const next = item.id
      ? { ...data, [funnelId]: list.map((x) => (x.id === item.id ? item : x)) }
      : { ...data, [funnelId]: [{ ...item, id: uid(), addedAt: Date.now() }, ...list] };
    update(next);
    setEditing(null);
  };

  const remove = (funnelId, id) => update({ ...data, [funnelId]: (data[funnelId] || []).filter((x) => x.id !== id) });

  // ---- Landing: the three funnel cards ----
  if (!open) {
    return html`<div>
      <div class="page-head">
        <div>
          <div class="eyebrow">Planning</div>
          <h1 class="page-title">Content Funnel</h1>
        </div>
      </div>
      <p class="muted" style=${{ marginTop: '-8px', marginBottom: '18px', fontSize: '13.5px' }}>
        Your inspiration library, organised by funnel stage. Pick a funnel to collect reference clips and notes.
      </p>
      <div class="fund-grid">
        ${FUNNELS.map((f) => {
          const n = (data[f.id] || []).length;
          return html`<button class="funnel-card" style=${{ '--accent': f.accent }} onClick=${() => setOpen(f.id)}>
            <div class="funnel-emoji">${f.emoji}</div>
            <div class="funnel-tag">${f.tag}</div>
            <div class="funnel-name">${f.name}</div>
            <div class="funnel-desc">${f.desc}</div>
            <div class="funnel-foot">
              <span>${n} ${n === 1 ? 'inspo clip' : 'inspo clips'}</span>
              <${Icon} name="chevronRight" size=${18} />
            </div>
          </button>`;
        })}
      </div>
    </div>`;
  }

  // ---- Detail: one funnel's inspo library ----
  const f = FUNNELS.find((x) => x.id === open);
  const items = data[open] || [];
  return html`<div>
    <div class="page-head">
      <div>
        <button class="btn btn-ghost btn-sm" style=${{ marginBottom: '8px' }} onClick=${() => setOpen(null)}>
          <${Icon} name="chevronLeft" size=${15} /> All funnels
        </button>
        <h1 class="page-title" style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>${f.emoji}</span> ${f.name}
          <span class="funnel-tag" style=${{ '--accent': f.accent }}>${f.tag}</span>
        </h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-gold" onClick=${() => setEditing({ item: null })}><${Icon} name="plus" size=${15} /> Add inspo</button>
      </div>
    </div>

    ${items.length === 0
      ? html`<div class="card card-pad"><${Empty} title="No inspo yet">Paste a TikTok link and a note to start building your ${f.name.toLowerCase()} reference library.</${Empty}></div>`
      : html`<div class="fund-grid">
          ${items.map((it) => {
            const src = embedSrc(it.url);
            return html`<div class="inspo-card">
              ${src
                ? html`<div class="inspo-thumb" style=${{ '--accent': f.accent }} onClick=${() => setPlaying(it)}>
                    <span class="inspo-play">▶</span>
                  </div>`
                : html`<a class="inspo-thumb" style=${{ '--accent': f.accent }} href=${it.url || '#'} target="_blank" rel="noopener">
                    <span class="inspo-link"><${Icon} name="external" size=${20} /><span>Open link ↗</span></span>
                  </a>`}
              <div class="inspo-body">
                ${it.title ? html`<div class="inspo-title">${it.title}</div>` : ''}
                <div class="inspo-note">${it.note || html`<span class="muted">No note.</span>`}</div>
                <div class="inspo-actions">
                  ${it.url ? html`<a href=${it.url} target="_blank" rel="noopener" class="btn btn-ghost btn-sm"><${Icon} name="external" size=${13} /> Open</a>` : ''}
                  <button class="btn btn-ghost btn-sm" onClick=${() => setEditing({ item: it })}><${Icon} name="pencil" size=${13} /></button>
                  <button class="btn btn-ghost btn-sm" onClick=${() => remove(open, it.id)}><${Icon} name="trash" size=${13} /></button>
                </div>
              </div>
            </div>`;
          })}
        </div>`}

    ${editing ? html`<${InspoModal} funnel=${f} item=${editing.item} onClose=${() => setEditing(null)} onSave=${(item) => addOrSave(open, item)} />` : ''}
    ${playing ? html`<${VideoModal} item=${playing} onClose=${() => setPlaying(null)} />` : ''}
  </div>`;
}

function InspoModal({ funnel, item, onClose, onSave }) {
  const it = item || {};
  const [url, setUrl] = useState(it.url || '');
  const [title, setTitle] = useState(it.title || '');
  const [note, setNote] = useState(it.note || '');

  const submit = () => {
    if (!url.trim() && !note.trim()) return;
    onSave({ ...it, url: url.trim(), title: title.trim(), note: note.trim() });
  };

  const playable = embedSrc(url);
  const footer = html`
    <div>${item ? html`<span class="muted" style=${{ fontSize: '12px' }}>${playable ? '▶ Will play inline' : url.trim() ? 'Opens in a new tab' : ''}</span>` : html`<span class="muted" style=${{ fontSize: '12px' }}>${playable ? '▶ Will play inline' : ''}</span>`}</div>
    <div style=${{ display: 'flex', gap: '8px' }}>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-gold" onClick=${submit}>${item ? 'Save' : 'Add'}</button>
    </div>`;

  return html`<${Modal} title=${(item ? 'Edit inspo — ' : 'Add inspo — ') + funnel.name} onClose=${onClose} footer=${footer}>
    <div class="field">
      <label>Video link</label>
      <input value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@user/video/12345…" autofocus />
      <div class="help">Paste a TikTok or Instagram (Reel/post) link — it plays right here. Other links open in a new tab.</div>
    </div>
    <div class="field">
      <label>Title <span class="muted" style=${{ fontWeight: 400 }}>(optional)</span></label>
      <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g. Fast hook + text overlay" />
    </div>
    <div class="field">
      <label>Notes</label>
      <textarea rows="4" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="What makes this a good reference? Hook, pacing, format, CTA…"></textarea>
    </div>
  <//>`;
}

function VideoModal({ item, onClose }) {
  const src = embedSrc(item.url);
  const stop = (e) => e.stopPropagation();
  return html`<div class="overlay" onClick=${onClose}>
    <div class="video-modal" onClick=${stop}>
      <button class="x-btn video-x" onClick=${onClose} aria-label="Close">×</button>
      ${src
        ? html`<iframe
            src=${src}
            title=${item.title || 'Inspo video'}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowfullscreen
            style=${{ width: '100%', height: '100%', border: 'none', borderRadius: '14px' }}></iframe>`
        : html`<div style=${{ padding: '40px', color: '#fff', textAlign: 'center' }}>
            This link can't play inline.
            ${item.url ? html`<div style=${{ marginTop: '10px' }}><a href=${item.url} target="_blank" rel="noopener" style=${{ color: 'var(--gold)' }}>Open link ↗</a></div>` : ''}
          </div>`}
    </div>
  </div>`;
}
