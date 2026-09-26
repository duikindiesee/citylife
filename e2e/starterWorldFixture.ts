import type { Page } from "@playwright/test";
import { createServer } from "vite";

let fixture: Promise<string> | undefined;
export function starterWorldFixture(): Promise<string> {
  return fixture ??= (async () => {
    const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    try {
      const { ColonyRuntime } = await server.ssrLoadModule("/src/colony/runtime.ts");
      const { COLONY } = await server.ssrLoadModule("/src/colony/config.ts");
      const { cellOk } = await server.ssrLoadModule("/src/colony/pathfind.ts");
      const { createStarterParcelManifest } = await server.ssrLoadModule("/src/colony/starterParcelManifest.ts");
      const runtime = new ColonyRuntime(COLONY.render.seed, { surveyOnly: true });
      const manifest = createStarterParcelManifest({layout:runtime.captureWorldLayout(),parcels:runtime.lots(),
        groundClear:(cell:{x:number;y:number})=>cellOk(runtime.sim.state.terrain,cell.x,cell.y)});
      return JSON.stringify({published:true,manifest});
    } finally { await server.close(); }
  })();
}
export async function installStarterWorldFixture(page: Page) {
  await installVehicleOffersFixture(page);
  // Authenticated player bootstrap now requires its authoritative arrival reads before mounting the
  // HUD. Supply a safe default for unrelated UI tests; tests of enabled/owned journeys install their
  // own route after this helper so their exact server truth takes precedence.
  await page.route("**/feature-flags/new-player-journey-v1", route => route.fulfill({status:200,
    contentType:"application/json",body:JSON.stringify({enabled:false,state:"OFF"})}));
  await page.route("**/players/me/vehicle", route => route.fulfill({status:200,
    contentType:"application/json",body:JSON.stringify({owned:false})}));
  await page.route("**/players/me/home", route => route.fulfill({status:200,
    contentType:"application/json",body:JSON.stringify({owned:false,status:"NONE",plotOwned:false,
      requiresBuild:false,onboardingState:"NONE"})}));
  const body = await starterWorldFixture();
  await page.route("**/worlds/seed-4242/starter-catalogue", route =>
    route.fulfill({status:200,contentType:"application/json",body}));
}

export async function installVehicleOffersFixture(page:Page){
  await page.route("**/players/me/vehicle/offers",route=>route.fulfill({status:200,
    contentType:"application/json",body:JSON.stringify([
      {vehicleKey:"karoo-vonk-11",priceKco:250,currency:"KCO"},
      {vehicleKey:"karoo-kaap-gt-v8",priceKco:2400,currency:"KCO"},
      {vehicleKey:"karoo-x19-targa",priceKco:950,currency:"KCO"},
    ])}));
}
