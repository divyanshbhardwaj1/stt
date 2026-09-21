# Clay Design System

A claymation-meets-data design system for **Clay** (clay.com) — a GTM (go-to-market) data-orchestration platform. Clay is the most playful B2B SaaS brand in the GTM-data category: it anchors on a warm **cream-tinted white canvas**, dark-navy primary CTAs, a custom rounded display typeface, and **saturated single-color feature cards** (hot pink, deep teal, lavender, peach, ochre, cream) that punctuate long-scroll explainer pages. The brand's most-recognized voltage comes from **3D-rendered claymation illustrations** — mountains, characters, mascots — used as full-bleed hero artifacts.

## Sources

- **Mounted codebase `Clay Design System/`** — an earlier build of this same design system (tokens, guidelines cards, component primitives, marketing UI kit) was attached read-only and is the direct source for this project. Everything here was ported from it verbatim, then extended (more specimen cards, two more UI-kit screens, project thumbnail).
- `guidelines/DESIGN.md` — the full brand/design analysis the system is built from (colors, typography, spacing, component specs, do's & don'ts, responsive behavior). Originally `uploads/DESIGN.md` in the mounted folder.
- No Clay codebase, Figma file, or brand asset package was provided — no logos, illustrations, or font binaries. Product-UI fragments in feature cards are faithful approximations driven by the design analysis, not extracted from Clay's real source.

## What Clay does

Clay lets revenue teams enrich, orchestrate, and act on go-to-market data. Customers build "tables" that pull from 100+ data providers, run AI research agents ("Claygent"), and push enriched records into outbound sequencers and CRMs. The marketing surface explains this through colorful, illustration-rich long-scroll pages.

---

## Content fundamentals

**Voice:** Confident, plain-spoken, and warm — never jargon-heavy or breathless. Clay sells a technical product but speaks like a smart, friendly operator.

- **Person:** Speaks to **"you"** ("Go to market with unique data", "Turn your growth ideas into reality"). First-person plural ("we") only in support/company contexts.
- **Casing:** **Sentence case** everywhere — headlines, buttons, nav. No Title Case CTAs. Section eyebrows are the one exception: short ALL-CAPS labels with wide tracking (`caption-uppercase`).
- **Headlines:** Short, declarative, benefit-led. "Go to market with unique data." "Turn your growth ideas into reality today." Verb-first or noun-led; rarely a full sentence with a period unless conversational.
- **Body:** Concrete and product-driven. Names real capabilities (Claygent, sequences, enrichment) rather than abstract value props.
- **Buttons:** Action verbs, sentence case — "Try free", "Sign in", "Book a demo", "Get started". Short (1–3 words).
- **Emoji:** Not used in product/marketing copy. Brand warmth comes from illustration and color, not emoji.
- **Tone examples:** "Sign in" not "Log In To Your Account". "Try free" not "Start Your Free Trial Now". Friendly, low-pressure, never salesy-aggressive.

---

## Visual foundations

