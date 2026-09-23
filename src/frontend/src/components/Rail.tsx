import { href, type Route } from "../router";
import { useSession } from "../session";
import { stageOf } from "../stages";
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
  onStage: (stage: string) => void;
  closed: boolean;
  onToggle: () => void;
}

function NavLink({
  to,
  icon,
  label,
  current,
}: {
  to: string;
  icon: string;
  label: string;
  current: boolean;
}) {
  return (
    <a className="navlink" href={to} title={label} aria-current={current ? "page" : undefined}>
      <Ico name={icon} />
      <span className="lbl">{label}</span>
    </a>
  );
}

export function Rail({ route, stage, onStage, closed, onToggle }: Props) {
  const { me, can, signOut } = useSession();
  const here = stageOf(stage);
  const mine = me?.stages ?? [];
  const roleHere = me?.admin ? "Administrator" : roleLabel(me?.roles?.[stage]);

  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand-row">
          <span className={`tile ${here.fill}`} aria-hidden="true">
            {here.tag}
          </span>
          <div className="grow">
            <span className="mark">{here.name}</span>
            <p>{mine.length > 1 ? `${mine.length} stages open to you` : "Triburg QA"}</p>
          </div>
          <button
            className="rail-toggle"
            onClick={onToggle}
            aria-expanded={!closed}
            title={closed ? "Show the rail" : "Hide the rail"}
          >
            {closed ? "»" : "«"}
          </button>
        </div>

        {mine.length > 1 && (
          <label className="teamswap">
            <span>Stage</span>
            <select value={stage} onChange={(event) => onStage(event.target.value)}>
              {mine.map((id) => (
                <option key={id} value={id}>
                  {stageOf(id).name}
                </option>
              ))}
            </select>
          </label>
        )}
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
