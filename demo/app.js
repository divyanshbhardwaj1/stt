/* Size Set Inspection — Clay prototype.
   Mock data and the few interactions worth having. No framework, no build.
   Everything here is presentation: nothing is fetched, nothing is saved. */

/* ------------------------------------------------------------------ rail */
/* The rail is scoped to one team. The nav, the work list and the role under
   your name all belong to the stage you are standing in — which is the point
   of the change: a final inspector opening this product should not be looking
   at somebody else's size-set queue. */

/* Nav icons. The design system substitutes Lucide for UI glyphs — stroke 1.5,
   rounded caps — so these are drawn to match. Inline rather than a CDN:
   collapsed, the icon IS the link, and a nav that needs a network fetch to be
   usable is not a nav. */
const ICON = {
  dashboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="8.5" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="12" width="7" height="8.5" rx="1.5"/></svg>',
  record:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/></svg>',
  library:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  members:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 6"/><path d="M17.2 14.2a5.5 5.5 0 0 1 3.3 5.3"/></svg>',
  log:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/></svg>',
  teams:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="7" height="6" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="6" rx="1.5"/><rect x="13.5" y="14" width="7" height="6" rx="1.5"/><rect x="3.5" y="16" width="7" height="4" rx="1.5"/></svg>',
};

function navlink(href, need, icon, label) {
  return `<a class="navlink" href="${href}"${need ? ` data-need="${need}"` : ""}
             title="${label}"><span class="ico">${ICON[icon]}</span><span class="lbl">${label}</span></a>`;
}

function rail() {
  const host = document.querySelector("aside.rail");
  if (!host) return;
  const here =
    document.body.dataset.rail || (location.pathname.split("/").pop() || "dashboard.html");
  const team = TEAMS[currentTeam()];
  const mine = myTeams();
  const items = team.items || [];
  const closed = document.documentElement.dataset.rail === "closed";

  host.innerHTML = `
    <div class="brand">
      <div class="brand-row">
        <span class="tile ${team.fill}" aria-hidden="true">${team.tag}</span>
        <div class="grow">
          <span class="mark">${team.name}</span>
          <p>${mine.length > 1 ? mine.length + " stages open to you" : "Triburg QA"}</p>
        </div>
        <button class="rail-toggle" data-rail-toggle
          aria-expanded="${!closed}"
          title="${closed ? "Show the rail" : "Hide the rail"}">${closed ? "»" : "«"}</button>
      </div>
      ${
        mine.length > 1
          ? `<label class="teamswap">
               <span>Stage</span>
               <select data-teamswap>
                 ${mine
                   .map(
                     (id) =>
                       `<option value="${id}"${id === currentTeam() ? " selected" : ""}>${TEAMS[id].name}</option>`,
                   )
                   .join("")}
               </select>
             </label>`
          : ""
      }
    </div>

    <div class="rail-nav">
      ${team.nav.map(([href, need, icon, label]) => navlink(href, need, icon, label)).join("")}
      ${navlink("teams.html", "", "teams", "Teams")}
      ${navlink("members.html", "manage.people", "members", "Members")}
    </div>

    <div class="listhead">${team.listhead || "Work"} <span>${items.length || ""}</span></div>
    <div class="list">
      ${
        items.length
          ? items
              .map(
                (job) => `
          <a class="item" href="${job.href}" aria-current="${job.href.split("#")[0] === here}"
             title="${job.file} — ${job.note}">
            <div class="n"><span class="dot ${job.status}"></span><em>${job.file}</em></div>
            <div class="s${job.flag ? " flag" : ""}">${job.note}</div>
          </a>`,
              )
              .join("")
          : '<p class="empty">Nothing open on this stage.</p>'
      }
    </div>
    <div class="rail-foot">${whoami()}</div>`;
}

/* The collapse toggle and the stage switcher. Switching stage navigates
   rather than re-rendering: every screen belongs to one team, so half of the
   product would be wrong for a moment otherwise. */
