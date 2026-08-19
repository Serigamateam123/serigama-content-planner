// ─────────────────────────────────────────────────────────────────────────
//  Serigama Content Planner — configuration
// ─────────────────────────────────────────────────────────────────────────
//
//  Leave these blank to run in LOCAL DEMO MODE (data saved in this browser,
//  no account needed — great for trying it out).
//
//  To turn on CLOUD SYNC (access from any device), paste your Supabase project
//  URL and anon key below. See README.md for the 10-minute setup.
//
//  The anon key is SAFE to expose here — it only allows access permitted by the
//  database's Row Level Security policies (each user sees only their own rows).
//
window.PLANNER_CONFIG = {
  supabaseUrl: 'https://acfscrvvlzjtbsxturkx.supabase.co',
  supabaseAnonKey: 'sb_publishable_Zywb6MJKBGSEah1PrFzUrg_eUCX0v1i',

  // Cosmetic: shown in the sidebar.
  brandName: 'Serigama',
  ownerName: 'Serigama',
  ownerRole: 'Social media',

  // TikTok connection (all non-secret — the client SECRET lives only in Supabase).
  tiktok: {
    clientKey: 'sbawyzcj7tu5xjf4x1',
    scopes: 'user.info.basic,user.info.stats,video.list',
    redirectUri: 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/tiktok-callback',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    syncFnUrl: 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/tiktok-sync',
  },
};
