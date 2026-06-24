import { describe, expect, it } from "vitest";
import { kookerbookLayoutForViewport } from "../src/colony/social/kookerbookLayout";

describe("Kookerbook mobile layout", () => {
  it("uses one column and full-width panels on phone screens", () => {
    const layout = kookerbookLayoutForViewport(390);

    expect(layout.shell.flexDirection).toBe("column");
    expect(layout.shell.overflowX).toBe("hidden");
    expect(layout.body.margin).toBe("0");
    expect(layout.body.overflowX).toBe("hidden");
    expect(layout.directory.width).toBe("auto");
    expect(layout.directory.maxWidth).toBe("100%");
    expect(layout.profile.width).toBe("auto");
    expect(layout.profile.maxWidth).toBe("100%");
    expect(layout.profile.minWidth).toBe(0);
    expect(layout.contentText.minWidth).toBe(0);
    expect(layout.contentText.overflowWrap).toBe("anywhere");
    expect(layout.contentText.wordBreak).toBe("break-word");
    expect(layout.directoryLink.minHeight).toBe(44);
    expect(layout.houseRender.width).toBe("100%");
    expect(layout.houseRender.maxWidth).toBe("100%");
    expect(layout.houseRender.minWidth).toBe(0);
    expect(layout.panel.maxWidth).toBe("100%");
    expect(layout.panel.minWidth).toBe(0);
    expect(layout.panel.overflowX).toBe("hidden");
  });

  it("keeps the two-column directory and profile layout on desktop", () => {
    const layout = kookerbookLayoutForViewport(1024);

    expect(layout.shell.flexDirection).toBe("row");
    expect(layout.directory.width).toBe(320);
    expect(layout.profile.maxWidth).toBe(760);
  });
});
