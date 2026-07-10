# Corgi Design System

Corgi's UI system is code-first: `web-next` is the implementation source of
truth, and the Figma library is the shared design workspace. The v1 Figma file
is [Corgi Design System v1](https://www.figma.com/design/wGEpGss6EBuyBvAjUG5ZSW).

## Foundations

- Use `web-next/app/globals.css` for brand color truth.
- Use `web-next/tailwind.config.ts` for Tailwind aliases, font families, and
  radius names.
- Use Plus Jakarta Sans for display headings, Inter for product UI, and IBM Plex
  Mono for scores, receipts, labels, and audit-like values.
- Keep dominant surfaces warm and quiet: cream page backgrounds, paper cards,
  biscuit insets, ginger primary actions, and ink text.
- Use larger radii only for native-looking Bluesky feed surfaces. Product tools
  should stay denser and calmer.
- **Signal palette** — the five ranking signals use one warm-harmonized set, so
  every weight bar, receipt dot, and slider across the whole site reads as the
  same product: recency `#6E93B8` (dusty slate-blue), engagement `#BC4B3E`
  (brick-red), bridging `#9B6F94` (muted plum), source diversity `#7A9A5E`
  (sage-olive), relevance `#C8612C` (ginger, = `--primary`). These are earthy
  hues that live in the cream/ginger world — **not** a generic
  blue/purple/emerald set. There are two mirrors, split only by key convention:
  `lib/signals.ts` (snake_case — governance + demo, consumed via the `PolicyBar`
  component and `SIGNAL_COLORS`; the demo re-exports it) and `lib/replay-model.ts`
  (camelCase `signals[].barColor` — the replay teaser + how-it-works). Keep the
  two hex sets identical; never hardcode a signal color anywhere else.
- **Weight mix = one stacked bar.** The community policy is shown as a single
  horizontal stacked `PolicyBar` (`components/ui/policy-bar.tsx`) + `PolicyLegend`,
  in the signal palette — the signature governance visual. Use it on every
  governance surface (dashboard, vote, proposals, history, the post receipt);
  don't fall back to five monochrome `WeightBar`s for the *aggregate* mix.
- **Per-signal rows are signal-tinted.** A single `WeightBar` is still right for a
  one-signal row (a score-breakdown contribution, a weight-diff "after" bar) — but
  pass its `color` prop the signal's `SIGNAL_COLORS[key]` so it matches the
  palette. The vote equalizer (`LinkedSlider`) does the same, plus a
  community-average marker so a voter sees their draft against consensus.

## Layout (single source of truth)

**Primitives live in `components/ui/layout.tsx`. Use them — do not hardcode
`max-w-*` or a bespoke `px-*` gutter on section-level elements.** Consistent
edges are what make navigating between pages feel intentional rather than
jarring; hardcoding is how it drifts.

- `<Section>` — a page section: semantic `<section>` wrapping a `<Container>`.
  The `bordered` divider and vertical rhythm live on the inner `<Container>`, so
  the rule is **inset to the content frame** (spans the `1320` box, `x=60→1380`
  at 1440), not full-bleed across the viewport — matching every other divider on
  the site. Props: `spacing` (`default` | `loose` | `tight` | `none`), `bordered`
  (`true` = top rule | `"y"` = top+bottom), `width`. Put a full-bleed
  background/glow on the `<Section>` via `className`; keep content on the frame.
- `<Container>` — the centered horizontal frame (width cap + gutter). Add
  `grid`/`flex`/display via `className`. `as` sets the element (e.g. `as="main"`).
- Constants `GUTTER`, `CONTAINER_WIDTH`, `SECTION_SPACING` are exported for the
  rare case a component owns its own semantic element (e.g. the sticky header).

**Content column:** `1320px`, centered. **Gutter:** `px-5 md:px-8 lg:px-12`
(20 / 32 / 48px). At a 1440px viewport this puts content at **x=108 → 1332** —
every left-aligned section edge, the header logo, and the footer share that line.

**Width scale** (the only sanctioned widths — `CONTAINER_WIDTH`):

| Token | Value | Use |
| --- | --- | --- |
| `content` | `max-w-[1320px]` | default marketing / product column |
| `stage` | `max-w-[1120px]` | narrower "product stage" (interactive demo) |
| `doc` | `max-w-3xl` | long-form reading measure (docs / legal body) |
| `narrow` | `max-w-xl` | focused single-column (sign-in, error, 404) |

**Vertical rhythm** (`SECTION_SPACING`): `default` = `py-10 md:py-14`,
`loose` = `py-14 md:py-20`, `tight` = `py-5 md:py-6`.

**Header / AppShell** use a `grid grid-cols-[1fr_auto_1fr]` inside the content
frame so the nav is centered on the *page*, not in the leftover space
(`justify-between` biases it toward the narrower side — don't use it here). Logo
`justify-self-start`, nav `justify-self-center`, actions `justify-self-end`.

Centered sections (hero, FAQ, CTA) center their own inner `max-w-*`; they don't
need to align to the 108 line. The full-bleed dark CTA band and the hero glow
intentionally break the frame — that's the one contrast moment, kept deliberate.

**Page heros — one system, two tiers.** Every top-nav page except the landing
uses `PageHero` (`components/ui/page-hero.tsx`) for its eyebrow + title +
subtitle + actions, and applies the shared `HERO_TOP` offset to its wrapper.
This keeps the headline at the **same height** on every page (so nothing jumps
when a visitor tabs between them) and the eyebrow/type consistent. Sizes:
`size="lg"` (marketing/content — how-it-works) sits just under the landing;
`size="md"` (utility/task — demo, get-started) is the compact default.
Descending scale is deliberate: **landing (bespoke, biggest) → `lg` → `md`** —
never let a sub-page out-size the homepage. The landing keeps its bespoke
full-viewport front-door hero; that's the one hero archetype that's *meant* to
be different.

> The landing (`app/page.tsx` + its sections), the shells, `how-it-works`, and
> `demo` are all on the primitives. New pages/sections start there too — never
> hardcode a `max-w-*` / `px-*` on a section-level element.

## Typography &amp; contrast

- Display: Plus Jakarta Sans. Product/body: Inter. Mono (scores, receipts,
  labels, audit values): IBM Plex Mono.
- Secondary text uses foreground opacity. **Floors:** body/prose ≥ `/55`;
  labels, eyebrows, and fine print ≥ `/45`. **Never** use `text-foreground/20`,
  `/30`, or `/35` for readable text (they fail contrast on cream). Aim for WCAG
  AA (4.5:1) on normal text.

## Focus &amp; interaction

- `Button` (`components/ui/button.tsx`) ships a focus ring. Raw `<Link>`/`<a>`/
  `<button>` do **not** — add one:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background`
  (use `ring-inset` where an offset would clip).
- Accordions/disclosures use a real `<button>` with `aria-expanded`, not a
  `role="button"` div.

## Elevation

Shadows are currently inline and ad-hoc (several different card shadows exist).
Prefer the lightest that reads: `shadow-[0_2px_10px_rgba(46,38,32,0.05)]` for
resting cards, deeper only for the hero product stage. *(Formalizing a named
elevation scale is a known follow-up.)*

## Reusable components (extend before inventing)

- **Feed surfaces** (Bluesky post + Corgi rank — demo, landing teaser, how-it-works):
  `components/feed/` is the single source. `BlueskyPostCard` (native card, real photo
  or initials), `BlueskyFeedFrame`/`RankColumnHeader`/`FeedRow` (chrome + the "Corgi
  rank · Epoch N" column header), and `CorgiRankBadge` (the editorial rank numeral +
  movement pill + "Why" receipt popover). The badge has variant props: `showMovement`
  (hide when no prior epoch), `showWhy` (hide the popover where the surface has its own
  receipt panel, e.g. the demo + how-it-works). Map non-demo data with
  `replay-adapter.ts`. **Never hand-roll post chrome or a rank rail** — three copies is
  how these drifted (initials vs photos, mismatched badges) before they were unified.
- Layout: `Section`, `Container` (`components/ui/layout.tsx`).
- CTAs: `DemoCTA`, `SignInCTA` (`components/landing-ctas.tsx`) — one source for
  CTA copy + styling. Add new CTA variants here, not inline per page.
- Static content page: copy `app/privacy/page.tsx` — `AppShell` + `LegalLayout`
  + prose helpers `P`/`UL`/`LI`/`Strong`/`InlineLink` (`components/legal-layout.tsx`).
- Authed page: `AppShell` + `useAuth()` (`components/auth-provider.tsx`) +
  `state-kit.tsx` (`EmptyState`/`ErrorCard`/`Skeleton`), gate queries on
  `isAuthenticated`.

## Surface Rules

Corgi has three distinct UI surfaces:

- **Product surface:** Corgi app UI, including landing pages, dashboards, voting,
  receipts, settings, and CTAs.
- **Bluesky surface:** native-looking feed previews with white cards, Bluesky
  blue accents, avatars, handles, timestamps, and engagement rows.
- **Explanation surface:** Corgi annotations such as rank rails, weights, score
  rows, receipts, epochs, counterfactuals, and why-ranked details.

Never put Corgi rank badges or explanation panels inside native-looking Bluesky
post chrome. Standard Bluesky clients show ordered posts; Corgi shows the
receipt.

## Component Families

The Figma v1 library includes:

- Core UI: Button, Link Button style, Badge/Chip, Card, Tab Item, Input Field,
  Select Field, Toggle, Slider, and Table Row.
- Corgi UI: Weight Bar, Score Row, Receipt Card, Rank Movement Chip, Policy
  Preset Button, Epoch Card, and CTA Row.
- Bluesky UI: Feed Post Card, Engagement Row, Corgi Annotation Rail, and Feed
  Thread Shell.
- Page patterns: Hero product stage, two-surface comparison, product education
  module, FAQ/proof band, and footer.

When adding new UI, prefer extending one of those families before inventing a
new visual pattern.

## Copy Rules

- Lead with product value and comprehension, not audit posture.
- Put reviewer/legal disclosure at the bottom or in supporting copy unless it is
  needed to avoid a misleading claim.
- Use lived-in demo data for marketing surfaces, but do not imply sample posts
  are live production Bluesky posts.
- Keep `/demo` and receipt-backed pages honest about live versus snapshot data.
- Prefer the sentence: "Bluesky shows the ordered posts. Corgi shows the
  receipt."
- **Do not use raw volume/throughput counts as proof** (posts ranked, authors,
  posts/day). A curated single-community feed's numbers invite a firehose-scale
  comparison and read as "toy," even when they don't mean that. Prove with
  mechanism instead — interpretable signals, community-set weights, the live feed
  link, and open code. (See `social-proof.tsx`.)

## Page Rhythm

Good Corgi pages usually follow this order:

1. A simple product promise.
2. One strong product stage that makes the mechanism visible.
3. A deeper explanation or replay module.
4. Proof, receipt, counterfactual, or live demo links.
5. A clear CTA: demo first, connect when ready.

Avoid stacking many similar explanatory cards. If two sections make the same
point, merge them into one stronger product moment.