**Canvas & atmosphere.** Every page floors on **cream-tinted white** (`--color-canvas` #fffaf0) — the warm tint is non-negotiable and is what differentiates Clay from cool-gray data competitors. Even the footer stays cream (`--color-surface-soft`); Clay deliberately does **not** use a dark footer.

**Color.** Dark near-black ink (#0a0a0a) for type and primary CTAs. The brand's energy is a **6-color saturated feature-card palette** — pink → teal → lavender → peach → ochre → cream — cycled (never repeated back-to-back) down long pages. Text flips to white on pink/teal cards, stays dark ink on the lighter lavender/peach/ochre/cream cards. Semantic colors (success/warning/error) are reserved for product UI states.

**Type.** Display headlines use **Plain Black** (Clay's proprietary rounded display face) at weight **500** with negative letter-spacing (−1 to −2.5px) — the rounded character gives warmth without needing heavier weight; going past 500 reads as bombastic. Body/UI/nav use **Inter** at standard weights. The display-vs-body split is functional and mixing them is a system violation. *(Plain Black is unlicensed for the web — see Caveats; this system substitutes Inter 500 with negative tracking, Clay's own recommended fallback.)*

**Spacing & layout.** 4px base unit; tokens xxs(4) → section(96). Major editorial bands are separated by **96px** vertical rhythm. Max content width ~1280px centered. Hero uses a 7/5 split (headline left, illustration right). Feature grids are 3-up desktop → 2-up tablet → 1-up mobile.

**Shape & radius.** Generous, friendly radii that match the rounded display type: **12px** (md) for buttons + inputs, **16px** (lg) for content cards, **24px** (xl) for the saturated feature cards, pill (9999px) for tabs and badges.

**Backgrounds.** Flat cream — no gradients, no full-bleed photography. The hero/CTA artifacts are **3D claymation illustrations** (commissioned assets, not tokens): hand-crafted mountains, mascot characters, abstract shapes. A signature **horizon mountain** illustration often anchors the footer.

**Elevation & depth.** Almost no shadows. Depth comes from the color contrast between cream canvas and bright saturated cards. Inputs and small content cards get a 1px `--color-hairline` border; feature cards rely on their color fill with no shadow. A faint drop shadow appears only on rare hover-elevated states.

**Borders.** 1px hairlines (`#e5e5e5`) on inputs and quieter cards. Saturated feature cards have no border — the fill carries them.

**Animation & motion.** Restrained. The analysis does not formalize timings; entrance fades and gentle scroll parallax on the 3D illustrations are in the spirit of the brand. No bouncy/springy UI motion, no infinite loops.

**Hover / press.** The system deliberately under-specifies hover (primary button darkens to `--color-primary-active` #1f1f1f; that's the encoded state). Don't invent extra hover styling beyond what's encoded.

**Transparency / blur.** Not a brand motif — surfaces are opaque cream or saturated fills.

**Imagery vibe.** Warm, tactile, hand-sculpted 3D claymation — saturated but soft, never cold/clinical, never grainy photographic.

---

## Iconography

The brand analysis does **not** ship a formal icon set, and no codebase/icon-font was provided. Observations and the approach this system takes:

- Clay's marketing surface leans on **3D claymation illustrations and product-UI fragments** for visual interest rather than a dense UI icon system. Icons play a supporting role (nav chevrons, small inline affordances, product-UI glyphs).
- **No emoji** are used as iconography. No reliance on unicode-glyph icons.
- For UI-level icons in components and kits, this system uses **Lucide** (`https://unpkg.com/lucide-static`) via CDN — a clean, rounded-cap, consistent-stroke open-source set whose soft stroke terminals match Clay's rounded, friendly character. **This is a substitution flagged for review** — Clay's real product may use a proprietary or different set.
- 3D claymation illustrations and named mascot characters are **commissioned per-page assets**, not tokens. None were provided with this analysis, so the kits use cream illustration-placeholder surfaces (`hero-illustration-card`) where those assets would sit. **Please supply the real illustration assets** to make heroes and CTA bands fully on-brand.

---

## Index / manifest

**Root**
- `styles.css` — global entry point (consumers link this). `@import` list only.
- `readme.md` — this file.
- `thumbnail.html` — homepage tile (cream canvas + "Clay" wordmark + brand swatch strip).
- `SKILL.md` — Agent-Skill manifest for downloadable use.

**`tokens/`** — CSS custom properties imported by `styles.css`
- `fonts.css` · `colors.css` · `typography.css` · `spacing.css`

**`guidelines/`** — `DESIGN.md` (full brand analysis) + 16 foundation specimen cards for the Design System tab:
- *Colors* — primary, text, surface, brand feature palette, semantic
- *Type* — display, body, support, negative-tracking rule
- *Spacing* — spacing scale, radius scale, elevation & borders, container & rhythm
- *Brand* — feature-card cycle, voice & casing, iconography

**`components/`** — reusable React primitives (namespace `window.ClayDesignSystem_d1a48f`)
- `core/` — `Button`, `Input`, `Badge`, `Tab`, `Avatar`
- `cards/` — `FeatureCard`, `Card`

**`ui_kits/`**
- `website/` — Clay marketing-site recreation. Screens: `Home.jsx` (hero, feature cards, testimonials, CTA band), `Pricing.jsx`, `Experts.jsx`, `SignIn.jsx`; shared `Nav.jsx` (+ `ClayIllustration` placeholder) and `Footer.jsx`. Click the nav in `index.html`.

**No `assets/`** — no logo, illustration, or font files were supplied. The wordmark is set in plain type everywhere a mark would go; see Caveats.

## Caveats

- **No brand assets at all** — no Clay logo or wordmark files, no claymation illustrations, no font binaries. Per policy the real mark was **not** drawn or reconstructed: the nav, thumbnail, and footer set "Clay" in plain display type, and hero/CTA artifacts use a cream `ClayIllustration` placeholder (soft brand-color blobs, labelled as a placeholder). **Supply the logo SVG and the 3D illustration renders** — they are the brand's signature and the single biggest fidelity gap.
- **Plain Black is unavailable** as a web font (proprietary to Clay). Substituted with **Inter 500 + negative letter-spacing** per Clay's own fallback guidance. Supply the real font files to upgrade.
- **Icon set substituted** with Lucide (CDN, stroke 1.5, rounded caps). Confirm or replace with Clay's real set.
- **Component inventory** is exactly what the source defined (Button, Input, Badge, Tab, Avatar, Card, FeatureCard) — nothing was invented beyond it.
- **Product UI (in-app tables, formula editor, agent builder) is out of scope** — no source was available for it, so only the marketing surface is recreated.
