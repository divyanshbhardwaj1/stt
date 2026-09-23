import type { Screen } from "./router";

/**
 * The four inspection stages, as teams. Ported from `demo/teams.js`.
 *
 * Triburg runs a garment through four checks, in order, and they are not the
 * same job done four times. A team is a stage, and the features belong to the
 * stage: a size-set reviewer has a graded sheet and a spec library; a final
 * inspector has a sampling plan and an AQL table; neither needs the other's
 * screens and showing them anyway is how a product becomes four products in a
 * trench coat.
 *
 * Only `sizeset` has a pipeline behind it today. The other three carry their
 * nav and their blurb because the roles are already real — somebody can hold
 * approver on final right now — and a stage that exists in the permission
 * model but nowhere on screen is how a person concludes their access is
 * broken.
 */

export interface StageNav {
  screen: Screen;
  icon: string;
  label: string;
  /** The capability the row needs. Blank means everybody. */
  need?: string;
}

export interface Stage {
  id: string;
  name: string;
  fill: string;
  tag: string;
  blurb: string;
  detail: string;
  /** Where the rail lands you when you switch to this stage. */
  home: Screen;
  nav: StageNav[];
  /** False until the stage has a pipeline of its own. */
  built: boolean;
}

export const STAGES: Stage[] = [
  {
    id: "sizeset",
    name: "Size set",
    fill: "lavender",
    tag: "SS",
    blurb: "One garment per size, every point of measure against the graded sheet.",
    detail:
      "The sheet is the source of truth and the recording supplies only the deviation, so every measurement on the report is rebuilt as spec + deviation.",
    home: "dashboard",
    nav: [
      { screen: "dashboard", icon: "dashboard", label: "Dashboard" },
      { screen: "record", icon: "record", label: "Record inspection", need: "record" },
      { screen: "inspections", icon: "inspection", label: "Inspection" },
      { screen: "styles", icon: "library", label: "Style sets" },
      { screen: "activity", icon: "log", label: "Activity" },
    ],
    built: true,
  },
  {
    id: "ppm",
    name: "PPM",
    fill: "peach",
    tag: "PP",
    blurb: "Approvals and open points before bulk is cut.",
    detail:
      "Fabric, trims, embroidery, wash standard, care labels and packing, each with an owner and a date. Nothing here is measured — the question is whether the factory may start.",
    home: "dashboard",
    nav: [
      { screen: "dashboard", icon: "dashboard", label: "Meetings" },
      { screen: "styles", icon: "library", label: "Style sets" },
      { screen: "activity", icon: "log", label: "Activity" },
    ],
    built: false,
  },
  {
    id: "interim",
    name: "Interim",
    fill: "mint",
    tag: "IN",
    blurb: "An audit of the line mid-production.",
    detail:
      "Sampling and defects, with a handful of critical measurements rather than the full sheet — while there is still time to correct the line.",
    home: "dashboard",
    nav: [
      { screen: "dashboard", icon: "dashboard", label: "Line audits" },
      { screen: "styles", icon: "library", label: "Style sets" },
      { screen: "activity", icon: "log", label: "Activity" },
    ],
    built: false,
  },
  {
    id: "final",
    name: "Final",
    fill: "ochre",
    tag: "FI",
    blurb: "The final random inspection against an AQL plan.",
    detail:
      "Cartons drawn to a sampling table, defects classified major or minor, and a lot accepted or rejected against the accept number.",
    home: "dashboard",
    nav: [
      { screen: "dashboard", icon: "dashboard", label: "Inspections" },
      { screen: "styles", icon: "library", label: "Style sets" },
      { screen: "activity", icon: "log", label: "Activity" },
    ],
    built: false,
  },
];

const BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));

/** One stage, falling back to size set — the only one that always exists. */
export function stageOf(id: string): Stage {
  return BY_ID.get(id) ?? STAGES[0];
}

export const STAGE_KEY = "stage";