function railToggle() {
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-rail-toggle]")) return;
    const root = document.documentElement;
    const next = root.dataset.rail === "closed" ? "open" : "closed";
    root.dataset.rail = next;
    try {
      localStorage.setItem("rail", next);
    } catch (err) {
      /* the toggle still works for this page */
    }
    rail();
    gate();
  });

  document.addEventListener("change", (event) => {
    const picker = event.target.closest("[data-teamswap]");
    if (picker) setTeam(picker.value);
  });
}

/* ------------------------------------------------------- the spec sheet */
/* Real rows off style 7122's graded sheet — the same sheet the pipeline
   reads. Values are the printed specs; the deviations are invented. */
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
const BASE = "M";
const MEASURED = ["S", "M", "L", "XL"];

// pom, description, tol-, tol+, specs (one per size)
const ROWS = [
  ["note", "*", "DISCLAIMER (WW): Measure garments in circumference unless noted"],
  ["0.00B", "REF ONLY — FRONT LENGTH FROM HPS TO HEM ON BODY", "0", "0",
    ["", "", "21 5/8", "22 1/4", "", "", ""]],
  ["1.01A", "FRONT LENGTH FROM HPS TO CF", "-3/8", "3/8",
    ["19 5/8", "20 1/4", "20 7/8", "21 1/2", "22 1/8", "22 7/8", "23 5/8"]],
  ["2.02A", "SHOULDER SLOPE FROM HPS", "-1/4", "1/4",
    ["3/4", "3/4", "3/4", "3/4", "3/4", "3/4", "3/4"]],
  ["1.20A", "ACROSS SHOULDER SEAM TO SEAM — RELAXED", "-3/8", "3/8",
    ["11 1/2", "12", "12 1/2", "13", "13 3/4", "14 1/2", "15 1/4"]],
  ["1.22A", "ACROSS FRONT POSITION FROM HPS", "0", "0",
    ["5", "5", "5", "5", "5", "5", "5"]],
  ["1.23A", "ACROSS FRONT SEAM TO SEAM — RELAXED", "-3/8", "3/8",
    ["10", "10 1/2", "11", "11 1/2", "12 1/4", "13", "13 3/4"]],
  ["1.24A", "ACROSS BACK POSITION FROM HPS", "0", "0",
    ["5", "5", "5", "5", "5", "5", "5"]],
  ["1.25A", "ACROSS BACK SEAM TO SEAM — RELAXED", "-3/8", "3/8",
    ["10 1/2", "11", "11 1/2", "12", "12 3/4", "13 1/2", "14 1/4"]],
  ["1.28A", "CHEST 1\" BELOW ARMHOLE — RELAXED", "-3/4", "3/4",
    ["26", "28", "30", "32", "35", "38", "41"]],
  ["1.28A", "CHEST 1\" BELOW ARMHOLE — EXTENDED MINIMUM", "-1", "1",
    ["43 1/2", "47", "50 1/2", "54", "59 1/2", "65", "70 1/2"]],
  ["4.22A", "BOTTOM OPENING RELAXED — LAST SMOCKING ROW", "-3/4", "3/4",
    ["27", "29", "31", "33", "36", "39", "42"]],
  ["9.08A", "BOTTOM OPENING RUFFLE HEIGHT AT CF/SS/CB", "-1/8", "1/8",
    ["2 3/4", "2 3/4", "2 3/4", "2 3/4", "2 3/4", "2 3/4", "2 3/4"]],
  ["2.03A", "FRONT NECK DROP FROM HPS TO SEAM", "-1/4", "1/4",
    ["8", "8 1/8", "8 1/4", "8 3/8", "8 1/2", "8 5/8", "8 3/4"]],
  ["2.04A", "BACK NECK DROP FROM HPS TO SEAM", "-1/8", "1/8",
    ["1 1/4", "1 1/4", "1 1/4", "1 1/4", "1 1/4", "1 1/4", "1 1/4"]],
  ["2.05C", "NECK WIDTH SEAM TO SEAM", "-1/4", "1/4",
    ["7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4"]],
  ["3.01A", "SLEEVE LENGTH FROM C.B LONGEST POINT", "-3/8", "3/8",
    ["24 1/2", "25", "25 1/2", "26", "26 3/4", "27 1/2", "28 1/4"]],
  ["3.06B", "ARMHOLE STRAIGHT", "-1/4", "1/4",
    ["7 5/8", "8", "8 3/8", "8 3/4", "9 3/8", "10", "10 5/8"]],
  ["3.13A", "MUSCLE 1\" FROM UNDERARM", "-1/4", "1/4",
    ["13 1/4", "14", "14 3/4", "15 1/2", "16 3/4", "18", "19 1/4"]],
  ["3.19B", "SLEEVE OPENING — RELAXED", "-1/4", "1/4",
    ["7 1/2", "8", "8 1/2", "9", "9 1/2", "10", "10 1/2"]],
];

