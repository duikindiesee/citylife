import { Component, useEffect, useReducer, useState, type ReactNode } from "react";
import { getAuthClient } from "../authClient";
import { COLONY } from "../config";
import { isLocalDevAuthBypass } from "../devAuthBypass";
import { fetchPublishedStarterWorld, type PublishedPlayerInventory } from "../home/starterWorldCatalogue";

class WorldStartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main role="alert" style={{ padding: 32 }}>
      <h1>Your world could not start</h1>
      <p>The published world could not be loaded safely. Please retry.</p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </main> : this.props.children;
  }
}

/** Runs before ColonyRuntime construction, including its resident and blueprint restoration. */
export function StarterWorldGate({ children }: {
  children: (inventory?: PublishedPlayerInventory) => ReactNode;
}) {
  const bypass = isLocalDevAuthBypass() && !getAuthClient().operator;
  const [attempt, retry] = useReducer(x => x + 1, 0);
  const [state, setState] = useState<{ inventory?: PublishedPlayerInventory; error?: string }>({});
  useEffect(() => {
    if (bypass) return;
    const abort = new AbortController();
    setState({});
    void fetchPublishedStarterWorld(`seed-${COLONY.render.seed}`, abort.signal)
      .then(inventory => { if (!abort.signal.aborted) setState({ inventory }); })
      .catch(error => { if (!abort.signal.aborted) setState({ error: error instanceof Error ? error.message : "World unavailable" }); });
    return () => abort.abort();
  }, [attempt, bypass]);
  if (bypass) return children();
  if (state.inventory) return <WorldStartBoundary>{children(state.inventory)}</WorldStartBoundary>;
  return <main style={{ padding: 32, color: "#dceaff", background: "#09121f", minHeight: "100vh" }}>
    <h1>Loading your world</h1>
    <p role={state.error ? "alert" : "status"}>{state.error ?? "Checking the published neighbourhood and home sites…"}</p>
    {state.error && <button onClick={retry}>Retry</button>}
  </main>;
}
