import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJobs } from "../api";
import type { Job } from "../types";

const FAST = 2000;
const IDLE = 15000;

/**
 * Polls /api/jobs, quickly while anything is running and slowly when nothing is.
 *
 * Identical payloads are dropped rather than set: re-rendering the report with
 * the same data would fight the reviewer's scroll position halfway down a
 * hundred-row table.
 */
export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const payload = useRef("");
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<() => void>(() => {});

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void tick.current(), delay);
  }, []);

  const poll = useCallback(async () => {
    if (busy.current || document.hidden) {
      schedule(FAST);
      return;
    }
    busy.current = true;
    let active = false;
    try {
      const next = await fetchJobs();
      active = next.some((job) => job.status === "running" || job.status === "queued");
      const serialised = JSON.stringify(next);
      if (serialised !== payload.current) {
        payload.current = serialised;
        setJobs(next);
      }
    } catch {
      /* transient: the next tick retries */
    } finally {
      busy.current = false;
    }
    schedule(active ? FAST : IDLE);
  }, [schedule]);

  useEffect(() => {
    tick.current = () => void poll();
  }, [poll]);

  /** Poll immediately, bypassing the identical-payload guard. */
  const refreshNow = useCallback(() => {
    payload.current = "";
    schedule(0);
  }, [schedule]);

  useEffect(() => {
    // Scheduled rather than awaited here: the first poll goes through the same
    // timer as every later one, so this effect only ever subscribes to an
    // external system instead of writing state during the effect body.
    schedule(0);
    const onVisible = () => {
      if (!document.hidden) schedule(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  return { jobs, refreshNow };
}
