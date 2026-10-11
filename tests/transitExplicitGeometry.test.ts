// @ts-ignore
import { createHash } from "node:crypto";
// @ts-ignore
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  CANONICAL_TRANSIT_SCHEMA_VERSION,
  CANONICAL_TRANSIT_GEOMETRY_CAPABILITY,
  validateCanonicalTransitAuthority,
  canonicalTransitMatches,
  type CanonicalTransitAuthority,
} from "../src/colony/transit/canonicalTransit";
import { WorldLayoutBootCoordinator } from "../src/colony/worldLayoutBoot";

const r0Url = new URL(
  "../fixtures/canonical-world/seed-4242-layout-r0.json",
  import.meta.url,
);
const r1Url = new URL(
  "../fixtures/canonical-world/seed-4242-starter-parcel-manifest-r1-physical-candidate.json",
  import.meta.url,
);

describe("Transit Explicit Geometry Contract (citylife.transit/v1 explicit-paths-v1)", () => {
  it("exports explicit-paths-v1 with 5 curved bays, spur, site, and 5 stop anchors on R0", () => {
    const raw = readFileSync(r0Url, "utf8");
    const doc = JSON.parse(raw);
    const rt = new ColonyRuntime(4242);
    rt.hydrateWorldLayout(doc);

    const auth = rt.exportCanonicalTransitAuthority();
    expect(auth).not.toBeNull();
    expect(auth!.schemaVersion).toBe(CANONICAL_TRANSIT_SCHEMA_VERSION);
    expect(auth!.geometryCapability).toBe(CANONICAL_TRANSIT_GEOMETRY_CAPABILITY);
    expect(auth!.worldId).toBe(doc.layoutId);
    expect(auth!.layoutRevision).toBe(doc.revision.contentHash);

    // Route loop & stops
    expect(auth!.route.loop.length).toBe(2158);
    expect(auth!.route.stops.length).toBe(5);
    expect(auth!.route.stopAnchors).toBeDefined();
    expect(auth!.route.stopAnchors!.length).toBe(5);

    // Stop0 loop wrap: arc > loop total length (~1817.08m)
    const stop0 = auth!.route.stopAnchors![0]!;
    expect(stop0.arc).toBeGreaterThan(1817.0);
    expect(stop0.arc).toBeLessThan(1825.0);

    // Depot site, spur, bays
    expect(auth!.depot.site).toBeDefined();
    expect(auth!.depot.site!.x).toBe(181);
    expect(auth!.depot.site!.y).toBe(299);
    expect(auth!.depot.site!.w).toBe(12);
    expect(auth!.depot.site!.h).toBe(7);
    expect(auth!.depot.site!.inward).toEqual({ x: 0, y: 1 });

    expect(auth!.depot.spur).toBeDefined();
    expect(auth!.depot.spur!.length).toBeGreaterThanOrEqual(2);
    expect(auth!.depot.spur![0]).toEqual(auth!.depot.gate);
    expect(auth!.depot.spur![auth!.depot.spur!.length - 1]).toEqual(auth!.depot.roadCell);

    expect(auth!.depot.bays).toBeDefined();
    expect(auth!.depot.bays!.length).toBe(5);
    for (let k = 0; k < 5; k++) {
      const bay = auth!.depot.bays![k]!;
      expect(bay.bayIndex).toBe(k);
      expect(bay.path.length).toBeGreaterThanOrEqual(3);
      expect(bay.path[0]).toEqual(auth!.depot.gate);
      expect(bay.path[bay.path.length - 1]).toEqual(bay.park);
    }

    const validation = validateCanonicalTransitAuthority(
      auth,
      doc.layoutId,
      doc.revision.contentHash,
      5,
      true,
    );
    expect(validation.valid).toBe(true);
  });

  it("exports explicit-paths-v1 with 5 curved bays, spur, site, and 5 stop anchors on R1", () => {
    const raw = readFileSync(r1Url, "utf8");
    const manifest = JSON.parse(raw);
    const doc = manifest.layout;
    const rt = new ColonyRuntime(4242);
    rt.hydrateWorldLayout(doc);

    const auth = rt.exportCanonicalTransitAuthority();
    expect(auth).not.toBeNull();
    expect(auth!.geometryCapability).toBe(CANONICAL_TRANSIT_GEOMETRY_CAPABILITY);

    const validation = validateCanonicalTransitAuthority(
      auth,
      doc.layoutId,
      doc.revision.contentHash,
      5,
      true,
    );
    expect(validation.valid).toBe(true);

    // Round-trip semantic match against independently serialized copy
    const serialized = JSON.parse(JSON.stringify(auth));
    expect(canonicalTransitMatches(auth, serialized)).toBe(true);

    // Negative control: altered input rejected
    const altered = JSON.parse(JSON.stringify(auth));
    altered.depot.bays[0].path[1].x += 0.5;
    expect(canonicalTransitMatches(auth, altered)).toBe(false);
  });

  it("fails closed on missing explicit geometry when requireExplicitGeometry is true", () => {
    const legacyAuth: CanonicalTransitAuthority = {
      schemaVersion: CANONICAL_TRANSIT_SCHEMA_VERSION,
      worldId: "seed-4242",
      layoutRevision: "abc123",
      route: {
        loop: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        stops: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      depot: {
        gate: { x: 5, y: 5 },
        roadCell: { x: 5, y: 4 },
        baysTotal: 5,
      },
    };

    // Valid under legacy lax mode
    expect(validateCanonicalTransitAuthority(legacyAuth, "seed-4242", "abc123", 5, false).valid).toBe(true);

    // Fails closed when requireExplicitGeometry is true
    const res = validateCanonicalTransitAuthority(legacyAuth, "seed-4242", "abc123", 5, true);
    expect(res.valid).toBe(false);
    expect(res.error).toBe("CANONICAL_TRANSIT_UNUSABLE");
  });

  it("fails closed on fractional baysTotal, non-finite coordinates, and mismatched stop cell", () => {
    const validBase: CanonicalTransitAuthority = {
      schemaVersion: CANONICAL_TRANSIT_SCHEMA_VERSION,
      geometryCapability: CANONICAL_TRANSIT_GEOMETRY_CAPABILITY,
      worldId: "seed-4242",
      layoutRevision: "abc123",
      route: {
        loop: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        stops: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        stopAnchors: [
          {
            cell: { x: 0, y: 0 },
            arc: 0,
            at: { x: 0, y: 0 },
            heading: 0,
            verge: { x: 0, y: 1 },
            furniture: { x: 0, y: 2.25 },
          },
          {
            cell: { x: 10, y: 10 },
            arc: 20,
            at: { x: 10, y: 10 },
            heading: 1.57,
            verge: { x: -1, y: 0 },
            furniture: { x: 7.75, y: 10 },
          },
        ],
      },
      depot: {
        gate: { x: 5, y: 5 },
        roadCell: { x: 5, y: 4 },
        baysTotal: 5,
        site: {
          x: 4,
          y: 5,
          w: 12,
          h: 7,
          inward: { x: 0, y: 1 },
        },
        spur: [
          { x: 5, y: 5 },
          { x: 5, y: 4 },
        ],
        bays: [0, 1, 2, 3, 4].map((k) => ({
          bayIndex: k,
          park: { x: 4 + k, y: 10 },
          heading: 1.57,
          path: [
            { x: 5, y: 5 },
            { x: 4 + k, y: 8 },
            { x: 4 + k, y: 10 },
          ],
        })),
      },
    };

    expect(validateCanonicalTransitAuthority(validBase, "seed-4242", "abc123", 5, true).valid).toBe(true);

    // Negative 1: Fractional baysTotal
    const fractionalBays = { ...validBase, depot: { ...validBase.depot, baysTotal: 5.5 } };
    expect(validateCanonicalTransitAuthority(fractionalBays, "seed-4242", "abc123", 5, true).valid).toBe(false);

    // Negative 2: Mismatched stop anchor cell
    const mismatchedAnchor = {
      ...validBase,
      route: {
        ...validBase.route,
        stopAnchors: [
          { ...validBase.route.stopAnchors![0]!, cell: { x: 999, y: 999 } },
          validBase.route.stopAnchors![1]!,
        ],
      },
    };
    expect(validateCanonicalTransitAuthority(mismatchedAnchor, "seed-4242", "abc123", 5, true).valid).toBe(false);

    // Negative 3: Non-finite bay coordinate
    const nonFiniteBay = {
      ...validBase,
      depot: {
        ...validBase.depot,
        bays: [
          { ...validBase.depot.bays![0]!, park: { x: NaN, y: 10 } },
          ...validBase.depot.bays!.slice(1),
        ],
      },
    };
    expect(validateCanonicalTransitAuthority(nonFiniteBay, "seed-4242", "abc123", 5, true).valid).toBe(false);
  });

  it("atomic boot: rejects altered transit authority before saving to store or mutating active runtime", async () => {
    const raw = readFileSync(r1Url, "utf8");
    const manifest = JSON.parse(raw);
    const doc = manifest.layout;
    const producer = new ColonyRuntime(4242);
    producer.hydrateWorldLayout(doc);
    const validAuth = producer.exportCanonicalTransitAuthority();
    expect(validAuth).not.toBeNull();

    // 1. Altered transit authority: bay point moved
    const alteredAuth = JSON.parse(JSON.stringify(validAuth));
    alteredAuth.depot.bays[0].path[1].x += 1;

    const runtime = new ColonyRuntime(4242);
    const beforeHash = runtime.captureWorldLayout().revision.contentHash;
    let saves = 0;
    let savedDoc: any = null;
    const store = {
      load: async () => null,
      save: async (input: any) => {
        saves++;
        savedDoc = input;
        return {
          status: "saved",
          revision: { worldId: doc.layoutId, layoutRevision: doc.revision.contentHash, sequence: 0, document: doc },
        };
      },
    };
    const remoteLoader = {
      loadRemoteStarterCatalogue: async () => ({
        published: true,
        manifest: {
          ...manifest,
          worldId: doc.layoutId,
          layoutRevision: doc.revision.contentHash,
          layout: doc,
          transit: alteredAuth,
        },
      }),
    };

    const boot = new WorldLayoutBootCoordinator({
      worldId: doc.layoutId,
      store: store as any,
      runtime: runtime as any,
      remoteLoader: remoteLoader as any,
      requireRemoteAuthority: true,
    });

    let error: any = null;
    try {
      await boot.boot();
    } catch (e: any) {
      error = e;
    }

    expect(error).not.toBeNull();
    expect(error.code).toBe("CANONICAL_TRANSIT_UNAVAILABLE");
    // Assert persistent store was NEVER saved to
    expect(saves).toBe(0);
    expect(savedDoc).toBeNull();
    // Assert active runtime was NEVER mutated
    expect(runtime.captureWorldLayout().revision.contentHash).toBe(beforeHash);

    // 2. Production ColonyApp wrapper shape forwards exportCanonicalTransitAuthority and rejects altered input
    let wrapperHydrateCalls = 0;
    const prodWrapper = {
      captureWorldLayout: () => runtime.captureWorldLayout(),
      hydrateWorldLayout: (d: any) => {
        wrapperHydrateCalls++;
        runtime.hydrateWorldLayout(d);
      },
      exportCanonicalTransitAuthority: (d?: any) =>
        runtime.exportCanonicalTransitAuthority(d),
    };
    const wrapperBoot = new WorldLayoutBootCoordinator({
      worldId: doc.layoutId,
      store: store as any,
      runtime: prodWrapper as any,
      remoteLoader: remoteLoader as any,
      requireRemoteAuthority: true,
    });
    let wrapperError: any = null;
    try {
      await wrapperBoot.boot();
    } catch (e: any) {
      wrapperError = e;
    }
    expect(wrapperError).not.toBeNull();
    expect(wrapperError.code).toBe("CANONICAL_TRANSIT_UNAVAILABLE");
    expect(saves).toBe(0);
    expect(wrapperHydrateCalls).toBe(0);

    // 3. Fail-closed: missing exportCanonicalTransitAuthority when remote transit companion is present
    const missingExporterWrapper = {
      captureWorldLayout: () => runtime.captureWorldLayout(),
      hydrateWorldLayout: (d: any) => {
        wrapperHydrateCalls++;
      },
    };
    const missingExporterBoot = new WorldLayoutBootCoordinator({
      worldId: doc.layoutId,
      store: store as any,
      runtime: missingExporterWrapper as any,
      remoteLoader: remoteLoader as any,
      requireRemoteAuthority: true,
    });
    let missingError: any = null;
    try {
      await missingExporterBoot.boot();
    } catch (e: any) {
      missingError = e;
    }
    expect(missingError).not.toBeNull();
    expect(missingError.code).toBe("CANONICAL_TRANSIT_UNAVAILABLE");
    expect(missingError.message).toContain("requires semantic validation runtime support");
    expect(saves).toBe(0);
    expect(wrapperHydrateCalls).toBe(0);

    // 4. Unchanged input succeeds through production wrapper and saves atomically
    const validLoader = {
      loadRemoteStarterCatalogue: async () => ({
        published: true,
        manifest: {
          ...manifest,
          worldId: doc.layoutId,
          layoutRevision: doc.revision.contentHash,
          layout: doc,
          transit: validAuth,
        },
      }),
    };
    const validWrapperBoot = new WorldLayoutBootCoordinator({
      worldId: doc.layoutId,
      store: store as any,
      runtime: prodWrapper as any,
      remoteLoader: validLoader as any,
      requireRemoteAuthority: true,
    });
    const result = await validWrapperBoot.boot();
    expect(result.ready).toBe(true);
    expect(saves).toBe(1);
    expect(wrapperHydrateCalls).toBe(1);
    expect(runtime.captureWorldLayout().revision.contentHash).toBe(doc.revision.contentHash);
  });
});
