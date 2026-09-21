Clay category tabs — pill-shaped sub-navigation for filtering content (solutions, resource categories, pricing toggles).

```jsx
const [tab, setTab] = React.useState("all");
<Tab items={["All", "Sales", "Marketing", "RevOps"]} value="All" onChange={setTab} />
<Tab items={[{label:"Monthly", value:"m"}, {label:"Yearly", value:"y"}]} value={tab} onChange={setTab} />
```

Active pill fills `surface-card` with ink text; inactive pills are transparent + muted. Accepts plain strings (value === label) or `{label, value}` objects.
