import { describe, expect, it } from "vitest";
import {
  aimBugCaptureDraft,
  attachBugCaptureScreenshot,
  commitBugCapture,
  openBugCaptureDraft,
  type BugCameraPose,
  type BugCaptureContext,
} from "../src/colony/bug/bugCapture";
import {
  buildBugGoalPlan,
  bugGoalStepsFromText,
} from "../src/colony/bug/bugGoal";
import { MS_PER_SOL } from "../src/colony/sol";
import type {
  SpatialFrame,
  SpatialFrameKind,
  SpatialTransform,
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
): SpatialFrame {
  return {
    id,
    address: `spatial://test/${id}`,
    kind,
    layer: kind === "room" ? "interior" : "surface",
    parentId,
    transform: identity,
  };
}

const frames = new Map<string, SpatialFrame>(
  [
    frame("universe", undefined, "universe"),
    frame("world", "universe", "world"),
    frame("surface", "world", "region"),
  ].map((f) => [f.id, f]),
);

const camera: BugCameraPose = {
  frameId: "surface",
  position: { x: 4, y: 8, z: 12 },
  target: { x: 4, y: 5, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovDeg: 65,
  near: 0.5,
  far: 12000,
  aspect: 16 / 9,
};

function capture(): BugCaptureContext {
  let draft = openBugCaptureDraft({
    world: { worldId: "seed-4242", seed: 4242 },
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  });
  draft = aimBugCaptureDraft(draft, {
    camera,
    location: { frameId: "surface", point: { x: 4, y: 0, z: 12 } },
  });
  draft = attachBugCaptureScreenshot(draft, {
    mimeType: "image/png",
    width: 1280,
    height: 720,
    payload: "data:image/png;base64,Y2l0eWxpZmUtYnVn",
  });
  return commitBugCapture(draft, {
    capturedAtMs: 1_780_092_000_000 + MS_PER_SOL * 3,
    frames,
  });
}

describe("bugGoal", () => {
  it("turns reporter text into stable non-empty repro steps", () => {
    expect(
      bugGoalStepsFromText(
        "1. Open CityLife at 1280px\n2) Observe the top bar\n\nActual line",
      ),
    ).toEqual([
      "Open CityLife at 1280px",
      "Observe the top bar",
      "Actual line",
    ]);
  });

  it("files, triages, and plans one governed queue goal from a captured bug", () => {
    const plan = buildBugGoalPlan({
      capture: capture(),
      filedAtMs: 1_780_300_000_000,
      reporterId: "operator:joe",
      title: "Topbar Log out wraps under bus map",
      stepsText:
        "1. Open CityLife at a 1280px wide viewport\n2. Observe the top navigation and bus map",
      expected:
        "All topbar actions remain visible and clickable without overlapping the bus map.",
      actual:
        "The Log out button wraps under the bus map and is partially hidden.",
      repo: "duikindiesee/citylife",
      pathGlobs: ["src/colony/ui/**", "tests/**"],
    });

    expect(plan.record.status).toBe("TRIAGED");
    expect(plan.taskSubmission.clientToken).toBe(
      `bugtrack-${plan.record.reportId}`,
    );
    expect(plan.taskSubmission.title).toContain(
      "Topbar Log out wraps under bus map",
    );
    expect(plan.taskSubmission.repo).toBe("duikindiesee/citylife");
    expect(plan.taskSubmission.scopeKeys).toContain("citylife:bug-reporting");
    expect(plan.taskSubmission.scopeKeys).toContain(
      `bug:${plan.record.reportId}`,
    );
    expect(plan.taskSubmission.body).toContain(
      `capture: ${plan.record.capture.captureId}`,
    );
    expect(plan.taskSubmission.body).toContain(
      "> 1. Open CityLife at a 1280px wide viewport",
    );
    expect(plan.markdown).toContain("## Expected");
    expect(plan.markdown).toContain("## Actual");
    expect(plan.markdown).toContain(plan.record.capture.captureId);
  });
});
