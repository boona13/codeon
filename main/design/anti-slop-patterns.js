/**
 * Anti-slop design pattern library.
 *
 * A curated set of concrete design moves distilled from real top-tier work
 * (the reference boards used to author this file). The agent injects a small,
 * coherent SELECTION of these into its system prompt for frontend/UI tasks so
 * generated interfaces commit to one real direction instead of blending the
 * whole grab-bag into the same generic "AI" look every time.
 *
 * --- Data model -----------------------------------------------------------
 * Each entry is one actionable directive with this shape:
 *
 *   {
 *     id:        string                       // stable unique id
 *     kind:      'rule' | 'option'            // see below
 *     group?:    string                       // REQUIRED for options; the
 *                                             // selector picks exactly ONE
 *                                             // option per group per run
 *     appliesTo: PageType[]                   // page types this fits; 'any'
 *                                             // means every page type
 *     moods:     Mood[]                       // moods this expresses; []
 *                                             // means mood-agnostic
 *     directive: string                       // the imperative instruction
 *   }
 *
 * kind:
 *   - 'rule'   = a quality floor that ALWAYS applies (when it matches the page
 *                type). Contrast, spacing scale, real data, etc.
 *   - 'option' = one stylistic choice among mutually-exclusive siblings in the
 *                same `group`. The selector picks ONE per group so two runs
 *                diverge instead of converging on the same composite.
 *
 * Why this beats the old flat list: the old module dumped ~60 directives into
 * every prompt, so the model cherry-picked the most template-able combo and
 * every output looked identical. Here the agent receives every relevant RULE
 * plus exactly one OPTION per applicable group, scoped to the page type and a
 * single coherent mood.
 * --------------------------------------------------------------------------
 */

'use strict';

/**
 * Controlled mood vocabulary (derived from the reference boards, not generic
 * adjectives). A run commits to ONE mood for coherence.
 * @typedef {('technical-dark'|'bold-3d'|'editorial-photo'|'warm-organic'|'friendly-soft'|'brutalist-caps'|'data-dense')} Mood
 */
const MOODS = [
  'technical-dark', // tinted near-black, neon accent, grids, fintech/dev energy
  'bold-3d',        // hero built on a high-fidelity 3D render (chrome/liquid/crystal/organic)
  'editorial-photo',// full-bleed art-directed photography + large display type
  'warm-organic',   // cream/clay/forest off-neutrals, soft serif, wellness/interior
  'friendly-soft',  // light, rounded cards, floating UI chips, pastel accents
  'brutalist-caps', // oversized condensed ALL-CAPS blocks, high energy
  'data-dense',     // analytics: charts, sparklines, heatmaps, semantic colors
];

/**
 * Page archetypes a build can be. Patterns are gated by this so landing-only
 * moves never leak into app/dashboard screens (and vice-versa).
 * @typedef {('landing'|'marketing'|'app'|'dashboard'|'ecommerce'|'mobile'|'docs'|'any')} PageType
 */
const PAGE_TYPES = ['landing', 'marketing', 'app', 'dashboard', 'ecommerce', 'mobile', 'docs', 'any'];

/**
 * Choice groups. For each applicable group the selector picks exactly ONE
 * option per run. Order here controls display order in the prompt.
 */
const GROUPS = [
  'hero',
  'palette-strategy',
  'type-system',
  'layout-rhythm',
  'data-viz',
  'stats-treatment',
];

/** Human labels for groups, used when formatting the prompt block. */
const GROUP_LABELS = {
  hero: 'Hero',
  'palette-strategy': 'Palette',
  'type-system': 'Type',
  'layout-rhythm': 'Layout rhythm',
  'data-viz': 'Data visualization',
  'stats-treatment': 'Stats / metrics',
};

