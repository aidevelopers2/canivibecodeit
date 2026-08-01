# Contributing an app

Every app on the death list is one JSON file in `data/apps/<slug>.json`, added by PR.
No web form, no account — the repo is the admin panel.

## Schema

```jsonc
{
  "slug": "granola",             // filename must match; lowercase, hyphens
  "name": "Granola",             // display name ("Senja / Testimonial.to" for a pair)
  "domain": "granola.ai",        // primary domain, used to fetch the favicon
  "category": "meeting-notes",   // one of the keys in src/lib/apps.js CATEGORIES
  "subcategory": "meeting transcription + AI notes",  // optional, freeform
  "tagline": "AI meeting notepad ...",                // one line, what the app is
  "priceMonthly": 14,            // typical paid tier, USD/month; null if it varies
  "pricing": {                   // provenance — prices drift, receipts matter
    "plan": "Business", "basis": "monthly per user",
    "unit": "per-seat",          // flat | per-seat | usage | one-time | custom
    "source": "https://www.granola.ai/pricing", "checkedOn": "2026-07-30",
    "confidence": "high", "notes": null, "native": "14 USD"
  },
  "verdict": "yes",              // "yes" | "kinda" | "no"
  "verdictConfidence": "medium", // how sure we are
  "verdictSummary": "One paragraph of honest reasoning shown on the page.",
  "coreLoopDIY": "What the one-shot build actually does, in one sentence.",
  "diyTimeEstimate": "one sitting",   // "one sitting" | "multi-day" | ...
  "requirements": ["OpenAI/Anthropic API key"],  // what the DIY build needs
  "whatYouLose": ["sync across devices"],        // 3–5 honest bullets
  "moatTags": ["execution-polish", "integrations"],  // 1–3, see the list below
  "moatNotes": "polish/sync/collaboration",      // optional freeform aside, null is fine
  "whyPeopleStillPay": "One honest paragraph.",
  "priorArt": [                  // existing open-source alternatives, [] if none
    { "name": "quill", "url": "https://github.com/...", "desc": "open-source alternative" }
  ],
  "relatedSlugs": ["otter-ai"],  // curated related apps (optional)
  "pagePriority": 5,             // 1–5 editorial weight for default ordering
  "verifiedOneShot": false,      // true only with a linked proof repo
  "notes": "One-line editorial for the entry.",
  "prompt": "Build me a ...",    // the one-shot prompt — see prompt rules below
  "promptCurated": true          // false = generated from coreLoopDIY, PRs welcome
}
```

Thin entries are welcome, but every key has to be there — use `null` for the prose
you don't have and `[]` for the lists (`subcategory`, `coreLoopDIY`,
`diyTimeEstimate`, `moatNotes`, `whyPeopleStillPay`, `notes` and `priceMonthly` all
take `null`). `npm run validate` checks the whole dataset and tells you exactly
what's off; CI runs the same check on your PR. Improving a `promptCurated: false`
prompt into a real hand-written one (and flipping the flag) is one of the most
valuable PRs you can send.

`priceMonthly` is the price for **one** seat when `pricing.unit` is `per-seat` — the
site multiplies it by the team size you type in. Pick the unit that matches how the
vendor actually charges: `flat` (one price per month), `per-seat` (per user),
`usage` (metered credits/events), `one-time` (a single purchase), `custom` ("contact
sales"). If a plan is billed yearly, convert to the monthly equivalent and say so in
`pricing.basis`.

Also add the app's favicon as `public/icons/<slug>.png` (64px; a favicon service export
is fine).

## Verdict criteria

- 🟢 **yes** — a competent AI coding agent produces a usable personal version in one
  session, self-hosted or local, no hard third-party dependency (or only trivial API
  keys). The core value survives without the SaaS's network/data moat.
- 🟡 **kinda** — buildable in a weekend but with real gaps (mobile app, sync,
  integrations, OAuth pain). Say what the gaps are.
- 🔴 **not really** — the value IS the network, the data, the infra, or compliance.
  These entries make the site credible: explain *why* it survives, and give the prompt
  for the closest honest consolation build (or say "don't").

## Moat tags

`moatTags` answers one question: structurally, why do people still pay for this
instead of building a replacement? Pick 1–3, strongest first, from this list — don't
invent new ones. `moatNotes` is free text for anything the tags miss.

- `network-effects` — it's better because other people are on it: social graphs,
  communities, respondent pools, audience reach.
- `marketplace-liquidity` — two sides that need each other: buyers and sellers,
  merchants and customers.
- `proprietary-data` — data you can't rebuild: indexes, crawls, live feeds, archives,
  maps, unique datasets.
- `proprietary-models` — custom-trained or frontier models plus the compute and
  inference behind them.
- `switching-costs` — your own accumulated history, config and habits make leaving
  painful, whatever the features are like.
- `integrations` — connector breadth and the endless upkeep: OAuth, calendars, banks,
  plugin ecosystems, platform partnerships.
- `compliance-regulatory` — regulated ground: payments licensing, payroll, tax, KYC,
  HIPAA/SOC2, legal exposure.
- `brand-trust` — people pay because it's *this* vendor: security assurance,
  credibility with counterparties, nobody-got-fired.
- `scale-infra` — infrastructure one person can't match: global hosting, uptime
  guarantees, media pipelines, email deliverability, monitoring fleets.
- `hardware` — physical devices, or data only the vendor's hardware produces.
- `collaboration` — it only pays off when the whole team is on it: shared editing,
  presence, permissions, team workflow.
- `content-rights` — licensed content, music and media rights, curriculum, template
  and asset libraries.
- `execution-polish` — polish, reliability, sync quality, workflow depth, import
  fidelity. This is execution, not structure — it's the moat AI erodes. An entry
  tagged *only* `execution-polish` is saying there's nothing structural left, so be
  honest either way.

## Prompt rules

The prompt is the product. It must be:

- **Genuinely runnable** — someone pastes it into Claude Code / Codex / Cursor in an
  empty folder and gets a working thing. No hand-waving.
- **Opinionated about stack** — pick one; don't offer menus.
- **Explicit about scope** — say what's included AND what's deliberately out.
- **15–30 lines.** If it needs more, the verdict probably isn't "yes".
- **Honest** — no accounts/cloud/telemetry unless the app genuinely needs it; secrets
  go in `.env`; include README/permissions notes where relevant.

## House rules

- Verdicts are editorial and honest — sponsorships never buy verdicts, and vote counts
  are never faked.
- Prices drift: check the app's pricing page when you touch an entry.
- No em dashes in UI copy; use `·`.
- One app per PR keeps review fast.
