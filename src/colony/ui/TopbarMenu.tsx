import { useEffect, useState } from "react";

type MenuPage = "profile" | "controls" | "friends" | "more";

export interface TopbarMenuProps {
  readonly hasRealAccount: boolean;
  readonly playerId: string | null;
  readonly firstPersonActive: boolean;
  readonly onOpenMap: () => void;
  readonly onBugReport: () => void;
  readonly onExitFirstPerson: () => void;
  readonly onChangePassword: () => void;
  readonly onLogout: () => void;
  readonly onSnapshot: () => void;
}

const PAGES: { id: MenuPage; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "controls", label: "Controls" },
  { id: "friends", label: "Friends" },
  { id: "more", label: "More" },
];

export function TopbarMenu({
  hasRealAccount,
  playerId,
  firstPersonActive,
  onOpenMap,
  onBugReport,
  onExitFirstPerson,
  onChangePassword,
  onLogout,
  onSnapshot,
}: TopbarMenuProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>("profile");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // This menu owns Escape while it is open. Do not let the world-level
        // handler also consume it and exit first-person or release pointer lock.
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const closeAnd = (action?: () => void) => () => {
    setOpen(false);
    action?.();
  };

  return (
    <>
      <button
        type="button"
        data-testid="topbar-menu"
        aria-label={open ? "Close game menu" : "Open game menu"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`topbar-menu-button${open ? " on" : ""}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        ☰
      </button>
      {open && (
        <div
          className="player-pause-menu-backdrop"
          data-testid="player-pause-menu-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="player-pause-menu"
            role="dialog"
            aria-modal="false"
            aria-labelledby="player-pause-menu-title"
            data-testid="player-pause-menu"
          >
            <header className="player-pause-menu__header">
              <div>
                <span className="player-pause-menu__eyebrow">CITYLIFE</span>
                <h2 id="player-pause-menu-title">Game menu</h2>
              </div>
              <button
                type="button"
                aria-label="Close game menu"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <nav className="player-pause-menu__tabs" aria-label="Game menu">
              <button type="button" onClick={closeAnd(onOpenMap)}>
                Map
              </button>
              {PAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={page === item.id}
                  className={page === item.id ? "on" : ""}
                  onClick={() => setPage(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="player-pause-menu__content">
              {page === "profile" && (
                <section aria-label="Player profile">
                  <h3>Profile</h3>
                  <p>
                    {playerId === null
                      ? "Sign in to load your player profile."
                      : `Player account ${playerId}`}
                  </p>
                  {firstPersonActive && (
                    <button type="button" onClick={closeAnd(onExitFirstPerson)}>
                      Exit walking view
                    </button>
                  )}
                </section>
              )}
              {page === "controls" && (
                <section aria-label="Controls">
                  <h3>Controls</h3>
                  <dl className="player-pause-menu__controls">
                    <div>
                      <dt>W A S D / arrows</dt>
                      <dd>Move</dd>
                    </div>
                    <div>
                      <dt>Shift</dt>
                      <dd>Sprint</dd>
                    </div>
                    <div>
                      <dt>E</dt>
                      <dd>Use the nearby action</dd>
                    </div>
                    <div>
                      <dt>1 / 2 / 3</dt>
                      <dd>Change camera view</dd>
                    </div>
                  </dl>
                </section>
              )}
              {page === "friends" && (
                <section aria-label="Friends and lobby">
                  <h3>Friends</h3>
                  <p>No friends are connected to this session.</p>
                  <p className="player-pause-menu__note">
                    Online multiplayer is not connected yet. City residents are
                    not shown as player friends or on your map.
                  </p>
                </section>
              )}
              {page === "more" && (
                <section aria-label="More options">
                  <h3>More</h3>
                  <a href="/ask-kooker.html">Ask Kooker</a>
                  <button type="button" onClick={closeAnd(onBugReport)}>
                    Log a reproducible bug
                  </button>
                  {hasRealAccount && (
                    <button type="button" onClick={closeAnd(onChangePassword)}>
                      Change password
                    </button>
                  )}
                  <button type="button" onClick={closeAnd(onSnapshot)}>
                    Save city snapshot
                  </button>
                  <button type="button" onClick={closeAnd(onLogout)}>
                    Log out
                  </button>
                </section>
              )}
            </div>
            <p className="player-pause-menu__world-status">
              The city keeps running while this menu is open.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
