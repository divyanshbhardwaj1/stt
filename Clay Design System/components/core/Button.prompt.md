Clay's primary call-to-action button — use for the main action on a band; near-black fill, sentence-case label, 12px radius.

```jsx
<Button>Try free</Button>
<Button variant="secondary">Sign in</Button>
<Button variant="on-color">Get started</Button>   {/* over a saturated feature card */}
<Button variant="text">Learn more</Button>
```

Variants: `primary` (near-black, default), `secondary` (cream + hairline border), `on-color` (white — use over pink/teal/saturated cards), `text` (inline link). Sizes: `sm` / `md` (default, 44px) / `lg`. Pass `iconLeft` / `iconRight` for icons, `href` to render an anchor. Labels are always sentence case ("Try free", never "Try Free").