/** One-line description of each mood, shown in the catalog the model chooses from. */
const MOOD_NOTES = {
  'technical-dark': 'tinted near-black, one neon accent, subtle grids; fintech/developer energy',
  'bold-3d': 'hero built around a high-fidelity 3D render (chrome / liquid-metal / crystal / organic)',
  'editorial-photo': 'full-bleed art-directed photography with large display type',
  'warm-organic': 'cream/clay/forest off-neutrals, soft serif; wellness / craft / interior',
  'friendly-soft': 'light, rounded cards, floating UI chips, pastel accents, lowercase headlines',
  'brutalist-caps': 'oversized condensed ALL-CAPS blocks, high energy',
  'data-dense': 'analytics surfaces: charts, sparklines, heatmaps, semantic up/down colors',
};

/**
 * Per-page-type mood bias. When the caller doesn't force a mood, the selector
 * picks one from this shortlist so the direction suits the surface (a dashboard
 * leans technical/data; a storefront leans editorial/3d). Falls back to all
 * moods for landing/marketing/docs/any.
 */
const PAGE_TYPE_MOODS = {
  dashboard: ['technical-dark', 'data-dense', 'friendly-soft'],
  app: ['technical-dark', 'data-dense', 'friendly-soft', 'bold-3d'],
  ecommerce: ['editorial-photo', 'bold-3d', 'friendly-soft', 'warm-organic'],
  mobile: ['friendly-soft', 'data-dense', 'bold-3d', 'warm-organic'],
};

/** @typedef {{ id: string, kind: 'rule'|'option', group?: string, appliesTo: PageType[], moods: Mood[], directive: string }} DesignPattern */

