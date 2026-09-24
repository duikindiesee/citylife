import { describe, expect, it } from "vitest";
import { resolveOwnedCar } from "../src/colony/car/ownedCar";

describe("authoritative single-car selection", () => {
  it("normalizes aliases without changing the owned model", () => {
    expect(
      resolveOwnedCar(["karoo-x19-targa", "showroom:karoo-x19-targa"])?.id,
    ).toBe("showroom:karoo-x19-targa");
  });
  it("never invents ownership from missing, unknown or conflicting truth", () => {
    for (const keys of [
      null,
      [],
      ["unknown"],
      ["karoo-vonk-11", "karoo-x19-targa"],
    ]) {
      expect(resolveOwnedCar(keys)).toBeNull();
    }
  });
});
