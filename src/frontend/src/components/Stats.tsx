import { useEffect, useMemo, useState } from "react";
import { DOWNLOAD_TITLES, VENDOR_DOWNLOADS, audioUrl, downloadUrl, fetchSheet } from "../api";
import { useSession } from "../session";
import type { GradedSheet, Job, SheetCell } from "../types";

/**
 * The Stats tab — `demo/report.html`'s second panel.
 *
 * A different question from the report. The report asks what to do about this
 * inspection; the stats ask how it behaved — where confidence went, how large
 * the deviations were, and which size carried the trouble. Nothing here is
 * actionable, and it should not pretend to be.
 *
 * Every figure is counted from the graded sheet the server returns. The
 * prototype's provenance block asks for four things the server does not record
 * yet — who took it, on which bench, the season, and the transcript — and
 * those say so rather than being filled with something plausible. A stats
 * screen that invents its own provenance is worse than one that admits the
 * gap, because provenance is exactly what gets checked when a vendor disputes
 * a measurement months later.
 */

const CONF_BUCKETS = ["100%", "95–99%", "90–94%", "85–89%", "under 85%"];
const DEV_BUCKETS = ["OK", "1/8", "1/4", "3/8", "1/2", "larger"];

function confBucket(confidence: number): number {
  const percent = confidence * 100;
  if (percent >= 99.5) return 0;
  if (percent >= 95) return 1;
  if (percent >= 90) return 2;
  if (percent >= 85) return 3;
  return 4;
}

/** The deviation as sixteenths, so "−1/4" and "1/4" fall in one bucket. */
function devBucket(deviation: string): number {
  const text = (deviation || "").trim().toLowerCase();
  if (!text || text === "ok" || text === "okay" || text === "0") return 0;
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  const whole = text.match(/^[-−+]?\s*(\d+)(?!\s*\/)/);
  const eighths =
    (whole ? Number(whole[1]) * 8 : 0) +
    (match ? (Number(match[1]) / Number(match[2])) * 8 : 0);
  if (eighths <= 0) return 0;
  if (eighths <= 1) return 1;
  if (eighths <= 2) return 2;
  if (eighths <= 3) return 3;
  if (eighths <= 4) return 4;
  return 5;
}

function median(values: number[]): string {
  if (!values.length) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return `${Math.round(value * 100)}%`;
}

