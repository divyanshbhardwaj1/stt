import { useEffect, useState } from "react";
import { fetchStyleSets } from "../api";
import { useSession } from "../session";

/**
 * The style set library — `demo/library.html`.
 *
 * The prototype's rows carry a description, season, sizes, a POM count and a
 * last-used date, because its sheets are mock objects. The server lists what
 * is in `data/StyleSets` and knows the style number and nothing else, so those
 * columns are not here: a table with five columns of invented detail is worse
 * than one with two that are true.
 *
 * Read-only for the same reason. `GET /api/style-sets` lists the library and
 * there is no endpoint that adds to it, so the Upload button the prototype has
 * would 404. `manage.styles` is enforced already and has nothing to guard yet.
 */
export function StyleSets() {
  const { can } = useSession();
  const [styles, setStyles] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchStyleSets()
      .then(setStyles)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Could not read the library."),
      );
  }, []);

  const shown = (styles ?? []).filter((style) => style.toLowerCase().includes(query));

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Style sets</h1>
          <span className="pill">
            {styles === null
              ? "…"
              : `${styles.length} sheet${styles.length === 1 ? "" : "s"}${
                  shown.length !== styles.length ? ` · ${shown.length} matching` : ""
                }`}
          </span>
          <span className="spacer" />
          {can("manage.styles") && (
            <button
              className="btn sm"
              disabled
              title="Uploading is not built yet — sheets are read from data/StyleSets on disk."
            >
              Upload a sheet
            </button>
          )}
        </div>
        <p className="page-meta">
          The buyer&apos;s graded measurement sheets. Every measurement on a report is rebuilt
          as the spec on one of these plus the deviation the inspector called.
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
          placeholder="Search by style number"
          style={{ maxWidth: 260, height: 36 }}
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
                <th>Document</th>
                <th>Checked against</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((style) => (
                <tr key={style}>
                  <td>
                    <b className="pom">{style}</b>
                  </td>
                  <td>
                    <span className="pill">PDF</span> graded spec sheet
                  </td>
                  <td className="why">Every measurement, every size</td>
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
            <h2>{styles === null ? "Reading the library…" : query ? "Nothing matches that" : "No style sets"}</h2>
            <p>
              {query
                ? "No sheet has that style number."
                : "Nothing in the library, so an inspection can be transcribed but not checked against spec. Put the buyer's graded sheets in data/StyleSets."}
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

      <p className="lede" style={{ marginTop: 20, fontSize: 12.5 }}>
        {can("manage.styles")
          ? "Sheets are read from data/StyleSets on disk. Uploading from here arrives with the library in the database."
          : "The library is managed by an administrator."}
      </p>
    </>
  );
}
