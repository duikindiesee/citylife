import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { ColonySim } from "../src/colony/sim";
import { updateTraffic } from "../src/colony/traffic";
import { RNG } from "../src/engine/rng";
import type { Artifact } from "../src/colony/build";
import {
  COMMERCIAL_START_MAX_DIST,
  MIN_RACE_TRACK_LENGTH,
  commercialFrontageExclusion,
  makeRaceTrack,
  nearestTrackPoint,
  trackProgress,
  type RaceRoadState,
  type RaceTrack,
} from "../src/colony/racing/track";
import {
  newRaceState,
  stepRace,
  type RaceState,
} from "../src/colony/racing/race";

const SEEDS = [4242, 42, 7];
const RT_CACHE = new Map<number, ColonyRuntime>();

function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}

function commercialCenter(rt: ColonyRuntime): { x: number; y: number } | null {
  const intersection = rt.commercialDistrict?.intersection;
  if (intersection) return intersection;
  const street = rt.commercialDistrict?.street;
  if (street && street.length > 0) {
    let sx = 0,
      sy = 0;
    for (const c of street) {
      sx += c.x;
      sy += c.y;
    }
    return { x: sx / street.length, y: sy / street.length };
  }
  const reserve = rt.commercialReserve;
  return reserve
    ? { x: reserve.x + reserve.w / 2, y: reserve.y + reserve.h / 2 }
    : null;
}

function trackFor(seed: number): RaceTrack {
  const rt = rtFor(seed);
  const track = makeRaceTrack(rt.sim.state, {
    commercialCenter: commercialCenter(rt),
    lighthouse: rt.sim.state.structures.find((s) => s.kind === "lighthouse"),
    seed,
    excludeCells: commercialFrontageExclusion(rt.commercialDistrict),
  });
  expect(track).not.toBeNull();
  return track!;
}

function roadKey(x: number, y: number): string {
  return `${x},${y}`;
}

function art(id: number, kind: "habitat" | "commercial"): Artifact {
  return {
    id,
    kind,
    color: 0xffffff,
    height: 1,
    residents: kind === "habitat" ? 3 : 0,
    jobs: kind === "commercial" ? 8 : 0,
    powerLoad: 0,
    powerGen: 0,
    buildTimeMin: 0,
    cost: 0,
    materialsCost: 0,
    crew: 0,
    materialsGen: 0,
  };
}

function seededTrafficTown(): ColonySim {
  const sim = new ColonySim(4242);
  const streets = sim.state.roads.filter(
    (r) => (r.kind ?? "street") === "street",
  );
  const a = streets[0]!;
  const b = streets[streets.length - 1]!;
  sim.state.buildings.push({
    id: 9001,
    x: a.x,
    y: a.y - 1,
    artifact: art(9001, "habitat"),
  });
  sim.state.buildings.push({
    id: 9002,
    x: b.x,
    y: b.y + 1,
    artifact: art(9002, "commercial"),
  });
  sim.state.colonists = 40;
  return sim;
}

function trafficBytes(sim: ColonySim): unknown {
  return sim.state.cars.map((c) => ({
    id: c.id,
    x: Number(c.x.toFixed(6)),
    y: Number(c.y.toFixed(6)),
    heading: Number(c.heading.toFixed(6)),
    path: [...c.path],
    held: c.held,
    waitTimer: c.waitTimer,
    goingTo: c.goingTo,
  }));
}

function tinyRoadState(): RaceRoadState {
  const size = 8;
  const roadKind = new Map<string, "street">();
  for (let x = 1; x <= 6; x++) roadKind.set(roadKey(x, 3), "street");
  return {
    terrain: {
      size,
      inBounds: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < size && y < size,
      isWater: () => false,
    },
    roadKind,
    roadsVersion: 1,
  };
}

function manualTrack(): RaceTrack {
  return {
    checkpoints: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ],
    path: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ],
    length: 3,
    loop: false,
    seed: 1,
    roadsVersion: 1,
    roadKinds: {
      "1,1": "street",
      "2,1": "street",
      "3,1": "street",
      "4,1": "street",
    },
  };
}

function running(track: RaceTrack, x: number, y: number): RaceState {
  const r = newRaceState(track);
  return {
    ...r,
    mode: "running",
    countdownMs: 0,
    nextCheckpoint: track.checkpoints.length,
    car: { ...r.car, x, y, speed: 0 },
  };
}

