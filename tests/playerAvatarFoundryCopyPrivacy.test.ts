import { describe, expect, it } from "vitest";
import { avatarFoundryCopy } from "../src/colony/ui/ColonyApp";
import { isPublicSafe } from "../src/colony/newcomers";

describe("player HUD avatar foundry copy privacy", () => {
  it("hides pod and routing internals from player-scoped HUD copy", () => {
    const copy = avatarFoundryCopy({
      foundries: 1,
      staffed: true,
      capacity: 3,
      playerScoped: true,
    });

    expect(copy.summary).toBe("1 foundry · up to 3 avatars");
    expect(copy.title).toBe(
      "The Avatar Foundry gives approved citizens an in-world body so players can meet them and step into their own view.",
    );
    expect(isPublicSafe(copy.summary)).toBe(true);
    expect(isPublicSafe(copy.title)).toBe(true);
    expect(copy.title).not.toMatch(
      /DMZ|namespace|pod|Hermes|kooker-service-ai|routing|cluster|intranet/i,
    );
  });

  it("keeps richer operator copy for admin HUDs", () => {
    const copy = avatarFoundryCopy({
      foundries: 1,
      staffed: true,
      capacity: 3,
      playerScoped: false,
    });

    expect(copy.summary).toBe("1 foundry · mints up to 3");
    expect(copy.title).toMatch(/citizen avatar/);
    expect(copy.title).toMatch(/capacity/);
    expect(copy.title).not.toBe(
      "The Avatar Foundry gives approved citizens an in-world body so players can meet them and step into their own view.",
    );
  });
});
