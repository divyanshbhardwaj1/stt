import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSheet, regradeSize, settleCells } from "../api";
import type { CellEdit, GradedSheet, Job, SheetCell, SheetRow } from "../types";

interface Props {
  job: Job;
  /** Back to the report. */
  onClose: () => void;
  /** A save rebuilt every output, so the job on screen has moved with it. */
  onSettled: (job: Job) => void;
}

const VERDICTS = [
  { id: "", label: "—" },
  { id: "okay", label: "okay — passed aloud" },
  { id: "deviation", label: "deviation" },
  { id: "not stated", label: "not stated" },
];

const STATE_MARK: Record<string, string> = {
  unconfirmed: "??",
  fail: "×",
  pass: "✓",
  unjudged: "–",
  empty: "",
};

/** Ranked the way the product ranks findings: a gap outranks a failure. */
function verdictState(job: Job): string {
  if (job.unconfirmed > 0) return "open";
  if (job.out_of_tolerance > 0) return "failed";
  return "done";
}

/**
 * What is in the cell editor before anything is typed.
 *
 * No measurement. The spec comes off the style sheet and the recording supplies
 * the deviation; the measurement is what those two make and is never typed.
 */
type Draft = { deviation: string; verdict: string; note: string };

const BLANK: Draft = { deviation: "", verdict: "", note: "" };

/**
 * Prefill from what the recording stated.
 *
 * Only the deviation, the verdict and the note are the recording's to give. The
 * measurement belongs to the style sheet - spec plus deviation - and is shown
 * read-only, because a typed measurement is a second source for a number that
 * must have exactly one.
 */
function draftOf(cell: SheetCell | undefined): Draft {
  if (!cell || cell.state === "empty" || !cell.stated) return BLANK;
  return {
    deviation: cell.stated.deviation,
    verdict: cell.stated.verdict,
    note: cell.stated.note,
  };
}

/** Only what the operator touched. Untouched fields are not sent at all. */
function changes(before: Draft, after: Draft): Omit<CellEdit, "sheet_index" | "size"> {
  const edit: Omit<CellEdit, "sheet_index" | "size"> = {};
  if (after.deviation !== before.deviation) edit.deviation = after.deviation;
  if (after.verdict !== before.verdict) edit.verdict = after.verdict;
  if (after.note !== before.note) edit.note = after.note;
  return edit;
}

/**
 * The graded sheet, cell by cell, with every cell open to correction.
 *
 * The same grid the graded PDF prints — every point of measure the client's
 * sheet carries, one column per size — because a reviewer moving between the
 * screen and the printout should not have to relearn the document.
 *
 * Saving is explicit. An audit tool must never let a stray click change a
 * vendor-facing report, so edits collect as a pending set and go in one call.
 */
