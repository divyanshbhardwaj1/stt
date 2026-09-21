/* Who is signed in, and what they are allowed to do.

   Prototype only — there is no server, no password check and no token. The
   session is a localStorage object and every check below runs in the browser,
   which is exactly where real access control must NOT live. In the real app
   these same names would be enforced on the API and this file would only be
   deciding what to draw.

   The permission split is the point, and it is drawn from what the documents
   actually are: a graded sheet is a vendor-facing record stamped "Subject to
   Legal Action if Disclosed Without Authorization". So:

     · the person who RECORDS an inspection is on the floor with a headset;
     · the person who CORRECTS a misheard reading is a QA reviewer;
     · the person who RELEASES it to the vendor is neither of them.

   That last separation is deliberate. Whoever signs a document off should not
   also be able to quietly change what it says first. */

const CAPABILITIES = [
  ["record", "Record and upload inspections"],
  ["audit.view", "Open the graded sheet"],
  ["audit.edit", "Correct readings and save"],
  ["download.working", "Download working files (CSV, JSON)"],
  ["download.vendor", "Download vendor documents (PDF)"],
  ["release", "Release a report to the vendor"],
  ["manage.styles", "Manage the style set library"],
  ["manage.people", "Manage people and roles"],
];

const ROLES = {
  inspector: {
    label: "Inspector",
    blurb: "Records on the floor. Sees the result, changes nothing.",
    can: ["record", "audit.view"],
  },
  reviewer: {
    label: "QA reviewer",
    blurb: "Listens back and settles what the recording got wrong.",
    can: ["record", "audit.view", "audit.edit", "download.working"],
  },
  approver: {
    label: "Approver",
    blurb: "Signs the report off. Deliberately cannot edit it first.",
    can: ["audit.view", "download.working", "download.vendor", "release"],
  },
  admin: {
    label: "Administrator",
    blurb: "Everything, plus the style set library and the people list.",
    can: CAPABILITIES.map(([id]) => id),
  },
};

/* Why an action is unavailable. Said in terms of the job, not the token —
   "your role cannot do X" tells somebody nothing about who to go to. */
const REASONS = {
  "record": "Only inspectors and reviewers record inspections.",
  "audit.view": "You do not have access to graded sheets.",
  "audit.edit": "Corrections are made by QA reviewers. Approvers sign off on the sheet as it stands — that separation is deliberate.",
  "download.working": "Working files are for the QA team.",
  "download.vendor": "Vendor documents are released by an approver.",
  "release": "Only an approver can release a report to the vendor.",
  "manage.styles": "The style set library is managed by an administrator.",
  "manage.people": "People and roles are managed by an administrator.",
};

/* ------------------------------------------------------------- members */
/* The roster is the login table and the admin screen's data at once — sign in
   with a member's id and you get that member's role. Held in localStorage so
   an administrator's edits survive a page navigation; seeded from this list
   the first time the prototype is opened. */
const DEFAULT_MEMBERS = [
  { id: "r.menon", name: "R. Menon", role: "inspector", seen: "2 minutes ago", state: "active" },
  { id: "a.bhatt", name: "A. Bhattacharya", role: "reviewer", seen: "18 minutes ago", state: "active" },
  { id: "s.iqbal", name: "S. Iqbal", role: "reviewer", seen: "Yesterday", state: "active" },
  { id: "p.grewal", name: "P. Grewal", role: "approver", seen: "3 hours ago", state: "active" },
  { id: "d.bhardwaj", name: "D. Bhardwaj", role: "admin", seen: "Now", state: "active" },
  { id: "k.tanaka", name: "K. Tanaka", role: "approver", seen: "6 days ago", state: "invited" },
];

const ROSTER_KEY = "members";

function roster() {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) return list;
    }
  } catch (err) {
    /* fall through to the seed */
  }
  return DEFAULT_MEMBERS.slice();
}

function saveRoster(list) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(list));
  } catch (err) {
    /* the edit still shows for this page */
  }
}

function resetRoster() {
  try {
    localStorage.removeItem(ROSTER_KEY);
  } catch (err) {
    /* nothing to clear */
  }
}

function member(id) {
  return roster().find((m) => m.id === id) || null;
}

/* Add, update, remove. Each returns an error string, or null on success.
   The rules are the ones that would matter on a real roster: ids are the
   login name so they must be unique, and the last administrator cannot be
   removed or demoted — that is how a tenant locks itself out for good. */
function addMember(draft) {
  const id = String(draft.id || "").trim().toLowerCase();
  if (!id) return "A member needs an id — it is what they sign in with.";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return "Ids are lower case letters, digits, dot, dash and underscore.";
  if (member(id)) return `“${id}” is already taken.`;
  if (!String(draft.name || "").trim()) return "A member needs a name — it is what the audit trail records.";
  if (!ROLES[draft.role]) return "Pick a role.";
  const list = roster();
  list.push({
    id,
    name: draft.name.trim(),
    role: draft.role,
    seen: "Never",
    state: "invited",
  });
  saveRoster(list);
  return null;
}

