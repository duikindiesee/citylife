// Seeded value-noise with fractal (fBm) and ridged variants. No dependencies.
import { RNG } from "../engine/rng";

export class Noise {
  private perm: Uint8Array;

  constructor(rng: RNG) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher–Yates with the seeded RNG
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  private hash(ix: number, iy: number): number {
    return this.perm[(ix + this.perm[iy & 255]!) & 255]! / 255; // [0,1]
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** Value noise in [-1, 1]. */
  value2(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const v00 = this.hash(x0, y0);
    const v10 = this.hash(x0 + 1, y0);
    const v01 = this.hash(x0, y0 + 1);
    const v11 = this.hash(x0 + 1, y0 + 1);
    const u = Noise.fade(fx);
    const v = Noise.fade(fy);
    const a = v00 + (v10 - v00) * u;
    const b = v01 + (v11 - v01) * u;
    return (a + (b - a) * v) * 2 - 1;
  }

  /** Fractal Brownian motion in roughly [-1, 1]. */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] — sharp mountain ridges. */
  ridged(
    x: number,
    y: number,
    octaves = 5,
    lacunarity = 2,
    gain = 0.5,
  ): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.value2(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