/* Readings, keyed "<row index>:<size>". Only the measured sizes carry one;
   everything else renders as spec-only, which is what an undictated size
   looks like in the real grid. */
const READINGS = {
  "2:S": { dev: "0", state: "pass", conf: 1, spoken: "okay" },
  "2:M": { dev: "-1/8", state: "pass", conf: 1, spoken: "minus one by eight" },
  "2:L": { dev: "0", state: "pass", conf: 0.93, spoken: "okay" },
  "2:XL": { dev: "0", state: "pass", conf: 1, spoken: "okay" },
  "3:S": { dev: "0", state: "pass", conf: 1 },
  "3:M": { dev: "0", state: "pass", conf: 1 },
  "3:L": { dev: "0", state: "pass", conf: 1 },
  "3:XL": { dev: "0", state: "pass", conf: 1 },
  "4:S": { dev: "-1/8", state: "pass", conf: 1 },
  "4:M": { dev: "-1/8", state: "pass", conf: 0.82, spoken: "minus one by eight" },
  "4:L": { dev: "0", state: "pass", conf: 1 },
  "4:XL": { dev: "-1/4", state: "pass", conf: 1 },
  "5:S": { dev: "", state: "unconfirmed" },
  "5:M": { dev: "", state: "unconfirmed" },
  "5:L": { dev: "0", state: "pass", conf: 1 },
  "5:XL": { dev: "0", state: "pass", conf: 1 },
  "6:S": { dev: "0", state: "pass", conf: 1 },
  "6:M": { dev: "-1/8", state: "pass", conf: 0.74, spoken: "eleven five by eight minus one by eight", disputed: true },
  "6:L": { dev: "0", state: "pass", conf: 1 },
  "6:XL": { dev: "0", state: "pass", conf: 1 },
  "7:S": { dev: "0", state: "pass", conf: 1 },
  "7:M": { dev: "", state: "unconfirmed" },
  "7:L": { dev: "0", state: "pass", conf: 1 },
  "7:XL": { dev: "0", state: "pass", conf: 1 },
  "8:S": { dev: "0", state: "pass", conf: 1 },
  "8:M": { dev: "0", state: "pass", conf: 1 },
  "8:L": { dev: "0", state: "pass", conf: 0.88 },
  "8:XL": { dev: "0", state: "pass", conf: 1 },
  "9:S": { dev: "-1/2", state: "pass", conf: 1 },
  "9:M": { dev: "-1 1/4", state: "fail", conf: 1, spoken: "minus one and a quarter" },
  "9:L": { dev: "-1/2", state: "pass", conf: 1 },
  "9:XL": { dev: "0", state: "pass", conf: 1 },
  "10:S": { dev: "0", state: "pass", conf: 1 },
  "10:M": { dev: "0", state: "pass", conf: 1 },
  "10:L": { dev: "0", state: "pass", conf: 1 },
  "10:XL": { dev: "0", state: "pass", conf: 1 },
  "11:S": { dev: "0", state: "pass", conf: 1 },
  "11:M": { dev: "-1/2", state: "pass", conf: 1 },
  "11:L": { dev: "0", state: "pass", conf: 1 },
  "11:XL": { dev: "0", state: "pass", conf: 1 },
  "12:S": { dev: "0", state: "pass", conf: 1 },
  "12:M": { dev: "0", state: "pass", conf: 1 },
  "12:L": { dev: "0", state: "pass", conf: 1 },
  "12:XL": { dev: "0", state: "pass", conf: 1 },
  "13:S": { dev: "0", state: "pass", conf: 1 },
  "13:M": { dev: "1/8", state: "pass", conf: 1 },
  "13:L": { dev: "0", state: "pass", conf: 1 },
  "13:XL": { dev: "0", state: "pass", conf: 0.91 },
  "14:S": { dev: "0", state: "pass", conf: 1 },
  "14:M": { dev: "0", state: "pass", conf: 1 },
  "14:L": { dev: "0", state: "pass", conf: 1 },
  "14:XL": { dev: "0", state: "pass", conf: 1 },
  "15:S": { dev: "0", state: "pass", conf: 1 },
  "15:M": { dev: "0", state: "pass", conf: 1 },
  "15:L": { dev: "0", state: "pass", conf: 1 },
  "15:XL": { dev: "0", state: "pass", conf: 1 },
  "16:S": { dev: "-1/4", state: "pass", conf: 1 },
  "16:M": { dev: "-3/8", state: "pass", conf: 1 },
  "16:L": { dev: "-1/2", state: "fail", conf: 1, spoken: "minus half" },
  "16:XL": { dev: "-1/4", state: "pass", conf: 1 },
  "17:S": { dev: "0", state: "pass", conf: 1 },
  "17:M": { dev: "0", state: "pass", conf: 1 },
  "17:L": { dev: "0", state: "pass", conf: 1 },
  "17:XL": { dev: "0", state: "pass", conf: 1 },
  "18:S": { dev: "0", state: "pass", conf: 1 },
  "18:M": { dev: "1/4", state: "pass", conf: 1 },
  "18:L": { dev: "0", state: "pass", conf: 1 },
  "18:XL": { dev: "0", state: "pass", conf: 1 },
  "19:S": { dev: "0", state: "pass", conf: 1 },
  "19:M": { dev: "0", state: "pass", conf: 1, edited: true },
  "19:L": { dev: "0", state: "pass", conf: 1 },
  "19:XL": { dev: "0", state: "pass", conf: 1 },
};

