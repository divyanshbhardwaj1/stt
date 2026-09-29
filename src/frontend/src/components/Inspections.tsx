import { useEffect, useMemo, useState } from "react";
import { fetchLibrary, type LibrarySheet } from "../api";
import { demoInspections } from "../demoStages";
import { href } from "../router";
import { STAGES, stageOf } from "../stages";
import { stateOf, styleOf, type Job } from "../types";

/**
 * Inspections, led by the style rather than by the recording.
 *
 * A garment is inspected four times — size set, PPM, interim, final — and the
 * thing those four checks have in common is the style, not the day or the
 * operator. A flat list of recordings newest-first answered "what happened
 * this afternoon", which is a useful question and the wrong one to organise a
 * product around: it cannot answer "where is style 7270 up to", and that is
 * what somebody asks when a buyer calls.
 *
 * So: styles here, one style's four stages behind each row, and an inspection
 * inside a stage opens its report.
 *
 * The page is laid out the way `demo/index.html` lays out its register — a
 * figures strip, then filter tabs built from the states actually present, then
 * one table. Search narrows what is listed; the tabs narrow it by where the
 * work has got to, which on a floor of three thousand styles is the question
 * being asked most of the time.
 *
 * A style with no sheet in the library still gets a row. Dropping it would
 * hide every inspection that was recorded before its sheet was uploaded, or
 * whose style number the recording never announced.
 */

/** The feature-card cycle at list-marker scale, one colour per style. */
const FILLS = ["pink", "teal", "lavender", "peach", "ochre", "mint"];

/** Inspections whose style nobody could determine. Still theirs to find. */
const UNFILED = "";

/**
 * Tab order: the product's own ranking, not alphabetical and not whatever
 * order the rows happen to arrive in. A gap outranks a finding, and a report
 * that has gone to the vendor is the least urgent thing on the floor — so the
 * tabs read left to right from "somebody has to do something" to "done".
 */
const STATE_ORDER = [
  "Needs review",
  "Failed",
  "Waiting for sign-off",
  "Processing",
  "Not graded",
  "Released",
];

const ALL = "all";

interface Props {
  jobs: Job[];
  onOpen: (jobId: string) => void;
  /** Open one style's four checks. Routing belongs to App, as it does for
      every other screen — a component that writes `location.hash` itself is a
      second router. */
  onOpenStyle: (styleNo: string) => void;
}

interface Row {
  styleNo: string;
  sheet: LibrarySheet | null;
  /** Newest first, so `jobs[0]` is the latest check. */
  jobs: Job[];
  latest: Job | null;
  /** Where the style got to, from `stateOf`. "" when nothing was recorded. */
  state: string;
  tone: string;
}

