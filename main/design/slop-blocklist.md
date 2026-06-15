# Slop Blocklist (hard bans for all UI work)

These are the recognizable tells of generic AI-generated web design. They are
BANNED unless the design system or brief explicitly calls for them. If you catch
yourself reaching for one, stop and use the curated design tokens instead.

## Color & surface
- NO purple-to-indigo / violet-to-blue gradients (the "AI default" palette).
- NO unsolicited gradients on text or buttons. Use solid token colors.
- NO default Tailwind grays (`slate-*`, `zinc-*`, `gray-*`) for text/surfaces.
  Use the `bg`, `surface`, `fg`, `muted`, `border` tokens.
- NO glassmorphism by default (`backdrop-blur`, semi-transparent frosted cards,
  `border-white/10`) unless the personality explicitly asks for it.
- NO neon glow / drop-shadow soup. Shadows must be intentional and match the mood.

## Layout & components
- NO generic centered hero with a giant gradient headline + two buttons labeled
  "Get Started" and "Learn More". Write real, specific copy and a real CTA.
- NO 3-column feature grid of identical rounded cards each topped with an emoji
  or a lonely Lucide icon. Vary rhythm, sizing, and composition.
- NO emoji used as iconography or bullet points.
- NO untouched shadcn/ui defaults. If a component is used, it must be themed to
  the design tokens.
- NO "Trusted by industry leaders" + fake greyed-out logo bar as filler.

## Type & content
- NO lorem ipsum or placeholder filler. Copy must be specific to the product.
- NO single default font for everything. Use the heading + body pairing from the
  design system.
- NO claims of fake metrics, fake testimonials with fake names, or fake press.

## Overused "premium" template (stop converging here)
You reach for the same editorial template on almost every build. These are BANNED
unless the brand is genuinely editorial / luxury / fashion / craft / print-like:
- NO fashionable high-contrast display serif (Fraunces, Playfair Display, and
  Didone-style faces) for headlines on tech, SaaS, sport, gaming, fintech,
  developer, or productivity products. Those briefs want a strong sans, a
  grotesk, a mono, or a distinctive non-serif display instead.
- NO uppercase, wide letter-spaced "eyebrow" kicker stacked above the headline
  AND above every section heading. Use this device at most once on a page, or not
  at all — it is a tell when it is everywhere.
- NO 01 / 02 / 03 numbered section headers as a default layout rhythm.
- NO defaulting the nav to the same shape every time (wordmark left + 2–3 text
  links + one pill CTA right). Vary the navigation to fit the product: it might be
  a sidebar, a centered/condensed bar, a utility bar with search/account, tabs, a
  command bar, or a fuller menu — choose what the product actually needs.
- Do NOT clamp the hero headline absurdly large by reflex (e.g. `7rem`+) on every
  page; size type to the content and mood, not to a formula.

## Imagery
- NO reusing the SAME generated/stock image across multiple cards, tiles, or
  list items. Each card needs its own distinct image (generate separate assets)
  or use no image rather than repeating one.

## Positive requirements
- Consume the design tokens (colors, fonts, radius) as CSS variables / Tailwind
  theme values. Do not invent ad-hoc hex values or font families.
- Honor the chosen `personality` and `references`. The result should look like it
  belongs to THAT brand, not to "generic SaaS template #4,000,000".
- Strong, deliberate visual hierarchy and consistent spacing rhythm.
- Accessible contrast (WCAG AA) for text on its background.
