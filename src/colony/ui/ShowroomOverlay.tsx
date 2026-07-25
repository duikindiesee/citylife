// PLAYER.GARAGE.1 — the Gearbox Auto Hub showroom overlay: full-screen interior scene with the
// rotating plinth (ShowroomView), left/right carousel between the Karoo vehicles, bounded zoom and
// the specification card.
//
// PLAYER.CAR.1.S4 — acquisition is wired to the AUTHORITATIVE SERVER, but stays DARK behind the
// carAcquisition feature gate until operator UAT. While the gate is off (the shipped default) the
// button is exactly the honest "preview only" lock this slice inherited — no KCO movement, grant,
// ownership write or service call can originate here. Only when the operator turns the gate on does
// the acquire button post the canonical vehicleKey to the service (which alone checks funds and moves
// coin) and render the server ownership truth.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
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
  loadOwnedKeysCache,
  saveOwnedKeysCache,
  fetchOwnedVehicleKeysBackend,
  postAcquireVehicle,
  acquireButtonView,
  acquireStateColor,
  type AcquireOutcome,
} from "../car/carAcquisition";

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

export function ShowroomOverlay({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(SHOWROOM_DEFAULT_ZOOM);
  const count = SHOWROOM_VEHICLES.length;
  const vehicle = SHOWROOM_VEHICLES[wrapIndex(index, count)]!;
  const card = showroomCardModel(vehicle);
  const vehicleKey = vehicleKeyOf(vehicle);

  // PLAYER.CAR.1.S4 — acquisition is dark unless the operator turned the gate on. Evaluated once so a
  // mid-session env flip can never surprise a live overlay; the whole server-truth path is inert while off.
  const [acquireEnabled] = useState(() => isCarAcquisitionEnabled());
  // The set of vehicleKeys the SERVER says the player owns. Seeded from the cache-only mirror for an
  // instant first paint, then overwritten by the authoritative GET — never merged ahead of it.
  const [owned, setOwned] = useState<readonly string[]>([]);
  // The per-vehicle outcome of the last acquire attempt (keyed by vehicleKey), and which key is in flight.
  const [outcomes, setOutcomes] = useState<Record<string, AcquireOutcome>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!acquireEnabled) return;
    let live = true;
    setOwned(loadOwnedKeysCache()); // instant, non-authoritative first paint
    void fetchOwnedVehicleKeysBackend().then((truth) => {
      if (!live || truth === null) return; // signed out / endpoint absent → keep the cache
      setOwned(truth);
      saveOwnedKeysCache(truth); // the cache follows the truth, never leads it
    });
    return () => {
      live = false;
    };
  }, [acquireEnabled]);

  const isOwned = owned.includes(vehicleKey);
  const outcome = outcomes[vehicleKey];
  const isPending = pendingKey === vehicleKey;

  const acquire = useCallback(() => {
    if (!acquireEnabled || isOwned || pendingKey !== null) return;
    const key = vehicleKey;
    setPendingKey(key);
    void postAcquireVehicle(key).then((result) => {
      setOutcomes((m) => ({ ...m, [key]: result }));
      setPendingKey((cur) => (cur === key ? null : cur));
      if (result.kind === "owned") {
        // Confirmed by the authority — reconcile against the fresh server truth, not a local guess.
        void fetchOwnedVehicleKeysBackend().then((truth) => {
          if (truth === null) return;
          setOwned(truth);
          saveOwnedKeysCache(truth);
        });
      }
    });
  }, [acquireEnabled, isOwned, pendingKey, vehicleKey]);

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
        <span
          data-testid="showroom-card-price"
          style={{ color: "#ffd25a", fontWeight: 700 }}
        >
          {card.priceLabel}
        </span>
        {acquireEnabled ? (
          <AcquireButton
            isOwned={isOwned}
            isPending={isPending}
            outcome={outcome}
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

// PLAYER.CAR.1.S4 — the server-truth acquire control. Rendered ONLY when the feature gate is on; the
// dark default keeps the inherited "preview only" lock instead. Its state + label + disabled come from
// the pure acquireButtonView state machine (carAcquisition), so this stays a thin view. It carries a
// stable data-acquire-state for deterministic E2E once the operator enables UAT, and never fires while a
// request is in flight (pending) or the car is already owned. The click posts the canonical vehicleKey
// and the authority decides — the button never names a price or moves coin.
function AcquireButton({
  isOwned,
  isPending,
  outcome,
  onAcquire,
}: {
  isOwned: boolean;
  isPending: boolean;
  outcome: AcquireOutcome | undefined;
  onAcquire: () => void;
}) {
  const view = acquireButtonView(isOwned, isPending, outcome);
  return (
    <button
      data-build-action="showroom-acquire"
      data-testid="showroom-acquire"
      data-acquire-state={view.state}
      disabled={view.disabled}
      onClick={onAcquire}
      title="Acquire this vehicle — the server checks your balance and moves the coin"
      style={{
        padding: "6px 10px",
        fontSize: 12,
        borderRadius: 6,
        border: `1px solid ${view.disabled ? "#3a4a5a" : "#b6892f"}`,
        background: view.disabled
          ? "rgba(255,255,255,0.05)"
          : "rgba(182,137,47,0.18)",
        color: acquireStateColor(view.state),
        cursor: view.disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
    >
      {view.label}
    </button>
  );
}