export function Inspections({ jobs, onOpen, onOpenStyle }: Props) {
  const [sheets, setSheets] = useState<LibrarySheet[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL);

  useEffect(() => {
    let live = true;
    fetchLibrary()
      .then((found) => live && setSheets(found))
      // The library is how a style gets a description and a season. Without it
      // the styles are still listed, off the inspections alone.
      .catch(() => live && setSheets([]));
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const byStyle = new Map<string, Job[]>();
    for (const job of jobs) {
      const style = styleOf(job);
      byStyle.set(style, [...(byStyle.get(style) ?? []), job]);
    }

    // Newest first once, here, so the latest check and the state derived from
    // it are one answer the whole screen shares.
    const build = (styleNo: string, sheet: LibrarySheet | null, found: Job[]): Row => {
      const ordered = [...found].sort((a, b) => b.started_at - a.started_at);
      const latest = ordered[0] ?? null;
      const [state, tone] = latest ? stateOf(latest) : ["", ""];
      return { styleNo, sheet, jobs: ordered, latest, state, tone };
    };

    const library = sheets ?? [];
    const listed = new Set(library.map((sheet) => sheet.style_no).filter(Boolean));
    const built: Row[] = library
      .filter((sheet) => sheet.style_no)
      .map((sheet) => build(sheet.style_no, sheet, byStyle.get(sheet.style_no) ?? []));

    // Styles that have inspections but no sheet on disk, and the unfiled
    // bucket. Both are things somebody has to be able to reach.
    for (const [style, found] of byStyle) {
      if (style !== UNFILED && !listed.has(style)) built.push(build(style, null, found));
    }
    const unfiled = byStyle.get(UNFILED);
    if (unfiled?.length) built.push(build(UNFILED, null, unfiled));

    // Busiest first, then by style number — a style nobody has inspected is
    // still here, just not at the top.
    return built.sort(
      (a, b) => b.jobs.length - a.jobs.length || a.styleNo.localeCompare(b.styleNo),
    );
  }, [jobs, sheets]);

  // Built from what is in the list, so a state nobody is in does not get a tab
  // that returns nothing — the same rule the prototype's register follows.
  const present = useMemo(() => {
    const seen = new Set(rows.map((row) => row.state).filter(Boolean));
    return STATE_ORDER.filter((state) => seen.has(state));
  }, [rows]);

  const shown = rows.filter((row) => {
    if (filter !== ALL && row.state !== filter) return false;
    if (!query) return true;
    return [row.styleNo, row.sheet?.description, row.sheet?.season, row.sheet?.company]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const narrowed = filter !== ALL || Boolean(query);
  const open = jobs.filter((job) => stateOf(job)[0] === "Needs review").length;
  const released = jobs.filter((job) => job.released_at).length;

  const clear = () => {
    setQuery("");
    setFilter(ALL);
  };

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Inspections</h1>
          <span className="pill">
            {sheets === null
              ? "…"
              : narrowed
                ? `${shown.length} of ${rows.length}`
                : `${rows.length} style${rows.length === 1 ? "" : "s"}`}
          </span>
          <span className="spacer" />
          <input
            type="text"
            className="search"
            placeholder="Search style or description"
            value={query}
            onChange={(event) => setQuery(event.target.value.trim().toLowerCase())}
          />
        </div>
        <p className="page-meta">
          Every style on this floor and where it is up to. Open one for its four checks.
        </p>
      </header>

      {/* The floor in four figures, before the list. Somebody arriving here
          wants to know whether anything is waiting on them before they start
          reading rows — and "needs review" is warmed because on this product a
          reading nobody ruled on outranks everything else on the page. */}
      <section style={{ marginTop: 20 }}>
        <dl className="readout">
          <div>
            <dt>Styles</dt>
            <dd>{sheets === null ? "…" : rows.length}</dd>
          </div>
          <div>
            <dt>Inspections</dt>
            <dd>{jobs.length}</dd>
          </div>
          <div className={open ? "hot" : undefined}>
            <dt>Need review</dt>
            <dd>{open}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{released}</dd>
          </div>
        </dl>
      </section>

      <section style={{ marginTop: 18 }}>
        {present.length > 1 && (
          <div className="tabs" style={{ marginBottom: 14 }}>
            <button aria-selected={filter === ALL} onClick={() => setFilter(ALL)}>
              All
            </button>
            {present.map((state) => (
              <button
                key={state}
                aria-selected={filter === state}
                onClick={() => setFilter(state)}
              >
                {state}
              </button>
            ))}
          </div>
        )}

        {shown.length > 0 ? (
          <div className="tablewrap">
            <table className="data sheets">
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Description</th>
                  {/* The four checks and the two latest columns share one width
                      and one alignment, so the head reads as an even band
                      rather than four narrow counts beside two wide ones.
                      Style and description keep whatever is left, and
                      .tablewrap scrolls before either of them is crushed. */}
                  {STAGES.map((stage) => (
                    <th className="num band" key={stage.id}>
                      {stage.name}
                    </th>
                  ))}
                  <th className="band">Latest state</th>
                  <th className="band">Latest date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <StyleRow
                    key={row.styleNo || "unfiled"}
                    row={row}
                    fill={FILLS[index % FILLS.length]}
                    onOpen={onOpen}
                    onOpenStyle={onOpenStyle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="blank" style={{ minHeight: "26vh" }}>
            <div>
              <div className="art" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h2>
                {sheets === null
                  ? "Reading the library…"
                  : narrowed
                    ? "Nothing matches that"
                    : "No styles yet"}
              </h2>
              <p>
                {narrowed
                  ? "No style matches what you searched for."
                  : "Upload a buyer's graded sheet, or record an inspection — a style appears here as soon as either exists."}
              </p>
              <div className="files" style={{ justifyContent: "center" }}>
                {narrowed ? (
                  <button className="btn secondary" onClick={clear}>
                    Clear
                  </button>
                ) : (
                  <a className="btn" href={href("record")}>
                    Record inspection
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function StyleRow({
  row,
  fill,
  onOpen,
  onOpenStyle,
}: {
  row: Row;
  fill: string;
  onOpen: (jobId: string) => void;
  onOpenStyle: (styleNo: string) => void;
}) {
  const { latest } = row;
  const unfiled = !row.styleNo;

  return (
    <tr
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        // Nothing to open for the unfiled bucket: there is no style behind it,
        // so its inspections are reached directly instead.
        if (unfiled) {
          if (latest) onOpen(latest.id);
          return;
        }
        onOpenStyle(row.styleNo);
      }}
    >
      <td>
        <div className="styleno">
          <span className={`tile ${fill}`}>{row.styleNo || "—"}</span>
        </div>
      </td>
      <td>
        <b>{unfiled ? "No style recorded" : row.sheet?.description || "No sheet in the library"}</b>
        <div className="dim pom" style={{ fontSize: 11.5 }}>
          {unfiled
            ? "The recording announced no style and none was picked"
            : row.sheet?.document || "Inspections only — upload the buyer's sheet to grade them"}
        </div>
      </td>
      {STAGES.map((stage) => {
        const count = countFor(row, stage.id, unfiled);
        return (
          <td className="num band" key={stage.id}>
            {count ? (
              // The number is the way in, and it goes to a page. Unfolding it
              // here answered the question in the wrong place: somebody who
              // followed a count wants a screen they can link to, come back
              // from, and read without the register underneath it.
              unfiled ? (
                <span>{count}</span>
              ) : (
                <a
                  className="link"
                  href={href("style", row.styleNo, stage.id)}
                  aria-label={`Show all ${count} ${stage.name} inspections for style ${row.styleNo}`}
                >
                  {count}
                </a>
              )
            ) : (
              <span className="dim">—</span>
            )}
          </td>
        );
      })}
      <td className="band">
        {latest ? (
          // Where the style actually got to: the stage of its newest
          // inspection, and what came of it. The state word is `stateOf`, the
          // same one the style screen and the report draw — a second
          // vocabulary for one fact is how two screens come to disagree about
          // one inspection.
          //
          // Only real inspections are eligible. Some stand-in rows on the three
          // unbuilt stages are dated more recently than a real size set, and
          // letting one win here would answer "where is 7270 up to" with
          // something fabricated, on the screen somebody opens when a buyer
          // calls. That is rule 1 in `demoStages.ts`, applied.
          <div className="latest">
            <b>{stageOf(latest.stage).name}</b>
            <span className={row.tone}>{row.state}</span>
          </div>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="band why">
        {latest ? new Date(latest.started_at * 1000).toLocaleDateString() : "—"}
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {unfiled ? (
          latest && (
            <a className="btn quiet sm" href={href("inspection", latest.id)}>
              Open
            </a>
          )
        ) : (
          <a className="btn quiet sm" href={href("style", row.styleNo)}>
            Open style
          </a>
        )}
      </td>
    </tr>
  );
}

/** How many checks this style has had at one stage. */
function countFor(row: Row, stageId: string, unfiled: boolean): number {
  if (stageOf(stageId).built) {
    return row.jobs.filter((job) => job.stage === stageId).length;
  }
  return unfiled ? 0 : demoInspections(row.styleNo, stageId).length;
}
