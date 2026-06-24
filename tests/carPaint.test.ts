import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { PAINT_PALETTES } from "../src/colony/car/carSpec";

// Spec 096 H — paint customisation. setCarPaint repaints a channel of the player's car, but only with a
// colour from that channel's curated palette, so paint stays curated and deterministic. carMesh reads
// the stored paint, so a repaint shows on the in-world car. localStorage-backed car spec, so the test
// installs a mock and sets the operator.
describe("car paint (096 H)", () => {
  const realLS = (globalThis as { localStorage?: Storage }).localStorage;
  beforeEach(() => {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = realLS;
  });

  it("is operator-gated", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.getUiState().garage).toBeNull();
    expect(rt.setCarPaint("body", PAINT_PALETTES.body[0]!)).toBe(false);
  });

  it("repaints a channel with a palette colour and rejects off-palette / unknown channels", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);

    const paint = () => rt.getUiState().garage!.paint;
    // the snapshot exposes all three channels, each with its current colour + palette options
    expect(paint().map((p) => p.channel)).toEqual(["body", "cabin", "accent"]);
    expect(paint().find((p) => p.channel === "body")!.options).toEqual(
      PAINT_PALETTES.body,
    );

    // pick a body colour DIFFERENT from the current one and apply it
    const body = paint().find((p) => p.channel === "body")!;
    const next = PAINT_PALETTES.body.find((c) => c !== body.current)!;
    expect(rt.setCarPaint("body", next)).toBe(true);
    expect(
      rt.getUiState().garage!.paint.find((p) => p.channel === "body")!.current,
    ).toBe(next);

    // an off-palette colour is rejected and leaves the paint unchanged
    expect(rt.setCarPaint("body", 0x123456)).toBe(false);
    expect(
      rt.getUiState().garage!.paint.find((p) => p.channel === "body")!.current,
    ).toBe(next);

    // an unknown channel is a no-op
    expect(rt.setCarPaint("wheels", PAINT_PALETTES.body[0]!)).toBe(false);
  });
});
