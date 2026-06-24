import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  grabPlane,
  planeHit,
  grabPanDelta,
} from "../src/colony/render/panControls";

// A camera roughly like the map's district view: up high, looking down at the world.
function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 36000);
  cam.position.set(0, 120, 160);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

function ndcOf(cam: THREE.Camera, world: THREE.Vector3): THREE.Vector2 {
  const p = world.clone().project(cam);
  return new THREE.Vector2(p.x, p.y);
}

describe("grab-the-world pan", () => {
  it("yields zero delta when the cursor has not moved off the grabbed point", () => {
    const cam = makeCamera();
    const grab = new THREE.Vector3(20, 0, -10);
    const d = grabPanDelta(cam, grabPlane(grab), grab, ndcOf(cam, grab))!;
    expect(d).not.toBeNull();
    expect(Math.hypot(d.dx, d.dz)).toBeLessThan(1e-6);
  });

  it("hauls the world MORE for a far grab than a near grab on the same screen drag", () => {
    const cam = makeCamera();
    const near = new THREE.Vector3(0, 0, 60); // close in front of the camera
    const far = new THREE.Vector3(0, 0, -260); // far across the map
    const DRAG = new THREE.Vector2(0.18, 0); // identical screen-space drag for both

    const nearDelta = grabPanDelta(
      cam,
      grabPlane(near),
      near,
      ndcOf(cam, near).add(DRAG),
    )!;
    const farDelta = grabPanDelta(
      cam,
      grabPlane(far),
      far,
      ndcOf(cam, far).add(DRAG),
    )!;

    const nearMag = Math.hypot(nearDelta.dx, nearDelta.dz);
    const farMag = Math.hypot(farDelta.dx, farDelta.dz);
    expect(nearMag).toBeGreaterThan(0);
    // the whole point of the fix: a far grab moves the world fast, a near grab little
    expect(farMag).toBeGreaterThan(nearMag);
  });

  it("returns null when the cursor ray is parallel to the ground plane", () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.5, 36000);
    cam.position.set(0, 50, 100);
    cam.lookAt(0, 50, 0); // horizontal gaze above the plane: the centre ray never meets y=0
    cam.updateMatrixWorld();
    const hit = planeHit(
      cam,
      grabPlane(new THREE.Vector3(0, 0, 0)),
      new THREE.Vector2(0, 0),
    );
    expect(hit).toBeNull();
  });
});
