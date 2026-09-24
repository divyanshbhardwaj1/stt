import { useEffect, useMemo, useState } from "react";
import { fetchActivity, type Event } from "../api";
import { useSession } from "../session";

/**
 * Activity — `demo/logs.html`.
 *
 * Append-only and attributed. Nothing in the application updates or deletes a
 * row behind this screen, which is the only reason it is worth anything when a
 * vendor disputes a measurement months later.
 *
 * Machine steps are deliberately absent. Transcription finishing, a file being
 * written, a job changing state: those are the inspection's own progress and
 * the Inspections screen already shows them. What is here is what a person
 * did. Four corrections buried in two hundred progress notices is a log nobody
 * reads.
 */

/** What kind of thing happened, and how it is badged. */
const KINDS: Record<string, [string, string]> = {
  record: ["Recording", "pill"],
  correction: ["Correction", "pill lavender"],
  approval: ["Approval", "pill success"],
  release: ["Release", "pill error"],
  access: ["Access", "pill"],
};

const label = (kind: string) => KINDS[kind]?.[0] ?? kind;

function When({ at }: { at: string }) {
  const when = new Date(at);
  return (
    <>
      <b>{when.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>
      <div className="dim" style={{ fontSize: 11.5 }}>
        {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </div>
    </>
  );
}

export function Activity() {
  const { can } = useSession();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("all");
  const [person, setPerson] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchActivity()
      .then(setEvents)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Could not read the log."),
      );
  }, []);

  const all = useMemo(() => events ?? [], [events]);

  // Built from the log rather than hard-coded, so a stage with no releases
  // does not offer a Releases tab that returns nothing.
  const kinds = useMemo(() => [...new Set(all.map((event) => event.kind))], [all]);
  const actors = useMemo(
    () => [...new Set(all.map((event) => event.actor).filter(Boolean))].sort(),
    [all],
  );

  const shown = all.filter(
    (event) =>
      (kind === "all" || event.kind === kind) &&
      (person === "all" || event.actor === person) &&
      (!query || `${event.actor} ${event.what} ${event.subject}`.toLowerCase().includes(query)),
  );

  /** Who did how much, which is the question a supervisor actually asks. */
  const byPerson = useMemo(() => {
    const tally = new Map<string, { entries: number; kinds: Set<string>; last: string }>();
    for (const event of all) {
      const who = event.actor || "Unattributed";
      const seen = tally.get(who) ?? { entries: 0, kinds: new Set<string>(), last: event.at };
      seen.entries += 1;
      seen.kinds.add(event.kind);
      if (event.at > seen.last) seen.last = event.at;
      tally.set(who, seen);
    }
    return [...tally.entries()].sort((a, b) => b[1].entries - a[1].entries);
  }, [all]);

  const filtered = kind !== "all" || person !== "all" || Boolean(query);

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Activity</h1>
          <span className="pill">
            {events === null
              ? "…"
              : `${all.length} entr${all.length === 1 ? "y" : "ies"}${
                  shown.length !== all.length ? ` · ${shown.length} matching` : ""
                }`}
          </span>
        </div>
        <p className="page-meta">
          Who recorded, corrected, downloaded and released. Append-only and attributed.
        </p>
      </header>

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 20 }}>
          {error}
        </div>
      )}

      <div className="notice info" style={{ marginTop: 20 }}>
        <b>Entries are written when the action happens and are never edited or removed.</b> That
        is what makes them worth anything when a vendor disputes a measurement months later. What
        the machine did — transcribing, grading, writing a file — is the inspection&apos;s own
        progress and is not logged here.
      </div>

      <div className="toolbar">
        <div className="tabs">
          <button aria-selected={kind === "all"} onClick={() => setKind("all")}>
            All
          </button>
          {kinds.map((one) => (
            <button key={one} aria-selected={kind === one} onClick={() => setKind(one)}>
              {label(one)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {actors.length > 1 && (
          <select
            style={{ maxWidth: 220 }}
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            aria-label="Filter by person"
          >
            <option value="all">Everyone</option>
            {actors.map((who) => (
              <option key={who} value={who}>
                {who}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search the log"
          style={{ maxWidth: 260, height: 36 }}
          value={query}
          onChange={(e) => setQuery(e.target.value.trim().toLowerCase())}
        />
      </div>

      {shown.length > 0 ? (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Kind</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((event) => (
                <tr key={event.id}>
                  <td>
                    <When at={event.at} />
                  </td>
                  <td>
                    {event.actor ? (
                      <b>{event.actor}</b>
                    ) : (
                      // Recorded before sign-in attribution existed. Said
                      // plainly rather than filled in with a guess.
                      <span className="dim">Unattributed</span>
                    )}
                  </td>
                  <td>{event.what}</td>
                  <td>
                    <span className={KINDS[event.kind]?.[1] ?? "pill"}>{label(event.kind)}</span>
                  </td>
                  <td className="why pom">{event.subject || "—"}</td>
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
              {events === null
                ? "Reading the log…"
                : filtered
                  ? "Nothing matches that"
                  : "No activity yet"}
            </h2>
            <p>
              {filtered
                ? "No entry in the log matches the filters you have set."
                : "The trail starts with the first recording, correction or download."}
            </p>
            {filtered && (
              <div className="files" style={{ justifyContent: "center" }}>
                <button
                  className="btn secondary"
                  onClick={() => {
                    setKind("all");
                    setPerson("all");
                    setQuery("");
                  }}
                >
                  Clear the filters
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {byPerson.length > 0 && can("manage.people") && (
        <section>
          <div className="section-head">
            <h2>By person</h2>
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Entries</th>
                  <th>What they did</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {byPerson.map(([who, seen]) => (
                  <tr key={who}>
                    <td>
                      <b>{who}</b>
                    </td>
                    <td className="num">{seen.entries}</td>
                    <td>
                      <div className="sizes">
                        {[...seen.kinds].map((one) => (
                          <span className={KINDS[one]?.[1] ?? "pill"} key={one}>
                            {label(one)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="why">
                      {new Date(seen.last).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