/** @type {DesignPattern[]} */
const PATTERNS = [
  // =========================================================================
  // RULES — quality floor, always applied when the page type matches
  // =========================================================================
  { id: 'rule-one-accent', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Commit to ONE confident accent color. Use it only for the primary action and a few moments of real emphasis; everything else stays neutral.' },
  { id: 'rule-type-scale', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Commit to one modular type scale and use only its steps (no ad-hoc sizes). Pair a characterful display face with a quiet neutral body; tight leading on big headings, generous on body, line length ~60–70ch.' },
  { id: 'rule-spacing-scale', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Use one consistent spacing scale and one corner-radius token across the whole UI. Optical alignment everywhere; treat whitespace as an intentional design element, not leftover gap.' },
  { id: 'rule-tabular-numerals', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Render every stat, price, metric and table column in tabular/monospaced numerals so figures align and read as engineered data.' },
  { id: 'rule-contrast', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Verify WCAG AA contrast on every text/background pairing — including text on color blocks, gradients, and images (add a scrim where needed).' },
  { id: 'rule-custom-marks', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Replace stock/emoji icons with custom marks, line diagrams, or numbered annotations. Treat the wordmark as a designed logotype (custom spacing/weight/case), not default body text.' },
  { id: 'rule-microcopy', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Write micro-copy with a specific human voice. Buttons get real verbs ("Log a meal", "Start the scan") — never "Get Started" / "Learn More" / lorem.' },
  { id: 'rule-motion', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Keep motion purposeful: restrained entrance reveals (fade + 8–16px translate, 300–500ms eased, staggered by group) and intentional hover states (underline grow, image zoom ~1.03, accent shift). Respect prefers-reduced-motion; no parallax soup.' },
  { id: 'rule-nav', kind: 'rule', appliesTo: ['any'], moods: [],
    directive: 'Minimal top nav that recedes on scroll: designed wordmark left, one primary action right. No bloated mega-menus on small products.' },
  { id: 'rule-imagery', kind: 'rule', appliesTo: ['landing', 'marketing', 'ecommerce', 'mobile'], moods: [],
    directive: 'Art-direct imagery: full-bleed, confident off-center crops, color-graded/duotoned to the palette so photos feel chosen, not stock-dropped.' },
  { id: 'rule-ui-states', kind: 'rule', appliesTo: ['app', 'dashboard', 'mobile'], moods: [],
    directive: 'Design the empty, loading, success, and error states for every data surface — never ship framework defaults or a blank screen.' },
  { id: 'rule-real-data', kind: 'rule', appliesTo: ['app', 'dashboard'], moods: [],
    directive: 'Populate product surfaces with realistic data: real charts, tables, sparklines, and semantic status pills — never lorem widgets or placeholder boxes.' },
  { id: 'rule-footer', kind: 'rule', appliesTo: ['landing', 'marketing'], moods: [],
    directive: 'Design the footer as a real section: structured navigation, brand line, contact — not an afterthought row of links.' },

  // =========================================================================
  // OPTIONS — exactly ONE picked per group per run
  // =========================================================================

  // ---- group: hero (landing/marketing/mobile) -----------------------------
  { id: 'hero-3d-object', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing', 'mobile'], moods: ['bold-3d', 'technical-dark'],
    directive: 'Build the hero around ONE high-fidelity 3D render (chrome, liquid-metal, crystalline, glass, or organic form) as the single focal point on a clean or dark field. Type sits beside or beneath it and never competes.' },
  { id: 'hero-photo-overlay', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing', 'ecommerce'], moods: ['editorial-photo', 'warm-organic'],
    directive: 'Full-bleed art-directed photograph with the display headline set directly over it (proper scrim/gradient for contrast). The image is the hero; type rides it.' },
  { id: 'hero-split-render', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing', 'ecommerce'], moods: ['friendly-soft', 'bold-3d', 'technical-dark'],
    directive: '50/50 split hero: headline + one-line value + single CTA on one half, a full-bleed product render / image on the other. Hard vertical seam, not a centered stack.' },
  { id: 'hero-statement-caps', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing'], moods: ['brutalist-caps', 'bold-3d'],
    directive: 'Statement hero: one bold ALL-CAPS sentence filling a solid color or dark field, with the single CTA directly beneath. Confidence over explanation.' },
  { id: 'hero-editorial-left', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing', 'docs'], moods: ['editorial-photo', 'warm-organic'],
    directive: 'Left-aligned editorial hero: small uppercase eyebrow + oversized headline + one-line value + single CTA, with a supporting visual or card to the right. Asymmetric, not centered.' },
  { id: 'hero-product-ui', kind: 'option', group: 'hero', appliesTo: ['landing', 'marketing', 'mobile'], moods: ['friendly-soft', 'data-dense', 'technical-dark'],
    directive: 'Show the actual product as the hero: the real dashboard/app screen in a clean device or browser frame with one short callout, so the UI itself is the proof.' },

  // ---- group: palette-strategy (any) --------------------------------------
  { id: 'palette-tinted-dark-neon', kind: 'option', group: 'palette-strategy', appliesTo: ['any'], moods: ['technical-dark', 'data-dense', 'bold-3d'],
    directive: 'Tinted near-black canvas (green / blue / violet undertone — never pure neutral gray-on-black) carried by ONE electric neon accent reserved for the primary action and live data. A soft single-hue radial glow behind the hero is allowed; no rainbow gradients or frosted glass.' },
  { id: 'palette-warm-offneutral', kind: 'option', group: 'palette-strategy', appliesTo: ['any'], moods: ['warm-organic', 'editorial-photo'],
    directive: 'Sophisticated warm off-neutrals — paper, clay, sand, forest, oxblood — instead of #fff/#000 and default grays. One muted accent; the palette itself carries the mood.' },
  { id: 'palette-mono-editorial', kind: 'option', group: 'palette-strategy', appliesTo: ['any'], moods: ['editorial-photo', 'brutalist-caps'],
    directive: 'Near-monochrome black/white editorial system with a single accent reserved only for links and the primary CTA. Contrast and type do the work, not color.' },
  { id: 'palette-soft-pastel', kind: 'option', group: 'palette-strategy', appliesTo: ['any'], moods: ['friendly-soft'],
    directive: 'Soft multi-tone pastel palette on a light canvas with rounded organic shapes used flat (not glassmorphic). Warm, approachable, generous whitespace.' },
  { id: 'palette-color-blocks', kind: 'option', group: 'palette-strategy', appliesTo: ['landing', 'marketing', 'ecommerce'], moods: ['brutalist-caps', 'bold-3d'],
    directive: 'Chapter the page with solid saturated color blocks — an entire section in one brand color — instead of gradients. Alternate canvas vs inverted bands to control pacing.' },

  // ---- group: type-system (any) -------------------------------------------
  { id: 'type-editorial-serif', kind: 'option', group: 'type-system', appliesTo: ['any'], moods: ['editorial-photo', 'warm-organic'],
    directive: 'Characterful display serif for headlines (let one make a statement or pose a question) paired with a quiet neutral body. Add editorial details: eyebrows, captions, index numbers, a pull-quote in the display face.' },
  { id: 'type-condensed-caps', kind: 'option', group: 'type-system', appliesTo: ['any'], moods: ['brutalist-caps', 'bold-3d'],
    directive: 'Tightly-tracked condensed ALL-CAPS display headlines stacked in big blocks for athletic impact; deliberately break a key word onto its own line. Quiet neutral body underneath.' },
  { id: 'type-grotesk-clean', kind: 'option', group: 'type-system', appliesTo: ['any'], moods: ['technical-dark', 'data-dense'],
    directive: 'Confident neutral grotesk throughout; build hierarchy with dramatic weight contrast (e.g. 800 headline beside a 400 caption) rather than size alone. Small uppercase eyebrows with wide tracking.' },
  { id: 'type-lowercase-friendly', kind: 'option', group: 'type-system', appliesTo: ['any'], moods: ['friendly-soft'],
    directive: 'Calm lowercase or sentence-case headlines in a rounded geometric sans; warm, conversational, never shouting. Hierarchy from weight and spacing.' },

  // ---- group: layout-rhythm (landing/marketing/docs) ----------------------
  { id: 'layout-bento', kind: 'option', group: 'layout-rhythm', appliesTo: ['landing', 'marketing', 'docs'], moods: ['technical-dark', 'data-dense', 'friendly-soft'],
    directive: 'Use a bento grid of unequal modular tiles for overview/feature sections instead of three identical cards. Vary tile size to set emphasis.' },
  { id: 'layout-alternating-bands', kind: 'option', group: 'layout-rhythm', appliesTo: ['landing', 'marketing'], moods: ['bold-3d', 'brutalist-caps', 'editorial-photo'],
    directive: 'Vary section rhythm: alternate full-bleed, contained, and 50/50 split layouts, and alternate canvas vs dark bands. Never stack identical card rows down the page.' },
  { id: 'layout-editorial-index', kind: 'option', group: 'layout-rhythm', appliesTo: ['landing', 'marketing', 'docs'], moods: ['editorial-photo', 'warm-organic'],
    directive: 'Magazine layout: asymmetric 12-column grid, sections numbered 01 / 02 / 03, hairline rules and grid dividers instead of heavy cards and soft shadows. Sticky section labels orient long pages.' },
  { id: 'layout-h-scroll-rail', kind: 'option', group: 'layout-rhythm', appliesTo: ['landing', 'marketing', 'ecommerce'], moods: ['friendly-soft', 'data-dense'],
    directive: 'Use a horizontal-scrolling rail for collections, screenshots, or case studies rather than cramming everything into one grid.' },

  // ---- group: data-viz (app/dashboard/mobile) -----------------------------
  { id: 'dataviz-neon-on-dark', kind: 'option', group: 'data-viz', appliesTo: ['app', 'dashboard', 'mobile'], moods: ['technical-dark', 'data-dense'],
    directive: 'Draw charts as thin neon lines/areas on a subtle grid over a tinted-dark canvas, with tabular numerals, semantic up/down colors, and rings/heatmaps for progress.' },
  { id: 'dataviz-friendly-light', kind: 'option', group: 'data-viz', appliesTo: ['app', 'dashboard', 'mobile'], moods: ['friendly-soft', 'data-dense'],
    directive: 'Colorful rounded charts on a light canvas inside soft cards: clear labels, gentle category colors, big readable numerals. Approachable, not corporate.' },
  { id: 'dataviz-isometric-3d', kind: 'option', group: 'data-viz', appliesTo: ['app', 'dashboard'], moods: ['bold-3d', 'data-dense'],
    directive: 'Use isometric 3D bar/column scenes as a feature visual for headline metrics, with flat 2D charts handling the dense supporting data.' },
  { id: 'dataviz-progress-rings', kind: 'option', group: 'data-viz', appliesTo: ['app', 'dashboard', 'mobile'], moods: ['friendly-soft', 'data-dense'],
    directive: 'Lead with goal/progress rings + compact stat cards + a weekly heatmap (calorie-tracker style): one hero metric, supporting stats around it, trends below.' },

  // ---- group: stats-treatment (landing/marketing/dashboard) ---------------
  { id: 'stats-oversized-band', kind: 'option', group: 'stats-treatment', appliesTo: ['landing', 'marketing', 'dashboard'], moods: ['technical-dark', 'brutalist-caps', 'data-dense', 'bold-3d'],
    directive: 'Convey traction with a band of oversized key metrics — a few huge numerals + small labels (e.g. +700 / +2.1B / 99.05%) — instead of a fake "trusted by" logo wall.' },
  { id: 'stats-inline-pills', kind: 'option', group: 'stats-treatment', appliesTo: ['landing', 'marketing', 'dashboard'], moods: ['friendly-soft', 'data-dense'],
    directive: 'Surface metrics inline near the content they describe: semantic status pills, deltas, and small sparklines rather than one isolated stats strip.' },
];

// ===========================================================================
// Selection engine
// ===========================================================================

// ---------------------------------------------------------------------------
// Structure axis — a seeded, mandatory rotation that forces the agent off its
// default skeleton (wordmark + few links + pill nav, oversized-headline hero,
// uppercase eyebrows on every section). Prose bans alone don't hold against the
// model's house style, so we pick a concrete nav + hero + eyebrow approach per
// run, seeded by the prompt (reproducible per prompt, varied across prompts).
// ---------------------------------------------------------------------------
const NAV_ARCHETYPES = [
  { id: 'sidebar', text: 'a persistent vertical sidebar / left rail for primary navigation (well suited to app- or content-dense layouts)' },
  { id: 'centered-split', text: 'a centered wordmark with navigation links split symmetrically to its left and right' },
  { id: 'utility-bar', text: 'a functional utility bar — search field, account, and one or two real actions — rather than just marketing text links' },
  { id: 'overlay-menu', text: 'a sparse bar that opens an expressive full-screen / overlay menu via a custom menu control' },
  { id: 'tabbed', text: 'a segmented tab / switcher bar as the primary navigation between major views' },
  { id: 'floating-dock', text: 'a floating, rounded dock/pill nav (icon + label led) detached from the page edges' },
  { id: 'editorial-masthead', text: 'an editorial masthead — large logo, a hairline rule, and a secondary row of categories' },
  { id: 'corner-minimal', text: 'navigation pushed into the page corners (logo in one corner, a single link/action diagonally opposite) with generous open space' },
];

const HERO_ARCHETYPES = [
  { id: 'full-bleed-media', text: 'a full-bleed image/scene with minimal overlaid text — let the visual carry it and keep type restrained' },
  { id: 'split-asymmetric', text: 'a deliberately asymmetric split: off-center content on one side, product UI / media / object on the other' },
  { id: 'centered-stage', text: 'a single hero object/product centered on a "stage" with radial light/shadow focus and sparse text' },
  { id: 'collage-grid', text: 'a modular collage / grid of tiles (images, stats, captions) instead of one big headline block' },
  { id: 'data-led', text: 'lead with the live interface itself — a working widget, real numbers, or an interactive demo as the hero' },
  { id: 'horizon-band', text: 'a wide horizontal-band composition with a low, calm text block and a strong horizontal motif' },
  { id: 'card-perspective', text: 'layered cards / device mockups arranged in perspective as the focal point' },
  { id: 'restrained-index', text: 'a restrained hero where small, precise type and a clear index/menu do the work instead of one giant headline' },
];

const EYEBROW_POLICIES = [
  { id: 'none', text: 'Do NOT use uppercase letter-spaced eyebrow/kicker labels anywhere; let headings and copy stand on their own.' },
  { id: 'once', text: 'Use at most ONE small eyebrow label, and only in the hero; every section heading must stand without a kicker label.' },
];

/** Seeded pick of one nav + one hero + one eyebrow policy for this run. */
function selectStructure(seed) {
  const rng = mulberry32(typeof seed === 'number' ? seed : 1);
  const choose = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    nav: choose(NAV_ARCHETYPES),
    hero: choose(HERO_ARCHETYPES),
    eyebrow: choose(EYEBROW_POLICIES),
  };
}

/** Render the structure axis as a mandatory directive block. */
function formatStructure(s) {
  if (!s) return '';
  return [
    '## Structure (mandatory this run — break your default skeleton)',
    'You habitually reach for the same skeleton: a wordmark + a few links + one pill CTA, an oversized-headline hero, and uppercase eyebrow labels above every section. To avoid that repetition, THIS build must use the structural approach below. Adapt the specifics tastefully to the product, but commit to these structures instead of your defaults:',
    `- Navigation: ${s.nav.text}.`,
    `- Hero: ${s.hero.text}.`,
    `- Eyebrows: ${s.eyebrow.text}`,
  ].join('\n');
}

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string -> 32-bit seed (djb2) so the same prompt is reproducible. */
function hashSeed(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function matchesPageType(pattern, pageType) {
  const at = pattern.appliesTo || [];
  return at.includes('any') || at.includes(pageType);
}

function matchesMood(pattern, mood) {
  if (!mood) return true;
  const m = pattern.moods || [];
  return m.length === 0 || m.includes(mood);
}

function pick(arr, rng) {
  if (!arr.length) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Selects a coherent, on-mood, page-appropriate set of patterns for one run:
 *   - every RULE that matches the page type, plus
 *   - exactly ONE OPTION per group (filtered by page type + mood).
 *
 * @param {Object} [opts]
 * @param {PageType} [opts.pageType='landing']
 * @param {Mood|null} [opts.mood=null]  when null, a mood is chosen (page-biased, seeded)
 * @param {number} [opts.seed=1]
 * @returns {{ pageType: PageType, mood: Mood, rules: DesignPattern[], options: DesignPattern[], all: DesignPattern[] }}
 */
function selectPatterns(opts = {}) {
  const pageType = PAGE_TYPES.includes(opts.pageType) ? opts.pageType : 'landing';
  const rng = mulberry32(typeof opts.seed === 'number' ? opts.seed : 1);

  // Resolve the mood (forced > page-biased random > any random).
  let mood = MOODS.includes(opts.mood) ? opts.mood : null;
  if (!mood) {
    const candidates = (PAGE_TYPE_MOODS[pageType] || MOODS).filter((m) => MOODS.includes(m));
    mood = pick(candidates.length ? candidates : MOODS, rng);
  }

  const rules = PATTERNS.filter((p) => p.kind === 'rule' && matchesPageType(p, pageType));

  const options = [];
  for (const group of GROUPS) {
    let candidates = PATTERNS.filter(
      (p) => p.kind === 'option' && p.group === group && matchesPageType(p, pageType)
    );
    if (!candidates.length) continue; // group not relevant to this page type

    // Prefer on-mood options; fall back to all in-group so we still pick one.
    const onMood = candidates.filter((p) => matchesMood(p, mood));
    const chosen = pick(onMood.length ? onMood : candidates, rng);
    if (chosen) options.push(chosen);
  }

  return { pageType, mood, rules, options, all: [...rules, ...options] };
}

/**
 * Formats a selection into a compact, directive prompt block.
 * @param {ReturnType<typeof selectPatterns>} selection
 */
function formatPatterns(selection) {
  // Back-compat: tolerate being handed a raw array of patterns.
  if (Array.isArray(selection)) {
    selection = { pageType: 'any', mood: '', rules: selection.filter((p) => p.kind !== 'option'), options: selection.filter((p) => p.kind === 'option') };
  }
  const { pageType, mood, rules = [], options = [] } = selection || {};

  const lines = [];
  lines.push('## Reference design direction for this run');
  lines.push(
    `Commit to ONE coherent direction for this build` +
    (mood ? ` — mood: **${mood}**` : '') +
    (pageType && pageType !== 'any' ? ` (page type: ${pageType})` : '') +
    `. Use the specific chosen moves below; do not blend in other styles or revert to a generic centered template.`
  );

  if (rules.length) {
    lines.push('\n**Always (quality floor)**');
    for (const r of rules) lines.push(`- ${r.directive}`);
  }

  if (options.length) {
    lines.push('\n**Chosen moves for this run (commit to exactly these)**');
    for (const o of options) {
      const label = GROUP_LABELS[o.group] || o.group;
      lines.push(`- **${label}** — ${o.directive}`);
    }
  }

  return lines.join('\n');
}

/** Page-type scope note for a group (which page types its options apply to). */
function groupPageScope(group) {
  const opts = PATTERNS.filter((p) => p.kind === 'option' && p.group === group);
  let anyAll = false;
  const types = new Set();
  for (const o of opts) {
    for (const a of o.appliesTo || []) {
      if (a === 'any') anyAll = true; else types.add(a);
    }
  }
  if (anyAll) return 'any page';
  return [...types].join(' / ');
}

/**
 * Render the full curated library as a MENU the model chooses from (instead of
 * pre-selecting via brittle keyword regex). Lists the mood palette, the
 * always-on rules, and every option grouped + mood-tagged. The model reads the
 * brief, commits to one mood, and picks one option per applicable group.
 */
function formatCatalog() {
  const lines = [];
  lines.push('## Design direction — choose what fits THIS product');
  lines.push(
    'Read the brief and decide the page type yourself, then commit to ONE mood below and execute it cohesively. ' +
    'Pick exactly ONE option per group that applies to your page type, and skip groups that do not apply ' +
    '(data-viz is app/dashboard only; hero and layout-rhythm are landing/marketing). ' +
    'If the project already has a design system / tokens, honor those first and use this only to raise quality.'
  );
  lines.push('');
  lines.push(
    'Deliberately VARY the direction from project to project. You tend to over-default to one editorial look — ' +
    'an oversized serif headline + uppercase eyebrow labels + 01/02 numbered sections. Choose that ONLY when it ' +
    'genuinely fits the brand, never as a reflex; for most briefs a different mood is a better fit.'
  );
  lines.push('');
  lines.push('**Moods — commit to exactly one:**');
  for (const m of MOODS) lines.push(`- \`${m}\` — ${MOOD_NOTES[m] || ''}`);
  lines.push('');
  lines.push('**Always apply (quality floor, regardless of mood):**');
  for (const r of PATTERNS.filter((p) => p.kind === 'rule')) lines.push(`- ${r.directive}`);
  lines.push('');
  lines.push('**Pick exactly ONE option per applicable group** (each tagged with the moods it suits):');
  for (const g of GROUPS) {
    const opts = PATTERNS.filter((p) => p.kind === 'option' && p.group === g);
    if (!opts.length) continue;
    lines.push(`\n_${GROUP_LABELS[g] || g}_ — ${groupPageScope(g)}`);
    for (const o of opts) lines.push(`- [${(o.moods || []).join(', ')}] ${o.directive}`);
  }
  return lines.join('\n');
}

module.exports = {
  PATTERNS,
  MOODS,
  MOOD_NOTES,
  PAGE_TYPES,
  GROUPS,
  GROUP_LABELS,
  PAGE_TYPE_MOODS,
  selectPatterns,
  formatPatterns,
  formatCatalog,
  selectStructure,
  formatStructure,
  hashSeed,
};
