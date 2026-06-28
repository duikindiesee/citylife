import { describe, it, expect } from "vitest";
import {
  formatCode,
  stripCode,
  isCodeComplete,
  MIN_CODE_HEX,
} from "../src/colony/visitorCode";

describe("visitorCode", () => {
  it("formats hex into upper-cased 4-char groups", () => {
    expect(formatCode("abcd1234")).toBe("ABCD-1234");
    expect(formatCode("a1b2c3")).toBe("A1B2-C3");
  });

  it("strips non-hex characters as you type", () => {
    expect(formatCode("ghij-ab12")).toBe("AB12"); // g,h,i,j are not hex
    expect(formatCode("  ab cd 12  ")).toBe("ABCD-12");
  });

  it("caps at 32 hex chars (128-bit)", () => {
    const long = "0123456789abcdef0123456789abcdef0123"; // 36 hex
    expect(stripCode(formatCode(long))).toHaveLength(32);
  });

  it("stripCode removes the display hyphens", () => {
    expect(stripCode("ABCD-1234-EF")).toBe("ABCD1234EF");
  });

  it("isCodeComplete requires at least MIN_CODE_HEX hex chars", () => {
    expect(MIN_CODE_HEX).toBe(16);
    expect(isCodeComplete("ABCD-1234-EF")).toBe(false); // 10 hex
    expect(isCodeComplete(formatCode("0123456789abcdef"))).toBe(true); // 16 hex
  });
});
