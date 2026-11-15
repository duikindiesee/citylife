import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const REVIEWED_SEED_4242_MANIFEST = new URL(
  "../../fixtures/canonical-world/seed-4242-starter-parcel-manifest-57f-v4-candidate.json",
  import.meta.url,
);

/** Satisfy authenticated world boot without contacting the gateway or bypassing auth. */
export async function stubPublishedStarterCatalogue(page: Page): Promise<void> {
  const manifest: unknown = JSON.parse(readFileSync(REVIEWED_SEED_4242_MANIFEST, "utf8"));
  await page.route("**/kooker/api/v1/citylife/worlds/seed-4242/starter-catalogue", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      json: { published: true, manifest },
    });
  });
}
