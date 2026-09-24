import { useEffect, useMemo, useState } from "react";
import { fetchLibrary, type LibrarySheet } from "../api";
import { demoInspections } from "../demoStages";
import { href } from "../router";
import { STAGES } from "../stages";
import { styleOf, type Job } from "../types";

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
 * inside a stage opens its report. The register's search survives because a
 * floor with three thousand styles needs it.
 *
 * A style with no sheet in the library still gets a row. Dropping it would
 * hide every inspection that was recorded before its sheet was uploaded, or
 * whose style number the recording never announced.
 */

/** The feature-card cycle at list-marker scale, one colour per style. */
const FILLS = ["pink", "teal", "lavender", "peach", "ochre", "mint"];

/** Inspections whose style nobody could determine. Still theirs to find. */
const UNFILED = "";

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
  jobs: Job[];
}

export function Inspections({ jobs, onOpen, onOpenStyle }: Props) {
  const [sheets, setSheets] = useState<LibrarySheet[] | null>(null);
  const [query, setQuery] = useState("");

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

    const library = sheets ?? [];
    const listed = new Set(library.map((sheet) => sheet.style_no).filter(Boolean));
    const built: Row[] = library
      .filter((sheet) => sheet.style_no)
      .map((sheet) => ({
        styleNo: sheet.style_no,
        sheet,
        jobs: byStyle.get(sheet.style_no) ?? [],
      }));

    // Styles that have inspections but no sheet on disk, and the unfiled
    // bucket. Both are things somebody has to be able to reach.
    for (const [style, found] of byStyle) {
      if (style !== UNFILED && !listed.has(style)) {
        built.push({ styleNo: style, sheet: null, jobs: found });
      }
    }
    const unfiled = byStyle.get(UNFILED);
    if (unfiled?.length) built.push({ styleNo: UNFILED, sheet: null, jobs: unfiled });

    // Busiest first, then by style number — a style nobody has inspected is
    // still here, just not at the top.
    return built.sort(
      (a, b) => b.jobs.length - a.jobs.length || a.styleNo.localeCompare(b.styleNo),
    );
  }, [jobs, sheets]);

  const shown = rows.filter((row) =>
    query
      ? [row.styleNo, row.sheet?.description, row.sheet?.season, row.sheet?.company]
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true,
  );

  const total = jobs.length;

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Inspections</h1>
          <span className="pill">
            {sheets === null
              ? "…"
              : `${rows.length} style${rows.length === 1 ? "" : "s"} · ${total} inspection${
                  total === 1 ? "" : "s"
                }`}
          </span>
          <span className="spacer" />
          <input
            type="text"
            placeholder="Search style or description"
            style={{ maxWidth: 280, height: 36 }}
            value={query}
            onChange={(event) => setQuery(event.target.value.trim().toLowerCase())}
          />
        </div>
        <p className="page-meta">
          Every style on this floor and where it is up to. Open one for its four checks.
        </p>
      </header>

      {shown.length > 0 ? (
        <div className="tablewrap" style={{ marginTop: 20 }}>
          <table className="data sheets">
            <thead>
              <tr>
                <th>Style</th>
                <th>Description</th>
                {STAGES.map((stage) => (
                  <th className="num" key={stage.id}>
                    {stage.name}
                  </th>
                ))}
                <th>Latest</th>
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
        <div className="blank">
          <div>
            <div className="art" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h2>
              {sheets === null
                ? "Reading the library…"
                : query
                  ? "Nothing matches that"
                  : "No styles yet"}
            </h2>
            <p>
              {query
                ? "No style matches what you searched for."
                : "Upload a buyer's graded sheet, or record an inspection — a style appears here as soon as either exists."}
            </p>
            <div className="files" style={{ justifyContent: "center" }}>
              {query ? (
                <button className="btn secondary" onClick={() => setQuery("")}>
                  Clear the search
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
  // Newest first, so "Latest" is the first one.
  const ordered = [...row.jobs].sort((a, b) => b.started_at - a.started_at);
  const latest = ordered[0];
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
        const count = stage.built
          ? row.jobs.filter((job) => job.stage === stage.id).length
          : unfiled
            ? 0
            : demoInspections(row.styleNo, stage.id).length;
        return (
          <td className="num" key={stage.id}>
            {count || <span className="dim">—</span>}
          </td>
        );
      })}
      <td className="why">{latest ? new Date(latest.started_at * 1000).toLocaleDateString() : "—"}</td>
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
