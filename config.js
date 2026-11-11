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

  // Instagram connection via Facebook Login for Business (Meta app "Serigama
  // Content Planner"). Non-secret — the app SECRET lives only in Supabase.
  instagram: {
    appId: '1784689132823597',
    configId: '1422746343402021', // login configuration "Planner Instagram read" (read-only permissions)
    redirectUri: 'https://acfscrvvlzjtbsxturkx.supabase.co/functions/v1/instagram-callback',
    authorizeUrl: 'https://www.facebook.com/v25.0/dialog/oauth',
  },
};