const MARK = { pass: "✓", fail: "×", unconfirmed: "??", empty: "" };

/* How sure the transcription was, banded rather than shown raw.
   Two thresholds, matching the pipeline: anything under 100% is worth a
   second listen, and anything under the review threshold is worth one before
   the report goes anywhere. A reading with no confidence at all — nothing was
   heard — is not low confidence, it is unanswered, and has its own state. */
const REVIEW_THRESHOLD = 0.85;

/* A zero deviation is not a number the inspector said, it is a pass — "okay"
   is the word on the tape. Printing 0 in the column of deviations made every
   passing row look like a measurement that happened to come out level. */
function deviation(read) {
  if (!read.dev) return '<span class="dev"></span>';
  if (read.dev === "0") return '<span class="dev okay">OK</span>';
  return `<span class="dev">${read.dev}</span>`;
}

function band(conf) {
  if (conf === null || conf === undefined) return "";
  if (conf < REVIEW_THRESHOLD) return "conf-low";
  if (conf < 1) return "conf-mid";
  return "conf-full";
}

/* ----------------------------------------------------------- inch maths */
/* Binary fractions only — the sheets never use anything else. Kept exact so
   the editor's "measurement" line adds up the way the real one does. */
function parseInches(text) {
  if (!text) return null;
  const clean = String(text).trim();
  const sign = clean.startsWith("-") ? -1 : 1;
  const parts = clean.replace("-", "").split(/\s+/);
  let total = 0;
  for (const part of parts) {
    if (part.includes("/")) {
      const [n, d] = part.split("/").map(Number);
      if (d) total += n / d;
    } else if (part !== "") {
      total += Number(part);
    }
  }
  return Number.isNaN(total) ? null : sign * total;
}

