import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstPersonMouseLookBar } from "../src/colony/ui/ColonyApp";

describe("FirstPersonMouseLookBar", () => {
  it("shows player-facing guidance when pointer lock is unavailable or denied", () => {
    const html = renderToStaticMarkup(
      React.createElement(FirstPersonMouseLookBar, {
        citizenName: "Joe",
        mouseLookLocked: false,
        pointerLockError:
          "Mouse-look unavailable — click the city view and try again.",
        requestMouseLook() {},
        levelFirstPersonLook() {},
        setMouseSensitivity() {},
        mouseSensitivity: "normal",
      }),
    );

    expect(html).toContain("Seeing through");
    expect(html).toContain("Joe");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("Look");
    expect(html).toContain("Mouse-look unavailable — click the city view and try again.");
    expect(html).not.toContain("Retry mouse-look");
    expect(html).not.toContain("Level view");
    expect(html).not.toContain("Look sensitivity");
  });
});
