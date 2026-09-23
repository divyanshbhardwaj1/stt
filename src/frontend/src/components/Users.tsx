import { useCallback, useEffect, useState } from "react";
import { addUser, fetchRoster, patchUser, removeUser, type Roster, type User } from "../api";
import { useSession } from "../session";
import { STAGES, stageOf } from "../stages";

/**
 * Members — `demo/members.html`.
 *
 * Every rule this screen appears to enforce is enforced on the server: the
 * last administrator, the role names, the address format, the uniqueness. What
 * is here is the form and the wording that comes back, unchanged — the API
 * already phrases its refusals for the person reading them, and rewriting them
 * in the browser would throw away the only part that says what to do next.
 *
 * The prototype keys a member by id. Here the column is the email, because
 * that is what somebody signs in with and recognises; the identity underneath
 * is a uuid and never appears on screen.
 */

const ROLE_LABELS: Record<string, string> = {
  inspector: "Inspector",
  reviewer: "QA reviewer",
  approver: "Approver",
};

export function Users() {
  const { me } = useSession();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRoster(await fetchRoster());
  }, []);

  useEffect(() => {
    let live = true;
    fetchRoster()
      .then((fresh) => live && setRoster(fresh))
      .catch(
        (failure: unknown) =>
          live &&
          setError(failure instanceof Error ? failure.message : "Could not load the roster."),
      );
    return () => {
      live = false;
    };
  }, []);

  const act = useCallback(
    async (work: () => Promise<unknown>, said?: string) => {
      setBusy(true);
      setError("");
      setNote("");
      try {
        await work();
        await load();
        if (said) setNote(said);
        return true;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "That did not work.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (!roster) {
    return (
      <>
        <header>
          <div className="page-title">
            <h1>Members</h1>
          </div>
        </header>
        {error ? <div className="notice bad">{error}</div> : <p className="lede">Loading…</p>}
      </>
    );
  }

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Members</h1>
          <span className="pill">
            {roster.users.length} {roster.users.length === 1 ? "person" : "people"}
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setAdding(true)}>
            Add member
          </button>
        </div>
        <p className="page-meta">
          Who can sign in, and what they may do on each stage. A role is a role in one stage —
          the same person is often a reviewer on one and an approver on another.
        </p>
      </header>

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 16 }}>
          <b>{error}</b>
        </div>
      )}
      {note && (
        <div className="notice warn" style={{ marginTop: 16 }}>
          {note}
        </div>
      )}

      <div className="tablewrap" style={{ marginTop: 20 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Stages and roles</th>
              <th>Status</th>
              <th>Last active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roster.users.map((person) => (
              <tr key={person.id}>
                <td className="pom">
                  {person.email}
                  {person.id === me?.id && <span className="pill">you</span>}
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="avatar">{person.name.slice(0, 1)}</span>
                    <b>{person.name}</b>
                  </div>
                </td>
                <td>
                  <div className="teamchips">
                    {person.admin ? (
                      <span className="teamchip admin">
                        <b>Administrator</b> every stage
                      </span>
                    ) : Object.keys(person.roles).length === 0 ? (
                      <span className="dim">no stage</span>
                    ) : (
                      Object.entries(person.roles).map(([id, role]) => (
                        <span key={id} className="teamchip">
                          <i className={`tile ${stageOf(id).fill}`}>{stageOf(id).tag}</i>
                          {stageOf(id).name}
                          <b>{ROLE_LABELS[role] ?? role}</b>
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td>
                  {person.state === "active" ? (
                    <span className="pill success">active</span>
                  ) : person.state === "invited" ? (
                    <span className="pill warning">invited</span>
                  ) : (
                    <span className="pill error">disabled</span>
                  )}
                </td>
                <td className="why">
                  {person.last_seen_at ? person.last_seen_at.slice(0, 10) : "Never"}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn quiet sm" disabled={busy} onClick={() => setEditing(person)}>
                    Edit
                  </button>
                  <button
                    className="btn quiet sm"
                    disabled={busy}
                    onClick={() => {
                      // The server refuses the last administrator and the
                      // account you are signed in with; this only stops the
                      // easy mistake.
                      if (window.confirm(`Remove ${person.name}? This cannot be undone.`)) {
                        void act(
                          () => removeUser(person.id),
                          `${person.name} removed. Corrections already attributed to them are unchanged.`,
                        );
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <MemberDialog
          member={editing ?? undefined}
          busy={busy}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (draft) => {
            const ok = editing
              ? await act(() =>
                  patchUser(editing.id, {
                    email: draft.email,
                    name: draft.name,
                    roles: draft.roles,
                    admin: draft.admin,
                    state: draft.state,
                    ...(draft.password ? { password: draft.password } : {}),
                  }),
                )
              : await act(() =>
                  addUser({
                    email: draft.email,
                    name: draft.name,
                    roles: draft.roles,
                    admin: draft.admin,
                    password: draft.password,
                  }),
                );
            if (ok) {
              setAdding(false);
              setEditing(null);
            }
          }}
        />
      )}
    </>
  );
}

interface Draft {
  email: string;
  name: string;
  roles: Record<string, string>;
  admin: boolean;
  state: string;
  password: string;
}

function MemberDialog({
  member,
  busy,
  onClose,
  onSave,
}: {
  member?: User;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    email: member?.email ?? "",
    name: member?.name ?? "",
    roles: member?.roles ?? {},
    admin: member?.admin ?? false,
    state: member?.state ?? "invited",
    password: "",
  });

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={member ? `Edit ${member.name}` : "Add member"}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{member ? `Edit ${member.name}` : "Add member"}</h2>
        <p className="sub">
          {member
            ? "Anything that narrows what they may do signs them out everywhere, at once."
            : "They will be invited, and can sign in once a password is set."}
        </p>

        <div className="field" style={{ marginBottom: 14 }}>
          <label className="lbl" htmlFor="md-email">
            Email
          </label>
          <input
            id="md-email"
            type="email"
            autoCapitalize="off"
            spellCheck={false}
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          <span className="hint">
            What they sign in with. It can be corrected later without breaking anything that
            points at them.
          </span>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label className="lbl" htmlFor="md-name">
            Name
          </label>
          <input
            id="md-name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <span className="hint">What the audit trail records.</span>
        </div>

        <label className="check" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={draft.admin}
            onChange={(event) => setDraft({ ...draft, admin: event.target.checked })}
          />
          <span>Administrator — holds every stage, including ones added later</span>
        </label>

        {!draft.admin && (
          <div className="field" style={{ marginBottom: 14 }}>
            <span className="lbl">Role on each stage</span>
            {STAGES.map((stage) => (
              <div key={stage.id} className="rolerow">
                <span className="teamchip">
                  <i className={`tile ${stage.fill}`}>{stage.tag}</i>
                  {stage.name}
                </span>
                <select
                  value={draft.roles[stage.id] ?? ""}
                  onChange={(event) => {
                    const next = { ...draft.roles };
                    if (event.target.value) next[stage.id] = event.target.value;
                    else delete next[stage.id];
                    setDraft({ ...draft, roles: next });
                  }}
                >
                  <option value="">No access</option>
                  {Object.entries(ROLE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {member && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="lbl" htmlFor="md-state">
              Status
            </label>
            <select
              id="md-state"
              value={draft.state}
              onChange={(event) => setDraft({ ...draft, state: event.target.value })}
            >
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        )}

        <div className="field">
          <label className="lbl" htmlFor="md-password">
            {member ? "New password" : "Password"}
          </label>
          <input
            id="md-password"
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
          />
          <span className="hint">
            {member
              ? "Leave blank to keep the current one. Setting it signs them out everywhere."
              : "Leave blank to invite them — they hold their roles but cannot sign in until a password is set."}
          </span>
        </div>

        <div className="dialog-foot">
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => onSave(draft)} disabled={busy}>
            {busy ? "Saving…" : member ? "Save changes" : "Add member"}
          </button>
        </div>
      </div>
    </div>
  );
}
