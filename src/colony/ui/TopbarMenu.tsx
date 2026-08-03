// UI.STATE.1 slice 1 — the ☰ menu that absorbs the four collapsed topbar controls (spec 170 §5/§8).
//
// Slice 1 scope ONLY: Ask Kooker, Change password, Log out, 📷 snapshot — the controls the plan's
// `showInlineAccountGroup`/`showInlineSnapshot` fields hide. The fuller Escape overlay (City tab,
// Extras, the operator section) is slice 2 and is deliberately NOT started here.
//
// Interaction contract, chosen to keep slice 1 out of ColonyApp's global key handling:
//   - opens/closes on the ☰ button;
//   - closes on backdrop click and after any item;
//   - does NOT bind Escape. ColonyApp's Escape chain (race → pointer lock → first person) has a
//     documented priority order that spec 170 says must be preserved; wiring a menu into it is
//     slice-2 work, not a topbar edit.
//
// Styling stays inline and minimal, the codebase's overlay idiom (HqReceptionView, the corner
// actions), with `env(safe-area-inset-*)` so the sheet clears notches — the convention colony.css
// already uses for the topbar's neighbours.
import { useState } from "react";

export interface TopbarMenuProps {
  /** Offer "Change password" only for a real logged-in account (mirrors the inline button's gate). */
  readonly hasRealAccount: boolean;
  readonly onChangePassword: () => void;
  readonly onLogout: () => void;
  readonly onSnapshot: () => void;
}

const ITEM_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 14px",
  background: "none",
  border: "none",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
};

export function TopbarMenu({
  hasRealAccount,
  onChangePassword,
  onLogout,
  onSnapshot,
}: TopbarMenuProps) {
  const [open, setOpen] = useState(false);
  const closeAnd = (fn?: () => void) => () => {
    setOpen(false);
    fn?.();
  };
  return (
    <div className="group" style={{ position: "relative" }}>
      <button
        data-testid="topbar-menu"
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={open ? "on" : ""}
        onClick={() => setOpen((o) => !o)}
      >
        ☰
      </button>
      {open && (
        <>
          {/* Backdrop: any click outside the sheet closes it. z-index sits under the sheet. */}
          <div
            data-testid="topbar-menu-backdrop"
            onClick={closeAnd()}
            style={{ position: "fixed", inset: 0, zIndex: 58 }}
          />
          <div
            role="menu"
            data-testid="topbar-menu-sheet"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: `max(0px, env(safe-area-inset-right))`,
              zIndex: 59,
              minWidth: 200,
              padding: 6,
              borderRadius: 12,
              border: "1px solid #3a4550",
              background: "#161b21",
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            }}
          >
            <a
              role="menuitem"
              style={ITEM_STYLE}
              href="/ask-kooker.html"
              title="Open the Ask Kooker board"
              onClick={closeAnd()}
            >
              Ask Kooker
            </a>
            {hasRealAccount && (
              <button
                role="menuitem"
                style={ITEM_STYLE}
                title="Change your CityLife password"
                onClick={closeAnd(onChangePassword)}
              >
                Change password
              </button>
            )}
            <button
              role="menuitem"
              style={ITEM_STYLE}
              title="Save a PNG snapshot of the city"
              onClick={closeAnd(onSnapshot)}
            >
              📷 Snapshot
            </button>
            <button
              role="menuitem"
              style={ITEM_STYLE}
              title="Sign out of CityLife"
              onClick={closeAnd(onLogout)}
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
