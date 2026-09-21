/* @ds-bundle: {"format":4,"namespace":"ClayDesignSystem_d1a48f","components":[{"name":"Card","sourcePath":"components/cards/Card.jsx"},{"name":"FeatureCard","sourcePath":"components/cards/FeatureCard.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Tab","sourcePath":"components/core/Tab.jsx"}],"sourceHashes":{"components/cards/Card.jsx":"bf154cade0ea","components/cards/FeatureCard.jsx":"c4ed66945107","components/core/Avatar.jsx":"952123619991","components/core/Badge.jsx":"856400dc6d2e","components/core/Button.jsx":"2d9cb2e832b7","components/core/Input.jsx":"5799f59875af","components/core/Tab.jsx":"b28fa30a908e","ui_kits/website/Experts.jsx":"01fd3405b8c9","ui_kits/website/Footer.jsx":"f93960186cf1","ui_kits/website/Home.jsx":"2d8cbfbac4c4","ui_kits/website/Nav.jsx":"9973812a90d0","ui_kits/website/Pricing.jsx":"39035b05176a","ui_kits/website/SignIn.jsx":"e635444abf1b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ClayDesignSystem_d1a48f = window.ClayDesignSystem_d1a48f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/cards/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Clay content card — quieter container for product mockups, testimonials,
 * pricing tiers, and expert cards. No saturated color; relies on hairline
 * or cream fill. For the bright brand cards use FeatureCard instead.
 */