export function AuditSheet({ job, onClose, onSettled }: Props) {
  const [sheet, setSheet] = useState<GradedSheet | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ row: SheetRow; size: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [original, setOriginal] = useState<Draft>(BLANK);
  const [pending, setPending] = useState<CellEdit[]>([]);
  const [saving, setSaving] = useState(false);
  const [misplaced, setMisplaced] = useState<{ sheet_index: number; size: string }[]>([]);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSheet(job.id)
      .then((loaded) => !cancelled && setSheet(loaded))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load the graded sheet."),
      );
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const pendingAt = useMemo(() => {
    const index = new Map<string, CellEdit>();
    for (const edit of pending) index.set(`${edit.sheet_index}:${edit.size}`, edit);
    return index;
  }, [pending]);

  const openCell = useCallback((row: SheetRow, size: string) => {
    const seed = draftOf(row.cells?.[size]);
    setOpen({ row, size });
    setDraft(seed);
    setOriginal(seed);
  }, []);

  const stage = useCallback(() => {
    const index = open?.row.sheet_index;
    if (index === undefined || !open) return;
    const edit = changes(original, draft);
    setOpen(null);
    // Nothing was actually changed. Staging it would put a correction in the
    // audit trail whose before and after are identical.
    if (Object.keys(edit).length === 0) return;
    setPending((current) => [
      ...current.filter((staged) => !(staged.sheet_index === index && staged.size === open.size)),
      { sheet_index: index, size: open.size, ...edit },
    ]);
  }, [open, draft, original]);

  const save = useCallback(async () => {
    if (pending.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const result = await settleCells(job.id, pending);
      setSheet(result.sheet);
      setPending([]);
      setMisplaced(result.misplaced);
      onSettled(result.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The corrections were not saved.");
    } finally {
      setSaving(false);
    }
  }, [job.id, pending, onSettled]);

  const regrade = async (from: string, to: string) => {
    setResizing(true);
    setError("");
    try {
      const result = await regradeSize(job.id, from, to);
      setSheet(result.sheet);
      onSettled(result.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The size was not changed.");
    } finally {
      setResizing(false);
    }
  };

  if (error && !sheet) {
    return (
      <div className="wrap">
        <div className="title">
          <h2>Graded sheet</h2>
          <button className="ghost" onClick={onClose}>
            Back to the report
          </button>
        </div>
        <div className="fail-box" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="wrap">
        <div className="skel">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }

  const settled = sheet.corrections.length;

  return (
    <div className="audit">
      <div className="audit-head">
        <div className="title">
          <h2>
            Graded sheet <span className="dim">style {sheet.style_no}</span>
          </h2>
          {/* The verdict's own state, not the job's. Styling this off
              `job.status` painted "FAIL CONDITIONALLY" in the pass green,
              which is the one thing a verdict must never do. */}
          <span className={`pill ${verdictState(job)}`}>{sheet.verdict}</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Back to the report
          </button>
        </div>
        <p className="lede">
          Every measurement here is the spec off style <b>{sheet.style_no}</b> plus the deviation
          the inspector called &mdash; the recording never supplies the measurement itself. Click
          any cell to correct what was heard, or to fill one the recording never covered. Nothing
          is written until you save.
          {settled > 0 && (
            <>
              {" "}
              <b>
                {settled} cell{settled === 1 ? "" : "s"}
              </b>{" "}
              already settled by hand.
            </>
          )}
        </p>
        {(sheet.below_full > 0 || sheet.disputed > 0) && (
          <p className="lede listen">
            Worth listening back to:
            {sheet.below_full > 0 && (
              <>
                {" "}
                <b className="shaky-count">{sheet.below_full}</b> heard below 100% confidence
                {sheet.low_confidence > 0 && (
                  <>
                    , <b className="shaky-count">{sheet.low_confidence}</b> of them under{" "}
                    {Math.round(sheet.review_threshold * 100)}%
                  </>
                )}
              </>
            )}
            {sheet.below_full > 0 && sheet.disputed > 0 ? ";" : ""}
            {sheet.disputed > 0 && (
              <>
                {" "}
                <b className="shaky-count">{sheet.disputed}</b> where the absolute the inspector
                read aloud matches neither the spec nor this measurement
              </>
            )}
            .
          </p>
        )}
        {/* The one error that is wrong in every row at once. The recording
            usually does not say the size, so the grading falls back to the
            sheet's base size — and each row still looks individually plausible,
            which is exactly why it has to be said out loud. */}
        {sheet.size_check
          .filter((check) => check.disagrees)
          .map((check) => (
            <div className="fail-box wrongsize" role="alert" key={check.assigned}>
              <b>
                These readings are graded as {check.assigned}, but the recording sounds like{" "}
                {check.best}.
              </b>{" "}
              The inspector read {check.votes[check.best]} measurements that match the{" "}
              <b>{check.best}</b> column and {check.votes[check.assigned] ?? 0} that match{" "}
              <b>{check.assigned}</b>. If that is right, every measurement on this sheet is being
              judged against the wrong grade.
              <div className="row tight" style={{ marginTop: 11 }}>
                <button onClick={() => void regrade(check.assigned, check.best)} disabled={resizing}>
                  {resizing ? "Regrading…" : `Regrade as ${check.best}`}
                </button>
              </div>
            </div>
          ))}
        {pending.length > 0 && (
          <div className="audit-bar" role="status">
            <b>
              {pending.length} change{pending.length === 1 ? "" : "s"} not saved
            </b>
            <span className="spacer" />
            <button className="ghost" onClick={() => setPending([])} disabled={saving}>
              Discard changes
            </button>
            <button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save and rebuild the report"}
            </button>
          </div>
        )}
        {error && (
          <div className="msg bad" role="alert">
            {error}
          </div>
        )}
        {misplaced.length > 0 && (
          <div className="fail-box" role="alert">
            <b>
              {misplaced.length} settled cell{misplaced.length === 1 ? "" : "s"} did not come back
              on the point of measure {misplaced.length === 1 ? "it was" : "they were"} entered
              against.
            </b>{" "}
            The reading was saved but the sheet may have filed it elsewhere — check it against the
            recording before this report goes anywhere.
          </div>
        )}
      </div>

      <div className="audit-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>POM</th>
              <th>Description</th>
              <th className="num">Tol−</th>
              <th className="num">Tol+</th>
              {sheet.sizes.map((size) => (
                <th
                  key={size}
                  className={`num size${size === sheet.base_size ? " base" : ""}${
                    sheet.measured_sizes.includes(size) ? "" : " unmeasured"
                  }`}
                >
                  {size}
                  {sheet.measured_sizes.includes(size) ? "" : " *"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, index) =>
              row.kind === "note" ? (
                <tr key={`note-${index}`} className="sheet-note">
                  <td>{row.pom}</td>
                  <td colSpan={3 + sheet.sizes.length}>{row.description}</td>
                </tr>
              ) : (
                <tr key={row.sheet_index}>
                  <td className="pom">{row.pom}</td>
                  <td>{row.description}</td>
                  <td className="num dim">{row.tol_minus}</td>
                  <td className="num dim">{row.tol_plus}</td>
                  {sheet.sizes.map((size) => {
                    const cell = row.cells?.[size];
                    const staged = pendingAt.get(`${row.sheet_index}:${size}`);
                    return (
                      <Cell
                        key={size}
                        cell={cell}
                        staged={Boolean(staged)}
                        onOpen={() => openCell(row, size)}
                        label={`${row.pom} ${size}`}
                        at={`${row.sheet_index}:${size}`}
                      />
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {sheet.unmatched.length > 0 && (
        <div className="audit-foot">
          <h3>
            Heard but not placed <span className="count open">{sheet.unmatched.length}</span>
          </h3>
          <p className="lede">
            Readings the inspector called that match no row on this sheet. They appear nowhere on
            the printed document, so they are listed here rather than lost.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Heard as</th>
                  <th className="num">Measured</th>
                  <th className="num">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {sheet.unmatched.map((row) => (
                  <tr key={`${row.row}-${row.size}`}>
                    <td>{row.size}</td>
                    <td className="said">{row.spoken}</td>
                    <td className="num">{row.measured}</td>
                    <td className="num">{row.deviation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <CellEditor
          row={open.row}
          size={open.size}
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setOpen(null)}
          onStage={stage}
        />
      )}
    </div>
  );
}

function Cell({
  cell,
  staged,
  onOpen,
  label,
  at,
}: {
  cell: SheetCell | undefined;
  staged: boolean;
  onOpen: () => void;
  label: string;
  /** Sheet position and size — the cell's identity, and the only stable one.
      POM codes repeat across shell and lining rows, and report numbers shift
      whenever a settled row is inserted ahead of them. */
  at: string;
}) {
  const state = cell?.state ?? "empty";
  return (
    <td
      data-cell={at}
      className={`cell ${state}${staged ? " staged" : ""}${cell?.edited ? " settled" : ""}${
        cell?.disputed ? " disputed" : ""
      }${cell?.below_full ? " uncertain" : ""}${cell?.low_confidence ? " shaky" : ""}`}
    >
      <button type="button" onClick={onOpen} aria-label={`${label}: ${state}`}>
        {state === "empty" ? (
          <span className="spec-only">{cell?.spec}</span>
        ) : (
          <>
            <span className="read">
              {cell?.measured || "—"}
              {/* Where the number came from, then how well it was heard. The
                  measurement is the sheet's own spec plus the deviation the
                  inspector called — never the absolute they read aloud — and an
                  auditor should be able to see both without opening the cell. */}
              <em className="from">{cell?.spec}</em>
              {typeof cell?.confidence === "number" ? (
                <em className="conf">{Math.round(cell.confidence * 100)}%</em>
              ) : null}
            </span>
            <span className="dev">{cell?.deviation}</span>
          </>
        )}
        {/* The mark carries the state as well as the colour does, so the grid
            survives a greyscale print and a colour-blind reviewer. */}
        <span className="mark-glyph" aria-hidden="true">
          {staged ? "•" : STATE_MARK[state]}
        </span>
        {cell?.disputed && !staged ? (
          <span className="disputed-mark" title="the recording contradicts this measurement">
            ≠
          </span>
        ) : null}
      </button>
    </td>
  );
}

function CellEditor({
  row,
  size,
  draft,
  setDraft,
  onCancel,
  onStage,
}: {
  row: SheetRow;
  size: string;
  draft: Draft;
  setDraft: (next: Draft) => void;
  onCancel: () => void;
  onStage: () => void;
}) {
  const cell = row.cells?.[size];
  const fresh = !cell || cell.state === "empty";
  return (
    <div
      className="sheetdlg"
      role="dialog"
      aria-modal="true"
      aria-label={`${row.pom} ${size}`}
      onKeyDown={(event) => event.key === "Escape" && onCancel()}
    >
      <div className="sheetdlg-box">
        <h3>
          {row.pom} <span className="dim">{size}</span>
        </h3>
        <p className="lede">{row.description}</p>

        <dl className="kv">
          <div style={{ display: "contents" }}>
            <dt>Spec</dt>
            <dd>
              <b>{cell?.spec || "—"}</b>{" "}
              <span className="dim">
                off the style sheet &middot; tolerance {row.tol_minus} / {row.tol_plus}
              </span>
            </dd>
          </div>
          {!fresh && (
            <>
              <div style={{ display: "contents" }}>
                <dt>Heard as</dt>
                <dd>
                  {cell?.spoken || "—"}
                  {typeof cell?.confidence === "number" ? (
                    <span className="dim"> · confidence {Math.round(cell.confidence * 100)}%</span>
                  ) : null}
                </dd>
              </div>
              {/* Read-only, and below the spec on purpose. The absolute is what
                  transcription mangles, so it decides nothing here - it is kept
                  so a reviewer can tell a misheard number from a real deviation. */}
              <div style={{ display: "contents" }}>
                <dt>Read aloud</dt>
                <dd className={cell?.disputed ? "disputed-note" : "dim"}>
                  {cell?.stated?.value || "—"}
                  {cell?.disputed ? (
                    <>
                      {" "}
                      &mdash; neither the spec nor this measurement. The two numbers the inspector
                      said do not agree; listen back before releasing it.
                    </>
                  ) : cell?.stated?.value && cell.stated.value === cell.spec ? (
                    <> &mdash; the spec, read off the sheet</>
                  ) : cell?.stated?.value && cell.stated.value === cell.measured ? (
                    <> &mdash; the measurement, called off the tape</>
                  ) : null}
                </dd>
              </div>
            </>
          )}
        </dl>

        {fresh && (
          <p className="caution">
            The recording never covered this point of measure. Anything entered here is your reading,
            not the inspector&apos;s — it is recorded as settled by hand.
          </p>
        )}

        <label className="fld">
          <span>Verdict</span>
          <select value={draft.verdict} onChange={(e) => setDraft({ ...draft, verdict: e.target.value })}>
            {VERDICTS.map((verdict) => (
              <option key={verdict.id} value={verdict.id}>
                {verdict.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>
            Deviation
            <em>what the inspector called</em>
          </span>
          <input
            value={draft.deviation}
            placeholder="e.g. -1/8"
            onChange={(e) => setDraft({ ...draft, deviation: e.target.value })}
          />
        </label>
        {/* The result, not a field. The style sheet is the only source for the
            measurement, so there is nothing here to type into. */}
        <div className="fld result">
          <span>
            Measured
            <em>spec + deviation</em>
          </span>
          <output>{cell?.measured || "—"}</output>
        </div>
        <p className="hint">
          The style sheet is the only source for the measurement: the spec of{" "}
          <b>{cell?.spec || "—"}</b> plus the deviation above. Change the deviation to move it.
        </p>
        <label className="fld">
          <span>Note</span>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>

        <div className="row tight" style={{ marginTop: 14 }}>
          <span className="spacer" />
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button onClick={onStage}>Stage this change</button>
        </div>
      </div>
    </div>
  );
}
