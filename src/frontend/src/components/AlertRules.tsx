import { useCallback, useEffect, useState } from "react";
import { fetchAlertRules, raiseTestAlert, setAlertRule, type AlertRules } from "../api";
import { STAGES } from "../stages";

/**
 * Alert settings — what is watched, and how this floor has set it.
 *
 * Four things an administrator can change per rule, and no more. What is
 * deliberately absent matters as much as what is here:
 *
 * Inventing a rule. Each one has to understand what a tolerance band is and
 * what an unanswered point of measure means, so the catalogue is in the code.
 * A page that could define one is a query builder, and a query builder is a
 * product of its own.
 *
 * Whether something is urgent. `act` or `notice` is part of what a rule
 * *means*. Make it a setting and within a month the two words stop telling
 * anybody anything.
 *
 * Who it goes to. Every alert goes to the administrators, whose addresses the
 * roster already holds. One answer that is always true beats a picker that has
 * to be kept in step with who does what this month.
 *
 * Set per stage, because the stages are not the same job. A reading with no
 * verdict on size set is a garment still on the table; the same gap on a final
 * inspection is a lot already packed, and one threshold for both is wrong for
 * one of them.
 */

interface Props {
  /** The stage in the rail, which is the one the page opens on. */
  stage: string;
  onClose: () => void;
}

export function AlertRules({ stage, onClose }: Props) {
  const [tab, setTab] = useState(stage);
  const [rules, setRules] = useState<AlertRules | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    fetchAlertRules(tab)
      .then(setRules)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Could not read the settings."),
      );
  }, [tab]);

  useEffect(load, [load]);

  const save = useCallback(
    async (key: string, patch: { enabled?: boolean; amount?: number; ways?: string[] }) => {
      setBusy(key);
      setError("");
      setNote("");
      try {
        await setAlertRule(key, tab, patch);
        load();
      } catch (failure: unknown) {
        // The server's wording, not ours: it phrases its refusals for the
        // person reading them, and it knows the limits.
        setError(failure instanceof Error ? failure.message : "That was not saved.");
        load();
      } finally {
        setBusy("");
      }
    },
    [load, tab],
  );

  const test = useCallback(async () => {
    setBusy("test");
    setError("");
    try {
      await raiseTestAlert();
      setNote("A test alert is now open. Go back to the list and dismiss it.");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "The test was not raised.");
    } finally {
      setBusy("");
    }
  }, []);

  return (
    <>
      <header>
        <div className="page-title">
          <h1>Alert settings</h1>
          <span className="spacer" />
          <button className="btn secondary sm" disabled={busy === "test"} onClick={() => void test()}>
            {busy === "test" ? "Raising…" : "Send me a test"}
          </button>
          <button className="btn sm" onClick={onClose}>
            Back to alerts
          </button>
        </div>
        <p className="page-meta">
          Set per stage. Everything is already on, with a threshold that suits a normal floor
          — change only what does not.
        </p>
      </header>

      <div className="tabs stagetabs" style={{ marginTop: 18 }}>
        {STAGES.map((one) => (
          <button
            type="button"
            key={one.id}
            aria-selected={tab === one.id}
            onClick={() => {
              setRules(null);
              setTab(one.id);
            }}
          >
            <i className={`tile ${one.fill}`}>{one.tag}</i>
            <span>{one.name}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="notice bad" role="alert" style={{ marginTop: 20 }}>
          {error}
        </div>
      )}
      {note && (
        <div className="notice good" role="status" style={{ marginTop: 20 }}>
          {note}
        </div>
      )}

      {rules === null ? (
        <p className="lede dim" style={{ marginTop: 20 }}>
          Reading the settings…
        </p>
      ) : (
        <div className="tablewrap" style={{ marginTop: 16 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Rule</th>
                <th>When</th>
                <th>How it goes out</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.rules.map((rule) => {
                const moved = rule.amount !== rule.default_amount;
                const rerouted =
                  [...rule.ways].sort().join() !== [...rule.default_ways].sort().join();
                return (
                  <tr key={rule.key} className={rule.enabled ? undefined : "dim"}>
                    <td>
                      <b>{rule.label}</b>
                      <div className="why">{rule.blurb}</div>
                    </td>
                    <td className="pom" style={{ whiteSpace: "nowrap" }}>
                      {rule.amount === null ? (
                        // Nothing to wait for: a job that failed has failed.
                        <span className="dim">immediately</span>
                      ) : (
                        <>
                          after{" "}
                          <input
                            type="number"
                            min={1}
                            step={1}
                            aria-label={`${rule.label} threshold in ${rule.unit}`}
                            defaultValue={rule.amount}
                            disabled={busy === rule.key || !rule.enabled}
                            style={{ width: 62, height: 30, display: "inline-block" }}
                            onBlur={(event) => {
                              const next = Number(event.target.value);
                              if (next && next !== rule.amount) void save(rule.key, { amount: next });
                            }}
                          />{" "}
                          {rule.unit}
                          {moved && (
                            <div className="why">was {rule.default_amount}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="ways">
                        {rules.channels.map((channel) => {
                          const on = rule.ways.includes(channel.id);
                          const impossible = channel.id === "email" && !rules.email_ready;
                          return (
                            <label className="check" key={channel.id}>
                              <input
                                type="checkbox"
                                checked={on && !impossible}
                                disabled={busy === rule.key || !rule.enabled || impossible}
                                onChange={(event) =>
                                  void save(rule.key, {
                                    ways: event.target.checked
                                      ? [...rule.ways, channel.id]
                                      : rule.ways.filter((way) => way !== channel.id),
                                  })
                                }
                              />
                              <span>{channel.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {rerouted && <div className="why">not the usual way</div>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          disabled={busy === rule.key}
                          onChange={(event) =>
                            void save(rule.key, { enabled: event.target.checked })
                          }
                        />
                        <span>{rule.enabled ? "on" : "off"}</span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="lede" style={{ marginTop: 20, fontSize: 12.5 }}>
<b>These are the {STAGES.find((one) => one.id === tab)?.name.toLowerCase()} settings.</b>{" "}
        Each stage keeps its own — a threshold that suits a garment on the table is not the
        one for a lot already packed. <b>Every alert goes to the administrators.</b> The roster already holds their addresses,
        so there is nothing to keep in step when somebody changes job. Turning a rule off stops
        it being raised; anything already open stays until it is dealt with.
      </p>
      {rules !== null && !rules.email_ready && (
        <div className="notice info" style={{ marginTop: 12 }}>
          <b>Email is not set up, so those boxes are off.</b> Set <code>SMTP_HOST</code>,{" "}
          <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>SMTP_FROM</code> on the
          server and they come to life. Until then every alert is in the list and nowhere else.
        </div>
      )}
      <p className="lede" style={{ marginTop: 12, fontSize: 12.5 }}>
        Email goes out when an alert is <em>raised</em>, once. The same stuck inspection is not
        sent again on every sweep — and nothing is sent while nobody is using the app, because
        the rules are swept as the screens are opened.
      </p>
    </>
  );
}
