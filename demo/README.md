# Size Set Inspection — Clay design prototype

Open **`demo/index.html`** in a browser. No server, no build, no install.

This is a visual prototype only. Nothing here touches the real application: no
React component, route, stylesheet or backend file was modified, and nothing in
`demo/` is imported by anything outside it. All data is mock.

## The question this answers

> If we redesigned this product using the Clay design system, what would the
> actual product UI look and feel like?

## Screens

| File | Screen | What it shows |
|---|---|---|
| `logs.html` | **Activity** | Every stage has one — append-only, attributed, filterable by kind and person |
| `teams.html` | **Stages** | The four stages, your role on each, and who else is on them |
| `account.html` | **Account** | Your id and stages, password change, per-device preferences |
| `ppm.html` | **PPM** | Pre-production meeting — approvals, open points, the room |
| `interim.html` | **Line audit** | Interim — defect rate, defects by category, critical measurements |
| `final.html` | **Final inspection** | AQL plan, defect classification, accept or reject |
| `dashboard.html` | **Dashboard** | What is blocking a report from going out today — different hero, counts and queue per role |
| `index.html` | **Inspection report** | The main working screen: intake, verdict, the three review tables, extracted counts, report header, downloads |
| `audit.html` | **Graded sheet** | The centrepiece — every point of measure × every size, click a cell to correct it, playback per reading, staged corrections |
| `record.html` | **Recording** | Live capture, waveform, live transcript, crash-recovery banner, silence warning |
| `processing.html` | **In progress** | Stage list and skeletons — the loading state |
| `states.html` | **Other outcomes** | Failed · no spec sheet · passed · nothing selected (tabbed) |
| `library.html` | **Style sets** | Everyone — the buyer's graded sheets as a list, filterable, with the full specification behind each one. PDF-only upload |
| `signin.html` | **Sign in** | Id and password. Wrong id, or an invited account, fails for real |
| `members.html` | **Members** | Admin only — add, edit, change role, remove, plus the permission matrix. Changes persist |

**Navigation is the inspection list in the rail**, which is how the real app
works — you pick an inspection and the pane becomes that inspection. Each one
in the list is in a different state and goes to the screen for that state.
`audit.html` is reached from the report's "Open the graded sheet", and
`record.html` from "Record inspection".

## What actually works

Clicking a cell in the graded sheet opens the real editor: it shows that cell's
spec off the sheet, what was heard and at what confidence, and recomputes the
measurement as **spec + deviation** as you type — including the exact binary
fractions the sheets use (`11 1/2` + `-1/8` → `11 3/8`). Staging a correction
marks the cell and raises the unsaved-corrections bar. Tabs, the ⓘ popover, the
play/stop button and the modal's Escape key all work.

Nothing is saved anywhere. There is no audio file, so the play button only
shows the state change the real one makes.

## Teams — one per stage

Triburg checks a garment four times and they are not the same job done four
times, so each stage is a team and **the features belong to the stage**:

| Stage | What it is | What the workspace carries |
|---|---|---|
| **Size set** | One garment per size, every point of measure against the graded sheet | Recording, graded sheet, spec library, the report. **Nothing is released to a vendor here** — an approver signs the sheet off and the shipment is released at Final |
| **PPM** | The pre-production meeting, before bulk is cut | Approvals with owners and dates, open points, attendees |
| **Interim** | An audit of the line while bulk runs | Defect log by category, defect rate against a threshold, six critical measurements |
| **Final** | Final random inspection against an AQL plan | Sampling plan, critical/major/minor against accept and reject numbers, one word |

**Each stage keeps its own log.** `logs.html` is in every stage's nav and
shows only that stage's entries: a correction made on size set has no business
in a final inspector's trail, and an approver signing a lot off is not a
size-set event. Filter by kind (recording, correction, approval, defect,
decision, release, access) or by person, and the *By person* table underneath
answers the question a log is usually opened for — who to ask about an entry.

The kind filters are built from the log rather than hard-coded, so a stage
with no releases does not offer a Releases tab that returns nothing. The
dashboard's activity panel now reads the newest five lines of the same log
instead of keeping a second list that could disagree with it.

Switching stage switches the whole workspace — the nav, the work list in the
rail and the role under your name. Opening a size-set screen while standing in
Final is not a permission error, it is the wrong stage, so it gets its own
answer and a button back rather than a refusal.

**Roles are held per stage** (administrators excepted — see above).
`s.iqbal` is a QA reviewer on size set and interim but only an inspector on
final; `k.tanaka` is an approver on final and nothing anywhere else. A stage
you hold no role on does not open at all. This
is the part worth arguing with — collapsing it into one global role per person
is what forces a factory to keep two logins.

The `members.html` editor gives every member a role select per stage, with
*— not on this stage —* as a real option, and the roster still refuses to
strand itself: the last administrator **on the floor** cannot have the flag taken away or be
removed, and a member with neither the flag nor a stage is refused rather than
created.

## The dashboard

`dashboard.html` answers one question — *what is stopping a report going to
the vendor today* — and it is built role-first, because a reviewer and an
approver are blocked on different things and should not be handed the same
page.

