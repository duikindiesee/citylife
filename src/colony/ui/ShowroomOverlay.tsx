// PLAYER.GARAGE.1 — the Gearbox Auto Hub showroom overlay: full-screen interior scene with the
// rotating plinth (ShowroomView), left/right carousel between the Karoo vehicles, bounded zoom and
// the specification card.
//
// PLAYER.CAR.1.S4 — eligible signed-in players without an owned vehicle enter the real server-backed
// purchase flow by default. The client first requires authoritative no-car eligibility and a valid
// server offer; it never supplies a price or changes KCO. Purchase and ownership remain server-owned,
// so a disabled service gate, missing quote, insufficient balance or signed-out session fails closed.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ShowroomView } from "../render/ShowroomView";
import {
  SHOWROOM_VEHICLES,
  showroomCardModel,
} from "../showroom/showroomCatalog";
import {
  SHOWROOM_DEFAULT_ZOOM,
  SHOWROOM_ZOOM_STEP,
  clampShowroomZoom,
  stepSelection,
  wrapIndex,
} from "../showroom/showroomState";
import {
  isCarAcquisitionEnabled,
  vehicleKeyOf,
  serverVehicleKeyOf,
  loadOwnedKeysCache,
  saveOwnedKeysCache,
  fetchOwnedVehicleKeysBackend,
  fetchVehicleOfferPricesBackend,
  postAcquireVehicle,
  acquireButtonView,
  acquireStateColor,
  type AcquireOutcome,
} from "../car/carAcquisition";
import { getAuthClient } from "../authClient";
import { hasStoredCar, saveCar } from "../car/garageStore";
import type { PlayerWalletStatus } from "../wallet/playerWallet";
import type { ColonyRuntime } from "../runtime";

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

