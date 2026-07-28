import { describe, expect, it } from "vitest";
import {
  aimBugCaptureDraft,
  attachBugCaptureScreenshot,
  bugCameraPoseFromWorld,
  BugCaptureError,
  BUG_CAPTURE_RECORD_VERSION,
  commitBugCapture,
  deriveBugCaptureId,
  openBugCaptureDraft,
  parseBugCapture,
  planBugReproduction,
  serializeBugCapture,
  toShareableBugCapture,
  type BugCameraPose,
  type BugCaptureContext,
} from "../src/colony/bug/bugCapture";
import { canonicalSolClock, MS_PER_SOL } from "../src/colony/sol";
import type {
  SpatialFrame,
  SpatialFrameKind,
  SpatialTransform,
  Vec3,
} from "../src/colony/worldSurvey";

const identity: SpatialTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function frame(
  id: string,
  parentId: string | undefined,
  kind: SpatialFrameKind,
  transform: SpatialTransform = identity,
): SpatialFrame {
  return {
    id,
    address: `spatial://test/${id}`,
    kind,
    layer: kind === "room" ? "interior" : "surface",
    parentId,
    transform,
  };
}

/**
 * universe -> world -> surface -> hq (building, translated) -> boardroom (room, translated + yawed).
 * Only translations and a quarter-turn yaw, so every expected value below is hand-computable and does
 * not lean on the transform helpers the code under test uses.
 */
const HQ_OFFSET: Vec3 = { x: 120, y: 3, z: -40 };
const ROOM_OFFSET: Vec3 = { x: 2, y: 0, z: 5 };

const frames = new Map<string, SpatialFrame>(
  [
    frame("universe", undefined, "universe"),
    frame("world", "universe", "world"),
    frame("surface", "world", "region"),
    frame("hq", "surface", "building", { ...identity, position: HQ_OFFSET }),
    frame("boardroom", "hq", "room", {
      ...identity,
      position: ROOM_OFFSET,
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
    }),
  ].map((f) => [f.id, f]),
);

/** Hand-worked room-local -> root: yaw +90 deg maps (x,y,z) to (z,y,-x), then the two translations. */
function roomLocalToRoot(point: Vec3): Vec3 {
  return {
    x: point.z + ROOM_OFFSET.x + HQ_OFFSET.x,
    y: point.y + ROOM_OFFSET.y + HQ_OFFSET.y,
    z: -point.x + ROOM_OFFSET.z + HQ_OFFSET.z,
  };
}

const WORLD = { worldId: "seed-4242", seed: 4242 } as const;
const VIEWPORT = { width: 1920, height: 1080, devicePixelRatio: 2 } as const;
/** Two sols past the epoch plus four hours, so the sol index is unambiguous and non-zero. */
const CAPTURED_AT_MS = 1_780_092_000_000 + MS_PER_SOL * 2 + 4 * 3_600_000;

const roomPose: BugCameraPose = {
  frameId: "boardroom",
  position: { x: 1, y: 1.7, z: -2 },
  target: { x: 0, y: 1.5, z: -6 },
  up: { x: 0, y: 1, z: 0 },
  fovDeg: 45,
  near: 0.5,
  far: 12000,
  aspect: 16 / 9,
};

const roomLocation = { frameId: "boardroom", point: { x: 1, y: 0, z: -2 } };

function buildContext(
  overrides: {
    pose?: BugCameraPose;
    capturedAtMs?: number;
    withScreenshot?: boolean;
  } = {},
): BugCaptureContext {
  let draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
  draft = aimBugCaptureDraft(draft, {
    camera: overrides.pose ?? roomPose,
    location: roomLocation,
  });
  if (overrides.withScreenshot !== false)
    draft = attachBugCaptureScreenshot(draft, {
      mimeType: "image/png",
      width: 1920,
      height: 1080,
      payload: "data:image/png;base64,aGVsbG8gY2l0eWxpZmU=",
    });
  return commitBugCapture(draft, {
    capturedAtMs: overrides.capturedAtMs ?? CAPTURED_AT_MS,
    frames,
  });
}

