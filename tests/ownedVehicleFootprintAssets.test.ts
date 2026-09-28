// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import {execFileSync} from "node:child_process";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import {resolve} from "node:path";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import process from "node:process";
import {expect, it} from "vitest";
import {COLONY} from "../src/colony/config";
import {SHOWROOM_VEHICLES} from "../src/colony/showroom/showroomCatalog";

it("the owned-car collision envelope contains every current showroom GLB", () => {
  const rows = (execFileSync(process.execPath, [resolve("scripts/measureOwnedVehicleModels.mjs")], {encoding:"utf8"}) as string)
    .trim().split(/\r?\n/).map(line => JSON.parse(line) as {name:string; size:{x:number;y:number;z:number}});
  for (const vehicle of SHOWROOM_VEHICLES.filter(v => v.glbUrl)) {
    // The measurement script and renderer must agree on model rotation.
    expect(vehicle.rotationOffset).toEqual([0, -Math.PI/2, 0]);
    const row = rows.find(r => vehicle.glbUrl!.endsWith(`/${r.name}.glb`));
    expect(row, vehicle.spec.id).toBeDefined();
    expect(row!.size.x).toBeGreaterThan(0);
    expect(row!.size.z).toBeGreaterThan(0);
    expect(row!.size.x).toBeLessThanOrEqual(2*COLONY.ownedDriving.halfLengthMetres);
    expect(row!.size.z).toBeLessThanOrEqual(2*COLONY.ownedDriving.halfWidthMetres);
  }
});
