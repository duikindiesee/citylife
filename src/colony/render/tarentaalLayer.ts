// Spec 125 — the tarentaal (guineafowl) flock, R3F port of the legacy updateTarentaal path.
// Unlike the decorative pedestrian crowd, the flock is NOT renderer ambience: positions come
// from the deterministic ColonySim tick (stepTarentaalFlock), so R3FTarentaal reads
// sim.state.tarentaal directly and this module holds the PURE placement math + the
// legacy-verbatim proportions/colors so it is all node-testable.
import type { TarentaalBird } from '../tarentaal';

/** Legacy adult/chick geometry: a scaled, base-lifted sphere (a low-poly bird body). */
export const TARENTAAL_ADULT = {
  radius: 0.22, wseg: 8, hseg: 6, scale: [1.25, 0.72, 0.82] as const, translateY: 0.22, color: 0x32343a,
} as const;
export const TARENTAAL_CHICK = {
  radius: 0.12, wseg: 7, hseg: 5, scale: [1.15, 0.78, 0.82] as const, translateY: 0.12, color: 0x8c7444,
} as const;

/** A chasing bird bobs higher and takes a longer stride (the legacy "chase" flourish). */
export function birdBob(behavior: TarentaalBird['behavior']): number {
  return behavior === 'chase' ? 0.035 : 0.01;
}
export function birdStride(behavior: TarentaalBird['behavior']): number {
  return behavior === 'chase' ? 1.18 : 1;
}

export interface TarentaalTransform {
  wx: number;
  wy: number;
  wz: number;
  /** Y rotation — the legacy convention is -heading (heading already points along travel). */
  rotY: number;
  /** Uniform X/Z scale (stride); Y stays 1. */
  stride: number;
}

/** Grid cell -> world transform for one bird (same 4m grid as everything else); wy adds the
 *  behavior bob on top of the ground. */
export function tarentaalTransform(
  bird: Pick<TarentaalBird, 'x' | 'y' | 'heading' | 'behavior'>,
  size: number,
  groundY: (x: number, y: number) => number,
): TarentaalTransform {
  return {
    wx: (bird.x - size / 2) * 4,
    wy: Math.max(0, groundY(Math.round(bird.x), Math.round(bird.y))) + birdBob(bird.behavior),
    wz: (bird.y - size / 2) * 4,
    rotY: -bird.heading,
    stride: birdStride(bird.behavior),
  };
}
