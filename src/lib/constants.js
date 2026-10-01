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

// Order = the production pipeline, left to right. 'draft' is kept so older posts
// saved before the pipeline stages existed still show a proper badge.
export const STATUSES = [
  { id: 'idea', label: 'Idea' },
  { id: 'draft', label: 'Draft' },
  { id: 'scripting', label: 'Scripting' },
  { id: 'filming', label: 'Filming' },
  { id: 'editing', label: 'Editing' },
  { id: 'ready', label: 'Ready to post' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'takedown', label: 'Take down' },
];

// Statuses that mean "being made" — shown in the Dashboard's production pipeline
// and flagged when they slip past their planned date.
export const PRODUCTION_STATUSES = ['scripting', 'filming', 'editing', 'ready'];

export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

export const FORMATS = [
  { id: 'feed', label: 'Feed post' },
  { id: 'reel', label: 'Reel' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'story', label: 'Story' },
  { id: 'video', label: 'Video' },
];

// Marketing-funnel stages. Shared by the Content Funnel inspo library, the post
// form (each post can be tagged with a stage) and the funnel breakdown in reports.
export const FUNNELS = [
  { id: 'top', emoji: '🔝', name: 'Top Funnel', tag: 'Awareness', accent: '#2f6df6',
    desc: 'Reach new people — scroll-stopping hooks, trends, and relatable skits that get discovered.' },
  { id: 'middle', emoji: '🎯', name: 'Middle Funnel', tag: 'Consideration', accent: '#e0a419',
    desc: 'Build trust — product education, demos, behind-the-scenes, and testimonials.' },
  { id: 'bottom', emoji: '🛒', name: 'Bottom Funnel', tag: 'Conversion', accent: '#0f9d58',
    desc: 'Drive action — offers, reviews, urgency, and clear calls-to-action to buy.' },
];

export const FUNNEL_LABEL = Object.fromEntries(FUNNELS.map((f) => [f.id, f.name]));

// Starter suggestions for the post form's free-text pickers. Anything typed
// before is suggested too, so these just help on day one.
export const PILLAR_SUGGESTIONS = ['Testimonial', 'Education', 'Behind the scenes', 'Promo / offer', 'Trend / entertainment', 'Confinement care'];

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
