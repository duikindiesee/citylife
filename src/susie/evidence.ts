export type EvidenceStatus = "verified" | "uncertain";

export interface EvidenceSource {
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly archivedAt: string;
  readonly text: string;
  readonly status: EvidenceStatus;
  readonly sources: readonly EvidenceSource[];
  readonly provenance: Readonly<Record<string, string>>;
}

/**
 * Susie's append-only domain boundary. Persistence belongs behind this interface
 * in the private backend; CityLife clients may query it but never update/delete
 * an existing record.
 */
export interface EvidenceLedger {
  append(record: EvidenceRecord): Promise<void>;
  find(query: string, limit: number): Promise<readonly EvidenceRecord[]>;
}

export function assertEvidenceRecord(record: EvidenceRecord): void {
  if (!record.id.trim() || !record.text.trim()) {
    throw new Error("Evidence records require an id and text");
  }
  if (Number.isNaN(Date.parse(record.archivedAt))) {
    throw new Error("archivedAt must be an ISO timestamp");
  }
  if (record.status === "verified" && record.sources.length === 0) {
    throw new Error("Verified evidence requires at least one source");
  }
  for (const source of record.sources) {
    if (!source.repository.trim() || !source.revision.trim() || !source.path.trim()) {
      throw new Error("Evidence sources require repository, revision, and path");
    }
  }
}

