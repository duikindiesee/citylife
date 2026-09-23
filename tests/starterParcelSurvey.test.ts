import { beforeAll, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import { surveyStarterParcels, surveyStarterDrivewayClearance } from "../src/colony/starterParcelSurvey";
import { stepOwnedDrive } from "../src/colony/car/ownedDriving";
import { SHOWROOM_VEHICLES } from "../src/colony/showroom/showroomCatalog";

describe("starter parcel survey of the real generated world", () => {
  let input: Parameters<typeof surveyStarterParcels>[0];
  beforeAll(() => {
    const runtime = new ColonyRuntime(4242, { surveyOnly: true });
    const layout = runtime.captureWorldLayout();
    input = {
      worldId: layout.worldId, layoutRevision: layout.revision.contentHash,
      parcels: runtime.lots(), roads: runtime.sim.state.roads,
      groundClear: c => cellOk(runtime.sim.state.terrain, c.x, c.y),
    };
  });

  it("keeps real parcel identity and stops the connected approach before the house", () => {
    const survey = surveyStarterParcels(input);
    expect(survey.candidates).toHaveLength(10);
    expect(survey.rejected).toHaveLength(10);
    const roads = new Set(input.roads.map(c => `${c.x},${c.y}`));
    for (const candidate of survey.candidates) {
      const lot = input.parcels.find(l => l.id === candidate.plotId)!;
      expect(candidate.neighbourhoodKey).toBe(lot.neighborhoodKey);
      expect(candidate.layoutRevision).toBe(input.layoutRevision);
      expect(roads.has(`${candidate.driveway[0].x},${candidate.driveway[0].y}`)).toBe(true);
      expect(roads.has(`${candidate.spawn.x},${candidate.spawn.y}`)).toBe(false);
      expect(candidate.driveway).toContainEqual(candidate.spawn);
      expect(candidate.parcel.width).toBe(lot.w);
      expect(candidate.parcel.depth).toBe(lot.h);
      for (const c of candidate.driveway) {
        const h = candidate.houseZone;
        expect(c.x >= h.x && c.x < h.x + h.width && c.y >= h.y && c.y < h.y + h.depth).toBe(false);
      }
    }
    // The converter must not rewrite the pedestrian paths used by existing residents.
    expect(input.parcels.find(l => l.id === "wood1_lot_1")!.driveway).toHaveLength(5);
    expect(surveyStarterParcels(input)).toEqual(survey);
  });

  it("refuses disconnected roads and blocked approach terrain", () => {
    expect(surveyStarterParcels({...input, roads: []}).candidates).toEqual([]);
    expect(surveyStarterParcels({...input, groundClear: () => false}).candidates).toEqual([]);
  });

  it("drives the X19 from every surveyed spawn onto its real road using production movement", () => {
    const candidates = surveyStarterParcels(input).candidates;
    const stats = SHOWROOM_VEHICLES.find(v => v.spec.id === "showroom:karoo-x19-targa")!.spec.stats;
    for (const candidate of candidates) {
      const lot = input.parcels.find(l => l.id === candidate.plotId)!;
      const clearance = surveyStarterDrivewayClearance(candidate, lot, input.roads, input.groundClear);
      expect(clearance.clear, candidate.plotId).toBe(true);
      const permitted = new Set([...input.roads, ...candidate.driveway].map(c => `${c.x},${c.y}`));
      const fence = new Set(lot.fence.map(c => `${c.x},${c.y}`));
      let pose = {...candidate.spawn, heading:clearance.heading, speed:0};
      const road = candidate.driveway[0];
      let reached = false;
      for (let frame = 0; frame < 2400; frame++) {
        pose = stepOwnedDrive(pose, pose.speed < 1 ? {throttle:true} : {brake:true}, stats, 1/60,
          (x,y) => permitted.has(`${Math.round(x)},${Math.round(y)}`) &&
            !fence.has(`${Math.round(x)},${Math.round(y)}`) &&
            input.groundClear({x:Math.round(x), y:Math.round(y)}));
        if (Math.hypot(pose.x-road.x,pose.y-road.y) < 0.1) { reached = true; break; }
      }
      expect(reached, candidate.plotId).toBe(true);
      expect(surveyStarterDrivewayClearance(candidate, {...lot, fence:[...lot.fence, candidate.spawn]}, input.roads, input.groundClear).clear).toBe(false);
    }
  });

  it("does not sell an occupied, built, founder or commercial parcel", () => {
    const lot = input.parcels.find(l => l.id === "wood1_lot_1")!;
    for (const change of [{ownerCitizenId:"resident"}, {built:true}, {reservedFor:"founder"}, {zone:"commercial" as const}]) {
      const survey = surveyStarterParcels({...input, parcels: [{...lot, ...change}]});
      expect(survey.candidates).toEqual([]);
      expect(survey.rejected[0].reason).toBe("occupied-or-reserved");
    }
  });

  it("refuses malformed geometry and duplicate IDs rather than fabricating replacements", () => {
    const lot = input.parcels.find(l => l.id === "wood1_lot_1")!;
    expect(surveyStarterParcels({...input, parcels:[{...lot, w:lot.w + 1}]}).candidates).toEqual([]);
    expect(() => surveyStarterParcels({...input, parcels:[lot, lot]})).toThrow("Duplicate parcel");
    expect(() => surveyStarterParcels({...input, layoutRevision:"latest"})).toThrow("SHA256");
  });
});
