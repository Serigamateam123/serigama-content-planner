// Pure derivations used by the Dashboard and Analytics screens. Everything here
// takes plain arrays of content and returns numbers/objects — no I/O.

import { startOfMonth, endOfMonth, startOfDay, addDays, dayKey, parse, isSameMonth } from './date.js';
import { PRODUCTION_STATUSES, FUNNELS } from './constants.js';

export function engagementOf(m) {
  if (!m) return 0;
  if (m.engagement != null) return Number(m.engagement) || 0;
  return (Number(m.likes) || 0) + (Number(m.comments) || 0) + (Number(m.shares) || 0);
}

export function erOf(m) {
  if (!m) return 0;
  if (m.engagement_rate != null) return Number(m.engagement_rate) || 0;
  const reach = Number(m.reach) || 0;
  if (!reach) return 0;
  return (engagementOf(m) / reach) * 100;
}

const round1 = (n) => Math.round(n * 10) / 10;

// 14 -> "2 PM", 0 -> "12 AM".
function fmtHour(h) {
  const ap = h < 12 ? 'AM' : 'PM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return hr + ' ' + ap;
}

// Pull #hashtags out of a caption/title, lowercased and de-duped by caller.
export function extractHashtags(title) {
  const out = [];
  const re = /#([\p{L}\p{N}_]+)/gu;
  let m;
  while ((m = re.exec(title || ''))) out.push('#' + m[1].toLowerCase());
  return out;
}

// Aggregate performance per hashtag across published posts (with metrics).
export function hashtagStats(published, limit = 12) {
  const map = new Map();
  for (const c of published) {
    if (!c.metrics) continue;
    for (const t of new Set(extractHashtags(c.title))) {
      const e = map.get(t) || { tag: t, posts: 0, views: 0, er: 0 };
      e.posts++;
      e.views += Number(c.metrics.views) || 0;
      e.er += erOf(c.metrics);
      map.set(t, e);
    }
  }
  return [...map.values()]
    .map((e) => ({ tag: e.tag, posts: e.posts, totalViews: e.views, avgViews: Math.round(e.views / e.posts), avgER: round1(e.er / e.posts) }))
    .sort((a, b) => b.totalViews - a.totalViews)
    .slice(0, limit);
}

// Deep engagement breakdown for the Engagement section: which posts drive the
// valuable engagement (shares/comments/saves), hidden gems, topics, ER trend.
export function engagementExtras(published) {
  const out = { topShared: [], topCommented: [], topSaved: [], hiddenGems: [], topics: [], monthlyER: [] };
  if (!published || !published.length) return out;
  const views = (c) => Number(c.metrics.views) || 0;
  const shares = (c) => Number(c.metrics.shares) || 0;
  const comments = (c) => Number(c.metrics.comments) || 0;
  const saves = (c) => Number(c.saves) || 0;
  const sortedV = published.map(views).sort((a, b) => a - b);
  const median = sortedV[Math.floor(sortedV.length / 2)] || 0;

  out.topShared = [...published].filter((c) => shares(c) > 0).sort((a, b) => shares(b) - shares(a)).slice(0, 3);
  out.topCommented = [...published].filter((c) => comments(c) > 0).sort((a, b) => comments(b) - comments(a)).slice(0, 3);
  out.topSaved = [...published].filter((c) => saves(c) > 0).sort((a, b) => saves(b) - saves(a)).slice(0, 3);
  out.hiddenGems = [...published].filter((c) => views(c) > 0 && views(c) <= median && erOf(c.metrics) > 0)
    .sort((a, b) => erOf(b.metrics) - erOf(a.metrics)).slice(0, 3);

  const map = new Map();
  for (const c of published) for (const t of new Set(extractHashtags(c.title))) {
    const e = map.get(t) || { tag: t, er: 0, posts: 0 };
    e.er += erOf(c.metrics); e.posts++; map.set(t, e);
  }
  out.topics = [...map.values()].filter((e) => e.posts >= 3)
    .map((e) => ({ tag: e.tag, avgER: round1(e.er / e.posts), posts: e.posts }))
    .sort((a, b) => b.avgER - a.avgER).slice(0, 5);

  const mm = new Map();
  for (const c of published) {
    const d = parse(c.published_at);
    if (!d) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const e = mm.get(k) || { sum: 0, num: 0 };
    e.sum += erOf(c.metrics); e.num++; mm.set(k, e);
  }
  out.monthlyER = [...mm.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, e]) => ({ key: k, er: round1(e.sum / e.num) }));
  return out;
}

