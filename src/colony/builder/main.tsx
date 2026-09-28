import { createRoot } from "react-dom/client";
import { BuilderApp } from "./BuilderApp";
import { getAuthClient } from "../authClient";
import { PlayerHouseBuilder } from "./PlayerHouseBuilder";

// Legacy free authoring is ADMIN-ONLY. Player onboarding is a separate server-deed-backed mode
// that ignores URL geometry/ownership and requires API eligibility and a paid current deed.
// For legacy authoring, only an operator role
// — ADMIN, KOOKER_ADMIN, or CITYLIFE_ADMIN — may open /builder.html. This FAILS CLOSED: no
// session, or any non-operator role (CITYLIFE_PLAYER, CITYLIFE_VISITOR, a plain KOOKER_USER,
// COLLABORATOR, or a newcomer) is refused. isCityLifePlayer is true for every non-operator, so
// `!isCityLifePlayer` admits only the three operator roles — and an unauthenticated visitor,
// having no operator role, is treated as a player and refused.
const root = createRoot(document.getElementById("root")!);
const auth = getAuthClient();

if (new URLSearchParams(window.location.search).get("mode") === "player-home") {
  root.render(<PlayerHouseBuilder />);
} else if (!auth.isCityLifePlayer) {
  root.render(<BuilderApp />);
} else {
  root.render(
    <div
      style={{
        maxWidth: 460,
        margin: "12vh auto",
        padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        color: "#333",
      }}
    >
      <h1 style={{ fontSize: "1.35rem", margin: "0 0 10px" }}>
        Builder restricted
      </h1>
      <p style={{ lineHeight: 1.55, color: "#555" }}>
        The house builder is available to CityLife administrators only. Sign in
        with an administrator account to open it.
      </p>
    </div>,
  );
}