| | Hero says | Queue | Counts |
|---|---|---|---|
| Inspector | Everything you recorded went through | Your recordings today | Recorded, processing, failed |
| QA reviewer | 4 inspections need a reviewer | Needs attention | Unanswered verdicts, out of tolerance, heard below 100% |
| Approver | 2 reports are ready to release | Waiting for release | Ready, released today, still with review |
| Administrator | 6 blocked, the oldest for a day | Blocked across the floor | Throughput, blocked, failed, library, people |

The inspector case is the one worth checking: they are shown their own
recordings, not the reviewer queue, because nothing in that queue is theirs to
settle. A reading the recording missed is the QA team's problem — except a take
that produced nothing, which is worth re-recording while the garments are still
out, and the row says so.

Counts are counts, never percentages: *76% complete* hides that the other 24%
is nine documents somebody has to open. The fortnight chart is drawn in CSS —
fourteen pairs of small integers do not justify a charting library — and plots
two numbers per day rather than one, because a busy day where half the reports
came out incomplete is not a good day.

## Roles and access

**Signing in takes an id and a password, and both are checked.**

| | id | password | reaches |
|---|---|---|---|
| **Administrator** | `admin` | `admin123` | every stage, every feature |
| Second administrator | `d.bhardwaj` | `demo123` | every stage |
| QA reviewer | `a.bhatt` | `demo123` | Size set, PPM |
| Reviewer / inspector | `s.iqbal` | `demo123` | Size set, Interim, Final |
| Approver | `p.grewal` | `demo123` | Size set, PPM, Final |
| Inspector | `r.menon` | `demo123` | Size set, Interim |
| Invited, cannot sign in | `k.tanaka` | — | Final, once a password is set |

`admin` / `admin123` is the one to start with. A wrong password, an unknown id
and an account that is still only *invited* each fail with their own message.
The accounts are listed as chips under the form — clicking one fills both
fields. Your role comes from your account, never from a picker at the door.

**An administrator is on every stage by definition.** Not "a role on four
teams" — a flag, because a list of four goes stale the first time a fifth
stage is added, and a floor whose administrator cannot see a stage is a floor
with a stage nobody can fix. The members editor offers it as a single
checkbox that replaces the per-stage selects rather than sitting beside them
inviting a contradiction.

Four roles, in `auth.js`. To see the product as another role, sign out and
sign in as somebody who holds it — the rail shows your role but never lets you
change it, because in the product it comes from your account.

| Can | Inspector | QA reviewer | Approver | Admin |
|---|:--:|:--:|:--:|:--:|
| Record and upload inspections | ✓ | ✓ | – | ✓ |
| Open the graded sheet | ✓ | ✓ | ✓ | ✓ |
| Correct readings and save | – | ✓ | – | ✓ |
| Download working files (CSV, JSON) | – | ✓ | ✓ | ✓ |
| Download vendor documents (PDF) | – | – | ✓ | ✓ |
| Sign off / release | – | – | ✓ | ✓ |
| View the style set library | ✓ | ✓ | ✓ | ✓ |
| Manage the style set library | – | – | – | ✓ |
| Manage people and roles | – | – | – | ✓ |

The split is drawn from what the documents are. A graded sheet is a vendor
record stamped *"Subject to Legal Action if Disclosed Without Authorization
from AEO"* — so the person who **records** it is on the floor with a headset,
the person who **corrects** a misheard reading is a QA reviewer, and the person
who **releases** it is neither. That last one is the load-bearing rule:
**an approver cannot edit the sheet they sign off.** If one account could both
alter a measurement and release the document, a wrong reading and its sign-off
would leave no trace of disagreement.

Two things worth looking at while switching roles:

- **Blocked controls stay on the page, dead, with the reason on hover** — not
  hidden. A control that vanishes teaches nobody why it is missing, and support
  tickets are made of that. Only the admin nav link genuinely disappears.
- **The permission matrix on `members.html` is generated from the same list
  the screens are gated on**, so it cannot drift from what the product
  enforces.

## The style set library

`library.html` is open to every role, because the spec sheet is the thing every
measurement on a report is rebuilt from — `spec + deviation`, with the
recording only ever supplying the deviation. Anyone reading a report has a
reason to look at what it was graded against.

Eight sheets, matching what is actually in `data/StyleSets/`, **as a list**:
eight rows is a register, and what a reviewer does here is run down one column,
which columns do better than cards. Filter by status — all, final, or in
development — or search by style, description or buyer; open one for its header
block and, for 7122, the real graded specification.

**Upload is the only way a sheet enters the library, and it is PDF only.** The
picker is filtered with `accept`, but the check that counts is in script,
because `accept` is only a hint and a dropped file bypasses the picker
entirely. A rejected file is named and identified — *"Only PDFs. `sheet.png`
is a PNG image"* — and told what to do instead. Oversized files are refused
separately at 25 MB. An accepted sheet lands in the list in a **Reading…**
state and settles once parsed; the whole graded table has to come out of the
PDF before anything can be judged against it, and a row that appeared finished
would be lying about that.

Uploading and removing sheets is gated to administrators; viewing and
downloading are not.

## Managing members

