/**
 * Activity — `demo/logs.html`.
 *
 * The prototype's log is a list of invented events. There is no audit trail on
 * the server yet, so this screen says that instead of showing one: a log that
 * makes entries up is worse than a log that is honestly empty, because it is
 * the one screen people reach for when they need to know what actually
 * happened.
 *
 * The table it will fill is phase 5 — `Inspection` and `User` already carry
 * the ids it needs to point at.
 */
export function Activity() {
  return (
    <>
      <header>
        <div className="page-title">
          <h1>Activity</h1>
          <span className="pill">Not recorded yet</span>
        </div>
        <p className="page-meta">
          Who recorded, corrected, downloaded and released, on this stage.
        </p>
      </header>

      <div className="notice info" style={{ marginTop: 20 }}>
        <b>Nothing is being written down yet.</b> Recording, settling a cell and downloading a
        vendor document are all attributable — every one of them runs as a signed-in user with
        a stable id — but the server does not yet keep the trail. Until it does, this screen
        would have to invent its contents, and an invented audit log is worse than none.
      </div>

      <div className="blank" style={{ marginTop: 20 }}>
        <div>
          <div className="art" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <h2>No activity to show</h2>
          <p>
            The events this screen lists are the ones the graded sheet depends on for its
            attribution. They arrive with the audit trail.
          </p>
        </div>
      </div>
    </>
  );
}