function formatInches(value) {
  if (value === null || value === undefined) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs + 1e-9);
  const frac = abs - whole;
  const sixteenths = Math.round(frac * 16);
  if (sixteenths === 0) return sign + String(whole);
  let n = sixteenths;
  let d = 16;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return sign + (whole ? whole + " " : "") + n + "/" + d;
}

/* ------------------------------------------------------------ the grid */
function grid() {
  const host = document.querySelector("#grid");
  if (!host) return;

  const head = `
    <thead><tr>
      <th>POM</th><th>Description</th>
      <th class="num">Tol−</th><th class="num">Tol+</th>
      ${SIZES.map((s) => {
        const cls = "num size" + (s === BASE ? " base" : "") +
          (MEASURED.includes(s) ? "" : " unmeasured");
        return `<th class="${cls}">${s}${MEASURED.includes(s) ? "" : " *"}</th>`;
      }).join("")}
    </tr></thead>`;

  const body = ROWS.map((row, index) => {
    if (row[0] === "note") {
      return `<tr class="sheet-note"><td>${row[1]}</td>
        <td colspan="${3 + SIZES.length}">${row[2]}</td></tr>`;
    }
    const [pom, desc, tolMinus, tolPlus, specs] = row;
    const cells = SIZES.map((size, column) => {
      const spec = specs[column];
      const read = READINGS[index + ":" + size];
      const state = read ? read.state : "empty";
      const conf = read && typeof read.conf === "number" ? read.conf : null;
      const cls = [
        "cell", state,
        band(conf),
        read && read.edited ? "settled" : "",
      ].filter(Boolean).join(" ");

      const inner = !read
        ? `<span class="spec-only">${spec || "—"}</span>`
        : `<span class="read">${spec || "—"}${
            conf === null ? "" : `<em class="conf">${Math.round(conf * 100)}%</em>`
          }</span>${deviation(read)}`;

      return `<td class="${cls}">
        <button type="button" data-cell="${index}:${size}"
          aria-label="${pom} ${size}: ${state}">
          ${inner}
          <span class="mark" aria-hidden="true">${
            read && read.disputed ? '<span class="disputed-mark">≠</span>' : MARK[state]
          }</span>
        </button></td>`;
    }).join("");

    return `<tr>
      <td class="pom">${pom}</td>
      <td class="desc">${desc}</td>
      <td class="tol">${tolMinus}</td>
      <td class="tol">${tolPlus}</td>
      ${cells}
    </tr>`;
  }).join("");

  host.innerHTML = head + "<tbody>" + body + "</tbody>";
  host.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cell]");
    if (button && can("audit.edit")) openCell(button.dataset.cell);
  });
  if (!can("audit.edit")) {
    host.classList.add("readonly");
    const banner = document.querySelector("[data-readonly]");
    if (banner) {
      banner.hidden = false;
      banner.querySelector("[data-readonly-why]").textContent = REASONS["audit.edit"];
    }
  }
}

/* --------------------------------------------------------- cell editor */
let openAt = null;

function openCell(at) {
  const [index, size] = at.split(":");
  const row = ROWS[Number(index)];
  const read = READINGS[at];
  const spec = row[4][SIZES.indexOf(size)];
  openAt = at;

  const dialog = document.querySelector("#cell-dialog");
  dialog.querySelector("[data-title]").textContent = row[0] + " · " + size;
  dialog.querySelector("[data-desc]").textContent = row[1];
  dialog.querySelector("[data-spec]").innerHTML =
    `<b>${spec || "—"}</b> <span class="dim">off the style sheet · tolerance ${row[2]} / ${row[3]}</span>`;

  const heard = dialog.querySelector("[data-heard]");
  heard.innerHTML = read
    ? (read.spoken || "—") +
      (typeof read.conf === "number"
        ? ` <span class="dim">· confidence ${Math.round(read.conf * 100)}%</span>`
        : "")
    : '<span class="dim">the recording never covered this point of measure</span>';

  const disputed = dialog.querySelector("[data-disputed]");
  disputed.hidden = !(read && read.disputed);

  dialog.querySelector("[data-fresh]").hidden = Boolean(read);
  dialog.querySelector("#verdict").value = read ? (read.dev && read.dev !== "0" ? "deviation" : "okay") : "";
  dialog.querySelector("#deviation").value = read ? read.dev : "";
  dialog.querySelector("[data-approx]").hidden = !(read && read.conf && read.conf < 0.85);
  result();
  document.querySelector("#scrim").hidden = false;
}