function expectVecClose(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

/** Every key path in a plain object tree, sorted. Used to prove the wire form gains and loses nothing. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  if (Array.isArray(value))
    return value.flatMap((entry, index) =>
      keyPaths(entry, `${prefix}[${index}]`),
    );
  return Object.keys(value as Record<string, unknown>)
    .flatMap((key) =>
      keyPaths(
        (value as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    )
    .sort();
}

describe("bug capture — composing with a free camera", () => {
  it("counts every re-aim and commits the pose that was aimed last", () => {
    let draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    expect(draft.composeSteps).toBe(0);
    draft = aimBugCaptureDraft(draft, {
      camera: { ...roomPose, position: { x: 9, y: 9, z: 9 } },
      location: roomLocation,
    });
    const midway = draft;
    draft = aimBugCaptureDraft(draft, {
      camera: roomPose,
      location: roomLocation,
    });
    draft = aimBugCaptureDraft(draft, {
      camera: roomPose,
      location: roomLocation,
    });

    // Drafts are persistent: the earlier one still carries the earlier framing.
    expect(midway.composeSteps).toBe(1);
    expect(midway.camera?.position).toEqual({ x: 9, y: 9, z: 9 });

    const context = commitBugCapture(draft, {
      capturedAtMs: CAPTURED_AT_MS,
      frames,
    });
    expect(context.composeSteps).toBe(3);
    expect(context.camera.position).toEqual(roomPose.position);
  });

  it("refuses to commit a draft that was never aimed", () => {
    const draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    expect(() =>
      commitBugCapture(draft, { capturedAtMs: CAPTURED_AT_MS, frames }),
    ).toThrowError(
      expect.objectContaining({ code: "NOT_AIMED" }) as unknown as Error,
    );
  });

  it("rejects a camera aimed in a different frame from the presence address", () => {
    const draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    expect(() =>
      aimBugCaptureDraft(draft, {
        camera: { ...roomPose, frameId: "surface" },
        location: roomLocation,
      }),
    ).toThrowError(BugCaptureError);
  });

  // DISCRIMINATING: a filed report must be a snapshot, not a live view of the camera. If the record
  // aliased the caller's pose object, moving the camera after filing would silently rewrite the report.
  it("keeps a committed record frozen and detached from the caller's live pose object", () => {
    const livePose = {
      ...roomPose,
      position: { x: 1, y: 1.7, z: -2 },
      up: { x: 0, y: 1, z: 0 },
    };
    const liveLocation = { frameId: "boardroom", point: { x: 1, y: 0, z: -2 } };
    let draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    draft = aimBugCaptureDraft(draft, {
      camera: livePose,
      location: liveLocation,
    });
    const context = commitBugCapture(draft, {
      capturedAtMs: CAPTURED_AT_MS,
      frames,
    });
    const idAtCommit = context.captureId;

    // The reporter keeps flying after filing.
    livePose.position.x = 999;
    livePose.position.y = -999;
    livePose.up.z = 42;
    liveLocation.point.x = 777;

    expect(context.camera.position).toEqual({ x: 1, y: 1.7, z: -2 });
    expect(context.camera.up).toEqual({ x: 0, y: 1, z: 0 });
    expect(context.presence.location.point).toEqual({ x: 1, y: 0, z: -2 });
    expect(context.captureId).toBe(idAtCommit);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.camera.position)).toBe(true);
    expect(Object.isFrozen(context.presence.ancestorFrameIds)).toBe(true);
  });
});

describe("bug capture — world, seed and canonical sol", () => {
  it("stamps the world id, seed and the canonical sol of the COMMIT instant", () => {
    const context = buildContext();
    const expected = canonicalSolClock(CAPTURED_AT_MS);
    expect(context.world).toEqual({ worldId: "seed-4242", seed: 4242 });
    expect(context.sol.capturedAtMs).toBe(CAPTURED_AT_MS);
    expect(context.sol.sol).toBe(expected.sol);
    expect(context.sol.sol).toBe(2);
    expect(context.sol.earthDay).toBe(expected.earthDay);
    expect(context.sol.solOfEarthDay).toBe(expected.solOfEarthDay);
    expect(context.sol.hour).toBe(expected.hour);
    expect(context.sol.minute).toBe(expected.minute);
    expect(context.sol.isDay).toBe(expected.isDay);
  });

  // Two captures a sol apart must not collapse to the same record, and reading a record later must not
  // re-derive the clock from "now".
  it("keeps a filed sol stable when the record is serialized on a later sol", () => {
    const early = buildContext({ capturedAtMs: CAPTURED_AT_MS });
    const later = buildContext({ capturedAtMs: CAPTURED_AT_MS + MS_PER_SOL });
    expect(later.sol.sol).toBe(early.sol.sol + 1);
    expect(parseBugCapture(serializeBugCapture(early)).sol).toEqual(early.sol);
    expect(early.captureId).not.toBe(later.captureId);
  });

  it("carries the presence address and its full ancestor chain", () => {
    const context = buildContext();
    expect(context.presence.location).toEqual(roomLocation);
    expect(context.presence.ancestorFrameIds).toEqual([
      "boardroom",
      "hq",
      "surface",
      "world",
      "universe",
    ]);
    // Coarsening stops at the building: a viewer learns "in Kooker HQ", never "in the boardroom".
    expect(context.presence.publicPresence.frameId).toBe("hq");
    expect(context.presence.publicPresence.kind).toBe("building");
  });

  it("fails loudly when the presence frame is not in the registry", () => {
    let draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    draft = aimBugCaptureDraft(draft, {
      camera: { ...roomPose, frameId: "ghost-room" },
      location: { frameId: "ghost-room", point: { x: 0, y: 0, z: 0 } },
    });
    expect(() =>
      commitBugCapture(draft, { capturedAtMs: CAPTURED_AT_MS, frames }),
    ).toThrowError(
      expect.objectContaining({ code: "MISSING_FRAME" }) as unknown as Error,
    );
  });
});

describe("bug capture — capture identity", () => {
  it("is stable across two independently composed but identical captures", () => {
    expect(buildContext().captureId).toBe(buildContext().captureId);
  });

  // DISCRIMINATING (the other side of stability): an id that ignored fields would still be "stable".
  // Every field must move the id, or the record could reproduce somewhere it does not describe.
  it("changes when any single field of the record changes", () => {
    const base = buildContext();
    const { captureId: _drop, ...parts } = base;
    expect(deriveBugCaptureId(parts)).toBe(base.captureId);

    const mutations: Array<[string, typeof parts]> = [
      ["seed", { ...parts, world: { ...parts.world, seed: 4243 } }],
      ["worldId", { ...parts, world: { ...parts.world, worldId: "seed-7" } }],
      ["sol", { ...parts, sol: { ...parts.sol, sol: parts.sol.sol + 1 } }],
      ["isDay", { ...parts, sol: { ...parts.sol, isDay: !parts.sol.isDay } }],
      [
        "camera.position",
        {
          ...parts,
          camera: {
            ...parts.camera,
            position: { ...parts.camera.position, x: 1.0001 },
          },
        },
      ],
      [
        "camera.fovDeg",
        { ...parts, camera: { ...parts.camera, fovDeg: 46 } },
      ],
      [
        "presence.point",
        {
          ...parts,
          presence: {
            ...parts.presence,
            location: {
              ...parts.presence.location,
              point: { ...parts.presence.location.point, z: -2.5 },
            },
          },
        },
      ],
      [
        "presence.chain",
        {
          ...parts,
          presence: {
            ...parts.presence,
            ancestorFrameIds: ["boardroom", "surface", "world", "universe"],
          },
        },
      ],
      [
        "viewport",
        { ...parts, viewport: { ...parts.viewport, width: 1921 } },
      ],
      [
        "screenshot",
        {
          ...parts,
          screenshot: parts.screenshot
            ? { ...parts.screenshot, fingerprint: "0000000000000000" }
            : null,
        },
      ],
      ["composeSteps", { ...parts, composeSteps: parts.composeSteps + 1 }],
    ];

    const seen = new Set<string>([base.captureId]);
    for (const [label, mutated] of mutations) {
      const id = deriveBugCaptureId(mutated);
      expect(id, `${label} did not move the capture id`).not.toBe(
        base.captureId,
      );
      expect(seen.has(id), `${label} collided with another capture id`).toBe(
        false,
      );
      seen.add(id);
    }
  });

  it("binds a specific screenshot to the capture", () => {
    const context = buildContext();
    let other = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    other = aimBugCaptureDraft(other, {
      camera: roomPose,
      location: roomLocation,
    });
    other = attachBugCaptureScreenshot(other, {
      mimeType: "image/png",
      width: 1920,
      height: 1080,
      payload: "data:image/png;base64,YSBkaWZmZXJlbnQgc2hvdA==",
    });
    const differentShot = commitBugCapture(other, {
      capturedAtMs: CAPTURED_AT_MS,
      frames,
    });
    expect(context.screenshot?.fingerprint).not.toBe(
      differentShot.screenshot?.fingerprint,
    );
    expect(context.captureId).not.toBe(differentShot.captureId);
    // The bytes themselves never enter the record.
    expect(serializeBugCapture(context)).not.toContain("aGVsbG8");
  });
});

describe("bug capture — transport", () => {
  it("round-trips through JSON with exactly the same fields, no more and no fewer", () => {
    const context = buildContext();
    const wire = serializeBugCapture(context);
    const parsed = parseBugCapture(wire);
    expect(parsed).toEqual(context);
    expect(keyPaths(JSON.parse(wire))).toEqual(keyPaths(context));
    expect(keyPaths(JSON.parse(wire))).toEqual([
      "camera.aspect",
      "camera.far",
      "camera.fovDeg",
      "camera.frameId",
      "camera.near",
      "camera.position.x",
      "camera.position.y",
      "camera.position.z",
      "camera.target.x",
      "camera.target.y",
      "camera.target.z",
      "camera.up.x",
      "camera.up.y",
      "camera.up.z",
      "captureId",
      "composeSteps",
      "presence.ancestorFrameIds[0]",
      "presence.ancestorFrameIds[1]",
      "presence.ancestorFrameIds[2]",
      "presence.ancestorFrameIds[3]",
      "presence.ancestorFrameIds[4]",
      "presence.location.frameId",
      "presence.location.point.x",
      "presence.location.point.y",
      "presence.location.point.z",
      "presence.publicPresence.address",
      "presence.publicPresence.frameId",
      "presence.publicPresence.kind",
      "recordVersion",
      "screenshot.byteLength",
      "screenshot.fingerprint",
      "screenshot.height",
      "screenshot.mimeType",
      "screenshot.width",
      "sol.capturedAtMs",
      "sol.earthDay",
      "sol.hour",
      "sol.isDay",
      "sol.minute",
      "sol.solOfEarthDay",
      "sol.sol",
      "viewport.devicePixelRatio",
      "viewport.height",
      "viewport.width",
      "world.seed",
      "world.worldId",
    ].sort());
  });

  // DISCRIMINATING: a validator that only checked shape would accept all three of these and send a
  // reviewer to the wrong place. The id must actually be recomputed and enforced.
  it("rejects a record whose contents were edited without re-deriving the id", () => {
    const context = buildContext();
    const wire = JSON.parse(serializeBugCapture(context)) as Record<
      string,
      unknown
    >;

    const moved = structuredClone(wire) as typeof wire;
    (moved.camera as { position: Vec3 }).position.x += 5;
    expect(() => parseBugCapture(JSON.stringify(moved))).toThrowError(
      expect.objectContaining({ code: "INVALID_RECORD" }) as unknown as Error,
    );

    const reseeded = structuredClone(wire) as typeof wire;
    (reseeded.world as { seed: number }).seed = 7;
    expect(() => parseBugCapture(JSON.stringify(reseeded))).toThrowError(
      expect.objectContaining({ code: "INVALID_RECORD" }) as unknown as Error,
    );

    const truncated = structuredClone(wire) as typeof wire;
    delete truncated.presence;
    expect(() => parseBugCapture(JSON.stringify(truncated))).toThrowError(
      expect.objectContaining({ code: "INVALID_RECORD" }) as unknown as Error,
    );
  });

  it("rejects an unknown record version and non-JSON input", () => {
    const wire = JSON.parse(serializeBugCapture(buildContext())) as Record<
      string,
      unknown
    >;
    wire.recordVersion = BUG_CAPTURE_RECORD_VERSION + 1;
    expect(() => parseBugCapture(JSON.stringify(wire))).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }) as unknown as Error,
    );
    expect(() => parseBugCapture("not json")).toThrowError(BugCaptureError);
  });

  it("coarsens to a shareable form that leaks no exact interior coordinate", () => {
    const context = buildContext();
    const shareable = toShareableBugCapture(context);
    const wire = JSON.stringify(shareable);
    expect(shareable.publicPresence.frameId).toBe("hq");
    expect(wire).not.toContain("boardroom");
    expect(Object.keys(shareable)).not.toContain("camera");
    expect(Object.keys(shareable)).not.toContain("presence");
    // Still identifies WHICH report and WHEN, so it is usable in a chat paste.
    expect(shareable.captureId).toBe(context.captureId);
    expect(shareable.sol).toEqual(context.sol);
  });
});

describe("bug capture — reproduction resolves against the renderer's own frame", () => {
  // DISCRIMINATING: the stored pose is boardroom-local. Replaying those numbers straight into the
  // renderer would put the camera 120 m away in the wrong place. The plan must resolve the chain.
  it("resolves the stored pose into the root frame the renderer uses", () => {
    const plan = planBugReproduction(buildContext(), frames);
    expect(plan.rootFrameId).toBe("universe");
    expectVecClose(plan.camera.position, roomLocalToRoot(roomPose.position));
    expectVecClose(plan.camera.position, { x: 120, y: 4.7, z: -36 });
    expectVecClose(plan.camera.target, roomLocalToRoot(roomPose.target));
    expectVecClose(plan.camera.target, { x: 116, y: 4.5, z: -35 });
    // The raw stored numbers are NOT the replay numbers.
    expect(plan.camera.position).not.toEqual(roomPose.position);
    expect(plan.enterFrameId).toBe("boardroom");
    expect(plan.portalPath).toEqual([
      "universe",
      "world",
      "surface",
      "hq",
      "boardroom",
    ]);
    expect(plan.camera.fovDeg).toBe(roomPose.fovDeg);
    expect(plan.camera.near).toBe(roomPose.near);
    expect(plan.camera.far).toBe(roomPose.far);
  });

  // DISCRIMINATING, two-sided: `up` is a direction. Frame TRANSLATION must not move it (the +120 m
  // offset must not leak in) and frame ROTATION must still turn it.
  it("treats camera up as a direction: translation ignored, rotation applied", () => {
    const upright = planBugReproduction(buildContext(), frames);
    expectVecClose(upright.camera.up, { x: 0, y: 1, z: 0 });
    expect(Math.hypot(...Object.values(upright.camera.up))).toBeCloseTo(1, 12);

    const rolledFrames = new Map(frames);
    rolledFrames.set("boardroom", {
      ...frames.get("boardroom")!,
      transform: {
        position: ROOM_OFFSET,
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    const rolled = planBugReproduction(buildContext(), rolledFrames);
    // A +90 deg roll about Z turns local +Y into root -X, and the frame offsets must not appear.
    expectVecClose(rolled.camera.up, { x: -1, y: 0, z: 0 });
  });

  // The end-to-end property the task is really about: a live renderer pose survives capture, storage
  // and replay unchanged, even though it was stored relative to an interior frame.
  it("round-trips a live renderer pose through capture and back to the same world pose", () => {
    const worldPose = {
      position: { x: 118.25, y: 7.5, z: -33.75 },
      target: { x: 130, y: 2, z: -41.5 },
      up: { x: 0, y: 1, z: 0 },
      fovDeg: 45,
      near: 0.5,
      far: 12000,
      aspect: 16 / 9,
    };
    const framePose = bugCameraPoseFromWorld(
      worldPose,
      "boardroom",
      "universe",
      frames,
    );
    expect(framePose.frameId).toBe("boardroom");
    // Genuinely re-expressed, not copied.
    expect(framePose.position).not.toEqual(worldPose.position);

    let draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    draft = aimBugCaptureDraft(draft, {
      camera: framePose,
      location: { frameId: "boardroom", point: framePose.position },
    });
    const context = commitBugCapture(draft, {
      capturedAtMs: CAPTURED_AT_MS,
      frames,
    });
    const plan = planBugReproduction(
      parseBugCapture(serializeBugCapture(context)),
      frames,
    );

    expectVecClose(plan.camera.position, worldPose.position);
    expectVecClose(plan.camera.target, worldPose.target);
    expectVecClose(plan.camera.up, worldPose.up);
    expect(plan.camera.fovDeg).toBe(worldPose.fovDeg);
    expect(plan.camera.aspect).toBeCloseTo(worldPose.aspect, 12);
  });

  it("rejects a degenerate up vector rather than replaying an undefined orientation", () => {
    const draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    expect(() =>
      aimBugCaptureDraft(draft, {
        camera: { ...roomPose, up: { x: 0, y: 0, z: 0 } },
        location: roomLocation,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DEGENERATE_DIRECTION",
      }) as unknown as Error,
    );
  });

  it("rejects a camera whose target sits on its own position", () => {
    const draft = openBugCaptureDraft({ world: WORLD, viewport: VIEWPORT });
    expect(() =>
      aimBugCaptureDraft(draft, {
        camera: { ...roomPose, target: { ...roomPose.position } },
        location: roomLocation,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DEGENERATE_DIRECTION",
      }) as unknown as Error,
    );
  });
});
