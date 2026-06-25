import { describe, expect, it } from "vitest";
import { rallyWhoIsHereCopy } from "../src/colony/ui/ColonyApp";
import type { ColonyUiState } from "../src/colony/runtime";

function makeRally(
  override: Partial<NonNullable<ColonyUiState["rally"]>> & {
    presentCitizens?: { id: string; displayName: string }[];
  } = {},
): ColonyUiState["rally"] {
  return {
    target: { x: 10, y: 11 },
    present: 2,
    ready: true,
    carId: null,
    ...override,
  } as unknown as ColonyUiState["rally"];
}

describe("rally who-is-here social read", () => {
  it("uses the read-only present citizen list and exposes the same ids for renderer nameplates", () => {
    const read = rallyWhoIsHereCopy(
      makeRally({
        present: 2,
        presentCitizens: [
          { id: "joe", displayName: "Joe Crab" },
          { id: "jack", displayName: "Jack Kooper" },
          { id: "extra", displayName: "Extra Friend" },
        ],
      }),
      false,
    );

    expect(read).toEqual({
      title: "Night rally",
      summary: "Joe, Jack",
      citizens: [
        { id: "joe", displayName: "Joe Crab" },
        { id: "jack", displayName: "Jack Kooper" },
      ],
      signature: "joe:Joe Crab|jack:Jack Kooper",
    });
  });

  it("screens unsafe present citizen names before UI copy or renderer ids", () => {
    const read = rallyWhoIsHereCopy(
      makeRally({
        present: 2,
        presentCitizens: [
          { id: "safe", displayName: "Mara Lane" },
          { id: "unsafe", displayName: "Hermes token keeper" },
        ],
      }),
      false,
    );

    expect(read?.summary).toBe("Mara");
    expect(read?.citizens).toEqual([{ id: "safe", displayName: "Mara Lane" }]);
    expect(read?.signature).toBe("safe:Mara Lane");
  });

  it("falls back to a rounded present count until presentCitizens lands", () => {
    const read = rallyWhoIsHereCopy(
      makeRally({ present: 1.6, ready: false }),
      true,
    );

    expect(read?.title).toBe("Rally point");
    expect(read?.summary).toBe("2 present at the hilltop");
    expect(read?.citizens).toEqual([]);
    expect(read?.signature).toBe("");
  });

  it("returns null when the rally read is unavailable", () => {
    expect(rallyWhoIsHereCopy(null, false)).toBeNull();
  });
});
