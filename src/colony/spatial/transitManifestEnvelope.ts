// Spec 149 / Task e81ea9de — Standalone Manifest Envelope Seam
//
// Pairs a canonical WorldLayoutDocumentV1 with an optional companion
// CanonicalTransitAuthority v1 without mutating the un-extended document schema.
// Cryptographically binds transit authority to layout revision contentHash.

import type { WorldLayoutDocument } from "./worldLayoutDocument";
import {
  type CanonicalTransitAuthority,
  type TransitValidationResult,
  validateCanonicalTransitAuthority,
} from "../transit/canonicalTransit";

export interface WorldLayoutManifestEnvelope {
  readonly layout: WorldLayoutDocument;
  readonly transit?: CanonicalTransitAuthority | null;
}

/**
 * Creates a standalone manifest envelope pairing a layout document
 * and its revision-bound transit authority companion.
 */
export function createWorldLayoutManifestEnvelope(
  layout: WorldLayoutDocument,
  transit?: CanonicalTransitAuthority | null,
): WorldLayoutManifestEnvelope {
  return {
    layout,
    transit: transit ?? null,
  };
}

/**
 * Validates the manifest envelope and verifies cryptographic revision binding.
 */
export function validateWorldLayoutManifestEnvelope(
  envelope: WorldLayoutManifestEnvelope,
  minBays: number = 5,
): TransitValidationResult {
  if (!envelope || typeof envelope !== "object" || !envelope.layout) {
    return {
      valid: false,
      error: "INVALID_MANIFEST_ENVELOPE",
      message: "Manifest envelope is missing a layout document",
    };
  }

  if (!envelope.transit) {
    return { valid: true };
  }

  return validateCanonicalTransitAuthority(
    envelope.transit,
    envelope.layout.layoutId,
    envelope.layout.revision.contentHash,
    minBays,
  );
}
