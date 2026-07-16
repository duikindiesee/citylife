import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  runWorldLayoutOperatorAction,
  WorldLayoutRevisionControls,
  type WorldLayoutOperatorControls,
} from "../src/colony/ui/BuilderPanel";

describe("WorldLayoutRevisionControls", () => {
  it("shows an explicit unavailable state instead of legacy road persistence", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorldLayoutRevisionControls, {}),
    );

    expect(html).toContain("WORLD LAYOUT R—");
    expect(html).toContain("UNAVAILABLE");
    expect(html).not.toContain("&gt;LOAD&lt;");
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(5);
  });

  it("renders the parent-owned revision and enables only supplied actions", () => {
    const controls: WorldLayoutOperatorControls = {
      revisionNumber: 12,
      revisionId: `wl:v1:12:${"a".repeat(64)}`,
      status: "dirty",
      onSave: () => undefined,
      onShowHistory: async () => [],
      onExport: () => undefined,
    };

    const html = renderToStaticMarkup(
      React.createElement(WorldLayoutRevisionControls, { controls }),
    );

    expect(html).toContain("WORLD LAYOUT R12");
    expect(html).toContain("DIRTY");
    expect(html).toContain("SAVE REV");
    expect(html).toContain("HISTORY");
    expect(html).toContain("ROLLBACK");
    expect(html).toContain("VALIDATE + IMPORT");
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(2);
  });

  it("closes rejected action and import-file boundaries and reports their failures", async () => {
    const errors: string[] = [];
    const onActionError = vi.fn((error: unknown, action: string) => {
      errors.push(`${action}:${(error as Error).message}`);
    });

    await expect(
      runWorldLayoutOperatorAction(
        "save",
        () => Promise.reject(new Error("CAS conflict")),
        onActionError,
      ),
    ).resolves.toEqual({ ok: false, message: "CAS conflict" });

    const unreadableFile = {
      text: () => Promise.reject(new Error("File read failed")),
    };
    await expect(
      runWorldLayoutOperatorAction(
        "import",
        async () => {
          await unreadableFile.text();
        },
        onActionError,
      ),
    ).resolves.toEqual({ ok: false, message: "File read failed" });

    expect(errors).toEqual(["save:CAS conflict", "import:File read failed"]);
  });

  it("contains a throwing error observer without reopening the rejection", async () => {
    await expect(
      runWorldLayoutOperatorAction(
        "history",
        () => {
          throw new Error("History unavailable");
        },
        () => {
          throw new Error("Observer failed");
        },
      ),
    ).resolves.toEqual({ ok: false, message: "History unavailable" });
  });
});
