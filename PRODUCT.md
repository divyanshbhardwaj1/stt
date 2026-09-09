# Product

## Register

product

## Users

Garment QA operators and inspectors working Triburg/AEO size-set inspections.

They meet this screen twice in one job, in two different physical situations:

1. **On the factory floor**, standing, on a tablet or phone, in bright and uneven
   light — starting and stopping a recording while an inspector reads a graded spec
   sheet aloud and an assistant calls out measured values.
2. **At a desk afterwards**, on a laptop or monitor, deciding whether the generated
   report is safe to send to a vendor.

The job to be done is the second one. The pipeline already fills the report; the
operator's actual task is **triage** — find the handful of values the pipeline is
not sure about, settle them against the audio, and release the report. Everything
on screen is in service of "can I send this yet, and if not, what is stopping me?"

## Product Purpose

Turn a recorded size-set inspection into the client's filled Size Set Inspection
Report plus a graded measurements sheet, and surface exactly the rows a human must
confirm.

Success is not "a report was produced". Success is that no measurement reaches a
vendor as a pass when nobody actually ruled on it. The expensive failure mode is a
silent one: transcription drops the short unstressed words ("okay", "minus one by
eight") that carry the verdict, and a report that treats that silence as approval
sends a real deviation out as on-spec. The interface exists to make that gap
impossible to overlook.

## Brand Personality

**Industrial utility.** Blunt, legible, high contrast. Voice is plain and
declarative — it states what happened and what is required, in the operator's own
vocabulary (POM, tolerance, verdict, size set), never in software vocabulary.

Three words: *unmissable, exact, unhurried*.

The interface should feel like a measuring instrument with a printed readout, not
like software with opinions. It is allowed to be dense. It is not allowed to be
ambiguous.

## Anti-references

- **Legacy enterprise QA software** (explicitly rejected by the user): grey chrome,
  bevelled buttons, cramped sub-12px data grids, dialogs stacked on dialogs. This is
  the thing being replaced.
- **Generic AI/SaaS dashboard**: gradient hero metrics, glassmorphism, purple glow,
  rows of identical icon-and-heading cards, a tiny tracked uppercase eyebrow over
  every section.
- **Terminal-native dark mode with neon accents** — the second-order reflex for
  "industrial". Loses on a bright factory floor, and the artefact under review is a
  printed white document.
- **Consumer-app playfulness**: emoji, bouncy motion, celebratory toasts. A misread
  report costs money.

## Design Principles

1. **A gap outranks a finding.** An unanswered point of measure is louder than a
   failed one, because a failure is a known result and a gap is an open question.
   Ranking is: no verdict > out of tolerance > low confidence > pass.
2. **Lead with the verdict, in a sentence.** The first thing on the page answers
   "can this be sent?" and names what is blocking it. Counts and tables support that
   sentence; they never replace it.
3. **Screen and paper speak one language.** The semantic colours match the constants
   in `graded_report.py` (fail orange, no-verdict violet, low-confidence blue), and
   the "??" mark is the same mark the PDF prints. A reviewer moving from screen to
   printout should not have to relearn anything.
4. **Colour is meaning, never decoration.** Every hue on the page denotes a state.
   Interactive weight comes from ink, so nothing that is merely clickable can be
   mistaken for something that is wrong.
5. **Order the page like the workflow.** Open questions, then failures, then things
   worth confirming, then the summary, then the downloads. The report is offered
   last, after the reviewer has seen what is wrong with it.

## Accessibility & Inclusion

- **WCAG 2.2 AA** (user-selected). All body text ≥4.5:1 and large text ≥3:1, in
  both the light and dark themes. Verified by computation over the token pairs, not
  by eye.
- **No state carried by colour alone.** WCAG 1.4.1 is a Level A criterion and so is
  inside the AA bar: every state also carries a glyph or a word (`?? no verdict`,
  `× out`, a literal confidence percentage). Given that the states being
  distinguished are "passed" and "nobody ruled on this", a colour-blind reviewer
  misreading one is a correctness failure, not an inconvenience.
- `prefers-reduced-motion` is honoured, with still equivalents for the pulsing
  status dots rather than removing the state signal.
- Visible focus rings on every interactive element; the job list is real buttons
  with `aria-current`.
- Coarse-pointer targets enlarge for tablet use on the floor.
