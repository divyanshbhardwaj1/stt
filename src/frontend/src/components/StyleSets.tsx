import { useCallback, useEffect, useState } from "react";
import {
  fetchLibrary,
  fetchLibrarySheet,
  removeStyleSet,
  sheetPdfUrl,
  uploadStyleSet,
  type LibrarySheet,
  type LibrarySheetDetail,
  type StyleSetAdded,
} from "../api";
import { since } from "../format";
import { useSession } from "../session";

/**
 * The style set library — `demo/library.html`.
 *
 * Every column here is read out of the PDF itself: description, season,
 * sizes, base size, the point-of-measure count. `GET /api/style-sets/sheets`
 * parses each sheet once and caches on size and mtime, which is why the
 * picker on the record screen still uses the cheap filename-only endpoint —
 * that one is on the path to starting an inspection and must never wait on a
 * parser.
 *
 * Uploading is real: the style number comes out of the document rather than
 * off the filename, and a sheet added here is checked against on the very
 * next recording with nothing to restart.
 */

/** The feature-card cycle at list-marker scale, one colour per sheet. */
const FILLS = ["pink", "teal", "lavender", "peach", "ochre", "mint"];

function Badge({ sheet }: { sheet: LibrarySheet }) {
  if (!sheet.readable) return <span className="pill error">Unreadable</span>;
  // A sheet read off an image is usable and says so on every report it
  // touches. It belongs in the library with a mark on it, not hidden.
  if (sheet.from_scan) return <span className="pill warning">Read from a scan</span>;
  if (sheet.status && !sheet.status.startsWith("FNL"))
    return <span className="pill warning">{sheet.status} — in development</span>;
  return <span className="pill success">Ready</span>;
}

