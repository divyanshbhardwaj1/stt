import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SessionContext, fetchMe } from "./session";
import type { Me } from "./session";

/**
 * Holds the session for the whole app.
 *
 * Its own file because everything else in `session.ts` is a hook or a plain
 * function, and a module that exports both a component and non-components
 * cannot be hot-reloaded.
 */
export function SessionProvider({ children }: { children: ReactNode }) {

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetchMe()
      .then((who) => live && setMe(who))
      .catch(() => live && setMe(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The server sends one message for every failure on purpose — see
      // auth.sign_in. Passing it through unchanged keeps it that way.
      throw new Error(body.detail || "Could not sign in.");
    }
    setMe(body as Me);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    setMe(null);
  }, []);

  const can = useCallback(
    (capability: string) => Boolean(me?.can.includes(capability)),
    [me],
  );

  return (
    <SessionContext.Provider value={{ me, loading, signIn, signOut, can }}>
      {children}
    </SessionContext.Provider>
  );
}
