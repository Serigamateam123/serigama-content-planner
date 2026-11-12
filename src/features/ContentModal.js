import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { Modal } from '../components/ui.js';
import { PLATFORMS, STATUSES, FORMATS, FUNNELS, PILLAR_SUGGESTIONS } from '../lib/constants.js';
import { toDatetimeLocal, fromDatetimeLocal } from '../lib/date.js';
import { activeAccountId } from '../lib/account.js';

// An inspo link as a clickable URL (adds https:// to "vt.tiktok.com/…"), or null.
const inspoHref = (v) => {
  const s = String(v || '').trim();
  if (!s || /\s/.test(s)) return null;
  const u = /^https?:\/\//i.test(s) ? s : (/^[\w-]+(\.[\w-]+)+\//.test(s) ? 'https://' + s : null);
  try { return u && new URL(u).href; } catch (e) { return null; }
};

// Distinct non-empty values already used for a field, for the type-ahead lists.
const usedValues = (contents, key, extra = []) =>
  [...new Set([...extra, ...(contents || []).map((c) => (c[key] || '').trim()).filter(Boolean)])].sort();

// Add / edit a piece of content. `content` is null when creating; `prefill` seeds a
// new post (e.g. "Plan a post" from a Content Funnel inspo clip).
export function ContentModal({ content, contents, allContents, accounts, defaultDate, prefill, canAutopost, uploadMedia, onSubmit, onDelete, onClose }) {
  const c = content || prefill || {};
  const [form, setForm] = useState({
    title: c.title || '',
    platform: c.platform || (PLATFORMS[0] && PLATFORMS[0].id),
    account_id: c.account_id || (content ? '' : activeAccountId() || ''), // new posts go to the account in the switcher
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
    inspo1: c.inspo1 || '',
    inspo2: c.inspo2 || '',
    trial: !!c.trial,
  });
  // Auto-posting to Instagram (supabase/publish.sql). `job` is this item's posting job.
  const job = content && content.publishJob && content.publishJob.status !== 'cancelled' ? content.publishJob : null;
  const jobLocked = !!job && (job.status === 'published' || job.status === 'processing');
  const [ap, setAp] = useState({
    on: !!job,
    file: null,
    cover: null,
    caption: job ? job.caption : (c.caption || ''),
    shareToFeed: job ? job.share_to_feed !== false : true,
    trialMode: (job && job.trial) || 'MANUAL',
  });
  const setA = (k) => (e) => {
    const t = e.target;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'file' ? (t.files && t.files[0]) || null : t.value;
    setAp((a) => ({ ...a, [k]: v }));
  };
  const [busyText, setBusyText] = useState('');
  const isImg = (f) => /^image\//.test((f && f.type) || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async () => {
    if (!form.title.trim()) { setErr('Give the post a title first.'); return; }
    // A trial reel's link must be its own: if it's the link of a post Instagram already
    // synced, saving would fold the trial into that post (lib/reconcile.js).
    const code = (u) => { const m = String(u || '').match(/instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : null; };
    if (form.trial && !(content && content.external_id) && code(form.post_url)) {
      const twin = (allContents || contents || []).find((x) => x.external_id && x.id !== (content && content.id) && code(x.post_url) === code(form.post_url));
      if (twin) { setErr(`Instagram already synced this reel: “${(twin.title || '').slice(0, 50)}”. Cancel this, open that post in the calendar and tick “Trial reel” there instead, so it isn't counted twice.`); return; }
    }
    const scheduled_at = fromDatetimeLocal(form.scheduled_local);
    const acct = (accounts || []).find((a) => a.id === form.account_id);
    const autopost = canAutopost && form.platform === 'instagram' && ap.on && !jobLocked;
    let publish = null;
    if (autopost) {
      if (!acct || acct.platform !== 'instagram') { setErr('To post automatically, set Account to your Instagram account.'); return; }
      if (!scheduled_at) { setErr('To post automatically, pick the date and time to post.'); return; }
      if (!ap.file && !(job && job.media_path)) { setErr('Choose the video (MP4 / MOV) or photo (JPG) to post.'); return; }
      const isImage = ap.file ? isImg(ap.file) : job.kind === 'image';
      if (ap.file && !/^(video\/(mp4|quicktime)|image\/jpe?g)$/.test(ap.file.type)) { setErr('Instagram takes MP4 / MOV videos and JPG photos only.'); return; }
      if (ap.file && ap.file.size > 50 * 1024 * 1024) { setErr('That file is over 50 MB. Export a smaller version (1080p, under 50 MB) and try again.'); return; }
      if (isImage && form.trial) { setErr('Trial reels must be videos.'); return; }
      setBusy(true); setErr('');
      try {
        setBusyText(ap.file ? 'Uploading… (a big video can take a minute)' : 'Saving…');
        const media_path = ap.file ? await uploadMedia(ap.file) : job.media_path;
        const cover_path = !isImage && ap.cover ? await uploadMedia(ap.cover) : (job && !ap.file ? job.cover_path : null);
        publish = { action: 'save', old: job ? [ap.file ? job.media_path : null, (ap.file || ap.cover) ? job.cover_path : null] : [], job: {
          account_id: acct.id, platform: 'instagram', kind: isImage ? 'image' : 'reel', media_path, cover_path,
          caption: ap.caption || '', share_to_feed: !!ap.shareToFeed, trial: form.trial && !isImage ? ap.trialMode : null,
          scheduled_at, status: 'queued', container_id: null, media_id: null, error: null, attempts: 0, lock_until: null,
        } };
      } catch (e) { setErr('Upload failed: ' + ((e && e.message) || e)); setBusy(false); setBusyText(''); return; }
    } else if (job && !jobLocked && !ap.on) {
      publish = { action: 'cancel', old: [job.media_path, job.cover_path] };
    }
    setBusy(true);
    setErr('');
    const prev = content || {};
    const patch = {
      title: form.title.trim(),
      platform: form.platform,
      account_id: form.account_id || null,
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
      inspo1: inspoHref(form.inspo1) || form.inspo1.trim(),
      inspo2: inspoHref(form.inspo2) || form.inspo2.trim(),
      trial: form.trial ? true : '',
    };
    if (publish) patch._publish = publish;
    if (publish && publish.action === 'save') {
      if (!['published', 'takedown'].includes(form.status)) patch.status = 'scheduled';
      patch.published_at = null;
    }
    try {
      await onSubmit(patch, content ? content.id : null);
    } catch (e) {
      setErr('Could not save — ' + ((e && e.message) || 'please check your connection and try again.'));
    }
    setBusy(false);
    setBusyText('');
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
        ${busy ? busyText || 'Saving…' : content ? 'Save changes' : 'Add content'}
      </button>
    </div>`;

  const list = (id, values) => html`<datalist id=${id}>${values.map((v) => html`<option value=${v} />`)}</datalist>`;
  // Inspo link field: the URL box, plus an "Open ↗" button once it holds a real link.
  const inspoField = (key, label) => {
    const href = inspoHref(form[key]);
    return html`<div class="field">
      <label>${label}</label>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input type="url" value=${form[key]} onInput=${set(key)} placeholder="Paste a TikTok / Instagram / YouTube link" style=${{ flex: 1, minWidth: 0 }} />
        ${href ? html`<a class="btn btn-sm" href=${href} target="_blank" rel="noopener" title=${href} style=${{ whiteSpace: 'nowrap', textDecoration: 'none' }}>Open ↗</a>` : ''}
      </div>
    </div>`;
  };

  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const jobLine = () => {
    if (!job) return '';
    if (job.status === 'published') return html`<div class="ap-status ap-ok">✅ Posted to Instagram${job.permalink ? html` · <a href=${job.permalink} target="_blank" rel="noopener">open ↗</a>` : ''}</div>`;
    if (job.status === 'processing') return html`<div class="ap-status ap-wait">⏳ Posting now. Instagram is processing the video…</div>`;
    if (job.status === 'failed') return html`<div class="ap-status ap-bad">⚠️ Couldn't post: ${job.error || 'unknown error'}<br/><span class="muted">Fix it and press Save to try again (pick a new time if this one has passed), or untick to post it yourself.</span></div>`;
    return html`<div class="ap-status ap-wait">⏱ Will post ${when(job.scheduled_at)}${job.error ? html` · last try: ${job.error}` : ''}</div>`;
  };
  const showCover = !(ap.file ? isImg(ap.file) : job && job.kind === 'image');
  const autopostBox = () => html`<div class="field ap-box">
      <label class="check">
        <input type="checkbox" checked=${ap.on || jobLocked} disabled=${jobLocked} onChange=${setA('on')} />
        <span><strong>📤 Post to Instagram automatically</strong> at the scheduled date & time</span>
      </label>
      ${jobLine()}
      ${ap.on && !jobLocked ? html`
        <div class="field" style=${{ marginTop: '10px' }}>
          <label>Video (MP4 / MOV) or photo (JPG) · max 50 MB</label>
          <input type="file" accept="video/mp4,video/quicktime,image/jpeg" onChange=${setA('file')} />
          ${!ap.file && job && job.media_path ? html`<div class="help">Already uploaded (${job.kind === 'image' ? 'photo' : 'video'}). Choose a file only to replace it.</div>` : ''}
        </div>
        ${showCover ? html`<div class="field">
          <label>Cover image (optional, JPG)</label>
          <input type="file" accept="image/jpeg" onChange=${setA('cover')} />
          ${!ap.cover && job && job.cover_path && !ap.file ? html`<div class="help">Cover already uploaded.</div>` : ''}
        </div>` : ''}
        <div class="field">
          <label>Caption to post</label>
          <textarea rows="4" value=${ap.caption} onInput=${setA('caption')} placeholder="The caption that goes on Instagram, with hashtags"></textarea>
        </div>
        ${form.trial ? html`<div class="field">
          <label><span class="trial-tag">Trial reel</span> After the trial</label>
          <select value=${ap.trialMode} onChange=${setA('trialMode')}>
            <option value="MANUAL">Keep it a trial (I'll share it to followers myself)</option>
            <option value="SS_PERFORMANCE">Share to followers automatically if it does well</option>
          </select>
        </div>` : html`<label class="check" style=${{ marginBottom: '6px' }}>
          <input type="checkbox" checked=${ap.shareToFeed} onChange=${setA('shareToFeed')} /> Also show the reel on the profile grid
        </label>`}
        <div class="help">It posts within 5 minutes of the scheduled time (Malaysia time). Tick “Trial reel” above to post it as a trial. The file is deleted from the planner once it's posted.</div>` : ''}
    </div>`;

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

    <div class="field">
      <label>Account</label>
      <select value=${form.account_id} onChange=${set('account_id')}>
        <option value="">—</option>
        ${accounts.map((a) => html`<option value=${a.id}>${a.display_name || a.handle}</option>`)}
      </select>
    </div>

    <div class="field">
      <label>Hook / script</label>
      <textarea rows="3" value=${form.hook} onInput=${set('hook')} placeholder="Opening line for the first 2 seconds, then the script or shot list…"></textarea>
    </div>

    <div class="field">
      <label>Call-to-action</label>
      <input value=${form.cta} onInput=${set('cta')} placeholder="e.g. Tap the yellow basket · Comment 'NAK' for the link" />
    </div>

    <div class="field-row">
      ${inspoField('inspo1', 'Inspo 1')}
      ${inspoField('inspo2', 'Inspo 2')}
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
      <label class="check">
        <input type="checkbox" checked=${form.trial} onChange=${set('trial')} />
        <span><span class="trial-tag">Trial reel</span> Posted as an Instagram trial reel (shown to non-followers first)</span>
      </label>
      ${form.trial ? html`<div class="help">Instagram syncs trial reels like normal reels, with their numbers, but doesn't say which ones are trials. So once the sync brings the reel in, open it in the calendar and tick this box. (Only add a trial reel by hand if it hasn't synced yet.)</div>` : ''}
    </div>

    ${canAutopost && form.platform === 'instagram' ? autopostBox() : ''}

    <div class="field">
      <label>Post link (once published)</label>
      <input value=${form.post_url} onInput=${set('post_url')} placeholder="https://…  (used for auto-syncing metrics)" />
    </div>
  <//>`;
}
