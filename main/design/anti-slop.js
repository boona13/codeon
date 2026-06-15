/**
 * Anti-slop design guidance for the agent.
 *
 * Builds a system-prompt append block that steers the agent away from generic
 * "AI slop" UI and toward curated, real-world design patterns. The guidance is
 * only injected when the current task looks like frontend/UI work, so backend
 * and tooling tasks don't pay the token cost.
 *
 * Sources:
 *  - ./slop-blocklist.md      (hard bans, always included when active)
 *  - ./anti-slop-patterns.js  (positive design directives)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { formatCatalog, MOODS, hashSeed, selectStructure, formatStructure } = require('./anti-slop-patterns');

// EXPERIMENT TOGGLE: when false, the curated pattern catalog is NOT injected.
// Instead the agent gets only an art-director persona and is told to invent a
// fresh design concept on its own each run. Flip back to true to restore the
// curated menu. (Blocklist + imagery directive stay active either way.)
const USE_CURATED_PATTERNS = true;

// Persona-only design brief used when USE_CURATED_PATTERNS is false. No moods,
// no options — just a strong point of view and a mandate to invent.
const PERSONA_BLOCK = [
  '## Design concept — invent it yourself, fresh every time',
  'You are a world-class art director and product designer with an unmistakable point of view and a portfolio of award-winning, genuinely original interfaces. For THIS product, invent a complete, specific design concept from scratch — do not reach for a template, a trend, or a house style.',
  '',
  "- Start from the brand: who it is for, the single feeling it should evoke, and what makes it unlike its competitors. Derive ONE bold, ownable creative concept, name it in a sentence, then execute it cohesively across type, color, layout, motion, and imagery.",
  '- Make decisive, opinionated choices: a distinctive type pairing, a confident palette with one real accent, an intentional layout system, and purposeful motion. Refined-minimal and rich-maximal both win — the timid, generic middle is the only way to fail.',
  '- Vary deliberately from project to project. Never default to the same fonts, the same oversized hero, the same nav, or the same composition you reach for by reflex. If a choice feels like the safe, average, on-distribution option, reject it and design something more specific and more memorable.',
  '- Match the ambition of the code to the vision, and honor any existing design system / tokens in the project first.',
].join('\n');

// Blocklist is static, so cache it once per process. The pattern SELECTION,
// by contrast, is computed per call (seeded by the prompt) so different tasks
// get different, coherent directions instead of one frozen block.
let _blocklistCache = null;

const BLOCKLIST_PATH = path.join(__dirname, 'slop-blocklist.md');

// Always-on imagery directive (injected for every frontend task, every
// provider). It is capability-gated: models with an image tool generate real
// assets; models without one fall back to crafted CSS/SVG. This lives here, not
// just in the on-demand frontend-design skill, so proactive image generation
// does not depend on whether the skill happened to load this run.
const IMAGERY_DIRECTIVE = [
  '# Imagery (plan assets first, then generate — judge WHEN / WHAT / WHERE)',
  'Visuals are part of building a UI, not an afterthought — but be deliberate, not reflexive. Do not just "generate some images"; decide what this specific interface actually needs and place each asset correctly.',
  '',
  'If you have an image-generation tool (e.g. an `image_generation` tool), follow this procedure (proactively, even if images were not requested):',
  '',
  '1. PLAN FIRST. Before generating anything, write a short asset plan: for each candidate image list its role, where it will sit, rough dimensions, and whether it needs a transparent cutout. Generate only assets that earn their place; cut decorative filler.',
  '2. WHEN. Generate art where it adds real value: a hero scene, empty/onboarding states, per-feature spot art, a brand/app icon, an OG share image. For data / utility / dashboard / tool products, the REAL centerpiece is the live interface and its data-viz — let the UI be the hero; do NOT bolt a decorative illustration on top of it.',
  '3. WHAT. Match every image to the page art direction — same style, palette, lighting, perspective — so the set looks like one family, and state that art direction in each prompt. Do NOT mix registers: e.g. never drop a glossy skeuomorphic 3D app icon onto a flat, modern UI.',
  '4. WHERE. Place each asset in its correct role. An app icon belongs in the favicon, a small nav wordmark, and the OG image — NEVER floated large as a hero decoration. A hero image is a full-bleed scene or real product UI. Empty-state art goes inside the empty container; spot illustrations sit beside the feature they explain. Reference local paths (e.g. `public/assets/`, never hotlink), set explicit width/height, add real alt text, and lazy-load below-the-fold images.',
  '5. TRANSPARENCY — decide per image:',
  '   - Subject that sits over colored/varying backgrounds or overlaps other elements (logos, icons, mascots, product cutouts, spot illustrations on a section): generate the SUBJECT ON A SOLID PURE MAGENTA (#FF00FF) BACKGROUND filling the canvas — flat and even, no gradient/shadow/vignette. That magenta (and pure green #00FF00) is auto-keyed to true transparency. Save as PNG.',
  '   - Image that owns its own rectangle / has an intentional background (full-bleed hero scenes, photos, textures, OG images, framed illustrations): generate with its real, art-directed background — never a magenta/green backdrop.',
  '',
  'If you do NOT have an image-generation tool, do not fake it or leave broken image references — use tasteful CSS/SVG (gradients, geometric shapes, inline SVG marks/illustrations) instead.',
].join('\n');

// Keywords in the user's request that strongly imply UI/frontend work.
const UI_PROMPT_RE = new RegExp(
  [
    '\\bui\\b', '\\bux\\b', 'frontend', 'front-end', 'landing page', 'landing',
    'website', 'web ?page', 'web ?app', 'homepage', 'hero section', '\\bhero\\b',
    'component', 'css', 'tailwind', 'styl(e|ing|es|esheet)', 'theme', 'design',
    'layout', 'responsive', 'button', 'navbar', 'navigation', 'header', 'footer',
    'modal', 'dashboard ui', 'marketing site', 'react', 'next\\.?js', 'vue',
    'svelte', 'html', 'jsx', 'tsx', 'figma', 'redesign', 'restyle', 'animation',
    'storefront', 'pricing page', 'dribbble', 'shadcn'
  ].join('|'),
  'i'
);

// Project files / config that indicate a frontend codebase.
const FRONTEND_CONFIG_FILES = [
  'index.html',
  'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs',
  'vite.config.js', 'vite.config.ts',
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'svelte.config.js', 'astro.config.mjs', 'nuxt.config.ts', 'nuxt.config.js',
  'postcss.config.js', 'postcss.config.cjs',
];

const FRONTEND_DEP_RE = /\b(react|react-dom|next|vue|svelte|@sveltejs|nuxt|astro|tailwindcss|@angular\/core|solid-js|preact|gatsby|remix|@remix-run|styled-components|@emotion|sass|less|@chakra-ui|@mui\/material|shadcn)\b/i;

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * Cheap, bounded check for whether `projectRoot` is a frontend project.
 * Reads package.json deps and looks for a few well-known config files.
 */