// --- Follower growth -------------------------------------------------------

// Normalise account_stats snapshots into a clean, ascending follower series.
export function followerSeries(stats) {
  return (stats || [])
    .filter((s) => s.follower_count != null)
    .map((s) => ({ day: s.day, followers: Number(s.follower_count) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Current follower count, gain within an optional {from,to} window, and the
// full series shaped for TrendChart. Returns null when there are no snapshots.
export function followerGrowth(stats, range = null) {
  const s = followerSeries(stats);
  if (s.length === 0) return null;
  let inRange = s;
  if (range && (range.from || range.to)) {
    inRange = s.filter((p) => {
      const d = parse(p.day);
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });
  }
  const window = inRange.length ? inRange : s;
  return {
    current: s[s.length - 1].followers,
    gained: window[window.length - 1].followers - window[0].followers,
    points: s.map((p) => ({ key: p.day, value: p.followers })),
    days: s.length,
  };
}

// Estimate followers gained per video: the day-over-day follower delta on each
// post's day, split across posts that shared that day. Only fills in once there
// are at least two daily snapshots — TikTok gives no true per-video attribution.
export function followersGainedPerVideo(published, stats) {
  const out = new Map();
  const s = followerSeries(stats);
  if (s.length < 2) return out;
  const deltaByDay = new Map();
  for (let i = 1; i < s.length; i++) deltaByDay.set(s[i].day, s[i].followers - s[i - 1].followers);
  const vidsByDay = new Map();
  for (const c of published) {
    const d = parse(c.published_at);
    if (d) vidsByDay.set(dayKey(d), (vidsByDay.get(dayKey(d)) || 0) + 1);
  }
  for (const c of published) {
    const d = parse(c.published_at);
    if (!d) continue;
    const k = dayKey(d);
    if (deltaByDay.has(k)) out.set(c.id, Math.round(deltaByDay.get(k) / (vidsByDay.get(k) || 1)));
  }
  return out;
}

// --- Dashboard -------------------------------------------------------------

export function dashboard(contents, now = new Date(), range = null) {
  // Every date-based tile uses this same range, so the whole overview is consistent.
  const from = range && range.from ? parse(range.from) : null;
  const to = range && range.to ? parse(range.to) : null;
  const inRange = (v) => {
    if (!from && !to) return true; // "All time"
    const d = parse(v);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  const thisMonth = contents.filter((c) => inRange(c.published_at) || inRange(c.scheduled_at));
  const publishedThisMonth = contents.filter((c) => c.status === 'published' && inRange(c.published_at));
  const scheduled = contents.filter((c) => c.status === 'scheduled' && inRange(c.scheduled_at));
  const ideas = contents.filter((c) => c.status === 'idea'); // dateless backlog — never range-filtered

  // Avg engagement now follows the same range, and its list shows per-post analytics.
  const publishedWithMetrics = publishedThisMonth
    .filter((c) => c.metrics)
    .sort((a, b) => (Number(b.metrics.views) || 0) - (Number(a.metrics.views) || 0));
  let sumEng = 0;
  let sumViews = 0;
  let sumLikes = 0;
  let sumComments = 0;
  let sumShares = 0;
  for (const c of publishedWithMetrics) {
    sumEng += engagementOf(c.metrics);
    sumViews += Number(c.metrics.views) || 0;
    sumLikes += Number(c.metrics.likes) || 0;
    sumComments += Number(c.metrics.comments) || 0;
    sumShares += Number(c.metrics.shares) || 0;
  }
  const avgER = sumViews ? round1((sumEng / sumViews) * 100) : 0;

  // Scoreboard: the big totals a manager wants at a glance.
  const scoreboard = {
    posts: publishedWithMetrics.length,
    views: sumViews,
    likes: sumLikes,
    comments: sumComments,
    shares: sumShares,
    engagement: sumEng,
  };

  // Period-over-period: compare this window against the same-length window right before it.
  let comparison = null;
  if (from && to) {
    const spanMs = to - from;
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    const prevPub = contents.filter((c) => {
      if (c.status !== 'published' || !c.metrics) return false;
      const dt = parse(c.published_at);
      return dt && dt >= prevFrom && dt <= prevTo;
    });
    let pViews = 0;
    let pEng = 0;
    for (const c of prevPub) {
      pViews += Number(c.metrics.views) || 0;
      pEng += engagementOf(c.metrics);
    }
    const pER = pViews ? round1((pEng / pViews) * 100) : 0;
    comparison = {
      curViews: sumViews,
      prevViews: pViews,
      viewsPct: pViews ? Math.round(((sumViews - pViews) / pViews) * 100) : null,
      curER: avgER,
      prevER: pER,
      erDelta: round1(avgER - pER),
      curPosts: publishedWithMetrics.length,
      prevPosts: prevPub.length,
    };
  }

  // Past its planned date but not posted: scheduled, or still mid-production.
  const overdue = contents.filter(
    (c) => (c.status === 'scheduled' || PRODUCTION_STATUSES.includes(c.status)) && parse(c.scheduled_at) && parse(c.scheduled_at) < now
  );
  const missingCaption = contents.filter((c) => c.status === 'scheduled' && !c.has_final_caption);

  const in7 = addDays(startOfDay(now), 7);
  const next7 = contents
    .filter((c) => {
      const d = parse(c.scheduled_at);
      return d && d >= startOfDay(now) && d < in7 && c.status !== 'published' && c.status !== 'takedown';
    })
    .sort((a, b) => parse(a.scheduled_at) - parse(b.scheduled_at));

  return {
    contentThisMonth: thisMonth.length,
    scheduledCount: scheduled.length,
    publishedThisMonth: publishedThisMonth.length,
    ideasCount: ideas.length,
    avgER,
    lists: { month: thisMonth, scheduled, published: publishedThisMonth, ideas, engagement: publishedWithMetrics },
    scoreboard,
    comparison,
    engNotes: engagementNotes(publishedWithMetrics),
    overdue,
    missingCaption,
    actionNeeded: overdue.length + missingCaption.length,
    next7,
    pipeline: pipelineOf(contents),
  };
}

// Posts at each production stage (not date-filtered — it's the live work queue).
const PIPELINE_STAGES = ['idea', 'scripting', 'filming', 'editing', 'ready', 'scheduled'];
function pipelineOf(contents) {
  return PIPELINE_STAGES.map((id) => ({
    id,
    items: contents
      .filter((c) => c.status === id || (id === 'idea' && c.status === 'draft'))
      .sort((a, b) => (parse(a.scheduled_at) || 8e15) - (parse(b.scheduled_at) || 8e15)),
  }));
}

// Auto-generated, plain-language notes about performance — things to act on.
function engagementNotes(published) {
  const notes = [];
  if (!published || published.length < 2) return notes;
  const n = published.length;
  const clip = (t) => { t = (t || '').trim(); return t.length > 44 ? t.slice(0, 44) + '…' : t; };
  const views = (c) => Number(c.metrics.views) || 0;
  const shares = (c) => Number(c.metrics.shares) || 0;

  const byViews = [...published].sort((a, b) => views(b) - views(a));
  const top = byViews[0];
  const avgViews = Math.round(published.reduce((s, c) => s + views(c), 0) / n);
  const avgErVal = round1(published.reduce((s, c) => s + erOf(c.metrics), 0) / n);

  // Best engagement rate, ignoring tiny-view outliers that can inflate ER.
  const erPool = published.filter((c) => views(c) >= avgViews * 0.15);
  const bestEr = (erPool.length ? erPool : published).slice().sort((a, b) => erOf(b.metrics) - erOf(a.metrics))[0];
  const mostShared = [...published].sort((a, b) => shares(b) - shares(a))[0];

  notes.push(`🏆 Top post: “${clip(top.title)}” — ${compact(views(top))} views, ${round1(erOf(top.metrics))}% ER. Make more like this.`);

  // Trend: recent posts vs earlier ones, by date.
  const byDate = published.filter((c) => c.published_at).sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  if (byDate.length >= 4) {
    const half = Math.floor(byDate.length / 2);
    const avg = (arr) => arr.reduce((s, c) => s + views(c), 0) / arr.length;
    const older = avg(byDate.slice(0, half));
    const recent = avg(byDate.slice(half));
    const pct = older ? Math.round(((recent - older) / older) * 100) : 0;
    if (pct >= 10) notes.push(`📈 Trending up — recent posts average ${compact(Math.round(recent))} views vs ${compact(Math.round(older))} before (+${pct}%). Keep leaning into what’s working.`);
    else if (pct <= -10) notes.push(`📉 Cooling off — recent posts average ${compact(Math.round(recent))} views vs ${compact(Math.round(older))} before (${pct}%). Try a fresh hook or format.`);
    else notes.push(`➡️ Fairly steady views lately — a bolder first-2-seconds hook could break the plateau.`);
  }

  // Best day + time to post, by average views (uses parse() so the weekday/hour is
  // read in the local timezone, not UTC).
  const withDate = published.filter((c) => parse(c.published_at));
  if (withDate.length >= 3) {
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const days = {};
    const hours = {};
    for (const c of withDate) {
      const dt = parse(c.published_at);
      (days[dt.getDay()] = days[dt.getDay()] || { sum: 0, n: 0 }).sum += views(c);
      days[dt.getDay()].n++;
      (hours[dt.getHours()] = hours[dt.getHours()] || { sum: 0, n: 0 }).sum += views(c);
      hours[dt.getHours()].n++;
    }
    if (Object.keys(days).length >= 2) {
      const best = Object.entries(days)
        .map(([d, v]) => ({ d: Number(d), avg: v.sum / v.n }))
        .sort((a, b) => b.avg - a.avg)[0];
      notes.push(`📅 Best day to post: ${DOW[best.d]} — averages ${compact(Math.round(best.avg))} views. Schedule your strongest content then.`);
    }
    const hrPool = Object.entries(hours).filter(([, v]) => v.n >= 2);
    if (hrPool.length >= 2) {
      const bh = hrPool
        .map(([h, v]) => ({ h: Number(h), avg: v.sum / v.n }))
        .sort((a, b) => b.avg - a.avg)[0];
      notes.push(`🕐 Best time to post: around ${fmtHour(bh.h)} — posts then average ${compact(Math.round(bh.avg))} views.`);
    }
  }

  if (bestEr && bestEr !== top) {
    notes.push(`🎯 Most engaging: “${clip(bestEr.title)}” at ${round1(erOf(bestEr.metrics))}% ER — this style really connects. Worth repeating.`);
  }
  if (mostShared && shares(mostShared) > 0) {
    notes.push(`🔁 Most shared: “${clip(mostShared.title)}” — ${compact(shares(mostShared))} shares. Shareable content reaches new audiences; note the topic/format.`);
  }

  // What to stop doing — flag a clear underperformer so it isn't repeated.
  if (n >= 3) {
    const worst = byViews[byViews.length - 1];
    if (worst && worst !== top && views(worst) < avgViews * 0.5) {
      notes.push(`⚠️ Weakest post: “${clip(worst.title)}” — only ${compact(views(worst))} views (well below your ${compact(avgViews)} average). Rethink this hook/topic before repeating it.`);
    }
  }

  let avgLine = `📊 On average: ${compact(avgViews)} views and ${avgErVal}% engagement per post.`;
  if (avgErVal >= 6) avgLine += ' That engagement rate is strong for TikTok — nice work.';
  else if (avgErVal < 3) avgLine += ' Add a clearer call-to-action and a stronger opening to lift engagement.';
  notes.push(avgLine);

  return notes;
}

// --- Period (Studio-style) metrics from daily snapshots --------------------
// TikTok gives only lifetime cumulative counts per video. By snapshotting those
// daily (content_metrics rows) we can measure what actually happened inside a
// date window — cumulative(end) − cumulative(just-before-start) — which matches
// how TikTok Studio reports "views in the last N days". Accrues going forward.

// Group snapshot rows into an ascending per-content time series.
export function metricsSeries(history) {
  const byContent = new Map();
  for (const m of history || []) {
    const arr = byContent.get(m.content_id) || [];
    arr.push(m);
    byContent.set(m.content_id, arr);
  }
  for (const arr of byContent.values()) {
    arr.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));
  }
  return byContent;
}

// The latest snapshot at or before a given time (null if none exists yet).
function snapAtOrBefore(series, atTime) {
  let found = null;
  for (const m of series) {
    if (new Date(m.fetched_at) <= atTime) found = m;
    else break;
  }
  return found;
}

// Distinct calendar days present in the snapshot history — tells us how much
// history has accrued (Studio-mode only becomes meaningful at >= 2).
export function daysOfHistory(history) {
  const days = new Set();
  for (const m of history || []) {
    const d = parse(m.fetched_at);
    if (d) days.add(dayKey(d));
  }
  return days.size;
}

// Views/likes/comments/shares that HAPPENED within [from,to], per content and
// summed, from the snapshot deltas. `from`/`to` are Date objects (or null).
export function periodMetrics(contents, history, from, to) {
  const byContent = metricsSeries(history);
  const endTime = to || new Date(8640000000000000); // "now-ish" upper bound
  const startBound = from ? new Date(from.getTime() - 1) : null; // just before window
  const perVideo = new Map();
  let views = 0, likes = 0, comments = 0, shares = 0, postsWithData = 0;
  for (const c of contents) {
    const series = byContent.get(c.id);
    if (!series || !series.length) continue;
    const endS = snapAtOrBefore(series, endTime);
    if (!endS) continue;
    const startS = startBound ? snapAtOrBefore(series, startBound) : null;
    const g = (f) => Math.max(0, (Number(endS[f]) || 0) - (startS ? Number(startS[f]) || 0 : 0));
    const dv = g('views'), dl = g('likes'), dc = g('comments'), ds = g('shares');
    perVideo.set(c.id, { views: dv, likes: dl, comments: dc, shares: ds, engagement: dl + dc + ds });
    views += dv; likes += dl; comments += dc; shares += ds;
    if (dv > 0) postsWithData++;
  }
  const engagement = likes + comments + shares;
  return {
    views, likes, comments, shares, engagement,
    er: views ? round1((engagement / views) * 100) : 0,
    postsWithData, perVideo,
    days: daysOfHistory(history),
  };
}

// Views that accrued per time bucket, from snapshot-to-snapshot deltas — the
// Studio-style "views over time" trend. The gain between two snapshots is spread
// EVENLY across every day in the gap, so a day with no snapshot doesn't read 0
// with the next snapshot day spiking — it plateaus instead (a smoothed estimate
// for untracked days; becomes exact once daily snapshots run every day).
// Pass `contents` so a video posted after tracking began also counts the views it
// got before its first snapshot (spread from its publish day to that snapshot's
// day) — otherwise a video that pops on day one is badly undercounted. Videos
// posted before tracking began are skipped: their first snapshot is lifetime views.
export function periodTrend(history, grain, contents = null) {
  const byContent = metricsSeries(history);
  const daily = new Map(); // dayKey -> views gained that day (smoothed)
  const spread = (from, to, total) => {
    const days = Math.max(0, Math.round((startOfDay(to) - startOfDay(from)) / 86400000));
    for (let d = 0; d <= days; d++) {
      const k = dayKey(addDays(startOfDay(from), d));
      daily.set(k, (daily.get(k) || 0) + total / (days + 1));
    }
  };
  if (contents && byContent.size) {
    const pubOf = new Map(contents.map((c) => [c.id, parse(c.published_at)]));
    let firstTracked = null;
    for (const series of byContent.values()) {
      const t = parse(series[0].fetched_at);
      if (t && (!firstTracked || t < firstTracked)) firstTracked = t;
    }
    const trackingStart = firstTracked ? startOfDay(firstTracked) : null;
    for (const [id, series] of byContent) {
      const pub = pubOf.get(id);
      const first = series[0];
      const at = parse(first.fetched_at);
      const v = Number(first.views) || 0;
      if (pub && at && trackingStart && v > 0 && startOfDay(pub) >= trackingStart && pub <= at) spread(pub, at, v);
    }
  }
  for (const series of byContent.values()) {
    for (let i = 1; i < series.length; i++) {
      const gain = Math.max(0, (Number(series[i].views) || 0) - (Number(series[i - 1].views) || 0));
      if (!gain) continue;
      const start = parse(series[i - 1].fetched_at);
      const end = parse(series[i].fetched_at);
      if (!start || !end) continue;
      const days = Math.max(1, Math.round((startOfDay(end) - startOfDay(start)) / 86400000));
      const per = gain / days;
      for (let d = 1; d <= days; d++) {
        const k = dayKey(addDays(startOfDay(start), d));
        daily.set(k, (daily.get(k) || 0) + per);
      }
    }
  }
  // Aggregate the smoothed daily series up to the requested grain.
  const keyFor = (dk) => {
    const x = parse(dk);
    if (grain === 'daily') return dk;
    if (grain === 'weekly') {
      const dow = (x.getDay() + 6) % 7;
      return dayKey(addDays(startOfDay(x), -dow));
    }
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  };
  const buckets = new Map();
  for (const [dk, v] of daily) {
    const k = keyFor(dk);
    buckets.set(k, (buckets.get(k) || 0) + v);
  }
  const sorted = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, Math.round(v)]);
  const entries = fillGaps(sorted, grain);
  return entries.map(([k, v]) => ({ key: k, value: v }));
}

// --- Analytics -------------------------------------------------------------

export function applyFilters(contents, f) {
  return contents.filter((c) => {
    if (f.funnel && f.funnel !== 'all' && (f.funnel === 'none' ? c.funnel_stage : c.funnel_stage !== f.funnel)) return false;
    if (f.account_id && f.account_id !== 'all' && c.account_id !== f.account_id) return false;
    if (f.platform && f.platform !== 'all' && c.platform !== f.platform) return false;
    if (f.hashtag && !extractHashtags(c.title).includes(f.hashtag)) return false;
    const d = parse(c.published_at || c.scheduled_at);
    if (f.from && d && d < startOfDay(parse(f.from))) return false;
    // Include the whole `to` day (up to but not including the next day's start).
    if (f.to && d && d >= addDays(startOfDay(parse(f.to)), 1)) return false;
    return true;
  });
}

export function analytics(contents, f = {}, stats = []) {
  const filtered = applyFilters(contents, f);
  const published = filtered.filter((c) => c.status === 'published' && c.metrics);

  let totalReach = 0;
  let totalEngagement = 0;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  const byPlatform = {};
  for (const c of published) {
    const m = c.metrics;
    totalReach += Number(m.reach) || 0;
    totalEngagement += engagementOf(m);
    totalViews += Number(m.views) || 0;
    totalLikes += Number(m.likes) || 0;
    totalComments += Number(m.comments) || 0;
    totalShares += Number(m.shares) || 0;
    byPlatform[c.platform] = (byPlatform[c.platform] || 0) + (Number(m.views) || Number(m.reach) || 0);
  }
  // Engagement rate is measured against reach when available, else views (TikTok gives views, not reach).
  const erBase = totalReach || totalViews;
  const avgER = erBase ? round1((totalEngagement / erBase) * 100) : 0;
  const bestPlatform = Object.entries(byPlatform).sort((a, b) => b[1] - a[1])[0];

  return {
    published,
    totalReach,
    totalEngagement,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    avgER,
    publishedCount: published.length,
    bestPlatform: bestPlatform ? bestPlatform[0] : null,
    scoreboard: { posts: published.length, views: totalViews, likes: totalLikes, comments: totalComments, shares: totalShares, engagement: totalEngagement },
    engNotes: engagementNotes(published),
    hashtags: hashtagStats(published),
    followerGrowth: followerGrowth(stats, {
      from: f.from ? startOfDay(parse(f.from)) : null,
      to: f.to ? parse(f.to) : null,
    }),
    followerGain: followersGainedPerVideo(published, stats),
    trend: trend(published, f.grain || 'monthly'),
  };
}

// Performance of published posts grouped by a planning field (funnel_stage,
// pillar, product). Untagged posts are grouped last so it's clear how much of
// the account isn't tagged yet.
export function breakdownBy(published, field) {
  const groups = new Map();
  for (const c of published) {
    const raw = (c[field] || '').trim();
    const k = raw || '__none';
    const g = groups.get(k) || { key: k, posts: 0, views: 0, engagement: 0 };
    g.posts++;
    g.views += Number(c.metrics && c.metrics.views) || 0;
    g.engagement += engagementOf(c.metrics);
    groups.set(k, g);
  }
  const label = (k) => (k === '__none' ? 'Not tagged' : field === 'funnel_stage' ? ((FUNNELS.find((f) => f.id === k) || {}).name || k) : k);
  const order = field === 'funnel_stage' ? (k) => { const i = FUNNELS.findIndex((f) => f.id === k); return i < 0 ? 99 : i; } : null;
  return [...groups.values()]
    .map((g) => ({ ...g, label: label(g.key), avgViews: Math.round(g.views / g.posts), er: g.views ? round1((g.engagement / g.views) * 100) : 0 }))
    .sort((a, b) => (a.key === '__none') - (b.key === '__none') || (order ? order(a.key) - order(b.key) : b.views - a.views));
}

// Group published content into time buckets summing views, for the line chart.
export function trend(published, grain) {
  const buckets = new Map();
  const keyFor = (d) => {
    const x = parse(d);
    if (!x) return null;
    if (grain === 'daily') return dayKey(x);
    if (grain === 'weekly') {
      const wk = startOfDay(x);
      const dow = (wk.getDay() + 6) % 7;
      return dayKey(addDays(wk, -dow));
    }
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; // monthly
  };
  for (const c of published) {
    const k = keyFor(c.published_at);
    if (!k) continue;
    buckets.set(k, (buckets.get(k) || 0) + (Number(c.metrics.views) || 0));
  }
  const entries = fillGaps([...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), grain);
  return entries.map(([k, v]) => ({ key: k, value: v }));
}

// Daily/weekly: fill in the gaps so the x-axis is an even day-by-day (or
// week-by-week) timeline instead of jumping between dates. Empty buckets show 0.
// Capped so an all-time daily view can't explode the point count.
function fillGaps(entries, grain) {
  if ((grain !== 'daily' && grain !== 'weekly') || entries.length < 2) return entries;
  const step = grain === 'weekly' ? 7 : 1;
  const first = parse(entries[0][0]);
  const last = parse(entries[entries.length - 1][0]);
  if (!first || !last) return entries;
  const spanSteps = Math.round((last - first) / 86400000) / step;
  if (spanSteps > 400) return entries;
  const map = new Map(entries);
  const out = [];
  for (let d = new Date(first); d <= last; d = addDays(d, step)) {
    const k = dayKey(d);
    out.push([k, map.get(k) || 0]);
  }
  return out;
}

// Ceiling & floor for a set of posts (usually the ones published in one month):
// ceiling = the best post's views ("how big can one video pop?"), floor = the
// median post's views ("what does a normal video get?"). The median is used
// rather than the lowest post so one fluke (or a post that's a day old) can't
// drag it down. Only posts with numbers count. Null when there are none.
export function ceilingFloor(posts) {
  const withViews = (posts || []).filter((c) => c.metrics).map((c) => ({ c, v: Number(c.metrics.views) || 0 }));
  if (!withViews.length) return null;
  withViews.sort((a, b) => b.v - a.v);
  const vs = withViews.map((x) => x.v);
  const mid = Math.floor(vs.length / 2);
  const floor = vs.length % 2 ? vs[mid] : Math.round((vs[mid - 1] + vs[mid]) / 2);
  return { ceiling: vs[0], ceilingPost: withViews[0].c, floor, count: vs.length };
}

// Compact number formatting: 1912700 -> "1.9M", 171160 -> "171.2K".
export function compact(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return round1(n / 1_000_000) + 'M';
  if (n >= 1_000) return round1(n / 1_000) + 'K';
  return String(n);
}

export function withThousands(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}
