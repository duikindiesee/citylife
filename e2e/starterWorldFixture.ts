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
  const body = await starterWorldFixture();
  await page.route("**/worlds/seed-4242/starter-catalogue", route =>
    route.fulfill({status:200,contentType:"application/json",body}));
}