function projectLooksFrontend(projectRoot) {
  const root = typeof projectRoot === 'string' ? projectRoot.trim() : '';
  if (!root) return false;

  try {
    const pkgPath = path.join(root, 'package.json');
    if (fileExists(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const depBlob = JSON.stringify({
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {}),
      });
      if (FRONTEND_DEP_RE.test(depBlob)) return true;
    }
  } catch { /* ignore malformed package.json */ }

  for (const f of FRONTEND_CONFIG_FILES) {
    if (fileExists(path.join(root, f))) return true;
  }
  // Common src entry for SPA projects.
  if (fileExists(path.join(root, 'public', 'index.html'))) return true;
  if (fileExists(path.join(root, 'src', 'index.html'))) return true;

  return false;
}

/**
 * Returns true when the agent should inject UI design guidance for this run.
 * @param {string} projectRoot
 * @param {string} prompt
 */
function shouldInject(projectRoot, prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (text && UI_PROMPT_RE.test(text)) return true;
  return projectLooksFrontend(projectRoot);
}

function getBlocklist() {
  if (_blocklistCache != null) return _blocklistCache;
  try {
    _blocklistCache = fs.readFileSync(BLOCKLIST_PATH, 'utf-8').trim();
  } catch {
    _blocklistCache = '';
  }
  return _blocklistCache;
}

/**
 * Two distinct, seeded moods used only as an optional, overridable tie-breaker
 * so genuinely ambiguous briefs don't all land on the same direction. The model
 * makes the real choice from the brief.
 */
function suggestMoods(seed) {
  const n = MOODS.length;
  const i = seed % n;
  const j = (i + 1 + (Math.floor(seed / n) % (n - 1))) % n;
  return [MOODS[i], MOODS[j]];
}

/**
 * Builds the design-direction block. Rather than pre-selecting a style via
 * keyword regex (which over-forced the same editorial look), this presents the
 * curated library as a MENU and lets the model choose what fits the brief.
 *
 * @param {string} projectRoot
 * @param {string} prompt
 * @returns {string}
 */
function getPatternsBlock(projectRoot, prompt) {
  try {
    const seed = hashSeed(prompt || projectRoot || 'default');
    // Seed-pinned structure axis runs in BOTH modes: it is the only lever that
    // reliably breaks the model's default nav/hero/eyebrow skeleton.
    const structure = formatStructure(selectStructure(seed));

    if (!USE_CURATED_PATTERNS) {
      return [PERSONA_BLOCK, structure].filter(Boolean).join('\n\n');
    }

    const catalog = formatCatalog();
    const [m1, m2] = suggestMoods(seed);
    const nudge =
      `\n\nFor this build, if several moods fit the brief equally well, consider starting from ` +
      `\`${m1}\` or \`${m2}\` — but override freely when the brief clearly points elsewhere.`;
    return [catalog + nudge, structure].filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Builds the system-prompt append string for anti-slop UI guidance.
 * Returns '' when the current task is not frontend/UI work.
 *
 * @param {string} projectRoot
 * @param {string} prompt - the user's request text
 * @returns {string}
 */
function buildAntiSlopAppend(projectRoot, prompt) {
  if (!shouldInject(projectRoot, prompt)) return '';

  const blocklist = getBlocklist();
  const patternsBlock = getPatternsBlock(projectRoot, prompt);
  if (!blocklist && !patternsBlock) return '';

  const header =
    '# UI Design Quality (anti-slop)\n' +
    'When you create or modify any user interface, follow the rules below so the ' +
    'result looks intentionally designed, not generically AI-generated. Honor any ' +
    'existing design system / tokens in the project first; use these as the bar for quality.';

  const imagery = IMAGERY_DIRECTIVE;

  return [header, imagery, blocklist, patternsBlock].filter(Boolean).join('\n\n');
}

module.exports = {
  buildAntiSlopAppend,
  shouldInject,
  projectLooksFrontend,
};