describe("spec 087 road rally track generation", () => {
  it("is deterministic for seed 4242 across fresh boots", () => {
    const a = trackFor(4242);
    const rt = new ColonyRuntime(4242);
    const b = makeRaceTrack(rt.sim.state, {
      commercialCenter: commercialCenter(rt),
      lighthouse: rt.sim.state.structures.find((s) => s.kind === "lighthouse"),
      seed: 4242,
      excludeCells: commercialFrontageExclusion(rt.commercialDistrict),
    });
    expect(b).toEqual(a);
  }, 30000);

  it("does not advance the sim rng that traffic consumes", () => {
    const withTrack = seededTrafficTown();
    const withoutTrack = seededTrafficTown();
    makeRaceTrack(withTrack.state, { commercialCenter: null, seed: 4242 });
    for (let i = 0; i < 260; i++) {
      withTrack.step();
      withoutTrack.step();
    }
    expect(trafficBytes(withTrack)).toEqual(trafficBytes(withoutTrack));
    expect(withTrack.state.cars.length).toBeGreaterThan(0);
  });

  it("puts checkpoints and the full route only on dry roadKind cells", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const track = trackFor(seed);
      for (const cp of track.checkpoints) {
        expect(
          rt.sim.state.roadKind.has(roadKey(cp.x, cp.y)),
          `checkpoint ${cp.x},${cp.y}`,
        ).toBe(true);
        expect(
          rt.sim.state.terrain.isWater(cp.x, cp.y),
          `checkpoint water ${cp.x},${cp.y}`,
        ).toBe(false);
      }
      for (const p of track.path) {
        expect(
          rt.sim.state.roadKind.has(roadKey(p.x, p.y)),
          `path ${p.x},${p.y}`,
        ).toBe(true);
        expect(
          rt.sim.state.terrain.isWater(p.x, p.y),
          `path water ${p.x},${p.y}`,
        ).toBe(false);
      }
    }
  }, 30000);

  it("has a first-class null-commercial out-and-back fallback on a minimal road line", () => {
    const track = makeRaceTrack(tinyRoadState(), {
      commercialCenter: null,
      seed: 7,
    });
    expect(track).not.toBeNull();
    expect(track!.loop).toBe(false);
    expect(track!.checkpoints.length).toBeGreaterThanOrEqual(4);
    expect(track!.path[0]).toEqual(track!.path[track!.path.length - 1]);
  });

  it("keeps the start checkpoint out of the Nearest bar footprint and frontage", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const excluded = commercialFrontageExclusion(rt.commercialDistrict);
      const track = trackFor(seed);
      const intersection = rt.commercialDistrict!.intersection!;
      expect(excluded.has(roadKey(intersection.x, intersection.y))).toBe(false);
      expect(rt.sim.state.roadKind.has(roadKey(intersection.x, intersection.y))).toBe(true);
      expect(
        Math.hypot(
          track.checkpoints[0]!.x - intersection.x,
          track.checkpoints[0]!.y - intersection.y,
        ),
      ).toBeLessThanOrEqual(2);
      for (const cp of track.checkpoints)
        expect(excluded.has(roadKey(cp.x, cp.y))).toBe(false);
    }
  }, 30000);

  it("honors the numeric contracts on live seeds", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const center = commercialCenter(rt);
      const track = trackFor(seed);
      expect(track.checkpoints.length).toBeGreaterThanOrEqual(4);
      expect(track.checkpoints.length).toBeLessThanOrEqual(7);
      expect(track.length).toBeGreaterThanOrEqual(MIN_RACE_TRACK_LENGTH);
      if (center)
        expect(
          Math.hypot(
            track.checkpoints[0]!.x - center.x,
            track.checkpoints[0]!.y - center.y,
          ),
        ).toBeLessThanOrEqual(COMMERCIAL_START_MAX_DIST);
    }
  }, 30000);
});

describe("spec 087 road rally race stepper", () => {
  it("progresses checkpoints in order and finishes with injected dt timing", () => {
    let race = newRaceState(manualTrack());
    race = stepRace(race, {}, 3000);
    expect(race.mode).toBe("running");
    race = { ...race, car: { ...race.car, x: 2, y: 1 } };
    race = stepRace(race, {}, 100);
    expect(race.nextCheckpoint).toBe(2);
    race = { ...race, car: { ...race.car, x: 3, y: 1 } };
    race = stepRace(race, {}, 200);
    expect(race.nextCheckpoint).toBe(3);
    race = { ...race, car: { ...race.car, x: 4, y: 1 } };
    race = stepRace(race, {}, 300);
    expect(race.mode).toBe("finished");
    expect(race.finishedMs).toBe(600);
  });

  it("reports nearest-track geometry and slows/pulls the car when off track", () => {
    const track = manualTrack();
    const near = nearestTrackPoint(track, 2, 3);
    expect(near.x).toBeCloseTo(2, 5);
    expect(near.y).toBeCloseTo(1, 5);
    expect(trackProgress(track, 3.2, 1)).toBeCloseTo(2.2, 5);

    const on = stepRace(running(track, 2, 1), { accelerate: true }, 250);
    const off = stepRace(running(track, 2, 4), { accelerate: true }, 250);
    expect(off.car.speed).toBeLessThan(on.car.speed);
    expect(off.car.y).toBeLessThan(4);
    expect(off.offTrack).toBe(true);
  });

  it("can still drive traffic in the injected-town fixture", () => {
    const sim = seededTrafficTown();
    const rng = new RNG(7);
    for (let i = 0; i < 200; i++) updateTraffic(sim.state, rng, 1.5);
    expect(sim.state.cars.length).toBeGreaterThan(0);
  });
});