export function ShowroomOverlay({
  onClose,
  canAcquire = false,
  accountKey,
  runtime,
  walletKco = null,
  walletStatus = "unavailable",
  walletLabel = "Balance unavailable",
  onWalletRefresh,
}: {
  onClose: () => void;
  canAcquire?: boolean;
  /** Authenticated player identity; changing it clears stale offer prices. */
  accountKey?: string | null;
  runtime?: ColonyRuntime;
  /** Current player-scoped wallet snapshot. It is display-only; the server still decides a debit. */
  walletKco?: number | null;
  walletStatus?: PlayerWalletStatus;
  walletLabel?: string;
  onWalletRefresh?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(SHOWROOM_DEFAULT_ZOOM);
  const count = SHOWROOM_VEHICLES.length;
  const vehicle = SHOWROOM_VEHICLES[wrapIndex(index, count)]!;
  const card = showroomCardModel(vehicle);
  const vehicleKey = vehicleKeyOf(vehicle);

  // The feature switch defaults ON, but it cannot grant eligibility. Only the login flow's
  // authoritative no-car decision may enable acquisition, and the explicit switch can still kill it.
  const acquireEnabled = Boolean(canAcquire && isCarAcquisitionEnabled());
  const [offerState, setOfferState] = useState<{
    accountKey: string | null;
    status: "loading" | "ready" | "unavailable";
    prices: Readonly<Record<string, number>> | null;
  }>({ accountKey: null, status: "loading", prices: null });
  const [offerRetry, setOfferRetry] = useState(0);
  const currentAccountKey =
    getAuthClient().operator?.userId == null
      ? null
      : String(getAuthClient().operator!.userId);
  // Bind quotes to the account that fetched them. On an account switch, the old price is unusable
  // during the render before the effect runs, so it cannot flash as an actionable offer.
  const offerBelongsToCurrentAccount =
    offerState.accountKey === currentAccountKey;
  const serverOfferPrices = offerBelongsToCurrentAccount
    ? offerState.prices
    : null;
  const offerStatus = offerBelongsToCurrentAccount
    ? offerState.status
    : "loading";
  // The set of vehicleKeys the SERVER says the player owns. Seeded from the cache-only mirror for an
  // instant first paint, then overwritten by the authoritative GET — never merged ahead of it.
  const [owned, setOwned] = useState<readonly string[]>([]);
  // The per-vehicle outcome of the last acquire attempt (keyed by vehicleKey), and which key is in flight.
  const [outcomes, setOutcomes] = useState<Record<string, AcquireOutcome>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const auth = getAuthClient();
    const initialUserId = auth.operator?.userId ?? null;
    const initialUserKey =
      initialUserId === null ? null : String(initialUserId);
    const initialCitizenId = runtime?.operatorCitizenId() ?? null;

    if (
      !auth.isAuthenticated ||
      initialUserKey === null ||
      (accountKey !== undefined && accountKey !== initialUserKey)
    ) {
      setOfferState({
        accountKey: initialUserKey,
        status: "unavailable",
        prices: null,
      });
      return () => {
        live = false;
      };
    }

    setOfferState({
      accountKey: initialUserKey,
      status: "loading",
      prices: null,
    });
    void fetchVehicleOfferPricesBackend().then((prices) => {
      if (!live || !isMountedRef.current) return;
      const freshAuth = getAuthClient();
      const freshUserId = freshAuth.operator?.userId ?? null;
      if (
        (freshUserId === null ? null : String(freshUserId)) !==
          initialUserKey ||
        (initialCitizenId && runtime?.operatorCitizenId() !== initialCitizenId)
      ) {
        return;
      }
      setOfferState({
        accountKey: initialUserKey,
        status: prices === null ? "unavailable" : "ready",
        prices,
      });
    });
    return () => {
      live = false;
    };
  }, [accountKey, currentAccountKey, offerRetry, runtime]);

  useEffect(() => {
    if (!acquireEnabled) return;
    let live = true;
    const auth = getAuthClient();
    const initialUserId = auth.operator?.userId ?? null;
    const initialCitizenId = runtime?.operatorCitizenId() ?? null;
    const scope = initialUserId
      ? String(initialUserId)
      : (initialCitizenId ?? "anon");

    setOwned(loadOwnedKeysCache(scope)); // instant, non-authoritative first paint
    void fetchOwnedVehicleKeysBackend().then((truth) => {
      if (!live || !isMountedRef.current || truth === null) return; // signed out / endpoint absent → keep the cache
      const freshAuth = getAuthClient();
      if (
        freshAuth.operator?.userId !== initialUserId ||
        (initialCitizenId && runtime?.operatorCitizenId() !== initialCitizenId)
      ) {
        return; // session/identity changed while in flight
      }

      setOwned(truth);
      saveOwnedKeysCache(truth, scope); // the cache follows the truth, never leads it
      if (initialUserId)
        runtime?.applyVehicleOwnership(String(initialUserId), truth);

      // Hydrate garageStore/runtime if the player owns a vehicle on the server but doesn't have it saved locally yet
      const citizenId =
        runtime?.operatorCitizenId() ??
        (initialUserId ? String(initialUserId) : "citizen-me");
      const alreadyHasCar = runtime
        ? runtime.hasStoredCar(citizenId)
        : hasStoredCar(citizenId);
      if (!alreadyHasCar && truth.length > 0) {
        const matching = SHOWROOM_VEHICLES.find(
          (v) =>
            truth.includes(vehicleKeyOf(v)) ||
            truth.includes(serverVehicleKeyOf(vehicleKeyOf(v))),
        );
        if (matching) {
          if (runtime) {
            runtime.acquireCar(matching.spec, citizenId);
          } else {
            saveCar(citizenId, matching.spec);
          }
        }
      }
    });
    return () => {
      live = false;
    };
  }, [acquireEnabled, runtime]);

  const isOwned =
    owned.includes(vehicleKey) ||
    owned.includes(serverVehicleKeyOf(vehicleKey));
  const serverPriceKco =
    serverOfferPrices?.[serverVehicleKeyOf(vehicleKey)] ?? null;
  const outcome = outcomes[vehicleKey];
  const isPending = pendingKey === vehicleKey;

  const acquire = useCallback(() => {
    if (
      !acquireEnabled ||
      serverPriceKco === null ||
      offerStatus !== "ready" ||
      isOwned ||
      pendingKey !== null
    )
      return;
    const key = vehicleKey;
    const initiatingAuth = getAuthClient();
    const initiatingUserId = initiatingAuth.operator?.userId ?? null;
    const initiatingCitizenId = runtime?.operatorCitizenId() ?? null;
    const scope = initiatingUserId
      ? String(initiatingUserId)
      : (initiatingCitizenId ?? "anon");

    setPendingKey(key);
    void postAcquireVehicle(key).then(async (result) => {
      if (!isMountedRef.current) return;
      const currentAuth = getAuthClient();
      const currentUserId = currentAuth.operator?.userId ?? null;
      const currentCitizenId = runtime?.operatorCitizenId() ?? null;
      if (
        currentUserId !== initiatingUserId ||
        (initiatingCitizenId && currentCitizenId !== initiatingCitizenId)
      ) {
        // Cross-account / session switch guard: suppress stale completion
        return;
      }
      if (result.kind === "owned" || result.kind === "insufficient_funds") {
        onWalletRefresh?.();
      }

      // A successful purchase can confirm a different, already-owned car.
      // Resolve authority before writing the garage; never infer it from the offer.
      const truth =
        result.kind === "owned" ? await fetchOwnedVehicleKeysBackend() : null;
      if (
        !isMountedRef.current ||
        (getAuthClient().operator?.userId ?? null) !== initiatingUserId ||
        (initiatingCitizenId &&
          runtime?.operatorCitizenId() !== initiatingCitizenId)
      )
        return;
      const confirmed =
        truth &&
        SHOWROOM_VEHICLES.find(
          (v) =>
            truth.includes(vehicleKeyOf(v)) ||
            truth.includes(serverVehicleKeyOf(vehicleKeyOf(v))),
        );
      setOutcomes((m) => ({
        ...m,
        [key]:
          result.kind === "owned" &&
          (!confirmed || vehicleKeyOf(confirmed) !== key)
            ? { kind: "error" }
            : result,
      }));
      setPendingKey((cur) => (cur === key ? null : cur));
      if (result.kind === "owned" && confirmed && truth) {
        if (currentUserId)
          runtime?.applyVehicleOwnership(String(currentUserId), truth);
        // Confirmed by authority — persist via identity-bound runtime method to update parked car
        const targetCitizenId =
          currentCitizenId ??
          (currentUserId ? String(currentUserId) : "citizen-me");
        if (runtime) {
          runtime.acquireCar(confirmed.spec, targetCitizenId);
        } else {
          saveCar(targetCitizenId, confirmed.spec);
        }

        setOwned(truth);
        saveOwnedKeysCache(truth, scope);
      }
    });
  }, [
    acquireEnabled,
    isOwned,
    onWalletRefresh,
    offerStatus,
    pendingKey,
    runtime,
    serverPriceKco,
    vehicleKey,
  ]);

  const retryOfferPrice = useCallback(() => {
    setOfferRetry((current) => current + 1);
  }, []);

  const prev = useCallback(
    () => setIndex((i) => stepSelection(i, count, -1)),
    [count],
  );
  const next = useCallback(
    () => setIndex((i) => stepSelection(i, count, 1)),
    [count],
  );
  const zoomIn = useCallback(
    () => setZoom((z) => clampShowroomZoom(z - SHOWROOM_ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => clampShowroomZoom(z + SHOWROOM_ZOOM_STEP)),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, zoomIn, zoomOut, onClose]);

  return (
    <div
      className="showroom-overlay"
      data-testid="showroom-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "#0a0f16" }}
    >
      <ShowroomView vehicle={vehicle} zoom={zoom} />

      <div
        style={{
          ...panelStyle,
          position: "absolute",
          top: 12,
          left: 12,
          padding: "8px 12px",
          fontSize: 13,
        }}
      >
        <span style={{ color: "#ffd25a", fontWeight: 700 }}>
          🏬 Gearbox Auto Hub · Showroom
        </span>
      </div>

      <button
        data-build-action="showroom-exit"
        onClick={onClose}
        title="Leave the showroom"
        style={{
          ...controlButtonStyle,
          position: "absolute",
          top: 12,
          right: 12,
        }}
      >
        ✕ Exit
      </button>

      {/* specification card */}
      <div
        data-testid="showroom-card"
        style={{
          ...panelStyle,
          position: "absolute",
          right: 12,
          bottom: 90,
          width: 260,
          padding: "10px 12px",
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        <span
          data-testid="showroom-card-name"
          style={{ color: "#ffd25a", fontWeight: 700, fontSize: 14 }}
        >
          {card.name}
        </span>
        <span style={{ color: "#9fd4a6", fontSize: 11, fontWeight: 700 }}>
          {card.vehicleClass}
        </span>
        <span style={{ color: "#7ab0d0", fontSize: 11 }}>{card.blurb}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {card.stats.map((s) => (
            <div key={s.label} style={{ fontSize: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#7ab0d0" }}>{s.label}</span>
                <span
                  data-testid={`showroom-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                  style={{ color: "#c8dff0" }}
                >
                  {s.pct}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={s.label}
                aria-valuenow={s.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  height: 5,
                  borderRadius: 999,
                  background: "rgba(122,176,208,0.16)",
                  overflow: "hidden",
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${s.pct}%`,
                    borderRadius: 999,
                    background: "linear-gradient(90deg,#6ea8d0,#a0d4f0)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div
          data-testid="showroom-wallet"
          data-wallet-status={walletStatus}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            color: "#b7c9d7",
            fontSize: 12,
          }}
        >
          <span>Your wallet</span>
          <strong data-testid="showroom-wallet-balance">{walletLabel}</strong>
          {(walletStatus === "missing" || walletStatus === "unavailable") &&
            onWalletRefresh && (
              <button
                type="button"
                data-testid="showroom-wallet-refresh"
                onClick={onWalletRefresh}
                style={{
                  ...controlButtonStyle,
                  padding: "4px 7px",
                  fontSize: 10,
                }}
              >
                Retry
              </button>
            )}
        </div>
        <span
          data-testid="showroom-card-price"
          data-price-source={serverPriceKco === null ? "unavailable" : "server"}
          data-price-kco={serverPriceKco === null ? undefined : serverPriceKco}
          style={{ color: "#ffd25a", fontWeight: 700 }}
        >
          {offerStatus === "loading"
            ? "Checking server price…"
            : serverPriceKco === null
              ? offerStatus === "ready"
                ? "Not currently offered for purchase"
                : "Price unavailable"
              : `₭${serverPriceKco.toLocaleString()} KCO`}
        </span>
        {acquireEnabled ? (
          <AcquireButton
            isOwned={isOwned}
            isPending={isPending}
            outcome={outcome}
            offerStatus={offerStatus}
            priceKco={serverPriceKco}
            walletKco={walletKco}
            onAcquire={acquire}
          />
        ) : (
          <button
            data-build-action="showroom-acquire-preview"
            disabled
            title="Acquisition arrives with the starter economy — preview only in this slice"
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #3a4a5a",
              background: "rgba(255,255,255,0.05)",
              color: "#7a90a0",
              cursor: "not-allowed",
              fontWeight: 700,
            }}
          >
            🔒 Acquire · preview only
          </button>
        )}
        {offerStatus !== "loading" && serverPriceKco === null && (
          <button
            data-build-action="showroom-offers-retry"
            onClick={retryOfferPrice}
            style={{ ...controlButtonStyle, padding: "5px 8px", fontSize: 11 }}
          >
            Retry server price
          </button>
        )}
      </div>

      {/* carousel + zoom controls */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <button
          data-build-action="showroom-prev"
          onClick={prev}
          title="Previous vehicle (Left arrow)"
          style={controlButtonStyle}
        >
          ◀
        </button>
        <span
          data-testid="showroom-position"
          style={{
            ...panelStyle,
            padding: "7px 12px",
            fontSize: 12,
            color: "#7ab0d0",
          }}
        >
          {wrapIndex(index, count) + 1} / {count}
        </span>
        <button
          data-build-action="showroom-next"
          onClick={next}
          title="Next vehicle (Right arrow)"
          style={controlButtonStyle}
        >
          ▶
        </button>
        <button
          data-build-action="showroom-zoom-in"
          onClick={zoomIn}
          title="Zoom in (+)"
          style={controlButtonStyle}
        >
          🔍+
        </button>
        <button
          data-build-action="showroom-zoom-out"
          onClick={zoomOut}
          title="Zoom out (−)"
          style={controlButtonStyle}
        >
          🔍−
        </button>
      </div>
    </div>
  );
}

// PLAYER.CAR.1.S4 — the server-truth acquire control. Rendered for an eligible account by default;
// missing authority still keeps the control disabled. Its state + label + disabled come from the pure
// acquireButtonView state machine (carAcquisition), so this stays a thin view. It carries a stable
// data-acquire-state for deterministic E2E, and never fires while a
// request is in flight (pending) or the car is already owned. The click posts the canonical vehicleKey
// and the authority decides — the button never names a price or moves coin.
function AcquireButton({
  isOwned,
  isPending,
  outcome,
  offerStatus,
  priceKco,
  walletKco,
  onAcquire,
}: {
  isOwned: boolean;
  isPending: boolean;
  outcome: AcquireOutcome | undefined;
  offerStatus: "loading" | "ready" | "unavailable";
  priceKco: number | null;
  walletKco: number | null;
  onAcquire: () => void;
}) {
  const view = acquireButtonView(isOwned, isPending, outcome);
  const shortage =
    typeof priceKco === "number" && typeof walletKco === "number"
      ? Math.max(0, priceKco - walletKco)
      : null;
  const affordabilityState =
    offerStatus === "loading"
      ? "price-loading"
      : offerStatus !== "ready"
        ? "price-unavailable"
        : priceKco === null
          ? "not-offered"
          : shortage === null
            ? "balance-unavailable"
            : shortage > 0
              ? "insufficient"
              : "affordable";
  const affordability =
    affordabilityState === "price-loading"
      ? "Checking server price…"
      : affordabilityState === "price-unavailable"
        ? "Server price unavailable"
        : affordabilityState === "not-offered"
          ? "Not offered for purchase"
          : affordabilityState === "balance-unavailable"
            ? "Balance unavailable — server will check"
            : affordabilityState === "insufficient"
              ? `Need ₭${shortage!.toLocaleString()} more`
              : `You have ₭${walletKco!.toLocaleString()}`;
  const unavailablePrice = offerStatus !== "ready" || priceKco === null;
  const insufficient = shortage !== null && shortage > 0;
  const disabled = view.disabled || unavailablePrice || insufficient;
  const state = insufficient ? "insufficient_funds" : view.state;
  return (
    <>
      <span
        data-testid="showroom-affordability"
        data-affordability={affordabilityState}
        style={{
          color: shortage && shortage > 0 ? "#f2a35a" : "#9fd4a6",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {affordability}
      </span>
      <button
        data-build-action="showroom-acquire"
        data-testid="showroom-acquire"
        data-acquire-state={state}
        disabled={disabled}
        onClick={onAcquire}
        title="Acquire this vehicle — the server checks your balance and moves the coin"
        style={{
          padding: "6px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: `1px solid ${disabled ? "#3a4a5a" : "#b6892f"}`,
          background: disabled
            ? "rgba(255,255,255,0.05)"
            : "rgba(182,137,47,0.18)",
          color: acquireStateColor(state),
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: 700,
        }}
      >
        {insufficient ? `Need ₭${shortage!.toLocaleString()} more` : view.label}
      </button>
    </>
  );
}
