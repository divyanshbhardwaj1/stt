import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioUrl, fetchCues, fetchSheet, regradeSize, settleCells } from "../api";
import { useCan } from "../session";
import type { CellEdit, GradedSheet, Job, PlaybackCues, SheetCell, SheetRow } from "../types";

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
  // An approver opens this sheet to read it and deliberately cannot change
  // it first — see services/auth.py. The cells stay clickable either way;
  // what disappears is the way to commit.
  const mayEdit = useCan("audit.edit");
  const [sheet, setSheet] = useState<GradedSheet | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ row: SheetRow; size: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [original, setOriginal] = useState<Draft>(BLANK);
  const [pending, setPending] = useState<CellEdit[]>([]);
  const [saving, setSaving] = useState(false);
  const [misplaced, setMisplaced] = useState<{ sheet_index: number; size: string }[]>([]);
  const [resizing, setResizing] = useState(false);
  /**
   * Where each reading is in the recording. Fetched the first time somebody
   * asks to listen, because building it costs money and most inspections are
   * never listened back to.
   */
  const [playback, setPlayback] = useState<PlaybackCues | null>(null);
  const [cueError, setCueError] = useState("");
  const [loadingCues, setLoadingCues] = useState(false);
  // Off the element's own events, not set when play() is called: the cue stops
  // itself at the end of the reading, and a flag we set by hand would still say
  // "playing" after it had.
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number>(0);

  const listen = useCallback(
    async (row: number) => {
      let where = playback;
      if (!where) {
        setLoadingCues(true);
        setCueError("");
        try {
          where = await fetchCues(job.id);
          setPlayback(where);
        } catch (cause) {
          setCueError(cause instanceof Error ? cause.message : "Could not locate the readings.");
          return;
        } finally {
          setLoadingCues(false);
        }
      }
      const cue = where.cues[String(row)];
      const player = audio.current;
      if (!cue || !player) {
        setCueError("This reading could not be found in the recording.");
        return;
      }
      stopAt.current = cue.end;
      // Seek only once the browser knows the timeline. Setting currentTime on a
      // element that has loaded nothing is silently dropped, which plays the
      // recording from the top and looks exactly like a wrong cue.
      const go = () => {
        player.currentTime = cue.start;
        void player.play();
      };
      if (player.readyState >= 1) go();
      else player.addEventListener("loadedmetadata", go, { once: true });
    },
    [job.id, playback],
  );

  /**
   * Silence the player.
   *
   * `stopAt` is cleared too, or the end-of-cue handler fires against a stale
   * boundary the next time something plays.
   */
  const silence = useCallback(() => {
    stopAt.current = 0;
    audio.current?.pause();
  }, []);

  /**
   * Leaving a cell stops its audio.
   *
   * Keyed on the open cell rather than hung off the Cancel button, because
   * Cancel is only one of the ways out - Escape closes the dialog, so does
   * staging a change, and so does opening a different cell. A reading left
   * playing after its cell is gone talks over whatever the reviewer opens next,
   * which on this screen means hearing one point of measure while reading
   * another.
   */
  useEffect(() => {
    silence();
  }, [open, silence]);

  // Stop at the end of the reading rather than running on into the next one.
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    const tick = () => {
      if (stopAt.current && player.currentTime >= stopAt.current) player.pause();
    };
    player.addEventListener("timeupdate", tick);
    return () => player.removeEventListener("timeupdate", tick);
  }, [playback]);

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
          <button className="btn secondary sm" onClick={onClose}>
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
  // What the operator would regret not reading. Kept on the trigger so a sheet
  // with shaky readings still says so while the note itself is folded away.
  const shaky = sheet.below_full + sheet.disputed;

  return (
    <div className="audit">
      <div className="audit-head">
        {/* `page-title` is the flex row in app.css — the verdict, the ⓘ and
            the way back all sit on one line, with the spacer below pushing
            "Back to the report" to the right edge. This said `title`, which is
            this app's old class and which app.css does not style, so the row
            was not a flex and the spacer did nothing. */}
        <div className="page-title">
          <h1
            style={{
              font: "var(--text-title-lg)",
              letterSpacing: "var(--tracking-title-lg)",
            }}
          >
            Graded sheet{" "}
            <span className="dim" style={{ fontWeight: 400 }}>
              style {sheet.style_no}
            </span>
          </h1>
          {/* The verdict's own state, not the job's. Styling this off
              `job.status` painted "FAIL CONDITIONALLY" in the pass green,
              which is the one thing a verdict must never do. */}
          <span className={`pill ${verdictState(job)}`}>{sheet.verdict}</span>
          {/* Folded away: read once, then in the way. <details> rather than a
              popover of our own - the browser already does open, close and the
              keyboard. The count stays on the trigger, because a sheet with
              shaky readings has to say so without being opened first. */}
          <details className="explain">
            <summary aria-label="About this sheet">
              i{shaky > 0 && <b className="shaky-count">{shaky}</b>}
            </summary>
            <div className="explain-box">
              <p className="lede">
                Every measurement is the spec off style <b>{sheet.style_no}</b> plus the deviation
                the inspector called. Click a cell to correct it; nothing is written until you
                save.
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
              {shaky > 0 && (
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
                      <b className="shaky-count">{sheet.disputed}</b> where the absolute the
                      inspector read aloud matches neither the spec nor this measurement
                    </>
                  )}
                  .
                </p>
              )}
            </div>
          </details>
          <span className="spacer" />
          <button className="btn secondary sm" onClick={onClose}>
            Back to the report
          </button>
        </div>
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
                <button className="btn sm" onClick={() => void regrade(check.assigned, check.best)} disabled={resizing}>
                  {resizing ? "Regrading…" : `Regrade as ${check.best}`}
                </button>
              </div>
            </div>
          ))}
        {pending.length > 0 && (
          <div className="audit-foot" role="status">
            <span className="pill peach">
              <b>
                {pending.length} correction{pending.length === 1 ? "" : "s"}
              </b>
            </span>
            <span className="hint muted" style={{ font: "var(--text-caption)" }}>
              staged, not written
            </span>
            <span className="spacer" />
            <button className="btn secondary sm" onClick={() => setPending([])} disabled={saving}>
              Discard
            </button>
            {/* Dead rather than absent, with the reason on it. A control that
                vanishes teaches nobody why, and support tickets are made of
                that. */}
            <button
              className="btn sm"
              onClick={() => void save()}
              disabled={saving || !mayEdit}
              title={
                mayEdit
                  ? undefined
                  : "Corrections are made by QA reviewers. Approvers sign off on the sheet as it stands — that separation is deliberate."
              }
            >
              {saving ? "Saving…" : "Save corrections"}
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

      {/* One player for the sheet, seeked per reading. "metadata" rather than
          "none": the duration has to be known before a seek can land, and it
          also starts the server building its seekable copy while the reviewer
          is still reading the grid. The audio itself still arrives by range
          request, a cue at a time. */}
      <audio
        ref={audio}
        src={audioUrl(job.id)}
        preload="metadata"
        hidden
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

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

        {/* The key, from demo/audit.html. Blue is confidence, lavender is no
            verdict, red is out of tolerance — the same four the graded PDF
            prints, so screen and paper say the same thing. */}
        <div className="gridkey">
          {/* One entry per fill, reading the same tokens the cells do. Two
              blue entries used to sit here for two blue bands; there is one
              blue now, so there is one entry. */}
          <span>
            <i className="sw" style={{ background: "var(--cell-uncertain)" }} />
            Heard below 100% — listen before releasing
          </span>
          <span>
            <i className="sw" style={{ background: "var(--cell-open)" }} />
            No verdict
          </span>
          <span>
            <i className="sw" style={{ background: "var(--cell-fail)" }} />
            Out of tolerance
          </span>
          <span className="spacer" />
          <span>
            Sizes marked <b>*</b> were never dictated — spec only. Base size{" "}
            <b>{sheet.base_size || "—"}</b>.
          </span>
        </div>
      </div>

      {sheet.unmatched.length > 0 && (
        <section className="unplaced">
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
        </section>
      )}

      {open && (
        <CellEditor
          row={open.row}
          size={open.size}
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setOpen(null)}
          onStage={stage}
          onListen={listen}
          onStop={silence}
          playing={playing}
          locating={loadingCues}
          cueError={cueError}
          approximate={
            playback && open.row.cells?.[open.size]?.row != null
              ? playback.cues[String(open.row.cells[open.size].row)]?.exact === false
              : false
          }
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
      // The confidence bands are `conf-mid` and `conf-low` in demo/app.css.
      // This used to say `uncertain` and `shaky`, which nothing styled — which
      // is why the blue tints and every state glyph rendered colourless.
      className={`cell ${state}${staged ? " staged" : ""}${cell?.edited ? " settled" : ""}${
        cell?.disputed ? " disputed" : ""
      }${cell?.below_full ? " conf-mid" : ""}${cell?.low_confidence ? " conf-low" : ""}`}
    >
      <button type="button" onClick={onOpen} aria-label={`${label}: ${state}`}>
        {state === "empty" ? (
          <span className="spec-only">{cell?.spec}</span>
        ) : (
          <>
            {/* The style set's own specified measurement, then the deviation
                called against it — the same two facts, in the same order, that
                graded_report.py prints into the PDF. The measurement itself is
                spec + deviation and is deliberately NOT here: showing it beside
                the spec put two numbers in a cell that are identical on every
                row the inspector passed, which reads as two rival readings. It
                is one click away, computed, in the cell editor. */}
            <span className="read">
              {cell?.spec || cell?.measured || "—"}
              {typeof cell?.confidence === "number" ? (
                <em className="conf">{Math.round(cell.confidence * 100)}%</em>
              ) : null}
            </span>
            <span className="dev">{cell?.deviation}</span>
          </>
        )}
        {/* The mark carries the state as well as the colour does, so the grid
            survives a greyscale print and a colour-blind reviewer. */}
        <span className="mark" aria-hidden="true">
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
  onListen,
  onStop,
  playing,
  locating,
  cueError,
  approximate,
}: {
  row: SheetRow;
  size: string;
  draft: Draft;
  setDraft: (next: Draft) => void;
  /** Play the seconds of the recording this reading was dictated in. */
  onListen: (reportRow: number) => void;
  onStop: () => void;
  playing: boolean;
  locating: boolean;
  cueError: string;
  /** The cue was inferred from its neighbours rather than found outright. */
  approximate: boolean;
  onCancel: () => void;
  onStage: () => void;
}) {
  const cell = row.cells?.[size];
  const fresh = !cell || cell.state === "empty";
  const stated = cell?.stated?.value || "";
  return (
    <div className="scrim" onKeyDown={(event) => event.key === "Escape" && onCancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.pom} ${size}`}
      >
        <h2>
          {row.pom} · {size}
        </h2>
        <p className="sub">{row.description}</p>

        <dl className="kv">
          <dt>Spec</dt>
          <dd>
            <b>{cell?.spec || "—"}</b>{" "}
            <span className="dim">
              off the style sheet · tolerance {row.tol_minus} / {row.tol_plus}
            </span>
          </dd>
          {!fresh && (
            <>
              <dt>Heard as</dt>
              <dd>
                {cell?.spoken || "—"}
                {typeof cell?.confidence === "number" ? (
                  <span className="dim"> · confidence {Math.round(cell.confidence * 100)}%</span>
                ) : null}
              </dd>
            </>
          )}
          {/* Read-only, and below the spec on purpose. The absolute is what
              transcription mangles, so it decides nothing here — it is kept so
              a reviewer can tell a misheard number from a real deviation. */}
          {!fresh && stated && (
            <>
              <dt>Read aloud</dt>
              <dd className="dim">
                {stated}
                {stated === cell?.spec ? (
                  <> — the spec, read off the sheet</>
                ) : stated === cell?.measured ? (
                  <> — the measurement, called off the tape</>
                ) : null}
              </dd>
            </>
          )}
        </dl>

        {cell?.disputed && (
          <p className="notice bad" style={{ marginBottom: 16 }}>
            The absolute read aloud is neither the spec nor this measurement. The two numbers the
            inspector said do not agree — listen back before releasing it.
          </p>
        )}

        {fresh && (
          <p className="notice info" style={{ marginBottom: 16 }}>
            The recording never covered this point of measure. Anything entered here is your
            reading, not the inspector&apos;s — it is recorded as settled by hand.
          </p>
        )}

        <div className="fld">
          <span>
            Recording
            <em>hear what was said</em>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              className="btn secondary sm"
              disabled={locating || cell?.row == null}
              onClick={() => {
                if (playing) return onStop();
                if (cell?.row != null) onListen(cell.row);
              }}
            >
              {locating ? "Locating…" : playing ? "■ Stop" : "▶ Play this reading"}
            </button>
            {approximate && (
              <span className="dim" style={{ font: "var(--text-caption)" }}>
                Placed between its neighbours, so this is approximate.
              </span>
            )}
            {cueError && (
              <span className="msg bad" role="alert">
                {cueError}
              </span>
            )}
          </div>
        </div>

        <label className="fld">
          <span>Verdict</span>
          <select
            value={draft.verdict}
            onChange={(e) => setDraft({ ...draft, verdict: e.target.value })}
          >
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

        <label className="fld">
          <span>
            Note
            <em>why it was settled by hand</em>
          </span>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>

        {/* The result, not a field. The style sheet is the only source for the
            measurement, so there is nothing here to type into. */}
        <div className="fld result">
          <span>Measurement</span>
          <div>
            {cell?.measured || "—"}
            <small>
              the spec of {cell?.spec || "—"} plus the deviation above — change the deviation to
              move it
            </small>
          </div>
        </div>

        <div className="dialog-foot">
          <button className="btn sm" onClick={onStage}>
            Stage this correction
          </button>
          <button className="btn secondary sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
