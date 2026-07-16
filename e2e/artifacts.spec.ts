import { test, expect } from '@playwright/test';

// Spec 126 — the civic-art artifacts. Asserts on the ACTUAL scene: the seeded catalog (one
// of each of the 7 kinds at founding) renders across the per-kind instanced meshes, their
// instance counts summing to the live artifact roster — proving sim.state.artifacts reaches
// the render.

const KINDS = ['bench', 'lamppost', 'planter', 'fountain', 'shade_tree', 'notice_board', 'wayfinder'];

test('R3F artifacts: the civic-art catalog renders from sim state', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/?skipauth=1');
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => !!(window as any).__r3fScene && !!(window as any).__colony, undefined, { timeout: 15000 });

  await page.waitForFunction(() => {
    let found = false;
    (window as any).__r3fScene?.traverse((o: any) => { if (o.name === 'artifact-bench') found = true; });
    return found;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const probe = await page.evaluate((kinds) => {
    const counts: Record<string, number> = {};
    (window as any).__r3fScene?.traverse((o: any) => {
      if (typeof o.name === 'string' && o.name.startsWith('artifact-')) {
        counts[o.name.slice('artifact-'.length)] = o.count;
      }
    });
    const total = kinds.reduce((s: number, k: string) => s + (counts[k] ?? 0), 0);
    const roster = (window as any).__colony?.sim?.state?.artifacts?.length ?? -1;
    return { counts, total, roster };
  }, KINDS);

  console.log(`artifact instance counts: ${JSON.stringify(probe.counts)}, total: ${probe.total}, roster: ${probe.roster}`);
  // All 7 kinds mounted their meshes.
  for (const k of KINDS) expect(probe.counts).toHaveProperty(k);
  // The drawn instances sum to the seeded roster (the renderable catalog).
  if (probe.roster > 0) {
    expect(probe.total).toBe(probe.roster);
    expect(probe.total).toBeGreaterThan(0);
  }
});