function updateMember(id, patch) {
  const list = roster();
  const found = list.find((m) => m.id === id);
  if (!found) return "That member is no longer on the roster.";
  if (patch.role && patch.role !== found.role && lastAdmin(id)) {
    return "This is the last administrator. Promote somebody else first, or nobody can manage the roster.";
  }
  if (patch.name !== undefined && !String(patch.name).trim()) return "A member needs a name.";
  Object.assign(found, patch);
  saveRoster(list);
  return null;
}

function removeMember(id) {
  if (lastAdmin(id)) {
    return "This is the last administrator. Promote somebody else first, or nobody can manage the roster.";
  }
  if (id === session().id) return "You cannot remove the account you are signed in with.";
  saveRoster(roster().filter((m) => m.id !== id));
  return null;
}

function lastAdmin(id) {
  const admins = roster().filter((m) => m.role === "admin");
  return admins.length === 1 && admins[0].id === id;
}

/* --------------------------------------------------------------- session */
const SESSION_KEY = "session";

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    /* privacy mode, or someone hand-edited it — fall through to the default */
  }
  return null;
}

function writeSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    /* the page still works for this visit */
  }
}

/* A prototype that dead-ends on a login wall is a prototype nobody opens.
   Every page seeds a reviewer session if there is none, and sign-out sends
   you to the real screen. */
function session() {
  return readSession() || { id: "a.bhatt", name: "A. Bhattacharya", role: "reviewer" };
}

/* Sign in. No password check — there is nothing to check it against — but the
   id is looked up for real, so a typo fails the way it would in the product
   and an invited account cannot be used until it is activated. */
function signIn(id, password) {
  const who = member(String(id || "").trim().toLowerCase());
  if (!password) return "Enter your password.";
  if (!who) return "No account with that id.";
  if (who.state === "invited") return `“${who.id}” has been invited but has not set a password yet.`;
  writeSession({ id: who.id, name: who.name, role: who.role });
  return null;
}

function can(capability) {
  const role = ROLES[session().role];
  return Boolean(role && role.can.includes(capability));
}

function signOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* nothing to clear */
  }
  location.href = "signin.html";
}

/* Only the sign-in screen calls this now — it is how an id becomes a session
   in the prototype. Nothing in the product chrome switches roles. */
function setRole(role, next) {
  const list = roster();
  const person = list.find((p) => p.role === role && p.state === "active") || list[0];
  writeSession({ id: person.id, name: person.name, role });
  if (next) location.href = next;
  else location.reload();
}

/* ------------------------------------------------------------- gating */
/* Mark an element with data-need="<capability>". By default it stays on the
   page and goes dead, with the reason on hover: hiding a control teaches
   nobody why it is not there, and support tickets are made of that. Add
   data-gate="hide" for the handful that should genuinely vanish. */
function gate(scope = document) {
  scope.querySelectorAll("[data-need]").forEach((el) => {
    if (can(el.dataset.need)) return;
    if (el.dataset.gate === "hide") {
      el.hidden = true;
      return;
    }
    const reason = REASONS[el.dataset.need] || "You do not have access to this.";
    el.classList.add("locked");
    el.setAttribute("title", reason);
    el.setAttribute("aria-disabled", "true");
    if ("disabled" in el) el.disabled = true;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
  });

  // Whole panels that swap for a denial notice.
  scope.querySelectorAll("[data-need-panel]").forEach((el) => {
    const need = el.dataset.needPanel;
    if (can(need)) return;
    el.innerHTML = denial(need);
  });
}

function denial(need) {
  const role = ROLES[session().role];
  return `
    <div class="blank">
      <div>
        <div class="art" aria-hidden="true"><i></i><i></i><i></i></div>
        <h2>Not available to ${role.label.toLowerCase()}s</h2>
        <p>${REASONS[need] || "You do not have access to this."}</p>
        <div class="files" style="justify-content: center">
          <a class="lead" href="index.html">Back to the inspection</a>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------- who is signed in */
/* Rendered into the rail foot by rail(). Your role is shown, never chosen —
   it comes from your account. To see the product as another role, sign out
   and sign in as somebody who holds it. */
function whoami() {
  const me = session();
  return `
    <div class="me">
      <span class="avatar" aria-hidden="true">${me.name.slice(0, 1)}</span>
      <div class="grow">
        <b>${me.name}</b>
        <span>${ROLES[me.role].label}</span>
      </div>
      <button class="rail-toggle" data-signout title="Sign out" aria-label="Sign out">⏻</button>
    </div>`;
}

function wireAuth() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-signout]")) signOut();
  });
}
