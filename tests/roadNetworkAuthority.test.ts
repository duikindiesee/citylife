import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceBuilderAccess,
  useRoadNetwork,
} from "../src/colony/stores/useRoadNetwork";

describe("road network authority", () => {
  beforeEach(() => {
    useRoadNetwork.setState({
      tiles: {
        "1,2": { x: 1, y: 2, mask: 0, type: "street" },
      },
      landscapeEdits: new Map([["1,2", 0.25]]),
    });
  });

  it("keeps legacy road loading from performing I/O or mutating hydrated state", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("legacy loader must not fetch"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sim = {
      state: {
        roads: [{ x: 9, y: 9, kind: "gravel" }],
        roadSet: new Set(["9,9"]),
        roadKind: new Map([["9,9", "gravel"]]),
        roadsVersion: 7,
      },
    };

    await useRoadNetwork.getState().loadFromDB(sim);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useRoadNetwork.getState().tiles).toEqual({
      "1,2": { x: 1, y: 2, mask: 0, type: "street" },
    });
    expect(useRoadNetwork.getState().landscapeEdits).toEqual(
      new Map([["1,2", 0.25]]),
    );
    expect(sim.state).toEqual({
      roads: [{ x: 9, y: 9, kind: "gravel" }],
      roadSet: new Set(["9,9"]),
      roadKind: new Map([["9,9", "gravel"]]),
      roadsVersion: 7,
    });
    expect(warn).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
    warn.mockRestore();
  });
});

describe("enforceBuilderAccess (SECURITY: fail-closed builder gate)", () => {
  afterEach(() => {
    useRoadNetwork.setState({ builderActive: false, isDrawing: false });
  });

  it("forces off a stale builderActive/isDrawing left over from a prior authorized session", () => {
    useRoadNetwork.setState({ builderActive: true, isDrawing: true });

    enforceBuilderAccess(false);

    expect(useRoadNetwork.getState().builderActive).toBe(false);
    expect(useRoadNetwork.getState().isDrawing).toBe(false);
  });

  it("is a no-op once the store is already clean for a restricted session", () => {
    useRoadNetwork.setState({ builderActive: false, isDrawing: false });
    const before = useRoadNetwork.getState();

    enforceBuilderAccess(false);

    // Same state reference — setState was never called.
    expect(useRoadNetwork.getState()).toBe(before);
  });

  it("never touches builderActive/isDrawing for an authorized (canBuild) session", () => {
    useRoadNetwork.setState({ builderActive: true, isDrawing: true });

    enforceBuilderAccess(true);

    expect(useRoadNetwork.getState().builderActive).toBe(true);
    expect(useRoadNetwork.getState().isDrawing).toBe(true);
  });
});