/** The sheet detail — the whole graded specification, as issued. */
function SheetDialog({ styleNo, onClose, onRemoved }: {
  styleNo: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { can } = useSession();
  const [sheet, setSheet] = useState<LibrarySheetDetail | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    fetchLibrarySheet(styleNo)
      .then(setSheet)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Could not read that sheet."),
      );
  }, [styleNo]);

  const remove = useCallback(async () => {
    setRemoving(true);
    try {
      await removeStyleSet(styleNo);
      onRemoved();
      onClose();
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "The sheet was not removed.");
      setRemoving(false);
    }
  }, [styleNo, onRemoved, onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Style ${styleNo}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="page-title" style={{ marginBottom: 4 }}>
          <h2>Style {styleNo}</h2>
          {sheet && <Badge sheet={sheet} />}
          <span className="spacer" />
          <button className="rail-toggle" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="sub">
          {sheet
            ? [sheet.description, sheet.company, sheet.season].filter(Boolean).join(" · ")
            : "Reading the sheet…"}
        </p>

        {error && (
          <div className="notice bad" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {sheet && (
          <>
            <div className="section-head">
              <h2 style={{ font: "var(--text-title-md)" }}>Sheet header</h2>
            </div>
            <dl className="kv">
              {(
                [
                  ["Style", sheet.style_no],
                  ["Description", sheet.description],
                  ["Company", sheet.company],
                  ["Season", sheet.season],
                  ["Division", sheet.division],
                  [
                    "Status",
                    sheet.status.startsWith("FNL")
                      ? "FNL — final"
                      : sheet.status
                        ? `${sheet.status} — in development`
                        : "—",
                  ],
                  ["Base size", sheet.base_size || "—"],
                  ["Tolerance model", sheet.tolerance_model || "—"],
                  ["Sizes", sheet.sizes.join(" · ")],
                  ["Points of measure", String(sheet.poms || "—")],
                  ["Document", sheet.document],
                  ["Last used", sheet.last_used ? since(sheet.last_used) : "Never"],
                ] as [string, string][]
              ).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>

            <div className="section-head">
              <h2 style={{ font: "var(--text-title-md)" }}>Graded specification</h2>
            </div>
            <div className="tablewrap" style={{ maxHeight: 360 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>POM</th>
                    <th>Description</th>
                    <th className="num">Tol−</th>
                    <th className="num">Tol+</th>
                    {sheet.sizes.map((size) => (
                      <th className="num" key={size}>
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, index) => (
                    <tr key={`${row.pom}-${index}`}>
                      <td className="pom">{row.pom}</td>
                      <td>{row.description}</td>
                      <td className="num dim">{row.minus || "—"}</td>
                      <td className="num dim">{row.plus || "—"}</td>
                      {sheet.sizes.map((size) => (
                        <td className="num" key={size}>
                          {row.specs[size] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="dialog-foot">
          <a className="btn sm" href="#/record">
            Check a recording against this
          </a>
          {can("download.working") && (
            <a className="btn secondary sm" href={sheetPdfUrl(styleNo)}>
              Download the sheet
            </a>
          )}
          <span className="spacer" />
          {can("manage.styles") && (
            <button className="btn danger sm" onClick={() => void remove()} disabled={removing}>
              {removing ? "Removing…" : "Remove from the library"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The dialog behind "Upload a sheet" — `demo/library.html`. */
function UploadSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Set when the server says this style is already in the library. */
  const [clash, setClash] = useState(false);
  const [added, setAdded] = useState<StyleSetAdded | null>(null);

  const send = useCallback(
    async (replace: boolean) => {
      if (!file) return;
      setBusy(true);
      setError("");
      try {
        setAdded(await uploadStyleSet(file, replace));
        onAdded();
      } catch (failure: unknown) {
        const said = failure instanceof Error ? failure.message : "The sheet was not accepted.";
        setError(said);
        setClash(said.includes("already in the library"));
      } finally {
        setBusy(false);
      }
    },
    [file, onAdded],
  );

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Upload a sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Upload a sheet</h2>
        <p className="sub">
          The style number, sizes and tolerances are read out of the sheet — there is nothing
          to type.
        </p>

        {error && (
          <div className="notice bad" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {added ? (
          <div className="notice good" role="status">
            <b>
              Style {added.style_no} is in the library — {added.poms} point
              {added.poms === 1 ? "" : "s"} of measure across {added.sizes.length} size
              {added.sizes.length === 1 ? "" : "s"}.
            </b>{" "}
            {added.description}
            {added.sizes.length > 0 ? ` · ${added.sizes.join(", ")}` : ""}
          </div>
        ) : (
          <label
            className={`dropzone${over ? " over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              setFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError("");
                setClash(false);
              }}
            />
            <span className="big">Drop a PDF here</span>
            <span className="small">or click to choose a file · PDF only, up to 25 MB</span>
            {file && (
              <span className="chosen">
                <b>{file.name}</b>
              </span>
            )}
          </label>
        )}

        <p className="lede" style={{ marginTop: 16 }}>
          <b>PDF only, and it has to carry text.</b> Export the graded sheet from the buyer&apos;s
          system — a scan is refused here, because every measurement on a report is rebuilt from
          what is on this sheet and a misread spec is wrong in every row at once without ever
          looking wrong.
        </p>

        <div className="dialog-foot">
          {added ? (
            <button className="btn sm" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn sm" disabled={!file || busy} onClick={() => void send(false)}>
                {busy ? "Reading the sheet…" : "Upload"}
              </button>
              {clash && (
                <button className="btn danger sm" disabled={busy} onClick={() => void send(true)}>
                  Replace what is there
                </button>
              )}
              <button className="btn secondary sm" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function StyleSets() {
  const { can } = useSession();
  const [sheets, setSheets] = useState<LibrarySheet[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState("");

  const load = useCallback(() => {
    fetchLibrary()
      .then(setSheets)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Could not read the library."),
      );
  }, []);

  useEffect(load, [load]);

  const all = sheets ?? [];
  const shown = all.filter((sheet: LibrarySheet) =>
    query
      ? [sheet.style_no, sheet.description, sheet.company, sheet.season, sheet.document]
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true,
  );

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Style sets</h1>
          <span className="pill">
            {sheets === null
              ? "…"
              : `${all.length} sheet${all.length === 1 ? "" : "s"}${
                  shown.length !== all.length ? ` · ${shown.length} matching` : ""
                }`}
          </span>
          <span className="spacer" />
          {can("manage.styles") && (
            <button className="btn sm" onClick={() => setUploading(true)}>
              Upload a sheet
            </button>
          )}
        </div>
        <p className="page-meta">
          The buyer&apos;s graded measurement sheets. Every measurement on a report is rebuilt as{" "}
          <b>spec + deviation</b>, so these are the source of truth — the recording only ever
          supplies the deviation.
        </p>
      </header>

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 20 }}>
          {error}
        </div>
      )}

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search style, description or buyer"
          style={{ maxWidth: 320, height: 36 }}
          value={query}
          onChange={(event) => setQuery(event.target.value.trim().toLowerCase())}
        />
      </div>

      {shown.length > 0 ? (
        <div className="tablewrap">
          <table className="data sheets">
            <thead>
              <tr>
                <th>Style</th>
                <th>Description</th>
                <th>Season</th>
                <th>Sizes</th>
                <th className="num">POM</th>
                <th>Status</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((sheet) => (
                <tr key={sheet.document}>
                  <td>
                    <div className="styleno">
                      <span className={`tile ${FILLS[all.indexOf(sheet) % FILLS.length]}`}>
                        {sheet.style_no || "?"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <b>{sheet.description || "—"}</b>
                    <div className="dim pom" style={{ fontSize: 11.5 }}>
                      {sheet.document}
                    </div>
                  </td>
                  <td className="why">{sheet.season || "—"}</td>
                  <td>
                    <div className="sizes">
                      {sheet.sizes.map((size) => (
                        <span
                          className={`sz${size === sheet.base_size ? " base" : ""}`}
                          key={size}
                        >
                          {size}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{sheet.poms || "—"}</td>
                  <td>
                    <Badge sheet={sheet} />
                  </td>
                  <td className="why">{sheet.last_used ? since(sheet.last_used) : "Never"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="btn quiet sm"
                      disabled={!sheet.readable}
                      onClick={() => setOpen(sheet.style_no)}
                    >
                      View sheet
                    </button>
                  </td>
                </tr>
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
                  : "No style sets"}
            </h2>
            <p>
              {query
                ? "No sheet in the library matches what you searched for."
                : "Nothing in the library, so an inspection can be transcribed but not checked against spec. Upload the buyer's graded sheets to start checking."}
            </p>
            {query && (
              <div className="files" style={{ justifyContent: "center" }}>
                <button className="btn secondary" onClick={() => setQuery("")}>
                  Clear the search
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <SheetDialog styleNo={open} onClose={() => setOpen("")} onRemoved={load} />
      )}
      {uploading && <UploadSheet onClose={() => setUploading(false)} onAdded={load} />}
    </>
  );
}
