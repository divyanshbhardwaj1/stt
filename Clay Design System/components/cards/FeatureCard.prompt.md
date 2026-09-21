Clay's signature saturated feature card — use to punctuate long-scroll pages; cycle the color across cards (pink → teal → lavender → peach → ochre → cream) and never repeat a color back-to-back.

```jsx
<FeatureCard
  color="pink"
  eyebrow="Outbound"
  title="Sequence in one click"
  description="Push enriched records straight into your outbound flows."
>
  {/* optional product-UI fragment or illustration */}
</FeatureCard>
```

Text auto-flips to white on `pink` and `teal`; lighter fills (`lavender`, `peach`, `ochre`, `cream`) keep dark ink. 24px radius, 32px padding, no shadow — the color fill carries it. Pick color by feature: pink = outbound/sequencer, teal = enterprise/featured, lavender = AI agents, peach = general, ochre = community/experts.
