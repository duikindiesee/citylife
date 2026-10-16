import { describe, expect, it } from "vitest";
import { assertEvidenceRecord } from "../src/susie/evidence";
import {
  assertVisualAcknowledgement,
  assertVisualRequest,
  SUSIE_VISUAL_PROTOCOL,
} from "../src/susie/visualContract";

describe("Susie evidence boundary", () => {
  it("requires citations before evidence can be called verified", () => {
    expect(() =>
      assertEvidenceRecord({
        id: "ev-1",
        archivedAt: "2026-08-30T08:00:00Z",
        text: "A claim",
        status: "verified",
        sources: [],
        provenance: {},
      }),
    ).toThrow(/source/);
  });

  it("allows explicitly uncertain material without pretending it is verified", () => {
    expect(() =>
      assertEvidenceRecord({
        id: "ev-2",
        archivedAt: "2026-08-30T08:00:00Z",
        text: "A user-provided recollection",
        status: "uncertain",
        sources: [],
        provenance: { suppliedBy: "user" },
      }),
    ).not.toThrow();
  });
});

describe("Susie visual boundary", () => {
  const request = {
    protocol: SUSIE_VISUAL_PROTOCOL,
    type: "visual.show" as const,
    id: "visual-1",
    view: "diagram" as const,
    templateId: "citylife.architecture",
    evidenceIds: ["ev-1"],
    expiresAt: "2026-08-30T09:00:00Z",
  };

  it("accepts a cited, allowlisted, unexpired display request", () => {
    expect(() => assertVisualRequest(request, new Date("2026-08-30T08:00:00Z"))).not.toThrow();
  });

  it("rejects expired requests and non-allowlisted payload identifiers", () => {
    expect(() => assertVisualRequest(request, new Date("2026-08-30T10:00:00Z"))).toThrow(/expired/);
    expect(() =>
      assertVisualRequest({ ...request, templateId: "https://example.invalid/payload" }, new Date("2026-08-30T08:00:00Z")),
    ).toThrow(/allowlisted/);
  });

  it("accepts only the explicit acknowledgement outcomes", () => {
    expect(() =>
      assertVisualAcknowledgement({
        protocol: SUSIE_VISUAL_PROTOCOL,
        type: "visual.ack",
        requestId: "visual-1",
        outcome: "understood",
      }),
    ).not.toThrow();
  });
});

