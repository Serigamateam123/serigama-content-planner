// Realistic sample data for local demo mode, so every screen has something to
// show before the user has entered their own content. Dates are anchored to a
// "today" so the dashboard's this-month / next-7-days / overdue logic lights up.

import { CAMPAIGN_COLORS } from './constants.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));

function iso(y, m, d, hh = 10, mm = 0) {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

function metrics(reach, views, erPct) {
  const engagement = Math.round((reach * erPct) / 100);
  const likes = Math.round(engagement * 0.82);
  const comments = Math.round(engagement * 0.1);
  const shares = engagement - likes - comments;
  return {
    reach,
    views,
    likes,
    comments,
    shares,
    engagement,
    engagement_rate: erPct,
    source: 'manual',
    fetched_at: new Date().toISOString(),
  };
}

export function buildSeed(now = new Date()) {
  const Y = now.getFullYear();

  const accounts = [
    { id: uid(), platform: 'tiktok', handle: '@serigama', display_name: 'Serigama (TikTok)' },
    { id: uid(), platform: 'instagram', handle: '@serigama.my', display_name: 'Serigama (Instagram)' },
    { id: uid(), platform: 'facebook', handle: 'Serigama', display_name: 'Serigama (Facebook)' },
  ];
  const tt = accounts[0].id;
  const ig = accounts[1].id;
  const fb = accounts[2].id;

  const campaignDefs = [
    ['New Arrivals Launch', 24],
    ['Flash Sale', 18],
    ['Customer Reviews', 16],
    ['Product Education', 30],
    ['Brand Story', 12],
  ];
  const campaigns = campaignDefs.map(([name, target], i) => ({
    id: uid(),
    name,
    color: CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length],
    target_count: target,
    start_date: iso(Y, 1, 28),
    end_date: iso(Y, 12, 31),
    status: 'active',
  }));
  const [cLaunch, cSale, cReviews, cEdu, cStory] = campaigns.map((c) => c.id);

  const contents = [];
  const add = (o) => contents.push({ id: uid(), has_final_caption: true, post_url: '', caption: '', ...o });

  // --- Published history, Feb -> Jul, growing views (drives the trend chart) ---
  const monthlyPlan = [
    [2, 4, 22000, 73000, 6.1],
    [3, 5, 26000, 105000, 6.4],
    [4, 6, 31000, 153000, 6.9],
    [5, 6, 42000, 264000, 7.2],
    [6, 7, 58000, 601000, 7.6],
    [7, 6, 71000, 717000, 7.9],
  ];
  const platforms = [
    [tt, 'tiktok', 'reel'],
    [ig, 'instagram', 'carousel'],
    [fb, 'facebook', 'feed'],
  ];
  const campCycle = [cLaunch, cSale, cReviews, cEdu, cStory];
  const titles = [
    'Behind the scenes: how we pack your order',
    'Customer favourite of the week',
    '3 ways to style our bestseller',
    'Unboxing our new arrival',
    'Real review from a happy customer',
    'Flash sale starts tonight — don’t miss it',
    'How to care for your purchase',
    'Meet the team behind Serigama',
  ];
  let ti = 0;
  monthlyPlan.forEach(([month, count, baseReach, totalViews, er], mi) => {
    for (let i = 0; i < count; i++) {
      const [acc, plat, fmt] = platforms[i % platforms.length];
      const reach = Math.round(baseReach * (0.7 + (i / count) * 0.6));
      const views = Math.round((totalViews / count) * (0.7 + (i / count) * 0.6));
      const day = 3 + i * 3;
      add({
        title: titles[ti++ % titles.length],
        platform: plat,
        account_id: acc,
        campaign_id: campCycle[(mi + i) % campCycle.length],
        format: fmt,
        status: 'published',
        scheduled_at: iso(Y, month, Math.min(day, 27), 10 + (i % 6), 0),
        published_at: iso(Y, month, Math.min(day, 27), 10 + (i % 6), 0),
        metrics: metrics(reach, views, er + (i % 3) * 0.1),
      });
    }
  });

  // --- Upcoming this month / next 7 days (scheduled) ---
  const mkFuture = (dayOffset, title, plat, acc, camp, fmt, finalCaption = true) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(11, 0, 0, 0);
    add({
      title,
      platform: plat,
      account_id: acc,
      campaign_id: camp,
      format: fmt,
      status: 'scheduled',
      scheduled_at: d.toISOString(),
      published_at: null,
      metrics: null,
      has_final_caption: finalCaption,
    });
  };
  mkFuture(0, 'New arrival teaser', 'tiktok', tt, cLaunch, 'reel');
  mkFuture(1, 'Weekend flash sale reminder', 'instagram', ig, cSale, 'story', false);
  mkFuture(2, 'Customer review spotlight', 'facebook', fb, cReviews, 'feed');
  mkFuture(3, 'How to choose the right size', 'tiktok', tt, cEdu, 'video', false);
  mkFuture(5, 'Restock announcement', 'instagram', ig, cLaunch, 'carousel');
  mkFuture(6, 'Brand story part 2', 'tiktok', tt, cStory, 'reel', false);

  // --- Overdue (scheduled in the past, not published) -> action needed ---
  const past = new Date(now);
  past.setDate(past.getDate() - 2);
  past.setHours(9, 0, 0, 0);
  add({
    title: 'Payday promo (needs posting!)',
    platform: 'tiktok', account_id: tt, campaign_id: cSale, format: 'reel',
    status: 'scheduled', scheduled_at: past.toISOString(), published_at: null, metrics: null,
    has_final_caption: false,
  });

  // --- Unscheduled backlog (no date) ---
  add({ title: 'Idea: collab with a local creator', platform: 'tiktok', account_id: tt, campaign_id: cStory, format: 'reel', status: 'draft', scheduled_at: null, published_at: null, metrics: null, has_final_caption: false });
  add({ title: 'Infographic: shipping timeline', platform: 'instagram', account_id: ig, campaign_id: cEdu, format: 'carousel', status: 'draft', scheduled_at: null, published_at: null, metrics: null, has_final_caption: false });
  add({ title: 'Testimonial compilation reel', platform: 'tiktok', account_id: tt, campaign_id: cReviews, format: 'reel', status: 'draft', scheduled_at: null, published_at: null, metrics: null, has_final_caption: false });

  return { accounts, campaigns, contents };
}
