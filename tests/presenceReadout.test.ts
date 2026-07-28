// BUG.GEO.1 — deterministic proof for the on-screen geolocation readout.
//
// Every assertion here is written to FAIL against a specific plausible-wrong implementation, because
// a test that passes both ways proves nothing:
//   * projection is checked against the geometry the RENDERER uses (`avatarTransform` / `gridToWorld`),
//     not against the raw sim cell it was built from — a readout that agrees with the sim but not with
//     the drawn world mislocates the screenshot it exists to locate;
//   * the extent invariant is checked in BOTH directions: an inside pose must read inside (no gap) and
//     an outside pose must read outside and stay un-clamped (no overshoot);
//   * the visibility policy is checked in BOTH directions: a viewer must not receive the exact point,
//     and an authorized subject must not be over-redacted;
//   * a subject with no authoritative pose must be withheld, never defaulted to the origin or home.
import { describe, expect, it } from "vitest";
import type { Terrain } from "../src/colony/terrain";
import {
  createWorldFrameRegistry,
  gridToWorld,
  type SpatialFrame,
} from "../src/colony/worldSurvey";
import { avatarTransform } from "../src/colony/render/avatarLayer";
import {
  formatPresenceEntry,
  formatPresenceStamp,
  resolvePresenceReadout,
  type PresenceRecord,
  type PresenceStamp,
} from "../src/colony/spatial/presenceReadout";
import { surfacePresenceRecords } from "../src/colony/spatial/presenceRecords";

const TERRAIN_SIZE = 608;

/** Only `size` is consulted by the frame graph; the readout never touches the heightfield itself. */
const terrainStub = { size: TERRAIN_SIZE } as unknown as Terrain;

const STAMP: PresenceStamp = {
  worldSeed: 4242,
  sol: 812,
  solHour: 6,
  solMinute: 30,
  layoutRevision: "wl:v1:7:abc",
};

function baseRegistry() {
  return createWorldFrameRegistry({
    terrain: terrainStub,
    worldId: "seed-4242",
  });
}

