// ARCADE.2A — the latest-wins (single-latest) sequencer that guarantees a STALE `citylife-arcade-3d-v1`
// entitlement result can never overwrite a newer one, no matter which order the async checks resolve in.
// The OPEN venue fires overlapping re-checks (immediately on entry, on a bounded interval, and on every
// tab refocus), and identity changes fire their own check; without sequencing, a slow earlier `enabled`
// could land AFTER a fast later OFF / killed / denied / malformed / failed / aborted result and silently
// re-open a venue the server just revoked. Every dispatch takes the next sequence number BEFORE it awaits
// the network; only the result of the MOST RECENTLY dispatched check is ever applied, and any non-enabled
// winning result (including the null reset) also closes the venue. Pure and dependency-injected (no DOM,
// no React) so the whole out-of-order matrix is deterministically unit-testable.
import type { ArcadeEntitlement } from "./arcadeGamehouse";

/** The side effects the gate drives — the React state setters in the app, or recorders in a test. */
export interface ArcadeEntitlementSink {
  /** Publish the winning entitlement, or `null` to drop back to the fail-closed loading state. */
  setEntitlement: (entitlement: ArcadeEntitlement | null) => void;
  /** Collapse any open venue. Fired for every non-enabled winning result (OFF/killed/denied/error/reset). */
  closeVenue: () => void;
}

export interface ArcadeEntitlementGate {
  /**
   * Drop to the fail-closed loading state (`null`) and close any open venue, AND invalidate every check
   * currently in flight. Use on an identity change or teardown so a prior user's positive can never carry
   * forward and a superseded in-flight result can never land afterwards.
   */
  reset: () => void;
  /**
   * Open a new check. Call this at DISPATCH time (BEFORE awaiting the network) so checks are numbered in
   * the order they start. Returns the `apply` bound to THIS check: it publishes the result only while this
   * is still the latest check, and closes the venue on any non-enabled result. A superseded (stale) check
   * finds a newer sequence already recorded and is silently dropped.
   */
  begin: () => (result: ArcadeEntitlement) => void;
}

export function createArcadeEntitlementGate(
  sink: ArcadeEntitlementSink,
): ArcadeEntitlementGate {
  // The sequence of the most recently DISPATCHED check. Only a result whose own sequence still equals
  // this may win; a stale (older) in-flight result finds `latest` already moved on and is discarded. A
  // reset also advances it, so nothing dispatched before the reset can land after it.
  let latest = 0;
  const publish = (result: ArcadeEntitlement) => {
    sink.setEntitlement(result);
    // Never leave a venue open on a non-enabled truth — OFF, killed, denied, a malformed body, a failed or
    // aborted fetch all arrive here as `{ enabled: false }` and must actively collapse the open venue,
    // not merely rely on a render guard (which would silently re-open if a later positive ever landed).
    if (!result.enabled) sink.closeVenue();
  };
  return {
    reset() {
      latest += 1;
      sink.setEntitlement(null);
      sink.closeVenue();
    },
    begin() {
      const mine = ++latest;
      return (result: ArcadeEntitlement) => {
        if (mine !== latest) return; // a newer check has since been dispatched — this result is stale.
        publish(result);
      };
    },
  };
}
