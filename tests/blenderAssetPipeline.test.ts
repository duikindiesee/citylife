import { describe, expect, it } from "vitest";
import garageHeroGenerator from "../public/assets/citylife/props/generate_commercial_garage_hero.py?raw";
import rallyBenchGenerator from "../public/assets/citylife/props/generate_rally_venue_bench.py?raw";
import {
  rallyVenuePropPlacements,
  venuePropAssets,
} from "../src/colony/render/venuePropAssets";
import type { SeedStructure } from "../src/colony/sim";

const dryTerrain = {
  inBounds: (x: number, y: number) => x >= 0 && x < 192 && y >= 0 && y < 192,
  isWater: () => false,
  worldY: () => 5.191,
};

describe("Blender GLB venue prop asset pipeline", () => {
  it("registers the public-safe rally venue bench GLB", () => {
    expect(venuePropAssets).toEqual([
      {
        id: "rally-venue-bench",
        url: "/assets/citylife/props/rally-venue-bench.glb",
        instanceKind: "rallyVenueBench",
        publicSafe: true,
      },
    ]);
  });

  it("derives one deterministic rally prop placement from city coordinates", () => {
    const structures: SeedStructure[] = [{ kind: "rally", x: 91, y: 73 }];
    const first = rallyVenuePropPlacements(structures, dryTerrain as never);
    const second = rallyVenuePropPlacements(structures, dryTerrain as never);
    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        assetId: "rally-venue-bench",
        instanceKind: "rallyVenueBench",
        x: 93,
        y: 74,
        rotationTurns: 0.125,
        scale: 1,
      },
    ]);
  });

  it("does not place Blender props without a rally marker", () => {
    expect(
      rallyVenuePropPlacements([{ kind: "rocket", x: 10, y: 10 }]),
    ).toEqual([]);
  });

  it("authors the rally bench as a locked no-armrest ladder frame", () => {
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_slat_top");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_slat_middle");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_slat_bottom");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_left_holder");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_right_holder");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_backrest_clamp_pad");
    expect(rallyBenchGenerator).toContain("rally_venue_bench_underseat_glow_strip");
    expect(rallyBenchGenerator).not.toMatch(/armrest/i);
  });

  it("authors the commercial garage hero as a no-placement GLB landmark shell", () => {
    expect(garageHeroGenerator).toContain("commercial_garage_hero_showroom_glass_cube");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_showroom_car_glow");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_service_bay_shed");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_rollup_door_left");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_forecourt_lane");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_corner_pylon_sign");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_display_car_angle_left");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_rooftop_wrench_emblem");
    expect(garageHeroGenerator).toContain("commercial_garage_hero_warm_night_emissive");
    expect(garageHeroGenerator).toContain("commercial-garage-hero.glb");
    expect(garageHeroGenerator).not.toMatch(/\b(brand|logo|text|placement)\b|Math\.random|Date\.now/i);
  });
});
