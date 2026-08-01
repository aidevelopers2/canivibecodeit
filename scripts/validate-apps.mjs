/* Every app entry is a PR, so the schema check has to be the reviewer that never
   gets tired: shape, vocabularies, and the fields the pages actually read.
   Run with `npm run validate`. No dependencies, on purpose. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, MOAT_TAGS, VERDICTS } from '../src/lib/apps.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'data/apps');

const UNITS = ['flat', 'per-seat', 'usage', 'one-time', 'custom'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrArray = (v) => Array.isArray(v) && v.every((x) => isStr(x));

// Every key every entry carries today. A missing one is a PR that copied an old
// template; the pages read all of them.
const REQUIRED = {
  slug: isStr,
  name: isStr,
  domain: isStr,
  category: isStr,
  subcategory: (v) => v === null || typeof v === 'string',
  tagline: isStr,
  priceMonthly: (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
  pricing: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  verdict: isStr,
  verdictConfidence: isStr,
  verdictSummary: isStr,
  coreLoopDIY: (v) => v === null || typeof v === 'string',
  diyTimeEstimate: (v) => v === null || typeof v === 'string',
  requirements: isStrArray,
  whatYouLose: isStrArray,
  moatTags: (v) => Array.isArray(v),
  moatNotes: (v) => v === null || typeof v === 'string',
  whyPeopleStillPay: (v) => v === null || typeof v === 'string',
  priorArt: (v) => Array.isArray(v),
  pagePriority: (v) => typeof v === 'number' && v >= 1 && v <= 5,
  verifiedOneShot: (v) => typeof v === 'boolean',
  notes: (v) => v === null || typeof v === 'string',
  prompt: isStr,
  promptCurated: (v) => typeof v === 'boolean',
};

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const problems = [];

for (const file of files) {
  const bad = (msg) => problems.push(`${file}: ${msg}`);
  let app;
  try {
    app = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  } catch (err) {
    bad(`invalid JSON — ${err.message}`);
    continue;
  }

  if (app.slug !== path.basename(file, '.json')) {
    bad(`slug "${app.slug}" does not match the filename`);
  }
  for (const [key, ok] of Object.entries(REQUIRED)) {
    if (!(key in app)) bad(`missing "${key}"`);
    else if (!ok(app[key])) bad(`"${key}" has the wrong type or value`);
  }

  if (!(app.verdict in VERDICTS)) {
    bad(`verdict "${app.verdict}" is not one of ${Object.keys(VERDICTS).join(' | ')}`);
  }
  if (!(app.category in CATEGORIES)) {
    bad(`category "${app.category}" is not a key in src/lib/apps.js CATEGORIES`);
  }

  if (Array.isArray(app.moatTags)) {
    if (app.moatTags.length < 1 || app.moatTags.length > 3) {
      bad(`moatTags needs 1–3 tags, found ${app.moatTags.length}`);
    }
    for (const tag of app.moatTags) {
      if (!(tag in MOAT_TAGS)) bad(`moatTags: "${tag}" is not a known moat tag`);
    }
    if (new Set(app.moatTags).size !== app.moatTags.length) bad('moatTags has duplicates');
  }

  if (app.pricing && typeof app.pricing === 'object') {
    if (!UNITS.includes(app.pricing.unit)) {
      bad(`pricing.unit "${app.pricing.unit}" is not one of ${UNITS.join(' | ')}`);
    }
  }

  if (Array.isArray(app.priorArt)) {
    app.priorArt.forEach((p, i) => {
      if (!p || typeof p !== 'object' || !isStr(p.name) || !isStr(p.url)) {
        bad(`priorArt[${i}] needs a name and a url`);
      }
    });
  }
  if (app.relatedSlugs !== undefined && !isStrArray(app.relatedSlugs)) {
    bad('relatedSlugs must be an array of slugs');
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in ${files.length} app files:\n`);
  problems.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

console.log(`✓ ${files.length} app files pass`);