/* measurement = spec + deviation. The spec sheet is the only source for the
   measurement — the spoken absolute never builds it — so this is a computed
   line, not a field. */
function result() {
  if (!openAt) return;
  const [index, size] = openAt.split(":");
  const spec = parseInches(ROWS[Number(index)][4][SIZES.indexOf(size)]);
  const dev = parseInches(document.querySelector("#deviation").value) || 0;
  const box = document.querySelector("[data-result]");
  if (spec === null) {
    box.innerHTML = "—<small>this size has no spec on the sheet</small>";
    return;
  }
  box.innerHTML =
    formatInches(spec + dev) +
    `<small>spec ${formatInches(spec)} ${dev < 0 ? "−" : "+"} ${formatInches(Math.abs(dev))}</small>`;
}

function closeCell() {
  document.querySelector("#scrim").hidden = true;
  openAt = null;
}

/* ------------------------------------------------------------- waveform */
function waveform() {
  const host = document.querySelector(".wave");
  if (!host) return;
  const bars = 72;
  host.innerHTML = Array.from({ length: bars }, (_, i) => {
    // A plausible speech envelope: a slow swell with syllable-rate detail.
    const swell = Math.sin(i / 9) * 0.5 + 0.5;
    const detail = Math.abs(Math.sin(i * 1.7)) * 0.55 + 0.2;
    const h = Math.max(4, Math.round(swell * detail * 58));
    return `<i style="height:${h}px"></i>`;
  }).join("");
}

/* ---------------------------------------------------------- interactions */
function wire() {
  // Tab groups: purely presentational here — they swap panels by id.
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-panel]");
      if (!button) return;
      group.querySelectorAll("button").forEach((b) =>
        b.setAttribute("aria-selected", String(b === button)),
      );
      const scope = document.querySelector(group.dataset.tabs);
      scope.querySelectorAll("[data-panel-id]").forEach((panel) => {
        panel.hidden = panel.dataset.panelId !== button.dataset.panel;
      });
    });
  });

  // The cell editor.
  const scrim = document.querySelector("#scrim");
  if (scrim) {
    scrim.addEventListener("click", (event) => {
      if (event.target === scrim || event.target.closest("[data-close]")) closeCell();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !scrim.hidden) closeCell();
    });
    const deviation = document.querySelector("#deviation");
    if (deviation) deviation.addEventListener("input", result);
    const stage = document.querySelector("[data-stage]");
    if (stage) {
      stage.addEventListener("click", () => {
        if (openAt) {
          const cell = document.querySelector(`button[data-cell="${openAt}"]`);
          if (cell) cell.closest("td").classList.add("staged");
          bump();
        }
        closeCell();
      });
    }
  }

  // The play/stop button in the editor. No audio file ships with the demo,
  // so this only shows the state change the real one makes.
  const play = document.querySelector("[data-play]");
  if (play) {
    play.addEventListener("click", () => {
      const on = play.dataset.playing === "true";
      play.dataset.playing = String(!on);
      play.textContent = on ? "▶ Play this reading" : "■ Stop";
    });
  }
}

/* The unsaved-corrections bar. Nothing is written — this is the counter the
   real screen keeps so nobody saves a vendor document by accident. */
let staged = 0;
function bump() {
  staged += 1;
  const bar = document.querySelector("[data-staged]");
  if (!bar) return;
  bar.hidden = false;
  bar.querySelector("b").textContent = staged + (staged === 1 ? " correction" : " corrections");
}

rail();
railToggle();
grid();
waveform();
wire();
wireAuth();
/* Last: every control is on the page by now, including the ones rail() and
   grid() just wrote. */
gate();