function Bars({ buckets, counts, tone }: { buckets: string[]; counts: number[]; tone: string }) {
  const top = Math.max(1, ...counts);
  return (
    <div className="dist">
      {counts.map((n, index) => (
        <div className="row" key={buckets[index]} title={`${buckets[index]}: ${n}`}>
          <span className="k">{buckets[index]}</span>
          <span className="track">
            <i className={tone} style={{ width: `${Math.round((n / top) * 100)}%` }} />
          </span>
          <span className="v">{n}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats({ job }: { job: Job }) {
  const { can } = useSession();
  const [sheet, setSheet] = useState<GradedSheet | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!job.graded) return;
    let live = true;
    fetchSheet(job.id)
      .then((fresh) => live && setSheet(fresh))
      .catch(
        (failure: unknown) =>
          live &&
          setError(failure instanceof Error ? failure.message : "Could not read the sheet."),
      );
    return () => {
      live = false;
    };
  }, [job.id, job.graded]);

  const figures = useMemo(() => {
    if (!sheet) return null;
    const confidence = Array(CONF_BUCKETS.length).fill(0);
    const deviations = Array(DEV_BUCKETS.length).fill(0);
    const confidences: number[] = [];
    const bySize = new Map<
      string,
      { rows: number; judged: number; fail: number; open: number; conf: number[] }
    >();
    let judged = 0;
    let fail = 0;
    let open = 0;
    let settled = 0;
    let rows = 0;

    for (const row of sheet.rows) {
      for (const size of sheet.sizes) {
        const cell: SheetCell | undefined = row.cells?.[size];
        if (!cell || cell.state === "empty") continue;
        rows += 1;
        const seen = bySize.get(size) ?? { rows: 0, judged: 0, fail: 0, open: 0, conf: [] };
        seen.rows += 1;
        if (cell.state === "unconfirmed") {
          open += 1;
          seen.open += 1;
        } else {
          judged += 1;
          seen.judged += 1;
          if (cell.state === "fail") {
            fail += 1;
            seen.fail += 1;
          }
        }
        if (cell.edited) settled += 1;
        if (typeof cell.confidence === "number") {
          confidence[confBucket(cell.confidence)] += 1;
          confidences.push(cell.confidence);
          seen.conf.push(cell.confidence);
        }
        if (cell.deviation) deviations[devBucket(cell.deviation)] += 1;
        bySize.set(size, seen);
      }
    }

    return { confidence, deviations, confidences, bySize, judged, fail, open, settled, rows };
  }, [sheet]);

  return (
    <>
      {/* ------------------------------------------- where it came from */}
      <section>
        <div className="section-head">
          <h2>Where this came from</h2>
        </div>
        <p className="lede">
          Everything a disputed measurement gets checked against: when it was taken, off which
          file, and through which transcript.
        </p>

        <dl className="readout">
          <div>
            <dt>Duration</dt>
            <dd className="sizes">
              {job.elapsed
                ? `${Math.floor(job.elapsed / 60)} min ${Math.round(job.elapsed % 60)} s`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd className="sizes">Size set</dd>
          </div>
          <div>
            <dt>Style</dt>
            <dd className="sizes">{job.graded_style_no || job.announced_style_no || "none"}</dd>
          </div>
        </dl>

        <div className="dash-split" style={{ marginTop: 16 }}>
          <div className="card">
            <span className="eyebrow">Recording</span>
            <div
              className="row"
              style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 4px" }}
            >
              <b
                className="pom"
                style={{
                  fontSize: 12.5,
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {job.filename}
              </b>
            </div>
            {can("audit.view") ? (
              <audio controls preload="none" src={audioUrl(job.id)} style={{ width: "100%" }} />
            ) : (
              <p className="lede">Playback is for the QA team.</p>
            )}
          </div>

          <div className="card">
            <span className="eyebrow">Not recorded yet</span>
            <p className="lede" style={{ margin: "12px 0 0" }}>
              Who took this inspection, on which bench, and the transcript it was built from are
              not written down anywhere yet. They arrive with the audit trail. Rather than show a
              name this app cannot stand behind, it shows none — provenance is the one thing on
              this screen that has to be true.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- the numbers */}
      {!job.graded ? (
        <section>
          <div className="section-head">
            <h2>Measurements</h2>
          </div>
          <div className="notice info">
            <b>Nothing measured yet.</b> This inspection was never checked against a spec sheet,
            so no reading carries a verdict, a confidence or a deviation.
          </div>
        </section>
      ) : error ? (
        <section>
          <div className="notice bad">{error}</div>
        </section>
      ) : !figures ? (
        <section>
          <p className="lede">Reading the sheet…</p>
        </section>
      ) : (
        <>
          <section>
            <div className="section-head">
              <h2>Headline</h2>
            </div>
            <dl className="readout">
              <div>
                <dt>Readings</dt>
                <dd>{figures.rows}</dd>
              </div>
              <div>
                <dt>Judged</dt>
                <dd>{figures.judged}</dd>
              </div>
              <div className={figures.fail ? "warm" : "clear"}>
                <dt>Out of tolerance</dt>
                <dd>{figures.fail}</dd>
              </div>
              <div className={figures.open ? "hot" : "clear"}>
                <dt>No verdict</dt>
                <dd>{figures.open}</dd>
              </div>
              <div>
                <dt>Median confidence</dt>
                <dd>{median(figures.confidences)}</dd>
              </div>
              <div>
                <dt>Settled by hand</dt>
                <dd>{figures.settled}</dd>
              </div>
            </dl>
          </section>

          <div className="dash-split">
            <section>
              <div className="section-head">
                <h2>How sure the transcription was</h2>
              </div>
              <div className="card">
                <Bars buckets={CONF_BUCKETS} counts={figures.confidence} tone="cool" />
              </div>
            </section>

            <section>
              <div className="section-head">
                <h2>Deviations called</h2>
              </div>
              <div className="card">
                <Bars buckets={DEV_BUCKETS} counts={figures.deviations} tone="warm" />
              </div>
            </section>
          </div>

          <section>
            <div className="section-head">
              <h2>By size</h2>
              <span className="pill">{figures.bySize.size} measured</span>
            </div>
            <p className="lede">
              Trouble rarely spreads evenly. A size carrying most of the failures usually means one
              garment, not one point of measure.
            </p>
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th className="num">Readings</th>
                    <th className="num">Judged</th>
                    <th className="num">Out of tol</th>
                    <th className="num">No verdict</th>
                    <th className="num">Median confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {[...figures.bySize.entries()].map(([size, seen]) => (
                    <tr key={size}>
                      <td>
                        <b>{size}</b>
                      </td>
                      <td className="num">{seen.rows}</td>
                      <td className="num">{seen.judged}</td>
                      <td
                        className="num"
                        style={seen.fail ? { color: "#b3261e", fontWeight: 700 } : undefined}
                      >
                        {seen.fail || "—"}
                      </td>
                      <td
                        className="num"
                        style={seen.open ? { color: "#4c3a8a", fontWeight: 700 } : undefined}
                      >
                        {seen.open || "—"}
                      </td>
                      <td className="num">{median(seen.conf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* The files, repeated here because this is the screen somebody is on
          when they go looking for the evidence behind a disputed number. */}
      <section>
        <div className="section-head">
          <h2>Files</h2>
        </div>
        <div className="files">
          {job.downloads
            .filter((kind) =>
              can(VENDOR_DOWNLOADS.includes(kind) ? "download.vendor" : "download.working"),
            )
            .map((kind) => (
              <a key={kind} href={downloadUrl(job.id, kind)}>
                {DOWNLOAD_TITLES[kind] ?? kind}
              </a>
            ))}
        </div>
      </section>
    </>
  );
}
