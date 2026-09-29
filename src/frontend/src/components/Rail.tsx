import { href, type Route } from "../router";
import { useSession } from "../session";
import { stageOf } from "../stages";
/**
 * Imported rather than referenced from `public/`, and that is the difference
 * between it working and it 404ing in the deployed app: `api/app.py` mounts
 * `dist/assets` and nothing else, so a file sitting at the root of `dist`
 * has no route. Importing it makes Vite emit it into `assets/` with a content
 * hash, which the existing mount already serves — and the hash means a
 * replaced logo is never served from a stale cache.
 */
import wordmark from "../assets/triburg-logo-m.png";
import { Glyph, Ico } from "../ui/icons";

/**
 * The navigation rail, as `rail()` builds it in `demo/app.js`.
 *
 * Same markup, same class names, same order: the brand row with the stage
 * tile, the stage switcher when more than one is open to you, that stage's own
 * nav, then a hairline and the foot — Members, your account, and the way out.
 * Members and your own account are not part of the stage above them, which is
 * why they sit below the line.
 *
 * The rail is scoped to one stage: the nav and the role under your name belong
 * to the stage you are standing in.
 */

interface Props {
  route: Route;
  stage: string;
  /** How many alerts are open for this account. 0 draws nothing. */
  alerts: number;
  closed: boolean;
  onToggle: () => void;
}

function NavLink({
  to,
  icon,
  label,
  current,
  count = 0,
}: {
  to: string;
  icon: string;
  label: string;
  current: boolean;
  count?: number;
}) {
  return (
    <a className="navlink" href={to} title={label} aria-current={current ? "page" : undefined}>
      <Ico name={icon} />
      <span className="lbl">{label}</span>
      {/* The count is the whole point of a rail entry for alerts: it is what
          somebody sees without opening it. Drawn only when there is one, so a
          clear floor has nothing blinking at it. */}
      {count > 0 && (
        <span className="tally" aria-label={`${count} open`}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}

export function Rail({ route, stage, alerts, closed, onToggle }: Props) {
  const { me, can, signOut } = useSession();
  const here = stageOf(stage);
  const roleHere = me?.admin ? "Administrator" : roleLabel(me?.roles?.[stage]);

  return (
    <aside className="rail">
      {/* The product, not the stage. The rail used to be headed by whichever
          stage you were standing in, with a select under it - so the one
          constant thing on screen was the one thing that kept changing, and
          the name of the product appeared nowhere. Switching stage is what
          the Stages screen is for; it is a thing you do occasionally, not a
          control that earns a permanent place above everything else. */}
      <div className="brand">
        <div className="brand-row">
          {/* The company's own wordmark, and "QA" after it for the product —
              the asset already reads "Triburg", so setting it beside the words
              "Triburg QA" would have said the name twice.

              It lives inside `.grow`, which the collapsed rail already hides:
              a 3.6:1 wordmark has nowhere to go in 56px, and shrinking it to
              fit would leave 12px of letterform. Collapsed, the brand row is
              the toggle alone, which is the affordance that matters there. */}
          <div className="grow brand-lockup">
            <img className="wordmark" src={wordmark} alt="Triburg" />
            <span className="mark">QA</span>
          </div>
          <button
            className="rail-toggle"
            onClick={onToggle}
            aria-expanded={!closed}
            title={closed ? "Show the rail" : "Hide the rail"}
          >
            {closed ? "\u00bb" : "\u00ab"}
          </button>
        </div>
      </div>

      <div className="rail-nav">
        {here.nav
          // The prototype dims a row it cannot use and shows the reason. Here
          // the server has already said what you hold, so a row you could
          // never use is not drawn at all — an empty screen teaches nothing.
          .filter((entry) => !entry.need || can(entry.need))
          .map((entry) => (
            <NavLink
              key={entry.screen}
              to={href(entry.screen)}
              icon={entry.icon}
              label={entry.label}
              current={route.screen === entry.screen}
            />
          ))}
        <NavLink
          to={href("stages")}
          icon="teams"
          label="Stages"
          current={route.screen === "stages"}
        />
      </div>

      <div className="rail-foot">
        <div className="rail-nav">
          {/* Alerts and Members sit below the hairline with the account,
              because neither belongs to the stage above it. An alert is
              raised against a stage and the screen splits by one, but the
              list itself is the floor's — switching stage to see what is
              stuck somewhere else would be a rail that hides its own
              contents. */}
          {can("manage.people") && (
            <NavLink
              to={href("alerts")}
              icon="flag"
              label="Alerts"
              current={route.screen === "alerts"}
              count={alerts}
            />
          )}
          {can("manage.people") && (
            <NavLink
              to={href("users")}
              icon="members"
              label="Members"
              current={route.screen === "users"}
            />
          )}
        </div>

        <a className="me" href={href("account")} title="Account information">
          <span className="avatar" aria-hidden="true">
            {me?.name.slice(0, 1)}
          </span>
          <div className="grow">
            <b>{me?.name}</b>
            <span>{roleHere ? `${roleHere} · ${here.name}` : "No role on this stage"}</span>
          </div>
          <span className="ico gear" aria-hidden="true">
            <Glyph name="settings" />
          </span>
        </a>

        <button className="navlink signout" onClick={() => void signOut()}>
          <Ico name="logout" />
          <span className="lbl">Log out</span>
        </button>
      </div>
    </aside>
  );
}

/** The labels `ROLES` uses in demo/auth.js, and `auth.ROLE_LABELS` on the server. */
function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return (
    { inspector: "Inspector", reviewer: "QA reviewer", approver: "Approver", admin: "Administrator" }[
      role
    ] ?? role
  );
}
