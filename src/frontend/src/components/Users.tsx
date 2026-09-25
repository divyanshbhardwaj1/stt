import { useCallback, useEffect, useState } from "react";
import { addUser, fetchRoster, patchUser, removeUser, type Roster, type User } from "../api";
import { plural } from "../format";
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

/**
 * What a role carries, plus this person's exceptions.
 *
 * The role is a preset and the exceptions are the differences from it, so a
 * role whose definition changes still moves everybody who was left on it.
 */
function effective(
  roster: Roster,
  role: string,
  overrides: Record<string, boolean> | undefined,
): Set<string> {
  const preset = roster.roles.find((one) => one.id === role);
  const out = new Set(preset?.can ?? []);
  for (const [capability, granted] of Object.entries(overrides ?? {})) {
    if (granted) out.add(capability);
    else out.delete(capability);
  }
  return out;
}

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
                    <>
                      <span className="pill warning">invited</span>
                      {/* There is no invite email. Somebody has to set the
                          password and tell them, and the roster is where that
                          gets noticed rather than three weeks later. */}
                      <div className="why">Cannot sign in — no password set</div>
                    </>
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
          roster={roster}
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
                    permissions: draft.permissions,
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
                    permissions: draft.permissions,
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
  /** Only where this person differs from the role. {stage: {cap: granted}}. */
  permissions: Record<string, Record<string, boolean>>;
  admin: boolean;
  state: string;
  password: string;
}

function MemberDialog({
  member,
  roster,
  busy,
  onClose,
  onSave,
}: {
  member?: User;
  roster: Roster;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    email: member?.email ?? "",
    name: member?.name ?? "",
    roles: member?.roles ?? {},
    permissions: member?.permissions ?? {},
    admin: member?.admin ?? false,
    state: member?.state ?? "invited",
    password: "",
  });
  /**
   * The stage being edited. One at a time rather than four stacked rows:
   * eight permissions across four stages is thirty-two controls in a dialog,
   * and nobody sets more than one stage at a time anyway.
   *
   * Opens on a stage they already hold, so editing somebody does not begin by
   * looking at a stage they have nothing to do with.
   */
  const [stageId, setStageId] = useState(
    () => Object.keys(member?.roles ?? {})[0] ?? STAGES[0].id,
  );

  /** Tick or clear one capability for one stage, storing only differences. */
  function toggle(stage: string, capability: string, on: boolean) {
    const role = draft.roles[stage] ?? "";
    const carries = (roster.roles.find((one) => one.id === role)?.can ?? []).includes(
      capability,
    );
    const forStage = { ...(draft.permissions[stage] ?? {}) };
    if (on === carries) delete forStage[capability];
    else forStage[capability] = on;
    const next = { ...draft.permissions };
    if (Object.keys(forStage).length) next[stage] = forStage;
    else delete next[stage];
    setDraft({ ...draft, permissions: next });
  }

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
            : "They can sign in as soon as you save — a password is set here, not invited for."}
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
            <p className="hint" style={{ marginBottom: 8 }}>
              A role is a starting point, not a cage — anything it carries can be granted or
              withheld for this person on this stage.
            </p>
            {/* One line of stages, switchable. A stage they hold no role on
                is greyed, so a glance answers "where do they work" without
                opening each in turn — but still clickable, because granting
                access is the whole reason to go there. */}
            <div className="tabs stagetabs">
              {STAGES.map((stage) => {
                const held = Boolean(draft.roles[stage.id]);
                return (
                  <button
                    type="button"
                    key={stage.id}
                    className={held ? undefined : "off"}
                    aria-selected={stageId === stage.id}
                    onClick={() => setStageId(stage.id)}
                  >
                    <i className={`tile ${stage.fill}`}>{stage.tag}</i>
                    <span>{stage.name}</span>
                  </button>
                );
              })}
            </div>

            {STAGES.filter((stage) => stage.id === stageId).map((stage) => {
              const role = draft.roles[stage.id] ?? "";
              const changed = Object.keys(draft.permissions[stage.id] ?? {}).length;
              const has = effective(roster, role, draft.permissions[stage.id]);
              const preset = roster.roles.find((one) => one.id === role)?.can ?? [];
              return (
                <div className="stagepane" key={stage.id}>
                  <div className="rolerow">
                    <span className="lbl">Role on {stage.name}</span>
                    <select
                      value={role}
                      onChange={(event) => {
                        const next = { ...draft.roles };
                        const permissions = { ...draft.permissions };
                        if (event.target.value) next[stage.id] = event.target.value;
                        else delete next[stage.id];
                        // Exceptions belong to the role they were exceptions
                        // to. Carrying them onto a different role, or onto no
                        // role at all, is how somebody keeps a permission
                        // after being moved off the job that needed it.
                        delete permissions[stage.id];
                        setDraft({ ...draft, roles: next, permissions });
                      }}
                    >
                      <option value="">No access</option>
                      {Object.entries(ROLE_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {changed > 0 && (
                      <span className="pill warning">{plural(changed, "change")}</span>
                    )}
                  </div>

                  {role ? (
                    <div className="perms">
                      <p className="hint">
                        {ROLE_LABELS[role]} carries the ticks below. Change any of them for
                        this person on {stage.name} alone — the role itself is untouched.
                      </p>
                      {roster.capabilities.map((capability) => {
                        const on = has.has(capability.id);
                        const standard = preset.includes(capability.id);
                        return (
                          <label className="check" key={capability.id}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(event) =>
                                toggle(stage.id, capability.id, event.target.checked)
                              }
                            />
                            <span>{capability.label}</span>
                            {on !== standard && (
                              <span className="pill warning">
                                {on ? "granted" : "withheld"}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="hint" style={{ marginTop: 8 }}>
                      No access to {stage.name}. Give them a role here to set permissions.
                    </p>
                  )}
                </div>
              );
            })}
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
              {/* Only for accounts made before a password was required. It
                  cannot be chosen, because nothing can put an account back
                  into a state it cannot be signed in to except taking the
                  password away, and Disabled is how that is said. */}
              {member?.state === "invited" && <option value="invited">Invited</option>}
              <option value="disabled">Disabled</option>
            </select>
          </div>
        )}

        {member ? (
          <div className="field">
            <label className="lbl" htmlFor="md-password">
              New password
            </label>
            {member.state === "invited" && (
              <div className="notice warn" style={{ marginBottom: 8 }}>
                <b>This account cannot sign in yet.</b> It holds its roles but has no
                password. Set one here and tell them — there is no invite email.
              </div>
            )}
            <input
              id="md-password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
            <span className="hint">
              Leave blank to keep the current one. Setting it signs them out everywhere.
            </span>
          </div>
        ) : (
          /* Required. There is no invite email to follow up with, so an
             account made without a password is an account nobody can sign in
             to until somebody remembers to come back to it. */
          <div className="field">
            <label className="lbl" htmlFor="md-password">
              Password
            </label>
            <input
              id="md-password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
            <span className="hint">
              At least 8 characters. They can sign in with it straight away — tell them what
              it is, and they can change it from their own account screen.
            </span>
          </div>
        )}

        <div className="dialog-foot">
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => onSave(draft)}
            disabled={busy || (!member && draft.password.length < 8)}
          >
            {busy ? "Saving…" : member ? "Save changes" : "Add member"}
          </button>
        </div>
      </div>
    </div>
  );
}
