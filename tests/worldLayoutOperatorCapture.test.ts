// Spec 158 / PERF.FP.JITTER.1 — the regression guard for the first-person frame budget.
//
// `runtime.captureWorldLayout()` costs ~220 ms (seeded world survey + canonical JSON +
// SHA-256 of the whole document). ColonyApp used to call it from its render body, and the
// runtime's 200 ms UI heartbeat re-renders ColonyApp five times a second, so the main thread
// was saturated and first-person play ran at 7.8 fps instead of 60.2.
//
// DISCRIMINATION: every test below that asserts `calls === 0` fails if the gate in
// captureWorldLayoutForOperator is removed and the capture goes back to being unconditional.
// That was verified by temporarily restoring the unconditional capture — see the PR.
import { describe, it, expect } from "vitest";
import {
  captureWorldLayoutForOperator,
  shouldCaptureWorldLayout,
} from "../src/colony/ui/worldLayoutOperatorCapture";

function countingSource(
  document: unknown = { revision: { contentHash: "h" } },
) {
  const state = { calls: 0 };
  return {
    state,
    source: {
      captureWorldLayout() {
        state.calls++;
        return document;
      },
    },
  };
}

describe("shouldCaptureWorldLayout", () => {
  it("is false while the player is just playing — nothing displays the result", () => {
    expect(
      shouldCaptureWorldLayout({ bootReady: true, consumerVisible: false }),
    ).toBe(false);
  });

  it("is true when the operator surface that shows it is on screen", () => {
    expect(
      shouldCaptureWorldLayout({ bootReady: true, consumerVisible: true }),
    ).toBe(true);
  });

  it("is false before the world-layout boot barrier has published a head", () => {
    expect(
      shouldCaptureWorldLayout({ bootReady: false, consumerVisible: true }),
    ).toBe(false);
  });
});

describe("captureWorldLayoutForOperator", () => {
  it("does NOT capture while the builder and world view are both closed", () => {
    const { state, source } = countingSource();
    const result = captureWorldLayoutForOperator(source, {
      bootReady: true,
      consumerVisible: false,
    });
    expect(state.calls).toBe(0);
    expect(result.document).toBeNull();
    expect(result.error).toBeNull();
  });

  it("does not capture once per heartbeat either — a hundred renders, zero captures", () => {
    // This is the shape of the bug: the runtime emits five times a second forever, and every
    // emit re-rendered ColonyApp. A hundred renders of a walking player must cost nothing.
    const { state, source } = countingSource();
    for (let i = 0; i < 100; i++)
      captureWorldLayoutForOperator(source, {
        bootReady: true,
        consumerVisible: false,
      });
    expect(state.calls).toBe(0);
  });

  it("captures exactly once per render when the operator surface IS visible", () => {
    const { state, source } = countingSource();
    const result = captureWorldLayoutForOperator(source, {
      bootReady: true,
      consumerVisible: true,
    });
    expect(state.calls).toBe(1);
    expect(result.document).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it("does not capture before boot, even with the surface open", () => {
    const { state, source } = countingSource();
    captureWorldLayoutForOperator(source, {
      bootReady: false,
      consumerVisible: true,
    });
    expect(state.calls).toBe(0);
  });

  it("reports a capture failure as an error instead of throwing through the render", () => {
    const result = captureWorldLayoutForOperator(
      {
        captureWorldLayout() {
          throw new Error("world layout identity mismatch");
        },
      },
      { bootReady: true, consumerVisible: true },
    );
    expect(result.document).toBeNull();
    expect(result.error).toBe("world layout identity mismatch");
  });

  it("still reports a message when a non-Error is thrown", () => {
    const result = captureWorldLayoutForOperator(
      {
        captureWorldLayout() {
          throw "nope";
        },
      },
      { bootReady: true, consumerVisible: true },
    );
    expect(result.error).toMatch(/could not be captured/);
  });
});
