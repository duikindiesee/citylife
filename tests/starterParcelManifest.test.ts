import { beforeAll, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import { createStarterParcelManifest } from "../src/colony/starterParcelManifest";
import { parseWorldLayoutDocument, serializeWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";

describe("canonical player parcel manifest", () => {
  let runtime: ColonyRuntime;
  let input: Parameters<typeof createStarterParcelManifest>[0];
  beforeAll(() => {
    runtime = new ColonyRuntime(4242, { surveyOnly: true });
    input = { layout: runtime.captureWorldLayout(), parcels: runtime.lots(),
      groundClear: c => cellOk(runtime.sim.state.terrain, c.x, c.y) };
  });

  it("binds real plots to canonical child frames and the final document hash", () => {
    const before = JSON.stringify(input.layout);
    const manifest = createStarterParcelManifest(input);
    expect(manifest.plots).toHaveLength(10);
    expect(manifest.rejected).toHaveLength(10);
    expect(manifest.status).toBe("REVIEW_REQUIRED_NOT_PUBLISHED");
    expect(manifest.layout.revision.parentHash).toBe(input.layout.revision.contentHash);
    expect(manifest.layoutRevision).not.toBe(manifest.sourceLayoutRevision);
    expect(parseWorldLayoutDocument(serializeWorldLayoutDocument(manifest.layout))).toEqual(manifest.layout);
    const surface = input.layout.frames.find(f => f.kind === "region" && f.layer === "surface" && f.grid)!;
    for (const plot of manifest.plots) {
      const frame = manifest.layout.frames.find(f => f.id === plot.frameId)!;
      expect(plot.geometry.layoutRevision).toBe(manifest.layoutRevision);
      expect(frame.parentId).toBe(surface.id);
      expect(frame.kind).toBe("region");
      expect(frame.grid!.width).toBe(plot.geometry.parcel.width);
      const spawn = plot.geometry.spawn;
      // Local spawn transformed through the parcel frame equals its original surface cell centre.
      expect(frame.transform.position.x + (spawn.x - plot.geometry.parcel.x) * frame.grid!.cellSize)
        .toBe(surface.grid!.origin.x + spawn.x * surface.grid!.cellSize);
      expect(frame.transform.position.z + (spawn.y - plot.geometry.parcel.y) * frame.grid!.cellSize)
        .toBe(surface.grid!.origin.z + spawn.y * surface.grid!.cellSize);
      expect(plot).not.toHaveProperty("priceKco");
      expect(plot).not.toHaveProperty("ownerId");
    }
    expect(JSON.stringify(input.layout)).toBe(before);
    expect(createStarterParcelManifest({ ...input, parcels: [...input.parcels].reverse() })).toEqual(manifest);
    const hydrated = new ColonyRuntime(4242, { surveyOnly: true, playerInventory: {
      worldId: manifest.worldId, layoutRevision: manifest.layoutRevision,
      layout: manifest.layout, plotIds: manifest.plots.map(p => p.plotId),
    } });
    expect(hydrated.captureWorldLayout().revision.contentHash).toBe(manifest.layoutRevision);
    for (const plot of manifest.plots) expect(hydrated.isPlayerParcel(plot.plotId)).toBe(true);
    expect(() => new ColonyRuntime(4242, { surveyOnly: true, playerInventory: {
      worldId: manifest.worldId, layoutRevision: manifest.sourceLayoutRevision,
      layout: manifest.layout, plotIds: manifest.plots.map(p => p.plotId),
    } })).toThrow(/inventory identity/);
  });

  it("rejects blocked terrain and cannot treat its own framed output as a fresh survey", () => {
    expect(() => createStarterParcelManifest({ ...input, groundClear: () => false })).toThrow(/No qualified/);
    const manifest = createStarterParcelManifest(input);
    expect(() => createStarterParcelManifest({ ...input, layout: manifest.layout })).toThrow(/canonical surface/);
  });
});