/** The production frame graph plus a Kooker-HQ-shaped building/room pair hanging off the surface. */
function interiorFrames() {
  const registry = baseRegistry();
  const surfaceId = registry.surfaceFrameId;
  const surface = registry.frames.get(surfaceId)!;
  const buildingId = `${surfaceId}:building:kooker-hq`;
  const roomId = `${buildingId}:room:boardroom`;
  const buildingOrigin = gridToWorld(TERRAIN_SIZE, 300, 300, 0);
  registry.addFrame({
    id: buildingId,
    address: `${surface.address}/building/kooker-hq`,
    kind: "building",
    layer: "surface",
    parentId: surfaceId,
    transform: {
      position: buildingOrigin,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  registry.addFrame({
    id: roomId,
    address: `${surface.address}/building/kooker-hq/room/boardroom`,
    kind: "room",
    layer: "interior",
    parentId: buildingId,
    transform: {
      position: { x: 2, y: 0, z: 6 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  return { registry, surfaceId, buildingId, roomId };
}

function record(over: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    subjectId: "citizen-1",
    displayName: "Mira Vale",
    subjectKind: "player",
    isLocal: true,
    location: null,
    ...over,
  };
}

describe("BUG.GEO.1 projection — the readout locates the RENDERED world", () => {
  const groundY = (x: number, y: number) => 3 + ((x + y) % 5) * 0.25;

  it("world coordinates equal the transform the avatar renderer places the citizen with", () => {
    const registry = baseRegistry();
    const pose = { x: 271.25, y: 344.5, heading: 0.75 };
    const records = surfacePresenceRecords(
      [
        {
          subjectId: "c1",
          displayName: "Mira Vale",
          subjectKind: "player",
          isLocal: true,
          pose,
        },
      ],
      {
        surfaceFrameId: registry.surfaceFrameId,
        terrainSize: TERRAIN_SIZE,
        groundY,
      },
    );
    const readout = resolvePresenceReadout(records, {
      frames: registry.frames,
      projectionFrameId: registry.surfaceFrameId,
      exactSubjectIds: ["c1"],
      stamp: STAMP,
    });

    // Reference is the renderer's own transform, NOT the sim cell the pose came from.
    const expected = avatarTransform(pose, TERRAIN_SIZE, groundY);
    const fix = readout.entries[0]!.fix!;
    expect(fix.world.x).toBeCloseTo(expected.wx, 10);
    expect(fix.world.y).toBeCloseTo(expected.wy, 10);
    expect(fix.world.z).toBeCloseTo(expected.wz, 10);
  });

  it("grid cell round-trips back to the source cell with no half-cell offset", () => {
    const registry = baseRegistry();
    // Whole cells: a half-cell offset anywhere in the chain shows up as a clean 0.5 error.
    for (const pose of [
      { x: 0, y: 0, heading: 0 },
      { x: 1, y: 2, heading: 0 },
      { x: 304, y: 304, heading: 0 },
      { x: 607, y: 607, heading: 0 },
    ]) {
      const records = surfacePresenceRecords(
        [
          {
            subjectId: "c1",
            displayName: "Mira Vale",
            subjectKind: "player",
            isLocal: true,
            pose,
          },
        ],
        {
          surfaceFrameId: registry.surfaceFrameId,
          terrainSize: TERRAIN_SIZE,
          groundY: () => 0,
        },
      );
      const readout = resolvePresenceReadout(records, {
        frames: registry.frames,
        projectionFrameId: registry.surfaceFrameId,
        exactSubjectIds: ["c1"],
        stamp: STAMP,
      });
      const fix = readout.entries[0]!.fix!;
      // Forward direction: the readout's world point is exactly the renderer's grid->world transform.
      const rendered = gridToWorld(TERRAIN_SIZE, pose.x, pose.y, 0);
      expect(fix.world.x).toBeCloseTo(rendered.x, 10);
      expect(fix.world.z).toBeCloseTo(rendered.z, 10);
      // Inverse direction: the reported cell is the cell the citizen actually stands on.
      expect(fix.cell!.x).toBeCloseTo(pose.x, 10);
      expect(fix.cell!.y).toBeCloseTo(pose.y, 10);
    }
  });

  it("reports inside AND outside the frame extent, and never clamps an outside pose", () => {
    const registry = baseRegistry();
    const cases: {
      pose: { x: number; y: number; heading: number };
      inside: boolean;
    }[] = [
      { pose: { x: 0, y: 0, heading: 0 }, inside: true }, // lower half-open bound is inside
      { pose: { x: 607.5, y: 607.5, heading: 0 }, inside: true },
      { pose: { x: 608, y: 300, heading: 0 }, inside: false }, // upper bound is exclusive
      { pose: { x: -1, y: 300, heading: 0 }, inside: false },
      { pose: { x: 300, y: 900, heading: 0 }, inside: false },
    ];
    for (const { pose, inside } of cases) {
      const records = surfacePresenceRecords(
        [
          {
            subjectId: "c1",
            displayName: "Mira Vale",
            subjectKind: "player",
            isLocal: true,
            pose,
          },
        ],
        {
          surfaceFrameId: registry.surfaceFrameId,
          terrainSize: TERRAIN_SIZE,
          groundY: () => 0,
        },
      );
      const fix = resolvePresenceReadout(records, {
        frames: registry.frames,
        projectionFrameId: registry.surfaceFrameId,
        exactSubjectIds: ["c1"],
        stamp: STAMP,
      }).entries[0]!.fix!;
      expect(fix.withinExtent).toBe(inside);
      // Overshoot direction: an out-of-extent pose keeps its true (out-of-range) coordinate.
      expect(fix.cell!.x).toBeCloseTo(pose.x, 10);
      expect(fix.cell!.y).toBeCloseTo(pose.y, 10);
    }
  });

  it("projects an interior room pose down into the surface grid the renderer draws", () => {
    const { registry, roomId, surfaceId } = interiorFrames();
    // Building origin sits on cell (300,300); the room is offset +2x/+6z inside it, so a room-local
    // point of (0,0,0) must land 2 m east and 6 m north of that cell corner — half a cell and 1.5
    // cells respectively at CELL_SIZE 4.
    const readout = resolvePresenceReadout(
      [
        record({
          subjectId: "c1",
          location: { frameId: roomId, point: { x: 0, y: 0, z: 0 } },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: surfaceId,
        exactSubjectIds: ["c1"],
        stamp: STAMP,
      },
    );
    const fix = readout.entries[0]!.fix!;
    const buildingCorner = gridToWorld(TERRAIN_SIZE, 300, 300, 0);
    expect(fix.world.x).toBeCloseTo(buildingCorner.x + 2, 10);
    expect(fix.world.z).toBeCloseTo(buildingCorner.z + 6, 10);
    expect(fix.cell!.x).toBeCloseTo(300.5, 10);
    expect(fix.cell!.y).toBeCloseTo(301.5, 10);
    expect(fix.withinExtent).toBe(true);
  });
});

describe("BUG.GEO.1 visibility policy — coarse for viewers, exact for authorized", () => {
  it("withholds the room, the point and the heading from an unauthorized viewer", () => {
    const { registry, roomId, buildingId, surfaceId } = interiorFrames();
    const readout = resolvePresenceReadout(
      [
        record({
          subjectId: "c1",
          isLocal: false,
          headingRadians: 1.2,
          location: { frameId: roomId, point: { x: 1.5, y: 0, z: 2.5 } },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: surfaceId,
        exactSubjectIds: [], // this viewer may not step into c1
        stamp: STAMP,
      },
    );
    const entry = readout.entries[0]!;
    expect(entry.resolution).toBe("coarse");
    expect(entry.frame.frameId).toBe(buildingId);
    expect(entry.frame.kind).toBe("building");
    // No point at all — redaction must survive being copied off a screenshot.
    expect(entry.fix).toBeNull();
    expect(entry.headingDegrees).toBeNull();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("boardroom");
    expect(serialized).not.toContain("2.5");
    // The address legitimately contains the word "world"; what must never appear is a coordinate.
    expect(formatPresenceEntry(entry)).not.toMatch(/(grid|world) -?\d/);
  });

  it("gives an authorized viewer the exact room frame and its coordinates (no over-redaction)", () => {
    const { registry, roomId, surfaceId } = interiorFrames();
    const entry = resolvePresenceReadout(
      [
        record({
          subjectId: "c1",
          headingRadians: Math.PI,
          location: { frameId: roomId, point: { x: 1.5, y: 0, z: 2.5 } },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: surfaceId,
        exactSubjectIds: ["c1"],
        stamp: STAMP,
      },
    ).entries[0]!;
    expect(entry.resolution).toBe("exact");
    expect(entry.frame.frameId).toBe(roomId);
    expect(entry.frame.kind).toBe("room");
    expect(entry.fix).not.toBeNull();
    expect(entry.headingDegrees).toBeCloseTo(180, 10);
    expect(formatPresenceEntry(entry)).toContain("grid ");
  });

  it("carries the complete ancestor chain, root last", () => {
    const { registry, roomId, buildingId, surfaceId } = interiorFrames();
    const entry = resolvePresenceReadout(
      [
        record({
          subjectId: "c1",
          location: { frameId: roomId, point: { x: 0, y: 0, z: 0 } },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: surfaceId,
        exactSubjectIds: ["c1"],
        stamp: STAMP,
      },
    ).entries[0]!;
    const chain = entry.ancestry.map((f) => f.frameId);
    expect(chain[0]).toBe(roomId);
    expect(chain[1]).toBe(buildingId);
    expect(chain[2]).toBe(surfaceId);
    expect(chain[chain.length - 1]).toBe("universe:citylife");
  });

  it("resolves each subject against its own authorization, in one list", () => {
    const { registry, roomId, surfaceId } = interiorFrames();
    const readout = resolvePresenceReadout(
      [
        record({
          subjectId: "me",
          isLocal: true,
          location: { frameId: roomId, point: { x: 0, y: 0, z: 0 } },
        }),
        record({
          subjectId: "them",
          displayName: "Ada Kell",
          isLocal: false,
          location: { frameId: roomId, point: { x: 1, y: 0, z: 1 } },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: surfaceId,
        exactSubjectIds: ["me"],
        stamp: STAMP,
      },
    );
    expect(readout.entries.map((e) => e.resolution)).toEqual([
      "exact",
      "coarse",
    ]);
    expect(readout.entries[0]!.isLocal).toBe(true);
    expect(readout.entries[1]!.fix).toBeNull();
  });
});

describe("BUG.GEO.1 no authoritative pose — hide the marker, never invent one", () => {
  it("hides a subject with no presence address instead of defaulting it", () => {
    const registry = baseRegistry();
    const readout = resolvePresenceReadout([record({ location: null })], {
      frames: registry.frames,
      projectionFrameId: registry.surfaceFrameId,
      exactSubjectIds: ["citizen-1"],
      stamp: STAMP,
    });
    expect(readout.entries).toHaveLength(0);
    expect(readout.hidden).toHaveLength(1);
    expect(readout.hidden[0]!.reason).toBe("NO_AUTHORITATIVE_POSE");
    // Nothing that could be mistaken for a position — not the origin, not a home cell.
    expect(JSON.stringify(readout.entries)).toBe("[]");
  });

  it("hides a subject whose frame is not in the authoritative graph", () => {
    const registry = baseRegistry();
    const readout = resolvePresenceReadout(
      [
        record({
          location: {
            frameId: "universe:citylife:world:ghost",
            point: { x: 0, y: 0, z: 0 },
          },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: registry.surfaceFrameId,
        exactSubjectIds: ["citizen-1"],
        stamp: STAMP,
      },
    );
    expect(readout.entries).toHaveLength(0);
    expect(readout.hidden[0]!.reason).toBe("UNRESOLVABLE_FRAME");
    expect(readout.hidden[0]!.detail).toContain("MISSING_FRAME");
  });

  it("treats a non-finite roster pose as no pose rather than as coordinates", () => {
    const registry = baseRegistry();
    const records = surfacePresenceRecords(
      [
        {
          subjectId: "c1",
          displayName: "Mira Vale",
          subjectKind: "player",
          isLocal: true,
          pose: { x: Number.NaN, y: 12, heading: 0 },
        },
        {
          subjectId: "c2",
          displayName: "Ada Kell",
          subjectKind: "bot",
          isLocal: false,
          pose: null,
        },
      ],
      {
        surfaceFrameId: registry.surfaceFrameId,
        terrainSize: TERRAIN_SIZE,
        groundY: () => 0,
      },
    );
    expect(records.every((r) => r.location === null)).toBe(true);
    const readout = resolvePresenceReadout(records, {
      frames: registry.frames,
      projectionFrameId: registry.surfaceFrameId,
      exactSubjectIds: ["c1", "c2"],
      stamp: STAMP,
    });
    expect(readout.entries).toHaveLength(0);
    expect(readout.hidden.map((h) => h.reason)).toEqual([
      "NO_AUTHORITATIVE_POSE",
      "NO_AUTHORITATIVE_POSE",
    ]);
  });

  it("hides only the broken subject and still renders the rest of the list", () => {
    const registry = baseRegistry();
    const readout = resolvePresenceReadout(
      [
        record({ subjectId: "broken", location: null }),
        record({
          subjectId: "ok",
          displayName: "Ada Kell",
          isLocal: false,
          location: {
            frameId: registry.surfaceFrameId,
            point: gridToWorld(TERRAIN_SIZE, 10, 20, 0),
          },
        }),
      ],
      {
        frames: registry.frames,
        projectionFrameId: registry.surfaceFrameId,
        exactSubjectIds: ["broken", "ok"],
        stamp: STAMP,
      },
    );
    expect(readout.entries.map((e) => e.subjectId)).toEqual(["ok"]);
    expect(readout.hidden.map((h) => h.subjectId)).toEqual(["broken"]);
  });
});

describe("BUG.GEO.1 reproducibility stamp and determinism", () => {
  it("prints the world seed and the canonical sol", () => {
    expect(formatPresenceStamp(STAMP)).toBe(
      "seed 4242 · sol 812 06:30 · rev wl:v1:7:abc",
    );
  });

  it("is byte-identical across repeated resolutions of the same inputs", () => {
    const { registry, roomId, surfaceId } = interiorFrames();
    const records = [
      record({
        subjectId: "me",
        location: { frameId: roomId, point: { x: 1, y: 0, z: 2 } },
      }),
      record({
        subjectId: "them",
        isLocal: false,
        location: {
          frameId: surfaceId,
          point: gridToWorld(TERRAIN_SIZE, 40, 41, 2),
        },
      }),
    ];
    const options = {
      frames: registry.frames,
      projectionFrameId: surfaceId,
      exactSubjectIds: ["me"],
      stamp: STAMP,
    };
    expect(JSON.stringify(resolvePresenceReadout(records, options))).toBe(
      JSON.stringify(resolvePresenceReadout(records, options)),
    );
  });

  it("grows the marker list by appending records, with no shape change", () => {
    const registry = baseRegistry();
    const make = (id: string, cell: { x: number; y: number }) =>
      record({
        subjectId: id,
        displayName: id,
        isLocal: id === "me",
        location: {
          frameId: registry.surfaceFrameId,
          point: gridToWorld(TERRAIN_SIZE, cell.x, cell.y, 0),
        },
      });
    const options = {
      frames: registry.frames,
      projectionFrameId: registry.surfaceFrameId,
      exactSubjectIds: ["me", "bot-a", "bot-b"],
      stamp: STAMP,
    };
    const one = resolvePresenceReadout([make("me", { x: 10, y: 10 })], options);
    const three = resolvePresenceReadout(
      [
        make("me", { x: 10, y: 10 }),
        make("bot-a", { x: 20, y: 30 }),
        make("bot-b", { x: 44, y: 55 }),
      ],
      options,
    );
    expect(one.entries).toHaveLength(1);
    expect(three.entries).toHaveLength(3);
    expect(JSON.stringify(three.entries[0])).toBe(
      JSON.stringify(one.entries[0]),
    );
    expect(three.entries[2]!.fix!.cell!.x).toBeCloseTo(44, 10);
  });
});

describe("BUG.GEO.1 frame graph reuse", () => {
  it("builds the same frames the full world survey does", () => {
    const registry = baseRegistry();
    const surface = registry.frames.get(
      registry.surfaceFrameId,
    )! as SpatialFrame;
    expect(surface.grid).toBeDefined();
    expect(surface.grid!.cellSize).toBe(4);
    expect(surface.grid!.width).toBe(TERRAIN_SIZE);
    // The grid origin IS the renderer's transform of cell (0,0) — the shared reference the readout
    // and the survey map both project through.
    expect(surface.grid!.origin).toEqual(gridToWorld(TERRAIN_SIZE, 0, 0));
  });
});
