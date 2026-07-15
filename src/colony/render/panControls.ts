// Grab-the-world pan math for the map camera. The operator left-drags to pan; instead of a fixed
// pan speed (which crawls when zoomed in and ignores how far away the grabbed point is), we anchor
// the clicked GROUND point under the cursor: on each move we slide the camera so that same world
// point stays beneath the pointer. A far grab (e.g. the shopfronts across the map) hauls the world
// toward you fast; a near grab moves it little — always 1:1 with the drag. Pure + headless so the
// behaviour is unit-testable without a renderer.
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

/** Mouse contract for the shared aerial controls. World View has no placement gesture, so the
 * familiar left-drag pans the map. City Builder must keep left-drag free for road placement, with
 * middle-drag retained as its pan fallback. Right-drag always owns tilt/orbit. */
export function aerialMouseButtons(worldViewActive: boolean) {
  return {
    LEFT: worldViewActive ? THREE.MOUSE.PAN : (undefined as any),
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
}

/** The horizontal plane through a grabbed ground point that a grab-pan anchors to. */
export function grabPlane(point: THREE.Vector3): THREE.Plane {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(UP, point);
}

/** World point where the screen ray (NDC, -1..1) meets the plane, or null if the ray is parallel. */
export function planeHit(
  camera: THREE.Camera,
  plane: THREE.Plane,
  ndc: THREE.Vector2,
): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const out = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, out) ? out : null;
}

/** XZ world-delta to add to the camera AND target so the grabbed point lands back under the cursor
 *  (NDC). Far grabs yield a larger delta per screen-pixel than near grabs — that is the whole point.
 *  Null if the cursor ray is parallel to the plane (looking along the horizon). */
export function grabPanDelta(
  camera: THREE.Camera,
  plane: THREE.Plane,
  grab: THREE.Vector3,
  ndc: THREE.Vector2,
): { dx: number; dz: number } | null {
  const hit = planeHit(camera, plane, ndc);
  if (!hit) return null;
  return { dx: grab.x - hit.x, dz: grab.z - hit.z };
}
