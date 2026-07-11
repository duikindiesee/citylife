// Spec 146 — the world metric system. ONE source of truth for how the CityLife world maps to
// real-world size, so props stop being sized by copy-pasted magic numbers that drift apart.
//
// THE ANCHOR: 1 world unit = 1 metre. This is not an arbitrary choice — roadPitch.ts already
// calls a grid cell "exactly one 4x4m grid cell", which fixes the metre and makes the majority
// of the world already correct at this scale: terrain (608 cells -> ~2.4 km region), trees
// (~8 m), houses post spec-129 (~6-16 m eaves), and per-building commercial massing (~7 m).
// The things that were WRONG were sized against no anchor at all: the first-person player
// (a 3 m giant) and the citizen/pedestrian figures (~1 m toddlers). Spec 146 pins every
// character dimension to this file so they read as real humans against the correct world.

/** Metres per world unit. The whole point of the file: everything below is in metres, and at
 *  METRES_PER_UNIT = 1 those numbers are also world units. Kept explicit so a future restyle
 *  can rescale the world by changing ONE number instead of hunting magic literals. */
export const METRES_PER_UNIT = 1;

/** World units per grid cell. The grid is placed at (x - size/2) * CELL_SIZE across ~14 render
 *  layers that each hardcoded the literal 4; this is the shared constant they should import so
 *  a layer can never forget the factor and drop its objects to 1/4 scale. Matches
 *  roadPitch.ROAD_CELL_SPAN. */
export const CELL_SIZE = 4;

/** Half a cell — the corner/centre offset used to align mesh vertices, colliders and house
 *  footprints to cell centres (the terrain collider's [-2,0,-2] body offset). */
export const HALF_CELL = CELL_SIZE / 2;

// ── The first-person player ──────────────────────────────────────────────────────────────
// A real adult, not the 3 m barrel the port shipped. The collider, camera eye height and the
// respawn guardrail all DERIVE from these so they can never drift out of agreement again
// (the port had a 3 m collider, a 2.1 m eye and a comment claiming 1.6 m — three disagreeing
// numbers). Rapier's CapsuleCollider takes [halfHeight, radius] where the capsule's total
// height is 2*(halfHeight + radius); its half-extent (centre to foot/crown) is halfHeight + radius.
export const PLAYER_HEIGHT_M = 1.8;
export const PLAYER_EYE_M = 1.6;
export const PLAYER_RADIUS_M = 0.3;
/** Capsule cylinder half-length: total height minus the two radius caps, halved. */
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT_M / 2 - PLAYER_RADIUS_M; // 0.6
/** Capsule half-extent (body centre to the foot / to the crown). */
export const PLAYER_HALF_EXTENT = PLAYER_HEIGHT_M / 2; // 0.9
/** Camera offset above the body centre so the eye sits at PLAYER_EYE_M above the feet. */
export const PLAYER_EYE_OFFSET = PLAYER_EYE_M - PLAYER_HALF_EXTENT; // 0.7

// ── Citizens & pedestrians ───────────────────────────────────────────────────────────────
// The colonists render from a torso capsule + a head sphere. The port modelled them at ~1 m
// (citizens) and ~0.8 m (pedestrians) — a third of the corrected player — and centred the
// citizen torso ON the ground so its lower half was buried. CITIZEN_HEIGHT_M pins BOTH crowds
// to one adult height, and citizenFigure() derives feet-on-ground geometry from it.
export const CITIZEN_HEIGHT_M = 1.7;

export interface CitizenFigure {
  /** torso capsule cylinder radius */
  bodyRadius: number;
  /** torso capsule cylinder length (excludes the radius caps) */
  bodyLength: number;
  /** Y to translate the torso capsule up so its lowest point sits at the feet (y=0). */
  bodyLift: number;
  /** head sphere radius */
  headRadius: number;
  /** Y of the head sphere centre so the crown reaches exactly `height`. */
  headLift: number;
}

/** Derive a feet-on-ground humanoid of a given total height. Proportions (head ~1/7 of height,
 *  torso the rest) are fixed here so citizens and pedestrians share one silhouette and only the
 *  height varies. The crown (headLift + headRadius) equals `height`; the torso bottom
 *  (bodyLift - bodyRadius) equals 0. */
export function citizenFigure(height: number): CitizenFigure {
  const headRadius = height * 0.07; // ~0.12 m head at 1.7 m — a believable head:body ratio
  const headLift = height - headRadius; // crown = headLift + headRadius = height
  const bodyRadius = height * 0.13; // ~0.22 m shoulders
  // torso runs from the feet to just under the head; capsule total = 2*bodyRadius + bodyLength
  const torsoTop = height - headRadius; // torso reaches the neck
  const bodyLength = Math.max(0.1, torsoTop - 2 * bodyRadius);
  const bodyLift = bodyRadius + bodyLength / 2; // capsule centre so its bottom sits at 0
  return { bodyRadius, bodyLength, bodyLift, headRadius, headLift };
}
