import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Resolved from the working directory (the project root in dev and under
// systemd), because import.meta.url points inside dist/ after the build.
const DATA_DIR = process.env.APPS_DIR || path.resolve('data/apps');

export const CATEGORIES = {
  'meeting-notes': { label: 'Meeting notes', emoji: '🎙️' },
  'voice-dictation': { label: 'Dictation', emoji: '🗣️' },
  'link-in-bio': { label: 'Link in bio', emoji: '🔗' },
  'testimonials': { label: 'Testimonials', emoji: '💬' },
  'waitlists': { label: 'Waitlists', emoji: '📋' },
  'screenshots': { label: 'Screenshots', emoji: '🖼️' },
  'og-images': { label: 'OG images', emoji: '🏞️' },
  'uptime': { label: 'Uptime', emoji: '⏱️' },
  'qr-codes': { label: 'QR codes', emoji: '🐯' },
  'cron': { label: 'Cron monitoring', emoji: '⏰' },
  'website-builder': { label: 'Website builders', emoji: '🧱' },
  'analytics': { label: 'Analytics', emoji: '📊' },
  'scheduling': { label: 'Scheduling', emoji: '📅' },
  'social-media': { label: 'Social media', emoji: '🐦' },
  'design': { label: 'Design', emoji: '🎨' },
  'finance-accounting': { label: 'Finance & accounting', emoji: '🧾' },
  'tasks-calendar': { label: 'Tasks & calendar', emoji: '🗓️' },
  'ai-writing': { label: 'AI writing', emoji: '✍️' },
  'dev-tools': { label: 'Dev tools', emoji: '🛠️' },
  'automation': { label: 'Automation', emoji: '🤖' },
  'seo-marketing': { label: 'SEO & marketing', emoji: '📈' },
  'audio-video': { label: 'Audio & video', emoji: '🎬' },
  'notes-knowledge': { label: 'Notes & knowledge', emoji: '🧠' },
  'security': { label: 'Security', emoji: '🔐' },
  'ai-assistant': { label: 'AI assistants', emoji: '✨' },
  'forms': { label: 'Forms', emoji: '📝' },
  'no-code-apps': { label: 'No-code apps', emoji: '🧩' },
  'newsletter': { label: 'Newsletters', emoji: '📮' },
  'creator-commerce': { label: 'Creator commerce', emoji: '🛍️' },
  'personal-finance': { label: 'Personal finance', emoji: '💰' },
  'screen-recording': { label: 'Screen recording', emoji: '📹' },
  'rss-research': { label: 'RSS & research', emoji: '📡' },
  'presentations': { label: 'Presentations', emoji: '🖥️' },
  'hosting': { label: 'Hosting', emoji: '☁️' },
  'community': { label: 'Community', emoji: '👥' },
  'read-it-later': { label: 'Read it later', emoji: '🔖' },
  'bookmarks': { label: 'Bookmarks', emoji: '📌' },
  'tasks': { label: 'Tasks', emoji: '✅' },
  'productivity-utilities': { label: 'Productivity utilities', emoji: '⚙️' },
  'email': { label: 'Email', emoji: '📬' },
  'whiteboard': { label: 'Whiteboards', emoji: '🧑‍🏫' },
  'diagrams': { label: 'Diagrams', emoji: '📐' },
  'ai-image': { label: 'AI images', emoji: '🎆' },
  'ai-video': { label: 'AI video', emoji: '🎞️' },
  'ai-audio': { label: 'AI audio', emoji: '🎧' },
  'ai-search': { label: 'AI search', emoji: '🔍' },
  'databases': { label: 'Databases', emoji: '🗄️' },
  'docs-databases': { label: 'Docs & databases', emoji: '📚' },
  'publishing': { label: 'Publishing', emoji: '📰' },
  'commerce': { label: 'Commerce', emoji: '🛒' },
  'audio': { label: 'Music & audio', emoji: '🎵' },
  'career': { label: 'Career', emoji: '💼' },
  'cloud-storage': { label: 'Cloud storage', emoji: '💾' },
  'crm': { label: 'CRM', emoji: '🤝' },
  'customer-support': { label: 'Customer support', emoji: '🛟' },
  'documents': { label: 'Documents & PDFs', emoji: '📄' },
  'education': { label: 'Education', emoji: '🎓' },
  'generative-media': { label: 'Generative media', emoji: '🪄' },
  'home': { label: 'Home', emoji: '🏠' },
  'hr': { label: 'HR', emoji: '🧑‍💼' },
  'legal': { label: 'Legal', emoji: '⚖️' },
  'localization': { label: 'Localization', emoji: '🌍' },
  'monitoring': { label: 'Monitoring', emoji: '📟' },
  'photo-editing': { label: 'Photo editing', emoji: '📷' },
  'podcasting': { label: 'Podcasting', emoji: '🎤' },
  'project-management': { label: 'Project management', emoji: '🗂️' },
  'reading': { label: 'Reading', emoji: '📖' },
  'sales-outreach': { label: 'Sales outreach', emoji: '📤' },
  'time-tracking': { label: 'Time tracking', emoji: '⏳' },
  'travel': { label: 'Travel', emoji: '✈️' },
  'user-research': { label: 'User research', emoji: '🔬' },
  'video-conferencing': { label: 'Video calls', emoji: '📞' },
  'voice-ai': { label: 'Voice AI', emoji: '🔊' },
  'wellness': { label: 'Wellness', emoji: '🧘' },
  'writing-assistant': { label: 'Writing tools', emoji: '🖋️' },
};

// Why the original survives, structurally. 1–3 per app; the label is what the
// site renders. Single source of truth for rendering and the validator.
export const MOAT_TAGS = {
  'network-effects': 'network effects',
  'marketplace-liquidity': 'marketplace liquidity',
  'proprietary-data': 'proprietary data',
  'proprietary-models': 'proprietary models',
  'switching-costs': 'switching costs',
  'integrations': 'integrations',
  'compliance-regulatory': 'compliance & regulation',
  'brand-trust': 'brand & trust',
  'scale-infra': 'infrastructure scale',
  'hardware': 'hardware',
  'collaboration': 'collaboration',
  'content-rights': 'content & rights',
  'execution-polish': 'execution polish',
};

// One icon per moat tag, the way categories have one. No per-tag colours —
// colour on this site means verdict.
export const MOAT_TAG_EMOJI = {
  'network-effects': '🕸️',
  'marketplace-liquidity': '🏪',
  'proprietary-data': '💎',
  'proprietary-models': '🧠',
  'switching-costs': '⛓️',
  'integrations': '🔌',
  'compliance-regulatory': '🏛️',
  'brand-trust': '🛡️',
  'scale-infra': '🏗️',
  'hardware': '🔩',
  'collaboration': '👥',
  'content-rights': '🎟️',
  'execution-polish': '💅',
};

// What the tag means, in one line. Adapted from the definitions in
// CONTRIBUTING.md, which stay the contributor-facing source.
export const MOAT_TAG_DESCS = {
  'network-effects': "It's better because other people are already on it: graphs, communities, audiences.",
  'marketplace-liquidity': 'Two sides that need each other, and both of them showed up.',
  'proprietary-data': "Data you can't rebuild: indexes, crawls, live feeds, archives, maps.",
  'proprietary-models': 'Custom-trained or frontier models, plus the compute and inference behind them.',
  'switching-costs': 'Your own accumulated history, config and habits make leaving painful.',
  'integrations': 'Connector breadth, and the endless upkeep that keeps every connector working.',
  'compliance-regulatory': 'Regulated ground: licensing, payroll, tax, KYC, HIPAA, real legal exposure.',
  'brand-trust': "People pay because it's this vendor, and nobody got fired for that.",
  'scale-infra': "Infrastructure one person can't match: global hosting, deliverability, uptime, media pipelines.",
  'hardware': "Physical devices, or data only the vendor's hardware produces.",
  'collaboration': 'It only pays off once the whole team is in it: shared editing, presence, permissions.',
  'content-rights': 'Licensed content, media rights, curriculum, template and asset libraries.',
  'execution-polish': 'Polish, reliability, sync quality, import fidelity — execution, not structure.',
};


export const VERDICTS = {
  yes: { label: 'YES', sub: 'one-shottable', color: 'yes' },
  kinda: { label: 'KINDA', sub: 'weekend project', color: 'kinda' },
  no: { label: 'NOT REALLY', sub: "don't bother", color: 'no' },
};

let cache;

export function allApps() {
  if (!cache) {
    cache = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const app = JSON.parse(readFileSync(path.join(DATA_DIR, f), 'utf8'));
        if (app.slug !== path.basename(f, '.json')) {
          throw new Error(`slug "${app.slug}" does not match filename ${f}`);
        }
        return app;
      });
  }
  return cache;
}

