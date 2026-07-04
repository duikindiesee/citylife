// Spec 120 — the citizen avatar layer, R3F port of the legacy updateAvatars path. The
// runtime feeds a per-frame avatar source (runtime.ts setAvatarSource); this module holds
// the PURE math and constants so the transforms, colors and capacity rules are pinned in
// the node test env, and R3FAvatars.tsx stays a thin instanced-mesh syncer.
import type { AvatarView } from './R3FPlanetRenderer';

/** Legacy capacity: at most 64 avatar instances are drawn (AV_CAP in PlanetRenderer.ts).
 *  The instanced meshes are allocated ONCE at this capacity and mesh.count varies — the
 *  max-capacity pattern avoids InstancedMesh reconstruction on roster changes. */
export const AVATAR_CAP = 64;

/** Legacy body proportions: capsule torso (radius 0.16, length 0.44) + head sphere
 *  (radius 0.12) lifted 0.86 — kept verbatim so citizens look identical across renderers. */
export const AVATAR_BODY = { radius: 0.16, length: 0.44 } as const;
export const AVATAR_HEAD = { radius: 0.12, lift: 0.86 } as const;

/** Legacy identity colors, verbatim from PlanetRenderer.ts updateAvatars:
 *  cyan for the operator's own citizen, pod-purple for citizens with a live Hermes pod,
 *  pale lavender for everyone else. */
export function avatarColorHex(a: Pick<AvatarView, 'isOperator' | 'hasPod'>): number {
  return a.isOperator ? 0x66e0ff : a.hasPod ? 0x9f86d8 : 0xc0b0e0;
}

export interface AvatarTransform {
  wx: number;
  wy: number;
  wz: number;
  /** Y rotation: heading is atan2(dy, dx) in grid space; the legacy renderer maps it to
   *  world yaw as -heading + PI/2 so a citizen walking toward +x faces east. */
  rotY: number;
}

/** Grid cell -> world transform for one avatar. groundY resolves the surface height
 *  (v1: terrain.worldY; road-ribbon and house-pad overrides are a v2 refinement). */
export function avatarTransform(
  a: Pick<AvatarView, 'x' | 'y' | 'heading'>,
  size: number,
  groundY: (x: number, y: number) => number,
): AvatarTransform {
  return {
    wx: (a.x - size / 2) * 4,
    wy: Math.max(groundY(Math.round(a.x), Math.round(a.y)), 0),
    wz: (a.y - size / 2) * 4,
    rotY: -a.heading + Math.PI / 2,
  };
}

/** The drawable subset for a frame: the first-person citizen is hidden (the player IS
 *  that citizen — legacy behavior), and the list is clamped to capacity. */
export function drawableAvatars(
  avatars: readonly AvatarView[],
  fpCitizenId: string | null,
): AvatarView[] {
  const out: AvatarView[] = [];
  for (const a of avatars) {
    if (fpCitizenId !== null && a.id === fpCitizenId) continue;
    out.push(a);
    if (out.length >= AVATAR_CAP) break;
  }
  return out;
}
