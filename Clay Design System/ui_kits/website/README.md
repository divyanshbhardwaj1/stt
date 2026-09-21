# Clay marketing-site UI kit

A high-fidelity recreation of Clay's (clay.com) marketing surface, composed entirely from this design system's component primitives (`window.ClayDesignSystem_d1a48f`).

## Run it
Open `index.html`. The nav is interactive — click **Experts**, **Pricing**, or **Sign in** to switch screens; the logo / other links return home.

## Screens
- **Home** (`Home.jsx`) — hero (7/5 split), saturated 3-up feature cards with embedded product-UI fragments, testimonials, and the "Turn your growth ideas into reality today" CTA band.
- **Pricing** (`Pricing.jsx`) — four tiers with a deep-teal featured tier and a Monthly/Yearly toggle.
- **Experts** (`Experts.jsx`) — /experts listing: pill category tabs, a 3-up grid of `expert-card`s (avatar, specialization badge, rate, Book session), and a "Become a Clay expert" CTA band.
- **Sign in** (`SignIn.jsx`) — split magic-link sign-in with focused-input state and a cream testimonial panel; footer is suppressed on this screen.
- **Nav.jsx** — sticky cream nav + `ClayIllustration` placeholder helper.
- **Footer.jsx** — cream 4-column footer with the signature horizon-mountain placeholder.

## Notes & substitutions
- **Claymation illustrations are placeholders.** No commissioned 3D assets were provided, so `ClayIllustration` renders soft brand-color clay blobs with a clear "placeholder" label. Drop the real assets in to finish the heroes, CTA band, and footer mountain.
- Display headlines use the **Inter 500 + negative-tracking** Plain Black substitute (see root `readme.md`).
- Built to copy Clay's existing layout — not a redesign. Sections beyond the core set are intentionally omitted rather than invented.
