import { describe, expect, it } from "vitest";
import {
  kookerbookProfileUrl,
  isKookerbookCitizenId,
  kookerbookInitialSelection,
  kookerbookCanonicalProfileUrl,
  kookerbookDirectoryLink,
} from "../src/colony/social/kookerbookNav";

describe("Kookerbook in-browser navigation", () => {
  it("builds a same-page profile URL with a screened citizen id", () => {
    const url = kookerbookProfileUrl(
      "https://citylife.example/kookerbook.html?citizen=citizen_joe&debug=1#old",
      "citizen_jack",
    );

    expect(url).toBe(
      "https://citylife.example/kookerbook.html?citizen=citizen_jack#old",
    );
  });

  it("refuses unsafe or non-citizen profile targets", () => {
    expect(isKookerbookCitizenId("citizen_jack")).toBe(true);
    expect(isKookerbookCitizenId("../admin")).toBe(false);
    expect(isKookerbookCitizenId("citizen_http://internal")).toBe(false);
    expect(isKookerbookCitizenId("profile_jack")).toBe(false);
  });

  it("opens a direct profile link only when the target is public-safe and loaded", () => {
    const ids = ["citizen_joe", "citizen_jack"];

    expect(
      kookerbookInitialSelection(
        "https://citylife.example/kookerbook.html?citizen=citizen_jack",
        ids,
      ),
    ).toBe("citizen_jack");

    expect(
      kookerbookInitialSelection(
        "https://citylife.example/kookerbook.html?citizen=../admin",
        ids,
      ),
    ).toBe("citizen_joe");

    expect(
      kookerbookInitialSelection(
        "https://citylife.example/kookerbook.html?citizen=citizen_missing",
        ids,
      ),
    ).toBe("citizen_joe");
  });

  it("canonicalizes stale or unsafe direct links to the selected loaded profile", () => {
    const ids = ["citizen_joe", "citizen_jack"];

    expect(
      kookerbookCanonicalProfileUrl(
        "https://citylife.example/kookerbook.html?citizen=citizen_jack&debug=1#directory",
        ids,
      ),
    ).toBe("https://citylife.example/kookerbook.html?citizen=citizen_jack#directory");

    expect(
      kookerbookCanonicalProfileUrl(
        "https://citylife.example/kookerbook.html?citizen=../admin&debug=1#directory",
        ids,
      ),
    ).toBe("https://citylife.example/kookerbook.html?citizen=citizen_joe#directory");

    expect(
      kookerbookCanonicalProfileUrl(
        "https://citylife.example/kookerbook.html?citizen=citizen_missing&debug=1#directory",
        ids,
      ),
    ).toBe("https://citylife.example/kookerbook.html?citizen=citizen_joe#directory");
  });

  it("builds accessible directory link metadata for loaded public profiles", () => {
    expect(
      kookerbookDirectoryLink({
        currentHref: "https://citylife.example/kookerbook.html?citizen=citizen_joe#directory",
        citizenId: "citizen_jack",
        alias: "Jack the Scout",
        selectedCitizenId: "citizen_jack",
      }),
    ).toEqual({
      href: "https://citylife.example/kookerbook.html?citizen=citizen_jack#directory",
      ariaLabel: "Open Kookerbook profile for Jack the Scout",
      ariaCurrent: "page",
    });

    expect(
      kookerbookDirectoryLink({
        currentHref: "https://citylife.example/kookerbook.html",
        citizenId: "citizen_http://internal",
        alias: "Unsafe",
        selectedCitizenId: "citizen_joe",
      }),
    ).toBeNull();
  });
});
