// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import {
  validateAuthoritativeStarterManifest,
  extractAuthoritativeNeighbourhoodKeys,
  WorldLayoutBootCoordinator,
  HttpRemoteWorldLayoutLoader,
  type WorldLayoutBootStore,
  type RemoteStarterCatalogueManifest,
} from "../src/colony/worldLayoutBoot";
import {
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import type { WorldLayoutSaveResult } from "../src/colony/worldLayoutStore";
import { ColonyRuntime } from "../src/colony/runtime";
import { MultiplayerClient } from "../src/colony/multiplayer/multiplayerClient";

const actualReviewedV4FixtureUrl = new URL(
  "../fixtures/canonical-world/seed-4242-starter-parcel-manifest-57f-v4-candidate.json",
  import.meta.url,
);
const olderR1FixtureUrl = new URL(
  "../fixtures/canonical-world/seed-4242-starter-parcel-manifest-r1-physical-candidate.json",
  import.meta.url,
);
const actualReviewedV4ManifestJson: RemoteStarterCatalogueManifest = JSON.parse(
  readFileSync(actualReviewedV4FixtureUrl, "utf8"),
);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason?: string) {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

/** Synthetic unit fixture generator for controlled negative permutations */
function makeSyntheticDocument(worldId = "seed-4242"): WorldLayoutDocument {
  return createWorldLayoutDocument({
    worldId,
    seed: 4242,
    revision: {
      number: 1,
      parentHash:
        "faa03550dc29e2a20f9c8f339ad6d919d278ccd4ce027370f40c51610fce9749",
    },
    frames: [
      {
        id: `${worldId}:surface`,
        address: `spatial://citylife/${worldId}/surface`,
        kind: "region",
        layer: "surface",
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        grid: {
          width: 608,
          height: 608,
          cellSize: 4,
          origin: { x: -1216, y: 0, z: -1216 },
        },
      },
    ],
    placements: [],
    roads: [],
    ways: [],
    terrainEdits: [],
    portals: [],
  });
}

/** Synthetic unit manifest generator for controlled negative permutations */
function makeSyntheticV4Manifest(
  doc: WorldLayoutDocument,
  overrides: Partial<RemoteStarterCatalogueManifest> = {},
): RemoteStarterCatalogueManifest {
  return {
    schemaVersion: "citylife.starter-parcel-manifest/v1",
    status: "PUBLISHED",
    worldId: doc.worldId,
    sourceLayoutRevision: doc.revision.parentHash ?? "",
    layoutRevision: doc.revision.contentHash,
    layout: {
      schemaVersion: "citylife.world-layout/v1",
      layoutId: doc.worldId,
      seed: 4242,
      generator: doc.generator,
      revision: {
        number: doc.revision.number,
        parentHash: doc.revision.parentHash ?? "",
        contentHash: doc.revision.contentHash,
      },
      frames: doc.frames as any,
      zones: [],
      reservations: [],
      placements: [],
    } as any,
    plots: [
      { plotId: "wood1_lot_1", geometry: { neighbourhoodKey: "wood1" } },
      { plotId: "wood1_lot_2", geometry: { neighbourhoodKey: "wood1" } },
      { plotId: "wood2_lot_1", neighbourhoodKey: "wood2" },
      { plotId: "wood3_lot_1", geometry: { neighbourhoodKey: "wood3" } },
    ],
    ...overrides,
  };
}

describe("Authoritative Neighbourhood Wire Identity & Negotiation", () => {
  const originalWebSocket = (globalThis as any).WebSocket;
  const originalWindow = (globalThis as any).window;
  let sharedRuntime: ColonyRuntime;

  beforeAll(() => {
    sharedRuntime = new ColonyRuntime(4242);
  }, 60000);

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).window = {
      location: {
        protocol: "http:",
        host: "127.0.0.1:8080",
        hostname: "127.0.0.1",
        search: "",
      },
    };
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).window = originalWindow;
    vi.unstubAllGlobals();
  });

  describe("Actual Reviewed 57f V4 Boot Pipeline -> Loader -> Coordinator -> Runtime -> Multiplayer", () => {
    it("asserts SHA-256 identity of current reviewed 57f V4 candidate fixture and preserved older R1 fixture", () => {
      const v4Raw = readFileSync(actualReviewedV4FixtureUrl);
      const v4Hash = createHash("sha256").update(v4Raw).digest("hex");
      expect(v4Hash).toBe(
        "69b6345495efe68bfd6b1cfadeab085c82418b580a24f7ed1810176e706520d8",
      );

      const r1Raw = readFileSync(olderR1FixtureUrl);
      const r1Hash = createHash("sha256").update(r1Raw).digest("hex");
      expect(r1Hash).toBe(
        "4df43688b8ec5e9a2fc68af662fde88cf8b0f26e02bc932dc21fef59f8a3673a",
      );
    });

    it("proves actual reviewed 57f V4 manifest handoff through normal boot to enableMultiplayer positive", async () => {
      // 1. Mock fetch returns the exact committed physical candidate manifest
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          published: true,
          manifest: actualReviewedV4ManifestJson,
        }),
      }));
      vi.stubGlobal("fetch", mockFetch);

      // 2. Set up loader, runtime, and boot coordinator with committed fixture
      const loader = new HttpRemoteWorldLayoutLoader({
        baseUrl: "http://127.0.0.1:8080",
        getToken: () => "mock-jwt-token",
      });

      const runtime = sharedRuntime;
      runtime.setAuthClient({
        getValidToken: async () => "mock-jwt-token",
      } as any);
      runtime.setOperatorUserId("driver@citylife.local");

      const store: WorldLayoutBootStore = {
        load: vi.fn(async () => null),
        save: vi.fn(
          async (): Promise<WorldLayoutSaveResult> => ({
            status: "saved" as const,
            revision: {
              worldId: "seed-4242",
              sequence: 1,
              layoutRevision: actualReviewedV4ManifestJson.layoutRevision,
              document: parseWorldLayoutDocument(
                JSON.stringify(actualReviewedV4ManifestJson.layout),
              ),
            },
          }),
        ),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "seed-4242",
        store,
        remoteLoader: loader,
        requireRemoteAuthority: true,
        requireTransitAuthority: true,
        runtime: {
          captureWorldLayout: () => runtime.captureWorldLayout(),
          hydrateWorldLayout: (doc) => runtime.hydrateWorldLayout(doc),
          exportCanonicalTransitAuthority: (doc) =>
            runtime.exportCanonicalTransitAuthority(doc),
          setStarterCatalogueManifest: (manifest) =>
            runtime.setStarterCatalogueManifest(manifest),
        },
      });

      // 3. Normal boot executes published authority handoff
      const bootResult = await coordinator.boot();
      expect(bootResult.ready).toBe(true);
      expect(bootResult.source).toBe("canonical_remote");
      expect(bootResult.worldId).toBe("seed-4242");

      // 4. Runtime binds authoritative neighbourhood keys
      const authoritativeKeys = runtime.getAuthoritativeNeighbourhoods();
      expect(authoritativeKeys).toEqual(["wood1", "wood2", "wood3"]);

      // 5. Normal enableMultiplayer derives canonical primary default 'wood1'
      runtime.enableMultiplayer(
        "PROOF_ROOM_01",
        "ws://127.0.0.1:8080/api/v1/citylife/ws",
      );

      const mp = runtime.getMultiplayerClient();
      expect(mp).not.toBeNull();
      await mp!.connect();

      // 6. Connects websocket with matching wire fields
      expect(MockWebSocket.instances.length).toBe(1);
      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();

      expect(ws.sent[0]).toMatchObject({
        type: "join_session",
        inviteCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        layoutRevision: `wl:v1:1:${actualReviewedV4ManifestJson.layoutRevision}`,
        neighbourhoodKey: "wood1",
      });

      // 7. Server acknowledges session
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session_joined",
          sessionId: "sess-v4-proof",
          inviteCode: "PROOF_ROOM_01",
          participantId: "part-driver",
          worldId: "seed-4242",
          layoutRevision: `wl:v1:1:${actualReviewedV4ManifestJson.layoutRevision}`,
          neighbourhoodKey: "wood1",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "driving",
          participants: [],
        }),
      });

      const sessionInfo = mp!.getSessionInfo();
      expect(sessionInfo.worldId).toBe("seed-4242");
      expect(sessionInfo.layoutRevision).toBe(
        `wl:v1:1:${actualReviewedV4ManifestJson.layoutRevision}`,
      );
      expect(sessionInfo.neighbourhoodKey).toBe("wood1");
      expect(mp!.getStatus()).toBe("connected");

      runtime.disableMultiplayer();
    });

    it("rejects wrong world through normal boot pipeline (consumer negative control)", async () => {
      const wrongWorldManifest = {
        ...actualReviewedV4ManifestJson,
        worldId: "seed-9999",
      };

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          published: true,
          manifest: wrongWorldManifest,
        }),
      }));
      vi.stubGlobal("fetch", mockFetch);

      const loader = new HttpRemoteWorldLayoutLoader({
        baseUrl: "http://127.0.0.1:8080",
        getToken: () => "mock-jwt-token",
      });

      const store: WorldLayoutBootStore = {
        load: vi.fn(async () => null),
        save: vi.fn(
          async (): Promise<WorldLayoutSaveResult> => ({
            status: "saved" as const,
            revision: {} as any,
          }),
        ),
      };

      const mockRuntime = {
        captureWorldLayout: vi.fn(),
        hydrateWorldLayout: vi.fn(),
        exportCanonicalTransitAuthority: vi.fn(),
        setStarterCatalogueManifest: vi.fn(),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "seed-4242",
        store,
        remoteLoader: loader,
        requireRemoteAuthority: true,
        runtime: mockRuntime,
      });

      await expect(coordinator.boot()).rejects.toThrow(
        /Remote starter catalogue seed-9999 does not match world seed-4242/,
      );
      expect(mockRuntime.setStarterCatalogueManifest).not.toHaveBeenCalled();
    });

    it("rejects wrong revision hash through normal boot pipeline (consumer negative control)", async () => {
      const wrongRevManifest = {
        ...actualReviewedV4ManifestJson,
        layoutRevision:
          "0000000000000000000000000000000000000000000000000000000000000000",
      };

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          published: true,
          manifest: wrongRevManifest,
        }),
      }));
      vi.stubGlobal("fetch", mockFetch);

      const loader = new HttpRemoteWorldLayoutLoader({
        baseUrl: "http://127.0.0.1:8080",
        getToken: () => "mock-jwt-token",
      });

      const store: WorldLayoutBootStore = {
        load: vi.fn(async () => null),
        save: vi.fn(
          async (): Promise<WorldLayoutSaveResult> => ({
            status: "saved" as const,
            revision: {} as any,
          }),
        ),
      };

      const mockRuntime = {
        captureWorldLayout: vi.fn(),
        hydrateWorldLayout: vi.fn(),
        exportCanonicalTransitAuthority: vi.fn(),
        setStarterCatalogueManifest: vi.fn(),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "seed-4242",
        store,
        remoteLoader: loader,
        requireRemoteAuthority: true,
        runtime: mockRuntime,
      });

      await expect(coordinator.boot()).rejects.toThrow(
        /does not match document contentHash/,
      );
      expect(mockRuntime.setStarterCatalogueManifest).not.toHaveBeenCalled();
    });
  });

  describe("validateAuthoritativeStarterManifest (Synthetic Unit Permutations)", () => {
    it("validates synthetic V4 manifest positive shape", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(true);
      expect(result.keys).toEqual(["wood1", "wood2", "wood3"]);
      expect(result.error).toBeUndefined();
    });

    it("rejects same hash on different worldId (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc, { worldId: "seed-9999" });

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("WORLD_ID_MISMATCH");
    });

    it("rejects inner layout layoutId mismatch against active layout (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);
      (manifest.layout as any).layoutId = "seed-9999";

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("WORLD_ID_MISMATCH");
    });

    it("rejects stale/replaced revision hash (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc, {
        layoutRevision:
          "0000000000000000000000000000000000000000000000000000000000000000",
      });

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("REVISION_HASH_MISMATCH");
    });

    it("rejects revision number wire mismatch (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);
      (manifest.layout.revision as any).number = 99;

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("REVISION_WIRE_IDENTITY_MISMATCH");
    });

    it("rejects parent revision hash mismatch (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);
      (manifest.layout.revision as any).parentHash =
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("REVISION_WIRE_IDENTITY_MISMATCH");
    });

    it("rejects top-level sourceLayoutRevision mismatch when present (consumer negative)", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc, {
        sourceLayoutRevision:
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      });

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("PARENT_REVISION_HASH_MISMATCH");
    });

    it("rejects missing inner layout revision object", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);
      delete (manifest.layout as any).revision;

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("MISSING_MANIFEST_REVISION");
    });

    it("rejects malformed inner layout revision fields", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);
      (manifest.layout.revision as any).number = "not-a-number";

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("MALFORMED_MANIFEST_REVISION");
    });

    it("rejects manifest with no valid neighbourhood keys", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc, { plots: [] });

      const result = validateAuthoritativeStarterManifest(manifest, doc);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("NO_NEIGHBOURHOOD_KEYS");
    });

    it("rejects when active layout document is null or uncommitted", () => {
      const doc = makeSyntheticDocument("seed-4242");
      const manifest = makeSyntheticV4Manifest(doc);

      const result = validateAuthoritativeStarterManifest(manifest, null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("NO_ACTIVE_LAYOUT");
    });
  });

  describe("ColonyRuntime Authority Staging & Lifecycle Binding", () => {
    let runtime: ColonyRuntime;
    let baseDoc: WorldLayoutDocument;

    function makeDoc(
      overrides: Partial<WorldLayoutDocument> = {},
    ): WorldLayoutDocument {
      return createWorldLayoutDocument({
        ...baseDoc,
        placements: [],
        roads: [],
        ways: [],
        terrainEdits: [],
        portals: [],
        ...overrides,
      });
    }

    beforeEach(() => {
      runtime = sharedRuntime;
      runtime.disableMultiplayer();
      baseDoc = runtime.captureWorldLayout();
    });

    it("respects production boot order: staged manifest is NOT usable until hydration succeeds", () => {
      runtime.setOperatorUserId("pilot@citylife.local");
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      // Staged before hydration
      runtime.setStarterCatalogueManifest(manifest);
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([]);

      // Committed via hydration
      runtime.hydrateWorldLayout(doc);
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([
        "wood1",
        "wood2",
        "wood3",
      ]);
    });

    it("clears manifest and authoritative keys on user logout / identity switch", () => {
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      runtime.setOperatorUserId("pilot@citylife.local");
      runtime.hydrateWorldLayout(doc);
      runtime.setStarterCatalogueManifest(manifest);
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([
        "wood1",
        "wood2",
        "wood3",
      ]);

      // User logs out
      runtime.setOperatorUserId(null);
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([]);
      expect(runtime.getStarterCatalogueManifest()).toBeNull();
    });

    it("clears manifest when active layout is replaced by a newer revision", () => {
      const doc1 = makeDoc();
      const manifest1 = makeSyntheticV4Manifest(doc1);

      runtime.setOperatorUserId("pilot@citylife.local");
      runtime.hydrateWorldLayout(doc1);
      runtime.setStarterCatalogueManifest(manifest1);
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([
        "wood1",
        "wood2",
        "wood3",
      ]);

      // Revision is advanced via adoptWorldLayoutRevision
      const doc2 = makeDoc({
        revision: {
          number: 2,
          parentHash: doc1.revision.contentHash,
          contentHash: "new-content-hash-rev2",
        },
      });

      runtime.adoptWorldLayoutRevision(doc2);
      // Older manifest1 no longer matches doc2
      expect(runtime.getAuthoritativeNeighbourhoods()).toEqual([]);
      expect(runtime.getStarterCatalogueManifest()).toBeNull();
    });

    it("resolves default canonical primary neighbourhood as first sorted key", () => {
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      runtime.hydrateWorldLayout(doc);
      runtime.setStarterCatalogueManifest(manifest);

      const resolved = runtime.resolveAuthoritativeNeighbourhood();
      expect(resolved).toEqual({
        neighbourhoodKey: "wood1",
        isExplicit: false,
      });
    });

    it("resolves explicit valid neighbourhood selection", () => {
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      runtime.hydrateWorldLayout(doc);
      runtime.setStarterCatalogueManifest(manifest);

      const resolved = runtime.resolveAuthoritativeNeighbourhood("wood2");
      expect(resolved).toEqual({
        neighbourhoodKey: "wood2",
        isExplicit: true,
      });
    });

    it("fails closed on explicit invalid neighbourhood (reproducing old citylife-central defect)", () => {
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      runtime.hydrateWorldLayout(doc);
      runtime.setStarterCatalogueManifest(manifest);

      const resolved =
        runtime.resolveAuthoritativeNeighbourhood("citylife-central");
      expect(resolved).toBeNull();
    });

    it("creates an error client and visible failed status when enabling multiplayer with invalid neighbourhood", () => {
      const doc = makeDoc();
      const manifest = makeSyntheticV4Manifest(doc);

      runtime.setOperatorUserId("pilot@citylife.local");
      runtime.hydrateWorldLayout(doc);
      runtime.setStarterCatalogueManifest(manifest);

      runtime.enableMultiplayer(
        "room-1",
        "ws://127.0.0.1:8080/api/v1/citylife/ws",
        "citylife-central",
      );
      const mp = runtime.getMultiplayerClient();
      expect(mp).not.toBeNull();
      expect(mp?.getStatus()).toBe("error");
      runtime.disableMultiplayer();
    });
  });

  describe("MultiplayerClient Bounded Negotiation Flow", () => {
    it("Scenario A: auto-negotiates room neighbourhood ONCE when no explicit intent", async () => {
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "jwt-token-1",
        userId: "pilot@citylife.local",
        username: "pilot",
        roomCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        neighbourhoodKey: "wood1",
        explicitNeighbourhood: false,
        getValidNeighbourhoods: () => ["wood1", "wood2", "wood3"],
      });

      const connectPromise = client.connect();
      expect(MockWebSocket.instances.length).toBe(1);
      const ws1 = MockWebSocket.instances[0];

      // Open ws1
      ws1.readyState = MockWebSocket.OPEN;
      ws1.onopen?.();

      expect(ws1.sent[0]).toMatchObject({
        type: "join_session",
        inviteCode: "PROOF_ROOM_01",
        neighbourhoodKey: "wood1",
      });

      // Server responds with mismatch advertising wood2
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood wood2",
        }),
      });

      // Client closes ws1 and creates ws2 with wood2
      expect(MockWebSocket.instances.length).toBe(2);
      const ws2 = MockWebSocket.instances[1];
      ws2.readyState = MockWebSocket.OPEN;
      ws2.onopen?.();

      expect(ws2.sent[0]).toMatchObject({
        type: "join_session",
        inviteCode: "PROOF_ROOM_01",
        neighbourhoodKey: "wood2",
      });

      // Server accepts join on ws2
      ws2.onmessage?.({
        data: JSON.stringify({
          type: "session_joined",
          sessionId: "sess-1",
          inviteCode: "PROOF_ROOM_01",
          participantId: "part-1",
          worldId: "seed-4242",
          neighbourhoodKey: "wood2",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "driving",
          participants: [],
        }),
      });

      expect(client.getStatus()).toBe("connected");
      expect(client.getSessionInfo().neighbourhoodKey).toBe("wood2");
    });

    it("Scenario B: fails closed without negotiation when user had explicit neighbourhood intent", async () => {
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "jwt-token-1",
        userId: "pilot@citylife.local",
        username: "pilot",
        roomCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        neighbourhoodKey: "wood2",
        explicitNeighbourhood: true,
        getValidNeighbourhoods: () => ["wood1", "wood2", "wood3"],
      });

      void client.connect();
      expect(MockWebSocket.instances.length).toBe(1);
      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();

      // Server responds with mismatch advertising wood1
      ws.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood wood1",
        }),
      });

      // No second connection is made
      expect(MockWebSocket.instances.length).toBe(1);
      expect(client.getStatus()).toBe("error");
    });

    it("Scenario C: bounds negotiation strictly to ONCE per admission attempt (no infinite loop)", async () => {
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "jwt-token-1",
        userId: "pilot@citylife.local",
        username: "pilot",
        roomCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        neighbourhoodKey: "wood1",
        explicitNeighbourhood: false,
        getValidNeighbourhoods: () => ["wood1", "wood2", "wood3"],
      });

      void client.connect();
      const ws1 = MockWebSocket.instances[0];
      ws1.readyState = MockWebSocket.OPEN;
      ws1.onopen?.();

      // First mismatch -> auto-negotiates to wood2
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood wood2",
        }),
      });

      expect(MockWebSocket.instances.length).toBe(2);
      const ws2 = MockWebSocket.instances[1];
      ws2.readyState = MockWebSocket.OPEN;
      ws2.onopen?.();

      // Server sends another mismatch (e.g. repeated mismatch)
      ws2.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood wood3",
        }),
      });

      // Negotiation is bound to ONCE; no third socket is created
      expect(MockWebSocket.instances.length).toBe(2);
      expect(client.getStatus()).toBe("error");
    });

    it("Scenario D: fails closed on malformed or unverified advertised key", async () => {
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "jwt-token-1",
        userId: "pilot@citylife.local",
        username: "pilot",
        roomCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        neighbourhoodKey: "wood1",
        explicitNeighbourhood: false,
        getValidNeighbourhoods: () => ["wood1", "wood2", "wood3"],
      });

      void client.connect();
      const ws1 = MockWebSocket.instances[0];
      ws1.readyState = MockWebSocket.OPEN;
      ws1.onopen?.();

      // Server sends error with unknown neighbourhood not in published catalogue
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood unauthorized-hood",
        }),
      });

      // No retry
      expect(MockWebSocket.instances.length).toBe(1);
      expect(client.getStatus()).toBe("error");
    });

    it("Scenario E: pending old join does NOT reconnect or mutate options when world/revision changed", async () => {
      const runtime = sharedRuntime;
      runtime.disableMultiplayer();
      const baseDoc = runtime.captureWorldLayout();
      const doc1 = createWorldLayoutDocument({
        ...baseDoc,
        revision: {
          number: 1,
          parentHash: baseDoc.revision.parentHash,
        },
        placements: [],
        roads: [],
        ways: [],
        terrainEdits: [],
        portals: [],
      });
      const manifest1 = makeSyntheticV4Manifest(doc1);

      runtime.setOperatorUserId("pilot@citylife.local");
      runtime.hydrateWorldLayout(doc1);
      runtime.setStarterCatalogueManifest(manifest1);

      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "jwt-token-1",
        userId: "pilot@citylife.local",
        username: "pilot",
        roomCode: "PROOF_ROOM_01",
        worldId: "seed-4242",
        layoutRevision: doc1.revision.contentHash,
        neighbourhoodKey: "wood1",
        explicitNeighbourhood: false,
        getValidNeighbourhoods: (w, rev) =>
          runtime.getAuthoritativeNeighbourhoods(w, rev),
      });

      void client.connect();
      expect(MockWebSocket.instances.length).toBe(1);
      const ws1 = MockWebSocket.instances[0];
      ws1.readyState = MockWebSocket.OPEN;
      ws1.onopen?.();

      // Now runtime adopts a new revision of the world (with identical hood keys wood1, wood2, wood3)
      const doc2 = createWorldLayoutDocument({
        ...baseDoc,
        revision: {
          number: 2,
          parentHash: doc1.revision.contentHash,
        },
        placements: [],
        roads: [],
        ways: [],
        terrainEdits: [],
        portals: [],
      });
      const manifest2 = makeSyntheticV4Manifest(doc2);
      runtime.adoptWorldLayoutRevision(doc2);
      runtime.setStarterCatalogueManifest(manifest2);

      // Now old socket receives NEIGHBOURHOOD_MISMATCH from the old session
      ws1.onmessage?.({
        data: JSON.stringify({
          type: "error",
          error: "NEIGHBOURHOOD_MISMATCH",
          message: "Session belongs to neighbourhood wood2",
        }),
      });

      // Because client options.layoutRevision belonged to doc1, runtime.getAuthoritativeNeighbourhoods returned []!
      // No second socket is created, options.neighbourhoodKey is NOT mutated, client transitions to error.
      expect(MockWebSocket.instances.length).toBe(1);
      expect(client.getStatus()).toBe("error");
      expect((client as any).options.neighbourhoodKey).toBe("wood1");
      expect(client.getSessionInfo().neighbourhoodKey).toBeNull();

      client.disconnect();
      runtime.disableMultiplayer();
    });
  });
});
