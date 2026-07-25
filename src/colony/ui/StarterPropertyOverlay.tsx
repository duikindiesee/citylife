// PLAYER.HOME.1C — the guided mobile property-selection step and identity-bound house projection. A
// full-screen overlay that:
//
//   • renders ONLY the server-returned eligible starter neighbourhoods (private/inaccessible ones are
//     absent because the authority omits them — the client adds no choice of its own),
//   • shows the canonical server price and the current server-synced wallet truth (display only — the
//     control never submits either),
//   • on tap posts the SELECTED neighbourhoodKey only, and is idempotent under a double-tap (a stable
//     Idempotency-Key + an in-flight guard mean one logical purchase → one deed → one house),
//   • re-fetches the authoritative home truth and projects it into exactly ONE deterministic,
//     identity-bound starter house (starterHouseProjection), advancing the journey to the owned state,
//   • fails soft on every read: a signed-out/absent/malformed response shows a retry, never a guess, and
//     the caller keeps the legacy entry.
//
// The overlay is a thin view over the pure model in starterProperty / starterHouseProjection; all the
// "handle every state" logic lives there and is node-tested. It mounts only when the operator UAT gate
// is open (see ColonyApp) — while dark it never renders and the network path is inert.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  fetchEligibleNeighbourhoods,
  fetchHomeTruth,
  postPurchaseHome,
  purchaseButtonView,
  purchaseStateColor,
  isHomeOwned,
  type EligibleNeighbourhood,
  type HomeTruth,
  type PurchaseOutcome,
} from "../home/starterProperty";
import { projectStarterHome } from "../home/starterHouseProjection";

const panelStyle: CSSProperties = {
  background: "rgba(8,14,24,0.92)",
  border: "1px solid #1e3a5a",
  borderRadius: 10,
  color: "#c8dff0",
  fontFamily: "monospace",
};

const controlButtonStyle: CSSProperties = {
  padding: "8px 14px",
  fontSize: 15,
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid #3a5a6a",
  background: "rgba(8,14,24,0.9)",
  color: "#a0d4f0",
  fontWeight: 700,
};

/** Round every number shown in the UI (AGENTS.md). Display only — never a submitted value. */
function money(currency: string, kco: number | null): string {
  return kco === null ? "—" : `${currency}${Math.round(kco).toLocaleString()}`;
}

/** The read phase for the eligible-choices / home-truth boot. */
type LoadPhase = "loading" | "ready" | "error";

