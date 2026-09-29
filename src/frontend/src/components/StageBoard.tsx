import { useEffect, useState } from "react";
import { fetchLibrary, type LibrarySheet } from "../api";
import { demoDate, demoInspections, type DemoInspection } from "../demoStages";
import { href } from "../router";
import { stageOf } from "../stages";

/**
 * A stage that has no pipeline yet, on stand-in rows.
 *
 * PPM, interim and final are three different jobs, not one shape with
 * different words: a PPM is a meeting with open points, an interim is a defect
 * rate off a sample, and a final is a lot accepted or rejected against an
 * accept number. `demoStages.ts` produces each in its own vocabulary, seeded
 * off the style so a style keeps the same inspector and the same figures
 * across reloads — which is what makes a demo readable rather than noise.
 *
 * Said once, at the top, and not on every row. A banner somebody reads when
 * they arrive is honest; a badge on all forty rows is noise that stops being
 * read by the second screenful, and then it is not doing the job either.
 */

interface Props {
  stageId: string;
  onOpenStyle: (styleNo: string) => void;
}

interface Line extends DemoInspection {
  styleNo: string;
  description: string;
}

export function StageBoard({ stageId, onOpenStyle }: Props) {
  const stage = stageOf(stageId);
  const [sheets, setSheets] = useState<LibrarySheet[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchLibrary()
      .then((found) => live && setSheets(found))
      // The library is where the styles come from. Without it there is nothing
      // to stand a check against, which the empty state says.
      .catch(() => live && setSheets([]));
    return () => {
      live = false;
    };
  }, []);

  const styles = (sheets ?? []).filter((sheet) => sheet.style_no);
  const lines: Line[] = styles
    .flatMap((sheet) =>
      demoInspections(sheet.style_no, stageId).map((row) => ({
        ...row,
        styleNo: sheet.style_no,
        description: sheet.description,
      })),
    )
    .sort((a, b) => a.daysAgo - b.daysAgo);

  const byState = lines.reduce<Record<string, number>>((tally, line) => {
    tally[line.state] = (tally[line.state] ?? 0) + 1;
    return tally;
  }, {});
  const settled = lines.filter((line) => line.tone.includes("success")).length;

  return (
    <>
      <header>
        <div className="page-title">
          <span className={`tile ${stage.fill}`} aria-hidden="true">
            {stage.tag}
          </span>
          <h1>{stage.name}</h1>
          {lines.length > 0 && <span className="pill">{lines.length}</span>}
        </div>
        <p className="page-meta">{stage.blurb}</p>
      </header>

      <div className="notice info" style={{ marginTop: 20 }}>
        <b>This stage has no pipeline yet, so everything below is stand-in data.</b> The
        shape is right — {stage.name.toLowerCase()} really is {stage.detail.toLowerCase()} —
        but no recording has been through it and nothing here can be opened. Size set is the
        stage that works.
      </div>

      {lines.length > 0 ? (
        <>
          <section>
            <div className="section-head">
              <h2>Where it stands</h2>
            </div>
            <dl className="readout">
              <div>
                <dt>Styles</dt>
                <dd>{styles.length}</dd>
              </div>
              <div>
                <dt>Checks</dt>
                <dd>{lines.length}</dd>
              </div>
              <div className={settled === lines.length ? "clear" : ""}>
                <dt>Closed</dt>
                <dd>{settled}</dd>
              </div>
              <div className={settled === lines.length ? "" : "warm"}>
                <dt>Still open</dt>
                <dd>{lines.length - settled}</dd>
              </div>
            </dl>
            <div className="legend" style={{ marginTop: 10 }}>
              {Object.entries(byState).map(([state, count]) => (
                <span key={state}>
                  {state} · {count}
                </span>
              ))}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Every check on this stage</h2>
            </div>
            <p className="lede">
              Newest first, across every style in the library. Open a style for all four of
              its stages at once.
            </p>
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Check</th>
                    <th>Result</th>
                    <th>Date</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.id}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a")) return;
                        onOpenStyle(line.styleNo);
                      }}
                    >
                      <td>
                        <div className="styleno">
                          <a className="link" href={href("style", line.styleNo)}>
                            {line.styleNo}
                          </a>
                        </div>
                        <div className="dim pom" style={{ fontSize: 11.5 }}>
                          {line.description}
                        </div>
                      </td>
                      <td>
                        <b>{line.label}</b>
                        <div className="dim pom" style={{ fontSize: 11.5 }}>
                          {line.by} · {line.where}
                        </div>
                      </td>
                      <td className="why">{line.summary}</td>
                      <td className="why">{demoDate(line).toLocaleDateString()}</td>
                      <td>
                        <span className={line.tone}>{line.state}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="blank" style={{ marginTop: 20 }}>
          <div>
            <div className="art" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h2>{sheets === null ? "Reading the library…" : "No styles to stand against"}</h2>
            <p>
              The stand-in rows are generated per style, so there is nothing to show until
              the library has one. Upload a buyer&apos;s graded sheet.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
