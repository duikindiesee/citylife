import { describe, expect, it } from "vitest";
import { FIRST_PERSON_KEY_CODES, normalizeFirstPersonKeyCode } from "../src/colony/ui/firstPersonKeys";

describe("first-person keyboard input boundary", () => {
  it("includes Shift sprint keys and normalizes browser codes for runtime input", () => {
    expect(FIRST_PERSON_KEY_CODES.has("ShiftLeft")).toBe(true);
    expect(FIRST_PERSON_KEY_CODES.has("ShiftRight")).toBe(true);
    expect(normalizeFirstPersonKeyCode("KeyW")).toBe("w");
    expect(normalizeFirstPersonKeyCode("ArrowRight")).toBe("arrowright");
    expect(normalizeFirstPersonKeyCode("ShiftLeft")).toBe("ShiftLeft");
    expect(normalizeFirstPersonKeyCode("ShiftRight")).toBe("ShiftRight");
  });
});