function Card({
  variant = "plain",
  padding,
  radius,
  children,
  style = {},
  ...rest
}) {
  const variants = {
    // canvas + hairline — product mockups, pricing tiers, expert cards
    plain: {
      background: "var(--color-canvas)",
      border: "1px solid var(--color-hairline)",
      color: "var(--color-ink)"
    },
    // cream fill, no border — testimonials, secondary cards
    cream: {
      background: "var(--color-surface-card)",
      border: "1px solid transparent",
      color: "var(--color-ink)"
    },
    // deep teal — featured pricing tier
    featured: {
      background: "var(--color-brand-teal)",
      border: "1px solid transparent",
      color: "var(--color-on-dark)"
    },
    // soft cream band — CTA / hero-illustration surfaces
    soft: {
      background: "var(--color-surface-soft)",
      border: "1px solid transparent",
      color: "var(--color-ink)"
    }
  };
  const v = variants[variant] || variants.plain;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      ...v,
      borderRadius: radius || "var(--radius-lg)",
      padding: padding || "var(--space-lg)",
      boxSizing: "border-box",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/Card.jsx", error: String((e && e.message) || e) }); }

// components/cards/FeatureCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Clay saturated feature card — the brand's signature voltage element.
 * One of 6 fills (pink, teal, lavender, peach, ochre, cream), 24px radius,
 * 32px padding. Text auto-flips to white on pink/teal. `children` holds a
 * product-UI fragment or illustration shown below the copy.
 */
function FeatureCard({
  color = "pink",
  eyebrow,
  title,
  description,
  children,
  style = {},
  ...rest
}) {
  const fills = {
    pink: {
      background: "var(--color-brand-pink)",
      dark: false
    },
    teal: {
      background: "var(--color-brand-teal)",
      dark: true
    },
    lavender: {
      background: "var(--color-brand-lavender)",
      dark: false
    },
    peach: {
      background: "var(--color-brand-peach)",
      dark: false
    },
    ochre: {
      background: "var(--color-brand-ochre)",
      dark: false
    },
    cream: {
      background: "var(--color-surface-card)",
      dark: false
    }
  };
  const f = fills[color] || fills.pink;
  // pink + teal carry white text; lighter fills keep dark ink
  const onColor = color === "pink" || color === "teal";
  const ink = onColor ? "var(--color-on-primary)" : "var(--color-ink)";
  const sub = onColor ? "rgba(255,255,255,.82)" : "var(--color-body)";
  const eye = onColor ? "rgba(255,255,255,.7)" : "var(--color-muted)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: f.background,
      color: ink,
      borderRadius: "var(--radius-xl)",
      padding: "var(--space-xl)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)",
      boxSizing: "border-box",
      ...style
    }
  }, rest), eyebrow && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-caption-uppercase)",
      letterSpacing: "var(--tracking-caption-uppercase)",
      textTransform: "uppercase",
      color: eye
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--text-title-lg)",
      letterSpacing: "var(--tracking-title-lg)",
      color: ink
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--text-body-md)",
      color: sub,
      textWrap: "pretty"
    }
  }, description), children && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-xs)"
    }
  }, children));
}
Object.assign(__ds_scope, { FeatureCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/FeatureCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Avatar.jsx
try { (() => {
/**
 * Clay avatar — circular, used in testimonials and expert cards.
 * Shows an image when `src` is set, else initials on a brand-tinted fill.
 */
function Avatar({
  src,
  name = "",
  size = 40,
  tone = "lavender",
  style = {}
}) {
  const tones = {
    lavender: {
      background: "var(--color-brand-lavender)",
      color: "var(--color-ink)"
    },
    peach: {
      background: "var(--color-brand-peach)",
      color: "var(--color-ink)"
    },
    mint: {
      background: "var(--color-brand-mint)",
      color: "var(--color-ink)"
    },
    ochre: {
      background: "var(--color-brand-ochre)",
      color: "var(--color-ink)"
    },
    teal: {
      background: "var(--color-brand-teal)",
      color: "var(--color-on-dark)"
    }
  };
  const initials = name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const dim = {
    width: size,
    height: size,
    borderRadius: "var(--radius-full)",
    flex: "none"
  };
  if (src) {
    return /*#__PURE__*/React.createElement("img", {
      src: src,
      alt: name,
      style: {
        ...dim,
        objectFit: "cover",
        ...style
      }
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...dim,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--text-title-sm)",
      fontSize: Math.round(size * 0.38),
      ...(tones[tone] || tones.lavender),
      ...style
    }
  }, initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Clay badge / pill label. Default = cream-fill caption pill.
 * Tones map to the brand palette for category accents.
 */
function Badge({
  tone = "cream",
  uppercase = false,
  children,
  style = {},
  ...rest
}) {
  const tones = {
    cream: {
      background: "var(--color-surface-card)",
      color: "var(--color-ink)"
    },
    pink: {
      background: "var(--color-brand-pink)",
      color: "var(--color-on-primary)"
    },
    teal: {
      background: "var(--color-brand-teal)",
      color: "var(--color-on-dark)"
    },
    lavender: {
      background: "var(--color-brand-lavender)",
      color: "var(--color-ink)"
    },
    peach: {
      background: "var(--color-brand-peach)",
      color: "var(--color-ink)"
    },
    ochre: {
      background: "var(--color-brand-ochre)",
      color: "var(--color-ink)"
    },
    success: {
      background: "rgba(34,197,94,.16)",
      color: "#137a3b"
    },
    warning: {
      background: "rgba(245,158,11,.16)",
      color: "#9a6206"
    },
    error: {
      background: "rgba(239,68,68,.14)",
      color: "#b3261e"
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: uppercase ? "5px 12px" : "4px 12px",
      borderRadius: "var(--radius-pill)",
      font: uppercase ? "var(--text-caption-uppercase)" : "var(--text-caption)",
      letterSpacing: uppercase ? "var(--tracking-caption-uppercase)" : "0",
      textTransform: uppercase ? "uppercase" : "none",
      whiteSpace: "nowrap",
      ...(tones[tone] || tones.cream),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Clay Button — near-black primary CTA with friendly 12px radius.
 * Variants: primary (default), secondary (cream + hairline), on-color
 * (white, for use over saturated feature cards), text (inline link).
 */
function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  iconLeft = null,
  iconRight = null,
  href,
  children,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      height: 36,
      padding: "0 14px",
      font: "var(--text-button)"
    },
    md: {
      height: 44,
      padding: "0 20px",
      font: "var(--text-button)"
    },
    lg: {
      height: 52,
      padding: "0 28px",
      font: "var(--text-title-sm)"
    }
  };
  const sz = sizes[size] || sizes.md;
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: sz.height,
    padding: sz.padding,
    font: sz.font,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap",
    transition: "background-color .15s ease, color .15s ease",
    boxSizing: "border-box"
  };
  const variants = {
    primary: {
      background: disabled ? "var(--color-primary-disabled)" : "var(--color-primary)",
      color: disabled ? "var(--color-muted)" : "var(--color-on-primary)"
    },
    secondary: {
      background: "var(--color-canvas)",
      color: disabled ? "var(--color-muted)" : "var(--color-ink)",
      borderColor: "var(--color-hairline)"
    },
    "on-color": {
      background: "var(--color-canvas)",
      color: "var(--color-ink)"
    },
    text: {
      background: "transparent",
      color: disabled ? "var(--color-muted)" : "var(--color-ink)",
      height: "auto",
      padding: 0,
      borderRadius: 0
    }
  };
  const cssStyle = {
    ...base,
    ...(variants[variant] || variants.primary),
    ...style
  };
  const Tag = href && !disabled ? "a" : "button";
  return /*#__PURE__*/React.createElement(Tag, _extends({
    href: href,
    disabled: Tag === "button" ? disabled : undefined,
    style: cssStyle
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Clay text input — cream fill, 1px hairline, 12px radius, 44px tall.
 * Border thickens to ink on focus.
 */
function Input({
  label,
  hint,
  error,
  type = "text",
  disabled = false,
  style = {},
  id,
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const inputId = id || (label ? `in-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const borderColor = error ? "var(--color-error)" : focused ? "var(--color-ink)" : "var(--color-hairline)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      font: "var(--text-caption)",
      color: "var(--color-body-strong)"
    }
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: type,
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      height: "44px",
      padding: "0 16px",
      font: "var(--text-body-md)",
      color: "var(--color-ink)",
      background: disabled ? "var(--color-surface-card)" : "var(--color-canvas)",
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-md)",
      outline: "none",
      boxSizing: "border-box",
      transition: "border-color .15s ease"
    }
  }, rest)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-caption)",
      color: error ? "var(--color-error)" : "var(--color-muted)"
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Tab.jsx
try { (() => {
/**
 * Clay category tabs — pill-shaped sub-nav. Active tab gets a cream-card
 * fill + ink text; inactive tabs are transparent + muted.
 */
function Tab({
  items = [],
  value,
  onChange = () => {},
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      gap: "4px",
      flexWrap: "wrap",
      ...style
    }
  }, items.map(it => {
    const key = typeof it === "string" ? it : it.value;
    const label = typeof it === "string" ? it : it.label;
    const active = key === value;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      onClick: () => onChange(key),
      style: {
        padding: "8px 16px",
        borderRadius: "var(--radius-pill)",
        border: "none",
        cursor: "pointer",
        font: "var(--text-nav-link)",
        background: active ? "var(--color-surface-card)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-muted)",
        transition: "background-color .15s ease, color .15s ease"
      }
    }, label);
  }));
}
Object.assign(__ds_scope, { Tab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tab.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Experts.jsx
try { (() => {
const {
  Button: EBtn,
  Badge: EBadge,
  Card: ECard,
  Tab: ETab,
  Avatar: EAvatar
} = window.ClayDesignSystem_d1a48f;
const expertsWrap = {
  maxWidth: "var(--container-max)",
  margin: "0 auto",
  padding: "0 32px"
};
const EXPERTS = [{
  n: "Mei Lin",
  s: "Outbound sequences",
  t: "lavender",
  r: "$180/hr",
  loc: "San Francisco"
}, {
  n: "Devon Rao",
  s: "Claygent & AI research",
  t: "peach",
  r: "$150/hr",
  loc: "Austin"
}, {
  n: "Sara Kade",
  s: "CRM enrichment",
  t: "mint",
  r: "$165/hr",
  loc: "Berlin"
}, {
  n: "Theo Vance",
  s: "RevOps architecture",
  t: "ochre",
  r: "$210/hr",
  loc: "London"
}, {
  n: "Priya Nair",
  s: "Inbound routing",
  t: "pink",
  r: "$140/hr",
  loc: "Bangalore"
}, {
  n: "Jonas Alt",
  s: "Data waterfalls",
  t: "teal",
  r: "$175/hr",
  loc: "Toronto"
}];
function ExpertCard({
  e
}) {
  return /*#__PURE__*/React.createElement(ECard, {
    padding: "24px"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(EAvatar, {
    name: e.n,
    tone: e.t,
    size: 44
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-title-sm)"
    }
  }, e.n), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, e.loc))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement(EBadge, null, e.s)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, e.r), /*#__PURE__*/React.createElement(EBtn, {
    variant: "secondary",
    size: "sm"
  }, "Book session")));
}
function Experts() {
  const [tab, setTab] = React.useState("All");
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    style: {
      ...expertsWrap,
      paddingTop: 72,
      paddingBottom: 48
    }
  }, /*#__PURE__*/React.createElement(EBadge, {
    uppercase: true
  }, "Clay experts"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--text-display-lg)",
      letterSpacing: "var(--tracking-display-lg)",
      margin: "16px 0 0",
      maxWidth: 640,
      textWrap: "balance"
    }
  }, "Work with an expert who has built it before"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-title-md)",
      fontWeight: 400,
      color: "var(--color-body)",
      maxWidth: 520,
      margin: "20px 0 0"
    }
  }, "Vetted operators who set up tables, agents, and sequences for teams like yours."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32
    }
  }, /*#__PURE__*/React.createElement(ETab, {
    items: ["All", "Outbound", "AI agents", "RevOps"],
    value: tab,
    onChange: setTab
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      ...expertsWrap,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16
    }
  }, EXPERTS.map(e => /*#__PURE__*/React.createElement(ExpertCard, {
    key: e.n,
    e: e
  })))), /*#__PURE__*/React.createElement("section", {
    style: {
      ...expertsWrap,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement(ECard, {
    variant: "soft",
    radius: "var(--radius-xl)",
    padding: "0"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr",
      alignItems: "center",
      gap: 32,
      padding: 64
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--text-display-md)",
      letterSpacing: "var(--tracking-display-md)",
      margin: 0,
      textWrap: "balance"
    }
  }, "Become a Clay expert"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-body-md)",
      color: "var(--color-body)",
      margin: "16px 0 0",
      maxWidth: 420
    }
  }, "Get matched with teams that need your playbooks."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement(EBtn, {
    size: "lg"
  }, "Apply now"))), /*#__PURE__*/React.createElement(window.ClayIllustration, {
    height: 200,
    blobs: ["ochre", "mint", "coral", "lavender"],
    label: "Expert scene"
  })))));
}
window.Experts = Experts;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Experts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Footer.jsx
try { (() => {
const {
  Badge: FooterBadge
} = window.ClayDesignSystem_d1a48f;
function Footer() {
  const cols = [{
    h: "Product",
    items: ["Tables", "Claygent", "Sequences", "Integrations", "Pricing"]
  }, {
    h: "Solutions",
    items: ["Sales", "Marketing", "RevOps", "Recruiting", "Startups"]
  }, {
    h: "Resources",
    items: ["Blog", "University", "Templates", "Community", "Docs"]
  }, {
    h: "Company",
    items: ["About", "Careers", "Customers", "Experts", "Contact"]
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "var(--color-surface-soft)",
      borderTop: "1px solid var(--color-hairline-soft)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      padding: "80px 32px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(window.Logo, null), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)",
      maxWidth: 240,
      marginTop: 16
    }
  }, "Go to market with unique data and AI. Built for revenue teams.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-title-sm)",
      marginBottom: 14
    }
  }, c.h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, c.items.map(i => /*#__PURE__*/React.createElement("a", {
    key: i,
    style: {
      cursor: "pointer",
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, i)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 56,
      height: 120,
      borderRadius: "var(--radius-lg)",
      background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-brand-peach) 35%, var(--color-surface-soft)))",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: -40,
      left: "8%",
      width: 180,
      height: 180,
      borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      background: "color-mix(in srgb, var(--color-brand-ochre) 60%, var(--color-surface-strong))"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: -60,
      left: "34%",
      width: 240,
      height: 220,
      borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      background: "color-mix(in srgb, var(--color-brand-teal) 22%, var(--color-surface-strong))"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: -40,
      right: "10%",
      width: 160,
      height: 150,
      borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
      background: "color-mix(in srgb, var(--color-brand-coral) 30%, var(--color-surface-strong))"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 12,
      textAlign: "center",
      font: "var(--text-caption)",
      color: "var(--color-muted-soft)"
    }
  }, "Signature footer mountain \u2014 illustration placeholder")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32,
      paddingTop: 24,
      borderTop: "1px solid var(--color-hairline)",
      display: "flex",
      justifyContent: "space-between",
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Clay Labs, Inc."), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("a", {
    style: {
      cursor: "pointer",
      color: "inherit"
    }
  }, "Privacy"), /*#__PURE__*/React.createElement("a", {
    style: {
      cursor: "pointer",
      color: "inherit"
    }
  }, "Terms"), /*#__PURE__*/React.createElement("a", {
    style: {
      cursor: "pointer",
      color: "inherit"
    }
  }, "Security")))));
}
window.Footer = Footer;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Footer.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Home.jsx
try { (() => {
const {
  Button: HBtn,
  Badge: HBadge,
  FeatureCard,
  Card,
  Avatar
} = window.ClayDesignSystem_d1a48f;
const homeWrap = {
  maxWidth: "var(--container-max)",
  margin: "0 auto",
  padding: "0 32px"
};

// ── product-UI fragments shown inside feature cards ───────────────
function EnrichFrag() {
  const rows = [["Acme Inc", "Verified"], ["Lumen Co", "Verified"], ["Northwind", "Enriching…"]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "rgba(255,255,255,.92)",
      borderRadius: "var(--radius-md)",
      padding: 12,
      color: "var(--color-ink)"
    }
  }, rows.map(([a, b], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 4px",
      borderBottom: i < 2 ? "1px solid var(--color-hairline)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-body-sm)"
    }
  }, a), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-caption)",
      color: b === "Verified" ? "var(--color-success)" : "var(--color-muted)"
    }
  }, b))));
}
function AgentFrag() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "rgba(255,255,255,.14)",
      borderRadius: "var(--radius-md)",
      padding: 14,
      font: "var(--text-body-sm)",
      lineHeight: 1.7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: .7
    }
  }, "\u2192 Researching funding rounds\u2026"), /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: .85
    }
  }, "\u2192 Found Series B \xB7 $40M"), /*#__PURE__*/React.createElement("div", null, "\u2713 Wrote to column \"Stage\""));
}
function SeqFrag() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, ["Email", "Wait 2d", "LinkedIn"].map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "rgba(255,255,255,.92)",
      color: "var(--color-ink)",
      font: "var(--text-caption)",
      padding: "8px 12px",
      borderRadius: "var(--radius-pill)"
    }
  }, s), i < 2 && /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .6
    }
  }, "\u2192"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      ...homeWrap,
      paddingTop: 72,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.15fr 1fr",
      gap: 56,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HBadge, {
    uppercase: true
  }, "GTM data platform"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--text-display-xl)",
      letterSpacing: "var(--tracking-display-xl)",
      margin: "20px 0 0",
      textWrap: "balance"
    }
  }, "Go to market with unique data"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-title-md)",
      fontWeight: 400,
      color: "var(--color-body)",
      maxWidth: 460,
      margin: "24px 0 0",
      textWrap: "pretty"
    }
  }, "Pull from 100+ providers, run AI research agents, and push clean records straight into your sequences and CRM."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      marginTop: 32
    }
  }, /*#__PURE__*/React.createElement(HBtn, {
    size: "lg"
  }, "Try free"), /*#__PURE__*/React.createElement(HBtn, {
    size: "lg",
    variant: "secondary"
  }, "Book a demo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 24,
      marginTop: 40,
      alignItems: "center",
      font: "var(--text-caption)",
      color: "var(--color-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Trusted by 8,000+ teams"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 14,
      opacity: .7
    }
  }, ["Ramp", "Vanta", "OpenAI", "Notion"].map(b => /*#__PURE__*/React.createElement("strong", {
    key: b,
    style: {
      fontWeight: 600
    }
  }, b))))), /*#__PURE__*/React.createElement(window.ClayIllustration, {
    height: 400,
    blobs: ["pink", "ochre", "lavender", "mint"]
  })));
}
function FeatureSection() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--color-surface-soft)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...homeWrap,
      paddingTop: 96,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 620,
      marginBottom: 48
    }
  }, /*#__PURE__*/React.createElement(HBadge, {
    uppercase: true
  }, "The platform"), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--text-display-lg)",
      letterSpacing: "var(--tracking-display-lg)",
      margin: "16px 0 0"
    }
  }, "Everything your GTM data needs")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(FeatureCard, {
    color: "pink",
    eyebrow: "Sequences",
    title: "Run outbound in one click",
    description: "Push enriched records into multi-step plays."
  }, /*#__PURE__*/React.createElement(SeqFrag, null)), /*#__PURE__*/React.createElement(FeatureCard, {
    color: "lavender",
    eyebrow: "Claygent",
    title: "AI research agents",
    description: "Agents find what static data can't."
  }, /*#__PURE__*/React.createElement(AgentFrag, null)), /*#__PURE__*/React.createElement(FeatureCard, {
    color: "peach",
    eyebrow: "Enrichment",
    title: "Waterfall across 100+ sources",
    description: "Always get the best available record."
  }, /*#__PURE__*/React.createElement(EnrichFrag, null)))));
}
function Testimonials() {
  const data = [{
    q: "Clay replaced five tools and cut our research time by 80%.",
    n: "Mei Lin",
    r: "Head of Growth, Ramp",
    t: "lavender"
  }, {
    q: "We build lists in minutes that used to take an analyst a week.",
    n: "Devon Rao",
    r: "RevOps Lead, Vanta",
    t: "peach"
  }, {
    q: "Claygent is the first AI that actually does the boring work.",
    n: "Sara Kade",
    r: "Founder, Northwind",
    t: "mint"
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      ...homeWrap,
      paddingTop: 96,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--text-display-md)",
      letterSpacing: "var(--tracking-display-md)",
      margin: "0 0 40px",
      maxWidth: 520
    }
  }, "Loved by revenue teams"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16
    }
  }, data.map(d => /*#__PURE__*/React.createElement(Card, {
    key: d.n,
    variant: "cream",
    padding: "28px"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-title-md)",
      fontWeight: 500,
      margin: "0 0 24px",
      textWrap: "pretty"
    }
  }, "\"", d.q, "\""), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: d.n,
    tone: d.t
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-title-sm)"
    }
  }, d.n), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, d.r)))))));
}
function CtaBand() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      ...homeWrap,
      paddingBottom: 96
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "soft",
    radius: "var(--radius-xl)",
    padding: "0"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr",
      alignItems: "center",
      gap: 32,
      padding: 64
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--text-display-md)",
      letterSpacing: "var(--tracking-display-md)",
      margin: 0,
      textWrap: "balance"
    }
  }, "Turn your growth ideas into reality today"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement(HBtn, {
    size: "lg"
  }, "Try free"), /*#__PURE__*/React.createElement(HBtn, {
    size: "lg",
    variant: "secondary"
  }, "Talk to sales"))), /*#__PURE__*/React.createElement(window.ClayIllustration, {
    height: 200,
    blobs: ["coral", "ochre", "mint", "lavender"],
    label: "Mascot scene"
  }))));
}
function Home() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(FeatureSection, null), /*#__PURE__*/React.createElement(Testimonials, null), /*#__PURE__*/React.createElement(CtaBand, null));
}
window.Home = Home;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Nav.jsx
try { (() => {
// Clay marketing-site nav + shared bits. Exports to window for the kit.
const {
  Button,
  Badge
} = window.ClayDesignSystem_d1a48f;
function Logo() {
  return (
    /*#__PURE__*/
    // No logo asset was supplied — the wordmark is set in plain display type.
    React.createElement("span", {
      style: {
        font: "var(--text-title-lg)",
        fontWeight: 500,
        letterSpacing: "-0.04em"
      }
    }, "Clay")
  );
}
function Nav({
  page,
  onNav
}) {
  const links = ["Product", "Solutions", "Experts", "Pricing", "Customers"];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      height: 64,
      background: "color-mix(in srgb, var(--color-canvas) 88%, transparent)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid var(--color-hairline-soft)",
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      width: "100%",
      margin: "0 auto",
      padding: "0 32px",
      display: "flex",
      alignItems: "center",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => onNav("home"),
    style: {
      cursor: "pointer",
      textDecoration: "none"
    }
  }, /*#__PURE__*/React.createElement(Logo, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      flex: 1
    }
  }, links.map(l => {
    const target = l.toLowerCase();
    const active = page === target;
    return /*#__PURE__*/React.createElement("a", {
      key: l,
      onClick: () => onNav(target),
      style: {
        cursor: "pointer",
        padding: "8px 12px",
        borderRadius: "var(--radius-sm)",
        font: "var(--text-nav-link)",
        color: active ? "var(--color-ink)" : "var(--color-muted)"
      }
    }, l);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => onNav("signin"),
    style: {
      cursor: "pointer",
      font: "var(--text-nav-link)",
      color: "var(--color-ink)"
    }
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, null, "Try free"))));
}

// Cream illustration placeholder — stands in for Clay's commissioned 3D
// claymation art (not provided with the brief). Soft clay blobs + label.
function ClayIllustration({
  height = 360,
  blobs = ["pink", "ochre", "lavender", "mint"],
  label = "3D claymation illustration"
}) {
  const colorVar = c => `var(--color-brand-${c})`;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height,
      borderRadius: "var(--radius-xl)",
      background: "var(--color-surface-soft)",
      overflow: "hidden",
      border: "1px solid var(--color-hairline-soft)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 150,
      height: 150,
      borderRadius: "50%",
      background: colorVar(blobs[0]),
      top: "12%",
      left: "10%",
      filter: "blur(2px)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 120,
      height: 120,
      borderRadius: "50%",
      background: colorVar(blobs[1]),
      bottom: "14%",
      left: "32%"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 170,
      height: 170,
      borderRadius: "46% 54% 50% 50% / 55% 50% 50% 45%",
      background: colorVar(blobs[2]),
      top: "20%",
      right: "12%"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 90,
      height: 90,
      borderRadius: "50%",
      background: colorVar(blobs[3]),
      bottom: "10%",
      right: "26%"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 14,
      textAlign: "center",
      font: "var(--text-caption)",
      color: "var(--color-muted-soft)"
    }
  }, label, " \u2014 placeholder"));
}
window.Logo = Logo;
window.Nav = Nav;
window.ClayIllustration = ClayIllustration;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Nav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Pricing.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Button: PBtn,
  Badge: PBadge,
  Card: PCard,
  Tab: PTab
} = window.ClayDesignSystem_d1a48f;
function Check({
  on = "var(--color-ink)"
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      color: on,
      font: "var(--text-title-sm)",
      lineHeight: 1
    }
  }, "\u2713");
}
function PricingTier({
  name,
  price,
  blurb,
  features,
  featured,
  cta
}) {
  const ink = featured ? "var(--color-on-dark)" : "var(--color-ink)";
  const sub = featured ? "var(--color-on-dark-soft)" : "var(--color-muted)";
  return /*#__PURE__*/React.createElement(PCard, {
    variant: featured ? "featured" : "plain",
    padding: "32px",
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 20,
      marginTop: featured ? 0 : 30
    }
  }, featured && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PBadge, {
    tone: "ochre",
    uppercase: true
  }, "Most popular")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-title-lg)",
      letterSpacing: "var(--tracking-title-lg)",
      color: ink
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-body-sm)",
      color: sub,
      marginTop: 6
    }
  }, blurb)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-display-md)",
      letterSpacing: "var(--tracking-display-md)",
      color: ink
    }
  }, price), price !== "Custom" && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-body-sm)",
      color: sub
    }
  }, "/ month")), /*#__PURE__*/React.createElement(PBtn, {
    variant: featured ? "on-color" : "primary",
    style: {
      width: "100%"
    }
  }, cta), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      marginTop: 4
    }
  }, features.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      font: "var(--text-body-sm)",
      color: featured ? "var(--color-on-dark)" : "var(--color-body)"
    }
  }, /*#__PURE__*/React.createElement(Check, {
    on: featured ? "var(--color-brand-mint)" : "var(--color-success)"
  }), f))));
}
function Pricing() {
  const [cycle, setCycle] = React.useState("Monthly");
  const yearly = cycle === "Yearly";
  const tiers = [{
    name: "Starter",
    price: "$0",
    blurb: "For trying things out",
    cta: "Try free",
    features: ["1,200 credits / mo", "1 user", "10 data sources", "Community support"]
  }, {
    name: "Explorer",
    price: yearly ? "$119" : "$149",
    blurb: "For individual operators",
    cta: "Start free trial",
    features: ["10,000 credits / mo", "Unlimited tables", "Claygent agents", "100+ data sources"]
  }, {
    name: "Team",
    price: yearly ? "$279" : "$349",
    blurb: "For growing GTM teams",
    cta: "Start free trial",
    featured: true,
    features: ["50,000 credits / mo", "Roles & permissions", "CRM sync", "Priority support"]
  }, {
    name: "Enterprise",
    price: "Custom",
    blurb: "For scaled orgs",
    cta: "Talk to sales",
    features: ["Custom credits", "SSO & SAML", "Audit logs", "Dedicated CSM"]
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      padding: "72px 32px 96px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 40
    }
  }, /*#__PURE__*/React.createElement(PBadge, {
    uppercase: true
  }, "Pricing"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--text-display-lg)",
      letterSpacing: "var(--tracking-display-lg)",
      margin: "16px 0 0",
      textWrap: "balance"
    }
  }, "Pricing that scales with you"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-title-md)",
      fontWeight: 400,
      color: "var(--color-body)",
      margin: "16px auto 0",
      maxWidth: 480
    }
  }, "Start free. Pay for the credits you use as your team grows."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center",
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement(PTab, {
    items: ["Monthly", "Yearly"],
    value: cycle,
    onChange: setCycle
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 16,
      alignItems: "start"
    }
  }, tiers.map(t => /*#__PURE__*/React.createElement(PricingTier, _extends({
    key: t.name
  }, t)))));
}
window.Pricing = Pricing;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Pricing.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/SignIn.jsx
try { (() => {
const {
  Button: SBtn,
  Input: SInput,
  Card: SCard,
  Badge: SBadge
} = window.ClayDesignSystem_d1a48f;
function SignIn({
  onNav
}) {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      minHeight: "calc(100vh - 64px)",
      alignItems: "center",
      gap: 64,
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      padding: "64px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 400
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--text-display-md)",
      letterSpacing: "var(--tracking-display-md)",
      margin: 0
    }
  }, sent ? "Check your inbox" : "Sign in to Clay"), sent ? /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-body-md)",
      color: "var(--color-body)",
      margin: "16px 0 32px"
    }
  }, "We sent a magic link to ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--color-ink)"
    }
  }, email || "you@company.com"), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-body-md)",
      color: "var(--color-body)",
      margin: "16px 0 32px"
    }
  }, "Use your work email \u2014 no password needed."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SInput, {
    label: "Work email",
    placeholder: "you@company.com",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), /*#__PURE__*/React.createElement(SBtn, {
    size: "lg",
    onClick: () => setSent(true)
  }, "Continue")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      margin: "24px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--color-hairline)",
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-caption)",
      color: "var(--color-muted-soft)"
    }
  }, "or"), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--color-hairline)",
      flex: 1
    }
  })), /*#__PURE__*/React.createElement(SBtn, {
    variant: "secondary",
    size: "lg",
    style: {
      width: "100%"
    }
  }, "Continue with Google")), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)",
      marginTop: 32
    }
  }, "New to Clay? ", /*#__PURE__*/React.createElement("a", {
    onClick: () => onNav && onNav("home"),
    style: {
      color: "var(--color-ink)",
      cursor: "pointer",
      textDecoration: "underline"
    }
  }, "Try it free"))), /*#__PURE__*/React.createElement(SCard, {
    variant: "cream",
    radius: "var(--radius-xl)",
    padding: "40px"
  }, /*#__PURE__*/React.createElement(SBadge, {
    uppercase: true
  }, "Why teams switch"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--text-title-lg)",
      letterSpacing: "var(--tracking-title-lg)",
      margin: "20px 0 28px",
      textWrap: "pretty"
    }
  }, "\"Clay replaced five tools and cut our research time by 80%.\""), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--text-body-sm)",
      color: "var(--color-muted)"
    }
  }, "Mei Lin \xB7 Head of Growth, Ramp")));
}
window.SignIn = SignIn;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/SignIn.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Card = __ds_scope.Card;

__ds_ns.FeatureCard = __ds_scope.FeatureCard;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Tab = __ds_scope.Tab;

})();
