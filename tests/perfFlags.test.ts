// Spec 158 — the perf subsystem is a debug tool. The single most important property is that
// it is OFF unless someone deliberately armed it, so that is what this file locks.
import { describe, it, expect } from "vitest";
import { resolvePerfArming } from "../src/colony/perf/perfFlags";
import {
  mergeExperiment,
  resetPerfExperimentCache,
  perfExperiment,
} from "../src/colony/perf/perfExperiment";
import { censusOf } from "../src/colony/perf/sceneCensus";

describe("resolvePerfArming", () => {
  it("is off with no query and no storage", () => {
    expect(resolvePerfArming("", null)).toBe("off");
    expect(resolvePerfArming("?skipauth=1", null)).toBe("off");
  });

  it("arms with the HUD on ?perf=1 and armed-but-hidden on ?perf=armed", () => {
    expect(resolvePerfArming("?perf=1", null)).toBe("hud");
    expect(resolvePerfArming("?perf=armed", null)).toBe("armed");
  });

  it("lets the query override stored state in both directions", () => {
    expect(resolvePerfArming("?perf=0", "1")).toBe("off");
    expect(resolvePerfArming("?perf=1", "off")).toBe("hud");
  });

  it("falls back to storage only when the query is silent", () => {
    expect(resolvePerfArming("", "armed")).toBe("armed");
    expect(resolvePerfArming("", "nonsense")).toBe("off");
  });
});

describe("perf experiment knobs", () => {
  it("defaults to the shipped behaviour", () => {
    const shipped = mergeExperiment(null);
    expect(shipped.foliage).toBe(true);
    expect(shipped.foliageShadow).toBe(true);
    expect(shipped.shadows).toBe(true);
    expect(shipped.shadowCadence).toBe(4);
    expect(shipped.postProcessing).toBe(true);
    expect(shipped.foliageCullDistance).toBe(0);
  });

  it("applies overrides but ignores wrongly typed ones", () => {
    const merged = mergeExperiment({
      foliageShadow: false,
      shadowCadence: "8" as unknown as number,
    });
    expect(merged.foliageShadow).toBe(false);
    expect(merged.shadowCadence).toBe(4);
  });

  it("reads nothing from the page when the perf flag is not armed", () => {
    resetPerfExperimentCache();
    // No window in the node test environment: the knobs must still resolve to shipped.
    expect(perfExperiment().foliageShadow).toBe(true);
    resetPerfExperimentCache();
  });
});

describe("censusOf", () => {
  it("counts live instances and separates the shadow casters", () => {
    const census = censusOf({
      name: "root",
      children: [
        {
          name: "foliage",
          isInstancedMesh: true,
          count: 75486,
          castShadow: true,
        },
        {
          name: "pedestrian-bodies",
          isInstancedMesh: true,
          count: 28,
          castShadow: true,
        },
        {
          name: "zone-tint",
          isInstancedMesh: true,
          count: 40,
          castShadow: false,
        },
        { name: "house", isMesh: true, castShadow: true },
      ],
    });
    expect(census.instances).toBe(75554);
    expect(census.shadowInstances).toBe(75514);
    expect(census.meshes).toBe(1);
    expect(census.shadowMeshes).toBe(1);
    expect(census.layers[0].name).toBe("foliage");
  });

  it("skips hidden subtrees, which cost nothing and would overstate the load", () => {
    const census = censusOf({
      name: "root",
      children: [
        {
          name: "hidden-group",
          visible: false,
          children: [{ name: "x", isInstancedMesh: true, count: 1000 }],
        },
      ],
    });
    expect(census.instances).toBe(0);
  });

  it("returns an empty census for a missing scene rather than throwing", () => {
    expect(censusOf(null).instances).toBe(0);
  });
});
