import { createContext, useContext } from "react";

/**
 * Who is signed in, and what the server says they may do.
 *
 * Mirrors `auth.describe()` in src/services/auth.py. Every capability here is
 * enforced again on the way into each endpoint — this copy only decides what
 * to draw. Anything sent to a browser is a suggestion, and gating a button is
 * a courtesy to the operator rather than a security measure.
 */
export interface Me {
  /** A uuid. Stable across a change of email — see services/db/models/user.py. */
  id: string;
  /** What they sign in with, and what a person recognises on a roster. */
  email: string;
  name: string;
  admin: boolean;
  state: string;
  stage: string;
  role: string | null;
  role_label: string;
  stages: string[];
  can: string[];
  roles: Record<string, string | null>;
}

export interface Session {
  me: Me | null;
  /** True until the first /api/me has answered, so nothing flashes a login screen. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Whether the signed-in account holds a capability on the current stage. */
  can: (capability: string) => boolean;
}

export const SessionContext = createContext<Session | null>(null);

/** The cookie is httpOnly, so the only way to know who you are is to ask. */
export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`/api/me returned ${response.status}`);
  return response.json();
}


export function useSession(): Session {
  const found = useContext(SessionContext);
  if (found === null) throw new Error("useSession outside a SessionProvider");
  return found;
}

/**
 * Whether the current account holds a capability.
 *
 * A convenience over useSession().can for the common case of one check in a
 * component that needs nothing else from the session.
 */
export function useCan(capability: string): boolean {
  return useSession().can(capability);
}
