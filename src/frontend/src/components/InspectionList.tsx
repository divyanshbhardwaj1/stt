import { href } from "../router";

/**
 * The list of inspections at one stage.
 *
 * Two screens draw this: the four stage panels on a style, and the "show all"
 * page for one of them. They had the same table twice over — and each of those
 * carried a second near-copy for the stand-in rows, so a column added here used
 * to be a column added in four places. It is one place now.
 *
 * Who recorded an inspection and where they stood are columns rather than a
 * subtitle under the name. Both were already on screen, set at 11.5px under the
 * inspection's own label, which is where you put a detail nobody is looking
 * for. On a stage with several checks of the same style they are the two facts
 * that tell them apart.
 */
export interface ListRow {
  key: string;
  label: string;
  /** Display name of whoever recorded it. Blank is shown, never guessed at. */
  by: string;
  /** Where the recording was made — typed at intake, or reverse-geocoded. */
  where: string;
  summary: string;
  date: Date;
  state: string;
  tone: string;
  /**
   * The inspection to open. Absent on a stand-in row, which has no report —
   * and a button that opens nothing is a defect rather than a label.
   */
  jobId?: string;
}

export function InspectionList({
  rows,
  onOpen,
}: {
  rows: ListRow[];
  onOpen: (jobId: string) => void;
}) {
  return (
    <div className="tablewrap">
      <table className="data">
        <thead>
          <tr>
            <th>Inspection</th>
            <th>Inspector</th>
            <th>Location</th>
            <th>Result</th>
            <th>Date</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              onClick={(event) => {
                if (!row.jobId) return;
                if ((event.target as HTMLElement).closest("a")) return;
                onOpen(row.jobId);
              }}
            >
              <td>
                <b>{row.label}</b>
              </td>
              {/* "unattributed" rather than blank: an inspection nobody is
                  recorded against is a fact about the record, and an empty cell
                  reads as a column that failed to load. */}
              <td className={row.by ? "" : "dim"}>{row.by || "unattributed"}</td>
              {/* Reverse-geocoded addresses run long — "IFFCO Chowk, Gurgaon,
                  Haryana, 122009" — so the cell clamps and carries the whole
                  thing in its tooltip rather than setting the table's width. */}
              <td className={`where${row.where ? "" : " dim"}`} title={row.where}>
                {row.where || "—"}
              </td>
              <td className="why">{row.summary}</td>
              <td className="why">{row.date.toLocaleDateString()}</td>
              <td>
                <span className={row.tone}>{row.state}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                {row.jobId ? (
                  <a className="btn quiet sm" href={href("inspection", row.jobId)}>
                    Open report
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
