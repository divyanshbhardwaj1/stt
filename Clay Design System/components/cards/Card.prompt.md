Clay quiet content card — use for product-UI mockups, testimonials, pricing tiers, expert cards, and CTA/hero surfaces (anything that is NOT a bright saturated feature card).

```jsx
<Card variant="plain">…product mockup…</Card>
<Card variant="cream">…testimonial quote…</Card>
<Card variant="featured">…featured pricing tier (deep teal)…</Card>
<Card variant="soft" padding="80px" radius="var(--radius-xl)">…CTA band…</Card>
```

Variants: `plain` (canvas + hairline, 16px radius — default), `cream` (surface-card fill, no border), `featured` (deep teal, white text — the featured pricing signal), `soft` (surface-soft cream band). Override `padding` / `radius` as needed.
