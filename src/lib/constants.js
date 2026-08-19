// Shared vocabulary for the app: platforms, content statuses, formats, and the
// palette used for campaign colour dots.

export const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', short: 'TT' },
  { id: 'instagram', label: 'Instagram', short: 'IG' },
  { id: 'youtube', label: 'YouTube', short: 'YT' },
  { id: 'facebook', label: 'Facebook', short: 'FB' },
  { id: 'threads', label: 'Threads', short: 'TH' },
];

export const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.label]));

export const STATUSES = [
  { id: 'idea', label: 'Idea' },
  { id: 'draft', label: 'Draft' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'takedown', label: 'Take down' },
];

export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

export const FORMATS = [
  { id: 'feed', label: 'Feed post' },
  { id: 'reel', label: 'Reel' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'story', label: 'Story' },
  { id: 'video', label: 'Video' },
];

// Distinct, legible dot colours for campaigns (assigned when a campaign is created).
export const CAMPAIGN_COLORS = [
  '#0EA5A4', // teal
  '#EF4444', // red
  '#22C55E', // green
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#3B82F6', // blue
  '#14B8A6', // emerald
];
