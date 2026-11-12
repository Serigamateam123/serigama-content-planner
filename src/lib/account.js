// Which social account the planner is showing (sidebar switcher), and how
// per-account app_kv keys are named (see DATA-SYNC.md §5).
//
// The PRIMARY account is the login's first TikTok account (serigama.daily). Its
// figures keep their original key names (`serigama.monthly`, …) so nothing moves.
// Every other account (more TikTok accounts, Instagram accounts) stores the same
// figures under `<key>@<account id>`.
// Keys that are already keyed by video / post id are shared by all accounts.

export const PER_ACCOUNT_KEYS = [
  'serigama.monthly',
  'serigama.goal.views',
  'serigama.audience',
  'serigama.monthlyfollowers',
  'serigama.goals',
  'serigama.reports',
  'serigama.targets',
];

export const SOCIAL_PLATFORMS = ['tiktok', 'instagram', 'threads'];
export const PLATFORM_NAME = { tiktok: 'TikTok', instagram: 'Instagram', threads: 'Threads' };

// One colour per connected account (by its order in the switcher), used to tell
// accounts apart in the "All accounts" calendar.
const ACCOUNT_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#10b981', '#8b5cf6', '#ef4444'];
export function accountColor(id, accounts) {
  const i = socialAccounts(accounts).findIndex((a) => a.id === id);
  return ACCOUNT_COLORS[(i < 0 ? 0 : i) % ACCOUNT_COLORS.length];
}

const ACTIVE_KEY = 'serigama.activeAccount'; // per-browser preference only (not in app_kv)
let list = [];
let primaryId = null;
let activeId = null;

// Display order in the switcher / sidebar (asked for 2026-11-11): the HQ accounts on
// top, serigama.daily in the centre, serigama.intern at the bottom. Within a brand,
// Instagram before TikTok; anything else after, oldest first.
const BRAND_ORDER = ['hq', 'daily', 'intern'];
const DISPLAY_ORDER = ['instagram', 'threads', 'tiktok'];
const brandRank = (a) => {
  const h = String(a.handle || a.display_name || '').toLowerCase().replace(/[^a-z]/g, '');
  const i = BRAND_ORDER.findIndex((b) => h.endsWith(b));
  return i < 0 ? BRAND_ORDER.length : i;
};
export function socialAccounts(accounts) {
  return (accounts || [])
    .filter((a) => SOCIAL_PLATFORMS.includes(a.platform))
    .sort((a, b) => brandRank(a) - brandRank(b)
      || DISPLAY_ORDER.indexOf(a.platform) - DISPLAY_ORDER.indexOf(b.platform)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

// Called by the app after each load. Returns the active account id.
export function initAccounts(accounts) {
  list = socialAccounts(accounts);
  // The primary account stays the oldest TikTok account (serigama.daily) whatever the
  // display order: its figures live under the plain `serigama.*` keys.
  const oldestTikTok = list.filter((a) => a.platform === 'tiktok')[0];
  primaryId = oldestTikTok ? oldestTikTok.id : (list[0] ? list[0].id : null);
  let saved = null;
  try { saved = localStorage.getItem(ACTIVE_KEY); } catch (e) { /* not essential */ }
  activeId = list.some((a) => a.id === saved) ? saved : primaryId;
  return activeId;
}

export function setActiveAccount(id) {
  activeId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* not essential */ }
}

export const activeAccountId = () => activeId;
export const primaryAccountId = () => primaryId;
export const loadedAccounts = () => list;

// The active account's platform ('tiktok' | 'instagram'), for wording like
// "from TikTok Studio" vs "from Instagram".
export const activePlatform = () => ((list.find((a) => a.id === activeId) || {}).platform) || 'tiktok';
export const isInstagram = () => activePlatform() === 'instagram';
export const isThreads = () => activePlatform() === 'threads';
// Where the manually-captured / insight figures come from, for labels.
export const insightSource = () => (isInstagram() ? 'Instagram' : isThreads() ? 'Threads' : 'Studio');
export const studioName = () => (isInstagram() ? 'Instagram' : isThreads() ? 'Threads' : 'TikTok Studio');

// The account a row belongs to. Rows tagged with an account outside the switcher,
// or untagged (manual plans, old syncs), count as the primary account's.
export const accountOf = (row) =>
  (row && list.some((a) => a.id === row.account_id) ? row.account_id : primaryId);

// The app_kv key holding `base` for an account (default: the active one).
export function kvKey(base, accountId = activeId) {
  if (!PER_ACCOUNT_KEYS.includes(base) || !accountId || accountId === primaryId) return base;
  return `${base}@${accountId}`;
}

// The base key of a stored key ('serigama.monthly@<id>' → 'serigama.monthly').
export const kvBase = (k) => String(k).split('@')[0];
