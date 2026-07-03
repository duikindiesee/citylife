// QA hardening — the "dead memo" fix, React side. Bridges the mutable sim.state class to React
// with useSyncExternalStore: the ColonyRuntime already emits on every mutation and on a 200ms
// heartbeat (runtime.loop), so subscribing to it and snapshotting a primitive signature gives
// components exactly-when-needed re-renders without a new state-manager dependency.
import { useCallback, useSyncExternalStore } from "react";

/** The slice of ColonyRuntime the bridge needs — kept structural so tests and headless
 *  harnesses can pass a stub, and so this module never imports the runtime. */
export interface SimBridge {
  subscribe(cb: () => void): () => void;
}

/** Fallback heartbeat for render trees mounted without a runtime (dev harnesses): poll at the
 *  same 200ms cadence the runtime's loop emits at. */
function intervalSubscribe(cb: () => void): () => void {
  const id = setInterval(cb, 200);
  return () => clearInterval(id);
}

/** Subscribe a component to the mutable sim. getSignature must be a pure read of sim.state
 *  returning a primitive (see simSignals.ts); the component re-renders only when the returned
 *  signature differs from the previous one. */
export function useSimSignal(
  runtime: SimBridge | undefined | null,
  getSignature: () => string,
): string {
  const subscribe = useCallback(
    (cb: () => void) => (runtime ? runtime.subscribe(cb) : intervalSubscribe(cb)),
    [runtime],
  );
  return useSyncExternalStore(subscribe, getSignature);
}