`members.html` is the administrator's screen and it genuinely works — add
somebody, change a role from the table, edit or remove them, and the change
survives navigation (the roster lives in `localStorage`, seeded on first open;
**Reset to defaults** puts the six original accounts back).

Five rules are enforced on every write, and they are the ones that would matter
on a real roster:

| Rule | Why |
|---|---|
| Ids are unique | An id is a login name *and* an audit-trail entry. Reusing one reattributes somebody else's corrections. |
| Ids cannot be renamed | Renaming orphans every correction already recorded against it. Remove and re-add instead. |
| The last administrator stays | The final admin cannot be demoted or removed — after that nobody can manage the roster at all. |
| You cannot remove yourself | Signing yourself out of your own permissions mid-session is never what was meant. |
| Invited accounts cannot sign in | An invitation is not an account until a password is set. |

Try the third one: sign in as `d.bhardwaj`, go to Members, and try to demote
yourself. The roster refuses and says why.

**This is a prototype.** There is no server, no password check and no token —
the session is a `localStorage` object and every check runs in the browser,
which is precisely where real access control must not live. In the real app
these same capability names would be enforced on the API and `auth.js` would
only be deciding what to draw. Opening any page without a session seeds a QA
reviewer rather than bouncing you to the login wall, so the prototype never
dead-ends.

## Files

```
demo/
  index.html  audit.html  record.html  processing.html  states.html
  signin.html teams.html members.html library.html
  ppm.html    interim.html final.html
  app.css     the product layer — everything visual
  app.js      mock data + the few interactions worth having
  auth.js     roles, capabilities, the session, and the gating helper
  teams.js    the four stages, their screens, and which one you are in
  clay/       the Clay design system, copied in verbatim (tokens)
```

`clay/` is untouched. Every size, radius and type style in `app.css` resolves
to a Clay token, and so does every fill. The only raw hex is the *text* colour
used on a tinted state fill: `#9a6206` and `#b3261e` are lifted verbatim from
Clay's own `Badge` component (its `warning` and `error` tones), and `#4c3a8a`
is the matching pair I derived for lavender, which the system does not define
because it has no product-state use for it.

## How the design system was applied

**Carried over unchanged**

- **Cream canvas** (`#fffaf0`) on every surface, sidebar included. The system
  calls the warm tint non-negotiable and has no dark chrome anywhere — a dark
  rail is the most common way a product breaks it.
- **Near-black primary CTA**, 12px radius, sentence case. Secondary is cream
  with a hairline.
- **Hairlines instead of shadows.** Depth comes from color contrast, not
  elevation.
- **Inter 500 with negative tracking** for display type — Clay's own documented
  substitute for Plain Black, never heavier than 500.
- **Pill badges and tabs**, 16px content cards, 24px saturated cards, 44px
  controls.
- **The six-color feature palette**, cycled, never repeated back to back.

**The one judgement call worth arguing about**

Clay's signature element is the saturated feature card, and its published
system is a marketing surface — it says outright that product UI is out of
scope. Sprayed across a working screen, six saturated cards would be noise.
So the saturated card is spent **once per screen, on the verdict**: the single
fact the page exists to deliver. It carries the state in its fill — teal for a
pass, pink for a failure, ochre for "not final", cream for "never checked" —
and everything else on the page stays quiet so it can be loud.

**Three deliberate deviations, flagged rather than smuggled**

1. **Section rhythm is 40px, not Clay's 96px.** 96px is an editorial band on a
   long-scroll page. At that spacing, answering "did this pass?" would take
   four screens of scrolling.
2. **A modal scrim and one soft shadow exist.** The system specifies almost no
   elevation, but a dialog over a data grid has to detach from it, or the grid
   behind reads as still-editable.
3. **Semantic color does real work** in the grid and tables. The system
   reserves success/warning/error for "product UI states" — this is that.

**Gaps inherited from the design system**

- **No Clay brand assets ship with it** — no logo, no font binaries, and none
  of the 3D claymation illustrations that are the brand's actual voltage. The
  wordmark is set in plain display type and the empty state uses the same
  soft-blob placeholder the system itself ships. Supply the real renders and
  the empty and recording screens change character completely.
- **Plain Black is unlicensed for the web**, so display type is Inter 500 with
  negative tracking throughout, per Clay's own fallback guidance.

## Things to judge

The grid is the hard part and the place to look first. A reviewer has to see,
in one pass over the grid (133 cells here, several hundred on a full sheet): which readings failed, which were never answered,
which were heard with less than full confidence, and which the recording
contradicts — without the page turning into a heat map.

Every reading shows its confidence, and cells below 100% are banded blue, with
a stronger band below 85%. Blue is **not** a Clay colour: the six brand fills
are all spoken for here — lavender already means *no verdict* — and how sure
the transcription was is a different axis from pass and fail, so it needed a
hue that could not be mistaken for either. Verdict fills win where the two
collide, and the confidence band moves to the bottom edge of the cell so it is
not lost. Every band is also carried by a glyph, so the grid survives a
greyscale print and a colour-blind reviewer.

Then: whether one saturated card per screen is enough brand presence, or too
much.
