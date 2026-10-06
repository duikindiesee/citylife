import { useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ColonyRuntime } from "../../src/colony/runtime";
import { BusNetworkMiniMap } from "../../src/colony/ui/BusNetworkMiniMap";
import { canShowPlayerLocationForAccount } from "../../src/colony/ui/busNetworkMiniMapModel";

type RenderSnapshot = {
  authenticatedAccount: string;
  runtimeAccount: string;
  isCityLifePlayer: boolean;
  markerVisible: boolean;
};

declare global {
  interface Window {
    __playerMapAccountRenders?: RenderSnapshot[];
  }
}

let runtimeAccount = "player-a";
const subscribers = new Set<() => void>();
const fixtureRuntime = {
  sim: { state: { roadWays: [] } },
  busDepot: null,
  busRoute: { stops: [] },
  busPoses: () => [],
  getOwnedDrivePose: () => null,
  getUiState: () => ({
    firstPerson: {
      operatorCitizenId: `citizen-${runtimeAccount}`,
      citizenId: `citizen-${runtimeAccount}`,
    },
  }),
  fpCameraCell: { x: 10, y: 10 },
  subscribe: (listener: () => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
} as unknown as ColonyRuntime;

function Fixture() {
  const [authenticatedAccount, setAuthenticatedAccount] = useState("player-a");
  const [runtimeAccountView, setRuntimeAccountView] = useState(runtimeAccount);
  const [isCityLifePlayer, setIsCityLifePlayer] = useState(true);

  // Mirror the app's passive auth-to-runtime binding. The delay keeps the transition frame
  // observable so the assertion proves the map fails closed while the previous pose still exists.
  useEffect(() => {
    if (authenticatedAccount === runtimeAccountView) return;
    const timer = window.setTimeout(() => {
      runtimeAccount = authenticatedAccount;
      fixtureRuntime.fpCameraCell = { x: 20, y: 20 };
      setRuntimeAccountView(runtimeAccount);
      for (const notify of subscribers) notify();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [authenticatedAccount, runtimeAccountView]);

  useLayoutEffect(() => {
    const renders = (window.__playerMapAccountRenders ??= []);
    renders.push({
      authenticatedAccount,
      runtimeAccount: runtimeAccountView,
      isCityLifePlayer,
      markerVisible: !!document.querySelector(
        '[data-testid="city-map-player-marker"]',
      ),
    });
  }, [authenticatedAccount, isCityLifePlayer, runtimeAccountView]);

  return (
    <>
      <button type="button" onClick={() => setAuthenticatedAccount("player-b")}>
        Switch account to B
      </button>
      <button type="button" onClick={() => setIsCityLifePlayer(false)}>
        Switch role to operator
      </button>
      <BusNetworkMiniMap
        runtime={fixtureRuntime}
        walletLabel="Test wallet"
        presenceReadout={null}
        playerLocationAuthorized={canShowPlayerLocationForAccount({
          isCityLifePlayer,
          authenticatedAccountKey: authenticatedAccount,
          runtimeAccountKey: runtimeAccountView,
        })}
        open
        onClose={() => undefined}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
