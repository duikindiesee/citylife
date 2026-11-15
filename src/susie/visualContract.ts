export const SUSIE_VISUAL_PROTOCOL = "citylife.susie.visual.v1" as const;

export const SUSIE_VISUAL_VIEWS = [
  "diagram",
  "timeline",
  "comparison",
  "explanation",
] as const;

export const SUSIE_VISUAL_ACKS = [
  "rendered",
  "understood",
  "misunderstood",
] as const;

export type SusieVisualView = (typeof SUSIE_VISUAL_VIEWS)[number];
export type SusieVisualAck = (typeof SUSIE_VISUAL_ACKS)[number];

export interface SusieVisualRequest {
  readonly protocol: typeof SUSIE_VISUAL_PROTOCOL;
  readonly type: "visual.show";
  readonly id: string;
  readonly view: SusieVisualView;
  readonly templateId: string;
  readonly evidenceIds: readonly string[];
  readonly expiresAt: string;
}

export interface SusieVisualAcknowledgement {
  readonly protocol: typeof SUSIE_VISUAL_PROTOCOL;
  readonly type: "visual.ack";
  readonly requestId: string;
  readonly outcome: SusieVisualAck;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function assertVisualRequest(request: SusieVisualRequest, now: Date): void {
  if (request.protocol !== SUSIE_VISUAL_PROTOCOL || request.type !== "visual.show") {
    throw new Error("Unsupported visual protocol or event type");
  }
  if (!IDENTIFIER.test(request.id) || !IDENTIFIER.test(request.templateId)) {
    throw new Error("Visual request ids must be allowlisted identifiers");
  }
  if (!SUSIE_VISUAL_VIEWS.includes(request.view)) {
    throw new Error("Unsupported visual view");
  }
  const expiry = Date.parse(request.expiresAt);
  if (Number.isNaN(expiry) || expiry <= now.getTime()) {
    throw new Error("Visual request is expired or has an invalid expiry");
  }
  if (request.evidenceIds.length === 0 || request.evidenceIds.some((id) => !IDENTIFIER.test(id))) {
    throw new Error("Visual requests require valid evidence ids");
  }
}

export function assertVisualAcknowledgement(ack: SusieVisualAcknowledgement): void {
  if (ack.protocol !== SUSIE_VISUAL_PROTOCOL || ack.type !== "visual.ack") {
    throw new Error("Unsupported acknowledgement protocol or event type");
  }
  if (!IDENTIFIER.test(ack.requestId) || !SUSIE_VISUAL_ACKS.includes(ack.outcome)) {
    throw new Error("Invalid visual acknowledgement");
  }
}

