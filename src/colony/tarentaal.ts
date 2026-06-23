import { COLONY } from "./config";
import type { Terrain } from "./terrain";
import type { RNG } from "../engine/rng";

export type TarentaalAge = "adult" | "chick";
export type TarentaalBehavior = "forage" | "follow" | "chase";

export interface TarentaalBird {
  id: number;
  age: TarentaalAge;
  x: number;
  y: number;
  heading: number;
  behavior: TarentaalBehavior;
  followId: number | null;
}

interface Point {
  x: number;
  y: number;
}

function isLand(terrain: Terrain, x: number, y: number): boolean {
  const gx = Math.round(x);
  const gy = Math.round(y);
  return terrain.inBounds(gx, gy) && !terrain.isWater(gx, gy);
}

function nearestLand(terrain: Terrain, target: Point, fallback: Point): Point {
  const tx = Math.round(target.x);
  const ty = Math.round(target.y);
  if (isLand(terrain, tx, ty)) return { x: tx, y: ty };
  for (let r = 1; r <= COLONY.tarentaal.landSearchRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (isLand(terrain, x, y)) return { x, y };
      }
    }
  }
  return fallback;
}

function moveToward(
  bird: TarentaalBird,
  target: Point,
  speed: number,
  dt: number,
  terrain: Terrain,
): void {
  const dx = target.x - bird.x;
  const dy = target.y - bird.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) return;
  const step = Math.min(d, speed * dt);
  const nx = bird.x + (dx / d) * step;
  const ny = bird.y + (dy / d) * step;
  const safe = nearestLand(terrain, { x: nx, y: ny }, { x: bird.x, y: bird.y });
  bird.heading = Math.atan2(safe.y - bird.y, safe.x - bird.x);
  bird.x = safe.x;
  bird.y = safe.y;
}

export function createTarentaalFlock(terrain: Terrain, rng: RNG): TarentaalBird[] {
  const anchor = nearestLand(
    terrain,
    {
      x: terrain.landing.x + COLONY.tarentaal.anchorOffset.x,
      y: terrain.landing.y + COLONY.tarentaal.anchorOffset.y,
    },
    terrain.landing,
  );
  const birds: TarentaalBird[] = [];
  for (let i = 0; i < COLONY.tarentaal.adults; i++) {
    const angle = (i / COLONY.tarentaal.adults) * Math.PI * 2;
    const radius = 1.2 + rng.next() * 1.8;
    const p = nearestLand(
      terrain,
      { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius },
      anchor,
    );
    birds.push({
      id: i,
      age: "adult",
      x: p.x,
      y: p.y,
      heading: angle,
      behavior: "forage",
      followId: null,
    });
  }
  for (let i = 0; i < COLONY.tarentaal.chicks; i++) {
    const adult = birds[i % COLONY.tarentaal.adults]!;
    const angle = adult.heading + Math.PI + (i - COLONY.tarentaal.chicks / 2) * 0.18;
    const p = nearestLand(
      terrain,
      {
        x: adult.x + Math.cos(angle) * COLONY.tarentaal.chickTrailDistance,
        y: adult.y + Math.sin(angle) * COLONY.tarentaal.chickTrailDistance,
      },
      { x: adult.x, y: adult.y },
    );
    birds.push({
      id: COLONY.tarentaal.adults + i,
      age: "chick",
      x: p.x,
      y: p.y,
      heading: adult.heading,
      behavior: "follow",
      followId: adult.id,
    });
  }
  return birds;
}

export function stepTarentaalFlock(
  birds: TarentaalBird[],
  terrain: Terrain,
  totalMinutes: number,
  dtMinutes: number,
): void {
  if (birds.length === 0) return;
  const adults = birds.filter((bird) => bird.age === "adult");
  const center = adults.reduce(
    (acc, bird) => ({ x: acc.x + bird.x / adults.length, y: acc.y + bird.y / adults.length }),
    { x: 0, y: 0 },
  );
  const tick = Math.floor(totalMinutes / COLONY.tarentaal.chasePeriodMinutes);
  const chaseLeader = adults[tick % adults.length]?.id ?? -1;
  const chaseFollower = adults[(tick + 1) % adults.length]?.id ?? -1;
  const dt = dtMinutes / 60;

  for (const bird of adults) {
    const phase = totalMinutes * COLONY.tarentaal.roamTurnRate + bird.id * 1.7;
    let target = {
      x: center.x + Math.cos(phase) * COLONY.tarentaal.flockRadius,
      y: center.y + Math.sin(phase * 0.83) * COLONY.tarentaal.flockRadius,
    };
    let speed: number = COLONY.tarentaal.adultSpeed;
    bird.behavior = "forage";
    if (bird.id === chaseLeader || bird.id === chaseFollower) {
      const dir = bird.id === chaseLeader ? 1 : -1;
      target = {
        x: bird.x + Math.cos(phase + dir * 1.1) * COLONY.tarentaal.chaseStride,
        y: bird.y + Math.sin(phase + dir * 1.1) * COLONY.tarentaal.chaseStride,
      };
      speed = COLONY.tarentaal.chaseSpeed;
      bird.behavior = "chase";
    }
    moveToward(bird, target, speed, dt, terrain);
  }

  for (const chick of birds.filter((bird) => bird.age === "chick")) {
    const adult = birds.find((bird) => bird.id === chick.followId) ?? adults[0]!;
    const trail = {
      x: adult.x - Math.cos(adult.heading) * COLONY.tarentaal.chickTrailDistance,
      y: adult.y - Math.sin(adult.heading) * COLONY.tarentaal.chickTrailDistance,
    };
    chick.behavior = "follow";
    moveToward(chick, trail, COLONY.tarentaal.chickSpeed, dt, terrain);
  }
}
