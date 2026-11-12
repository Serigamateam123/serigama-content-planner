// Planned item → posted video. When the daily sync brings in a video that was
// planned in the calendar (an Idea / Filming / Editing / … item on the same day,
// same account), the plan is folded into the posted video and the plan is removed,
// so the calendar never shows the same content twice.
//
// What moves onto the posted video: planning fields kept in `serigama.contentmeta`
// (pillar, funnel stage, hook / script, product, assignee, CTA, Notion id), the
// plan's title (as `plan_title`), its campaign, and its notes (only if the posted
// video has no notes yet). Nothing is merged into a video that already has a plan.
//
// Matching (per account, Malaysia time):
//   • same day: one plan + one unlinked video → a pair; with several on that day,
//     pair by title similarity (≥ 0.34), best first;
//   • a day apart: only when the titles clearly agree (similarity ≥ 0.5).

export const PLAN_STATUSES = ['idea', 'draft', 'scripting', 'filming', 'editing', 'ready', 'scheduled'];
export const PLAN_FIELDS = ['funnel_stage', 'pillar', 'product', 'assignee', 'hook', 'cta', 'inspo1', 'inspo2', 'trial', 'notion_id'];

const MYT = 8 * 3600e3;
const mytDay = (iso) => new Date(new Date(iso).getTime() + MYT).toISOString().slice(0, 10);
const dayGap = (a, b) => Math.round(Math.abs(new Date(a) - new Date(b)) / 864e5);
const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2));
export function similarity(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

// contents: rows with their contentmeta already merged on (as app.js loads them).
// accountOf: row → account id. Returns [{ plan, post }] pairs; changes nothing.
export function findPlanMatches(contents, accountOf) {
  const linked = (c) => !!(c.plan_title || c.notion_id || c.hook || c.pillar);
  const posts = contents.filter((c) => c.external_id && c.status === 'published' && c.published_at && !linked(c));
  // Trial reels are included: Instagram syncs them like any reel, and the plan's
  // "Trial reel" tick (a PLAN_FIELD) moves onto the synced reel with the rest.
  // Items waiting to auto-post are left out: they become the post themselves
  // (instagram-publish), and merging one away would delete its posting job.
  const autoPosting = (c) => c.publishJob && ['queued', 'processing', 'failed'].includes(c.publishJob.status);
  const plans = contents.filter((c) => !c.external_id && !autoPosting(c) && PLAN_STATUSES.includes(c.status) && c.scheduled_at);
  const pairs = [];
  const usedPost = new Set(), usedPlan = new Set();
  const candidates = [];
  for (const plan of plans) {
    const acct = accountOf(plan), pd = mytDay(plan.scheduled_at);
    for (const post of posts) {
      if (accountOf(post) !== acct) continue;
      const gap = dayGap(pd, mytDay(post.published_at));
      if (gap > 1) continue;
      candidates.push({ plan, post, gap, sim: similarity(plan.title, post.title) });
    }
  }
  // Same-day singles first (one plan and one free video that day for that account).
  const key = (c, d) => accountOf(c) + '|' + d;
  const plansOn = new Map(), postsOn = new Map();
  for (const p of plans) { const k = key(p, mytDay(p.scheduled_at)); plansOn.set(k, (plansOn.get(k) || 0) + 1); }
  for (const p of posts) { const k = key(p, mytDay(p.published_at)); postsOn.set(k, (postsOn.get(k) || 0) + 1); }
  const ok = (c) => (c.gap === 0 && (c.sim >= 0.34 || (plansOn.get(key(c.plan, mytDay(c.plan.scheduled_at))) === 1
    && postsOn.get(key(c.post, mytDay(c.post.published_at))) === 1))) || (c.gap === 1 && c.sim >= 0.5);
  candidates.filter(ok).sort((a, b) => a.gap - b.gap || b.sim - a.sim).forEach((c) => {
    if (usedPlan.has(c.plan.id) || usedPost.has(c.post.id)) return;
    usedPlan.add(c.plan.id); usedPost.add(c.post.id);
    pairs.push({ plan: c.plan, post: c.post });
  });
  return pairs;
}

// Fold each plan into its posted video, then delete the plan.
// meta: the whole contentmeta map; returns the updated map (caller saves it once).
export async function applyPlanMatches(pairs, meta, store) {
  const next = { ...meta };
  for (const { plan, post } of pairs) {
    const fromPlan = {};
    for (const f of PLAN_FIELDS) if (plan[f]) fromPlan[f] = plan[f];
    const existing = next[post.id] || {};
    next[post.id] = { ...fromPlan, ...Object.fromEntries(Object.entries(existing).filter(([, v]) => v)),
      plan_title: plan.title, plan_merged_at: new Date().toISOString().slice(0, 10) };
    const patch = {};
    if (!post.caption && (plan.caption || plan.title)) patch.caption = ['Plan: ' + plan.title, plan.caption].filter(Boolean).join('\n\n');
    if (!post.campaign_id && plan.campaign_id) patch.campaign_id = plan.campaign_id;
    if (Object.keys(patch).length) await store.updateContent(post.id, patch);
    await store.deleteContent(plan.id);
    delete next[plan.id];
  }
  return next;
}

// Trial reels. Instagram's API leaves a trial reel out until it's shared to followers,
// so meanwhile it lives as a hand-made item ticked "Trial reel" (with its link).
// Once the sync brings in the same reel (same shortcode in the link), the hand-made
// item is folded into the synced one — the label and plan fields move across — and
// the hand-made item is removed, so the reel isn't counted twice.
export const igCode = (u) => { const m = String(u || '').match(/instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : null; };
export function findTrialMatches(contents) {
  const synced = new Map();
  for (const c of contents) if (c.external_id && c.platform === 'instagram' && igCode(c.post_url)) synced.set(igCode(c.post_url), c);
  return contents.filter((c) => c.trial && !c.external_id && igCode(c.post_url) && synced.has(igCode(c.post_url)))
    .map((plan) => ({ plan, post: synced.get(igCode(plan.post_url)) }));
}
export async function applyTrialMatches(pairs, meta, store) {
  const next = { ...meta };
  for (const { plan, post } of pairs) {
    const fromPlan = {};
    for (const f of PLAN_FIELDS) if (plan[f]) fromPlan[f] = plan[f];
    next[post.id] = { ...fromPlan, ...Object.fromEntries(Object.entries(next[post.id] || {}).filter(([, v]) => v)), trial: true, plan_title: plan.title };
    await store.deleteContent(plan.id);
    delete next[plan.id];
  }
  return next;
}
