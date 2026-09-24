/**
 * Demo inspections for the three stages that have no pipeline yet.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  EVERYTHING IN THIS FILE IS FABRICATED. None of it is a real inspection.
 * ────────────────────────────────────────────────────────────────────────
 *
 * PPM, Interim and Final are real stages — real roles, a real column on
 * `inspections`, real screens — and they will have real pipelines. Until they
 * do, a style opened on the Inspections screen would show one populated panel
 * and three empty ones, which reads as a broken product rather than an
 * unfinished one. So the three carry stand-in rows that show the shape of what
 * each check produces.
 *
 * Two rules, and one that was dropped on purpose:
 *
 *  1. **It never reaches the server.** No fetch, no write, no row. The database
 *     holds inspections that happened. `POST /api/jobs` refuses a stage with no
 *     pipeline (see `RECORDABLE_STAGES` in api/app.py), so there is no way for
 *     one of these to be mistaken for real later either. This is the safeguard
 *     that actually holds, because it does not depend on anybody reading a
 *     label — and it is why removing the labels below costs less than it looks.
 *  2. **It is deterministic.** Seeded off the style number, so a style shows
 *     the same demo rows on every reload and on every machine. Random figures
 *     that change under a reader are how somebody learns the screen is fake —
 *     and, worse, how somebody screenshots two different "truths".
 *
 *  3. ~~It is marked on screen.~~ **Dropped, by request, on 25 September 2026.**
 *     The panels used to carry a "demo data" pill, a notice per stage and a
 *     "no report" in place of every action. They are gone: these stages are
 *     being shown to the team building them, and the labels were reading as
 *     defects in the product rather than as honesty about it.
 *
 *     So `demo: true` is still on every row and every caller can still tell
 *     these apart — nothing draws attention to it. If this data ever ends up
 *     in front of somebody who does not already know these three stages are
 *     unbuilt, that is the moment to put the marking back, and rule 1 is what
 *     stops the gap being worse than cosmetic in the meantime.
 *
 * Deleting this file is the last step of building those three pipelines, and
 * `STAGE_DEMOS` below is the list of what to delete from.
 */

export interface DemoInspection {
  id: string;
  /** Always true. The field exists so a caller cannot forget to check. */
  demo: true;
  /** What the row is called, in that stage's own vocabulary. */
  label: string;
  /** Days before today, so the dates move with the calendar. */
  daysAgo: number;
  /** The one-line result, in the words that stage would use. */
  summary: string;
  /** Shown as a pill, reusing the register's states. */
  state: string;
  tone: string;
  /** Who and where, so the row carries the same sub-line a real one does. */
  by: string;
  where: string;
}

/** Names for the stand-in rows. Picked off the same seed as the figures, so a
    style keeps the same inspector across reloads the way a real one would. */
const PEOPLE = ["S. Iqbal", "R. Menon", "A. Kaur", "D. Sharma", "P. Nair"];
const BENCHES = ["Unit 2, bench 4", "Unit 1, line 3", "Unit 3, bench 1", "Unit 2, line 7"];

/** A stable 32-bit hash of a string, so a style seeds the same rows forever. */
function seed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * What each unbuilt stage produces, in its own vocabulary.
 *
 * Not one shape repeated three times with different words: a PPM is a meeting
 * with open points, an interim is a defect rate off a sample, and a final is a
 * lot accepted or rejected against an accept number. Showing them as three
 * copies of a size-set row would teach the floor the wrong model of its own
 * process before the real screens exist to correct it.
 */
const STAGE_DEMOS: Record<string, (n: number) => DemoInspection[]> = {
  ppm: (n) => [
    {
      id: "demo-ppm-1",
      demo: true,
      label: "Pre-production meeting",
      daysAgo: 18 + (n % 5),
      summary: `${6 + (n % 4)} of ${9 + (n % 3)} approvals closed · fabric and wash standard outstanding`,
      state: "open points",
      tone: "pill warning",
      by: PEOPLE[n % PEOPLE.length],
      where: BENCHES[n % BENCHES.length],
    },
    {
      id: "demo-ppm-2",
      demo: true,
      label: "Trims and packing review",
      daysAgo: 14 + (n % 4),
      summary: "All approvals closed · factory cleared to cut",
      state: "cleared",
      tone: "pill success",
      by: PEOPLE[(n + 1) % PEOPLE.length],
      where: BENCHES[n % BENCHES.length],
    },
  ],
  interim: (n) => [
    {
      id: "demo-interim-1",
      demo: true,
      label: "Line audit — first 20%",
      daysAgo: 8 + (n % 4),
      summary: `${180 + (n % 40)} pieces sampled · ${2 + (n % 3)}% defect rate · ${1 + (n % 2)} critical measurement off`,
      state: "corrections issued",
      tone: "pill warning",
      by: PEOPLE[(n + 2) % PEOPLE.length],
      where: BENCHES[(n + 1) % BENCHES.length],
    },
    {
      id: "demo-interim-2",
      demo: true,
      label: "Line audit — re-check",
      daysAgo: 5 + (n % 3),
      summary: "Corrections verified on the line · defect rate back inside limit",
      state: "passed",
      tone: "pill success",
      by: PEOPLE[(n + 2) % PEOPLE.length],
      where: BENCHES[(n + 1) % BENCHES.length],
    },
  ],
  final: (n) => [
    {
      id: "demo-final-1",
      demo: true,
      label: "Final random inspection",
      daysAgo: 2 + (n % 3),
      summary: `AQL 2.5 · ${200 + (n % 3) * 15} sampled · ${4 + (n % 4)} major against an accept number of 10`,
      state: "lot accepted",
      tone: "pill success",
      by: PEOPLE[(n + 3) % PEOPLE.length],
      where: BENCHES[(n + 2) % BENCHES.length],
    },
  ],
};

/** The fabricated rows for one style on one stage. Empty for size set. */
export function demoInspections(styleNo: string, stage: string): DemoInspection[] {
  const build = STAGE_DEMOS[stage];
  return build ? build(seed(`${styleNo}:${stage}`)) : [];
}

/** Whether a stage is showing stand-in data rather than inspections that happened. */
export const isDemoStage = (stage: string): boolean => stage in STAGE_DEMOS;

/** A demo row's date, resolved against today so the list never goes stale. */
export const demoDate = (row: DemoInspection): Date =>
  new Date(Date.now() - row.daysAgo * 86_400_000);