export function StarterPropertyOverlay({
  onClose,
  walletKco,
  currency = "₭",
}: {
  onClose: () => void;
  /** The current server-synced wallet balance for the signed-in player, display only. null = unknown. */
  walletKco: number | null;
  currency?: string;
}) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [choices, setChoices] = useState<EligibleNeighbourhood[]>([]);
  const [truth, setTruth] = useState<HomeTruth | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PurchaseOutcome | undefined>();
  const [pending, setPending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Load the authoritative eligible choices + home truth together. Fail-soft: a null from either read
  // (signed out / endpoint absent / malformed) surfaces the retry state and never a client-invented list.
  useEffect(() => {
    let live = true;
    setPhase("loading");
    void (async () => {
      const [elig, home] = await Promise.all([
        fetchEligibleNeighbourhoods(),
        fetchHomeTruth(),
      ]);
      if (!live) return;
      setTruth(home);
      if (elig === null) {
        setChoices([]);
        // If the player already owns a home, an eligible-list miss is not an error — we go straight to
        // the owned projection. Otherwise it is a genuine read failure the player can retry.
        setPhase(isHomeOwned(home) ? "ready" : "error");
        return;
      }
      setChoices(elig);
      setSelected((cur) => cur ?? elig[0]?.key ?? null);
      setPhase("ready");
    })();
    return () => {
      live = false;
    };
  }, [reloadToken]);

  const owned = isHomeOwned(truth);
  // EXACTLY ONE deterministic, identity-bound house — a pure function of the authoritative truth, so a
  // refresh / re-login / second device all converge on this same projection.
  const projected = useMemo(() => projectStarterHome(truth), [truth]);

  const eligibleKeys = useMemo(() => choices.map((c) => c.key), [choices]);
  const selectedChoice = choices.find((c) => c.key === selected) ?? null;

  const purchase = useCallback(() => {
    if (pending || owned || !selected) return;
    const key = selected;
    setPending(true);
    void postPurchaseHome(key, eligibleKeys).then((result) => {
      setOutcome(result);
      if (result.kind === "owned") {
        // Confirmed by the authority — reconcile against a FRESH re-fetch of the server truth (never a
        // local guess), which is what the house projection binds to.
        void fetchHomeTruth().then((fresh) => {
          setTruth(fresh);
          setPending(false);
        });
      } else {
        setPending(false);
      }
    });
  }, [pending, owned, selected, eligibleKeys]);

  const view = purchaseButtonView(owned, !!selected, pending, outcome);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="starter-property-overlay"
      data-testid="starter-property-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 82,
        background: "#0a0f16",
        overflowY: "auto",
        padding: "16px 14px 96px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          ...panelStyle,
          padding: "8px 12px",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#ffd25a", fontWeight: 700 }}>
          🏡 Choose your starter home
        </span>
        <button
          data-build-action="home-exit"
          data-testid="home-exit"
          onClick={onClose}
          title="Leave property selection"
          style={{ ...controlButtonStyle, padding: "6px 10px", fontSize: 13 }}
        >
          ✕ Exit
        </button>
      </div>

      {/* wallet truth — server-synced, display only */}
      <div
        data-testid="home-wallet"
        style={{
          ...panelStyle,
          marginTop: 10,
          padding: "8px 12px",
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: "#7ab0d0" }}>Your wallet</span>
        <span data-testid="home-wallet-balance" style={{ color: "#9fd4a6", fontWeight: 700 }}>
          {money(currency, walletKco)}
        </span>
      </div>

      {phase === "loading" && (
        <div
          data-testid="home-loading"
          style={{ ...panelStyle, marginTop: 10, padding: 16, fontSize: 13, color: "#7ab0d0" }}
        >
          ⏳ Loading eligible neighbourhoods…
        </div>
      )}

      {phase === "error" && !owned && (
        <div
          data-testid="home-error"
          style={{ ...panelStyle, marginTop: 10, padding: 16, fontSize: 13 }}
        >
          <div style={{ color: "#e07a7a", marginBottom: 10 }}>
            Couldn't load your eligible neighbourhoods.
          </div>
          <button
            data-build-action="home-retry"
            data-testid="home-retry"
            onClick={() => setReloadToken((t) => t + 1)}
            style={controlButtonStyle}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {/* OWNED — the deterministic, identity-bound house projection */}
      {owned && projected && (
        <div
          data-testid="home-owned"
          data-plot-id={projected.plotId ?? ""}
          data-frame-id={projected.frameId ?? ""}
          data-house-seed={String(projected.seed)}
          data-placement={`${projected.placement.x},${projected.placement.y}`}
          style={{
            ...panelStyle,
            marginTop: 10,
            padding: 16,
            fontSize: 13,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span style={{ color: "#9fd4a6", fontWeight: 700, fontSize: 15 }}>
            ✓ Your home is yours
          </span>
          <span style={{ color: "#c8dff0" }}>
            A {projected.spec.character} {projected.spec.floors}-storey home
            {truth?.neighbourhoodKey ? ` in ${truth.neighbourhoodKey}` : ""}.
          </span>
          <span style={{ color: "#7ab0d0", fontSize: 11 }}>
            Placed at {projected.placement.x},{projected.placement.y} · the same on every device.
          </span>
        </div>
      )}

      {/* SELECT — server-eligible choices only */}
      {!owned && phase === "ready" && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {choices.length === 0 ? (
            <div
              data-testid="home-empty"
              style={{ ...panelStyle, padding: 16, fontSize: 13, color: "#7ab0d0" }}
            >
              No eligible starter neighbourhoods are open to you yet.
            </div>
          ) : (
            <div
              data-testid="home-choices"
              role="radiogroup"
              aria-label="Eligible starter neighbourhoods"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {choices.map((c) => {
                const isSel = c.key === selected;
                return (
                  <button
                    key={c.key}
                    data-build-action="home-choice"
                    data-testid={`home-choice-${c.key}`}
                    data-choice-key={c.key}
                    data-selected={isSel ? "true" : "false"}
                    role="radio"
                    aria-checked={isSel}
                    onClick={() => setSelected(c.key)}
                    style={{
                      ...panelStyle,
                      textAlign: "left",
                      padding: "12px 14px",
                      cursor: "pointer",
                      border: `1px solid ${isSel ? "#b6892f" : "#1e3a5a"}`,
                      background: isSel ? "rgba(182,137,47,0.16)" : panelStyle.background,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#c8dff0", fontWeight: 700 }}>{c.name}</span>
                    <span
                      data-testid={`home-price-${c.key}`}
                      style={{ color: "#ffd25a", fontWeight: 700 }}
                    >
                      {money(currency, c.priceKco)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {choices.length > 0 && (
            <button
              data-build-action="home-purchase"
              data-testid="home-purchase"
              data-purchase-state={view.state}
              disabled={view.disabled}
              onClick={purchase}
              title="Secure this starter home — the server checks your balance and grants the deed"
              style={{
                marginTop: 4,
                padding: "12px 16px",
                fontSize: 15,
                borderRadius: 8,
                border: `1px solid ${view.disabled ? "#3a4a5a" : "#b6892f"}`,
                background: view.disabled
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(182,137,47,0.18)",
                color: purchaseStateColor(view.state),
                cursor: view.disabled ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {view.label}
              {selectedChoice && view.state === "ready"
                ? ` · ${money(currency, selectedChoice.priceKco)}`
                : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