export function getApp(slug) {
  return allApps().find((a) => a.slug === slug);
}

export function appsByCategory(cat) {
  return allApps().filter((a) => a.category === cat);
}

export function categoriesInUse() {
  const counts = new Map();
  for (const a of allApps()) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  return Object.entries(CATEGORIES)
    .filter(([slug]) => counts.has(slug))
    .map(([slug, meta]) => ({ slug, ...meta, count: counts.get(slug) }));
}

export function appsByMoat(tag) {
  return allApps().filter((a) => (a.moatTags ?? []).includes(tag));
}

export function moatsInUse() {
  const counts = new Map();
  for (const a of allApps()) {
    for (const t of a.moatTags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Object.entries(MOAT_TAGS)
    .filter(([tag]) => counts.has(tag))
    .map(([tag, label]) => ({ tag, label, emoji: MOAT_TAG_EMOJI[tag], count: counts.get(tag) }))
    .sort((a, b) => b.count - a.count);
}

export function topCategories(n = 11) {
  return categoriesInUse()
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// 3 related apps: the sheet's curated relatedSlugs first, then same category,
// then the best other YES apps by votes.
export function relatedApps(app, votes) {
  const rest = allApps().filter((a) => a.slug !== app.slug);
  const curated = (app.relatedSlugs ?? [])
    .map((s) => rest.find((a) => a.slug === s))
    .filter(Boolean);
  const same = rest.filter(
    (a) => a.category === app.category && !curated.includes(a)
  );
  const others = rest
    .filter((a) => a.category !== app.category && a.verdict === 'yes' && !curated.includes(a))
    .sort((a, b) => (votes?.(b.slug) ?? 0) - (votes?.(a.slug) ?? 0));
  return [...curated, ...same, ...others].slice(0, 3);
}

export function yearlySaving(app) {
  return app.priceMonthly != null ? app.priceMonthly * 12 : null;
}
