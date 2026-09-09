import type { FailedRow, FlaggedRow, UnconfirmedRow } from "../types";

/** An empty cell, distinct from a zero. */
const Nil = () => <span className="nil">&mdash;</span>;
const cell = (value: string) => (value ? value : <Nil />);

const Scroll = ({ children }: { children: React.ReactNode }) => (
  <div className="scroll">
    <table>{children}</table>
  </div>
);

/**
 * Points of measure the recording never ruled on.
 *
 * "??" is the same mark the graded PDF prints for these, so screen and paper
 * read alike. The word next to it is what makes the state legible without
 * colour.
 */
export function UnconfirmedTable({ rows }: { rows: UnconfirmedRow[] }) {
  return (
    <Scroll>
      <thead>
        <tr>
          <th>POM</th>
          <th>Size</th>
          <th>Point of measure</th>
          <th className="num">Spec</th>
          <th>Heard as</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.no} className="row-open">
            <td className="pom">{cell(row.pom)}</td>
            <td>{cell(row.size)}</td>
            <td>{row.description}</td>
            <td className="num">{cell(row.spec)}</td>
            <td className="said">{cell(row.spoken)}</td>
            <td>
              <span className="mark open">?? no verdict</span>
            </td>
          </tr>
        ))}
      </tbody>
    </Scroll>
  );
}

export function FailedTable({ rows }: { rows: FailedRow[] }) {
  return (
    <Scroll>
      <thead>
        <tr>
          <th>POM</th>
          <th>Size</th>
          <th>Point of measure</th>
          <th className="num">Spec</th>
          <th className="num">Measured</th>
          <th className="num">Deviation</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.no} className="row-fail">
            <td className="pom">{cell(row.pom)}</td>
            <td>{cell(row.size)}</td>
            <td>{row.description}</td>
            <td className="num">{cell(row.spec)}</td>
            <td className="num">{cell(row.measured)}</td>
            <td className="num">{cell(row.deviation)}</td>
            <td>
              <span className="mark fail">&times; out</span>
            </td>
          </tr>
        ))}
      </tbody>
    </Scroll>
  );
}

export function FlaggedTable({ rows }: { rows: FlaggedRow[] }) {
  return (
    <Scroll>
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Size</th>
          <th>Point of measure</th>
          <th className="num">Value</th>
          <th className="num">Heard</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.no}>
            <td className="num dim">{row.no}</td>
            <td>{cell(row.size)}</td>
            <td>{row.field}</td>
            <td className="num">
              {cell(row.value)}
              {row.deviation ? ` ${row.deviation}` : ""}
            </td>
            <td className="num">
              <span className="mark heard">{(row.confidence * 100).toFixed(0)}%</span>
            </td>
            <td className="dim">{row.note || "low confidence in the transcription"}</td>
          </tr>
        ))}
      </tbody>
    </Scroll>
  );
}
