// Spec 173 — actual server-offered plot selection. Submit only the selected identity/revision;
// prices, ownership and debits remain server-owned. Paid land still needs a completed house.
// A retained insufficient-funds intent resumes the same selection after reload, while pending
// and operator-held purchases cannot select another plot. The parent keys this view by account.
// Legacy home summaries remain isolated from published parcel geometry.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  fetchHomeTruth,
  purchaseButtonView,
  purchaseStateColor,
  isHomeOwned,
  type HomeTruth,
  type PurchaseOutcome,
} from "../home/starterProperty";
import { projectStarterHome } from "../home/starterHouseProjection";
import { fetchStarterPlotOffers, postPurchasePlot, postResumePlotPurchase, type StarterPlotOffer } from "../home/starterPlotOffers";
import { CELL_SIZE } from "../scale";
import type { PublishedPlayerInventory } from "../home/starterWorldCatalogue";

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
  playerInventory,
}: {
  onClose: () => void;
  /** The current server-synced wallet balance for the signed-in player, display only. null = unknown. */
  walletKco: number | null;
  currency?: string;
  playerInventory?: PublishedPlayerInventory;
}) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [choices, setChoices] = useState<StarterPlotOffer[]>([]);
  const [truth, setTruth] = useState<HomeTruth | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PurchaseOutcome | undefined>();
  const [pending, setPending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const purchaseInFlight = useRef(false);

  // Load the authoritative eligible choices + home truth together. Fail-soft: a null from either read
  // (signed out / endpoint absent / malformed) surfaces the retry state and never a client-invented list.
  useEffect(() => {
    let live = true;
    setPhase("loading");
    void (async () => {
      const [elig, home] = await Promise.all([
        fetchStarterPlotOffers(playerInventory),
        fetchHomeTruth(),
      ]);
      if (!live) return;
      setTruth(home);
      if (elig === null) {
        setChoices([]);
        // If the player already owns a home, an eligible-list miss is not an error — we go straight to
        // the owned projection. Otherwise it is a genuine read failure the player can retry.
        setPhase(isHomeOwned(home) || home?.plotOwned || home?.plotId ? "ready" : "error");
        return;
      }
      setChoices(elig);
      setSelected((cur) => elig.some(c => c.plotId === cur) ? cur : elig[0]?.plotId ?? null);
      setPhase(home === null ? "error" : "ready");
    })();
    return () => {
      live = false;
    };
  }, [reloadToken, playerInventory]);

  const owned = isHomeOwned(truth);
  const plotOwned = truth?.plotOwned === true;
  const existingIntent = !!truth?.plotId && !owned && !plotOwned;
  // EXACTLY ONE deterministic, identity-bound house — a pure function of the authoritative truth, so a
  // refresh / re-login / second device all converge on this same projection.
  const projected = useMemo(() => projectStarterHome(truth), [truth]);

  const selectedChoice = choices.find((c) => c.plotId === selected) ?? null;

  const purchase = useCallback((resume = false) => {
    if (purchaseInFlight.current || pending || owned || plotOwned || (!selected && !resume)) return;
    purchaseInFlight.current = true;
    setPending(true);
    void (async () => {
      try {
        const result = resume && truth ? await postResumePlotPurchase(truth)
          : await postPurchasePlot(selected!, choices);
        setOutcome(result);
        const fresh = await fetchHomeTruth();
        if (fresh) setTruth(fresh);
      } finally {
        purchaseInFlight.current = false;
        setPending(false);
      }
    })();
  }, [pending, owned, plotOwned, selected, choices, truth]);

  const view = purchaseButtonView(owned, !!selected, pending, outcome);
  const selectionConflict = outcome?.kind === "error" && outcome.status === 409;
  const refresh = () => { setOutcome(undefined); setReloadToken(n => n + 1); };

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
          🏡 Choose your home plot
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
        <span
          data-testid="home-wallet-balance"
          style={{ color: "#9fd4a6", fontWeight: 700 }}
        >
          {money(currency, walletKco)}
        </span>
      </div>

      {phase === "loading" && (
        <div
          data-testid="home-loading"
          style={{
            ...panelStyle,
            marginTop: 10,
            padding: 16,
            fontSize: 13,
            color: "#7ab0d0",
          }}
        >
          ⏳ Loading available plots…
        </div>
      )}

      {phase === "error" && !owned && (
        <div
          data-testid="home-error"
          style={{ ...panelStyle, marginTop: 10, padding: 16, fontSize: 13 }}
        >
          <div style={{ color: "#e07a7a", marginBottom: 10 }}>
            Couldn't load your available plots or purchase status.
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
            Placed at {projected.placement.x},{projected.placement.y} · the same
            on every device.
          </span>
        </div>
      )}

      {/* SELECT — server-eligible choices only */}
      {plotOwned && !owned && truth && (
        <div data-testid="home-plot-owned" data-plot-id={truth.plotId ?? ""}
          style={{...panelStyle, marginTop:10, padding:16}}>
          <strong>Your plot is secured</strong>
          <p>{truth.plotId} · {truth.neighbourhoodKey}</p>
          <p>{truth.requiresBuild ? "Your house still needs to be built." : "Your home setup needs an operator check."}</p>
          {truth.requiresBuild && playerInventory && truth.layoutRevision === playerInventory.layoutRevision &&
            !!truth.plotId && playerInventory.plotIds.includes(truth.plotId) &&
            <a data-testid="home-build-house" href="/builder.html?mode=player-home">Build your house</a>}
        </div>
      )}
      {existingIntent && truth && phase === "ready" && (
        <div data-testid="home-existing-purchase" style={{...panelStyle, marginTop:10, padding:16}}>
          <p>Plot {truth.plotId} · {money(currency, truth.priceKco)}</p>
          <p>{truth.status === "REJECTED_INSUFFICIENT_FUNDS" && truth.layoutRevision
            ? "Payment needs more funds. Your selected plot is retained."
            : truth.status === "PENDING" ? "Your purchase is still being confirmed."
            : "This purchase needs an operator check."}</p>
          {truth.status === "REJECTED_INSUFFICIENT_FUNDS" && truth.layoutRevision && (
            <button data-testid="home-resume-purchase" style={controlButtonStyle}
              disabled={pending} onClick={() => purchase(true)}>Retry payment for this plot</button>
          )}
          <button data-testid="home-check-purchase" style={controlButtonStyle}
            disabled={pending} onClick={refresh}>Check purchase status</button>
        </div>
      )}
      {!owned && !plotOwned && !existingIntent && phase === "ready" && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {choices.length === 0 ? (
            <div
              data-testid="home-empty"
              style={{
                ...panelStyle,
                padding: 16,
                fontSize: 13,
                color: "#7ab0d0",
              }}
            >
              No starter plots are currently available. Check again later.
            </div>
          ) : (
            <div
              data-testid="home-choices"
              role="radiogroup"
              aria-label="Available starter plots"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {choices.map((c) => {
                const isSel = c.plotId === selected;
                return (
                  <button
                    key={c.plotId}
                    data-build-action="home-choice"
                    data-testid={`home-choice-${c.plotId}`}
                    data-choice-key={c.plotId}
                    data-selected={isSel ? "true" : "false"}
                    role="radio"
                    aria-checked={isSel}
                    onClick={() => setSelected(c.plotId)}
                    style={{
                      ...panelStyle,
                      textAlign: "left",
                      padding: "12px 14px",
                      cursor: "pointer",
                      border: `1px solid ${isSel ? "#b6892f" : "#1e3a5a"}`,
                      background: isSel
                        ? "rgba(182,137,47,0.16)"
                        : panelStyle.background,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#c8dff0", fontWeight: 700 }}>
                      Plot {c.plotId} · {c.neighbourhoodKey}
                      <small style={{display:"block", marginTop:4}}>
                        {Math.round(c.width * CELL_SIZE)} × {Math.round(c.depth * CELL_SIZE)} m
                      </small>
                    </span>
                    <span
                      data-testid={`home-price-${c.plotId}`}
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
              disabled={view.disabled || selectionConflict}
              onClick={() => purchase()}
              title="Buy this plot — the server checks availability, balance and ownership"
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
              {selectionConflict ? "Plot changed — refresh availability" : view.state === "ready" ? "Buy this plot" : view.label}
              {selectedChoice && view.state === "ready"
                ? ` · ${money(currency, selectedChoice.priceKco)}`
                : ""}
            </button>
          )}
          <button data-testid="home-refresh-plots" style={controlButtonStyle}
            disabled={pending} onClick={refresh}>Refresh available plots</button>
        </div>
      )}
    </div>
  );
}
