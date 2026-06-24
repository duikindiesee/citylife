import {
  ARTIFACT_KINDS,
  type ArtifactCategory,
  type ArtifactFootprint,
  type ArtifactKind,
  isArtifactKind,
} from "./artifacts";

export const PLACED_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type PlacedArtifactKind =
  | "furniture"
  | "prop"
  | "landscaping"
  | "house"
  | "tree";

export type PlacedArtifactVariant = ArtifactKind;

export interface PlacedArtifactTransform {
  x: number;
  y: number;
  /** Floating-point radians. Do not quantise: seeded planter/fountain rotations are π/4 and 3π/4. */
  rot: number;
}

export interface PlacedArtifactData {
  variant: PlacedArtifactVariant;
}

export interface PlacedArtifact {
  schemaVersion: typeof PLACED_ARTIFACT_SCHEMA_VERSION;
  id: string;
  kind: PlacedArtifactKind;
  transform: PlacedArtifactTransform;
  footprint: ArtifactFootprint;
  category: ArtifactCategory;
  children?: PlacedArtifact[];
  data: PlacedArtifactData;
}

export interface PlacedArtifactKindRegistration {
  kind: PlacedArtifactKind;
  variants: readonly PlacedArtifactVariant[];
  defaultCategory: ArtifactCategory;
}

export const PLACED_ARTIFACT_KIND_REGISTRY: Record<
  PlacedArtifactKind,
  PlacedArtifactKindRegistration
> = Object.freeze({
  furniture: Object.freeze({
    kind: "furniture",
    variants: Object.freeze(["bench"] as const),
    defaultCategory: "furniture",
  }),
  prop: Object.freeze({
    kind: "prop",
    variants: Object.freeze(["lamppost", "fountain"] as const),
    defaultCategory: "lighting",
  }),
  landscaping: Object.freeze({
    kind: "landscaping",
    variants: Object.freeze(["planter"] as const),
    defaultCategory: "greenery",
  }),
  house: Object.freeze({
    kind: "house",
    variants: Object.freeze([] as const),
    defaultCategory: "furniture",
  }),
  tree: Object.freeze({
    kind: "tree",
    variants: Object.freeze(["shade_tree"] as const),
    defaultCategory: "greenery",
  }),
});

const PLACED_KIND_SET = new Set<PlacedArtifactKind>(
  Object.keys(PLACED_ARTIFACT_KIND_REGISTRY) as PlacedArtifactKind[],
);

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`placed artifact: ${label} must be an object`);
  return value as Record<string, unknown>;
}

function numberField(fields: Record<string, unknown>, key: string, ctx: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`placed artifact: ${ctx}.${key} must be a finite number`);
  return value;
}

function stringField(fields: Record<string, unknown>, key: string, ctx: string): string {
  const value = fields[key];
  if (typeof value !== "string" || !value)
    throw new Error(`placed artifact: ${ctx}.${key} must be a non-empty string`);
  return value;
}

function canonicalPlacedArtifact(value: unknown): PlacedArtifact {
  const raw = assertRecord(value, "root");
  if (raw.schemaVersion !== PLACED_ARTIFACT_SCHEMA_VERSION)
    throw new Error(
      `placed artifact: unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}`,
    );

  const kind = stringField(raw, "kind", "root") as PlacedArtifactKind;
  if (!PLACED_KIND_SET.has(kind))
    throw new Error(`placed artifact: unknown kind ${JSON.stringify(kind)}`);

  const data = assertRecord(raw.data, "data");
  const variant = stringField(data, "variant", "data");
  if (!isArtifactKind(variant))
    throw new Error(`placed artifact: unknown variant ${JSON.stringify(variant)}`);
  if (!PLACED_ARTIFACT_KIND_REGISTRY[kind].variants.includes(variant))
    throw new Error(
      `placed artifact: variant ${JSON.stringify(variant)} is not registered for ${kind}`,
    );

  const transform = assertRecord(raw.transform, "transform");
  const footprint = assertRecord(raw.footprint, "footprint");
  const childrenRaw = raw.children;
  const children =
    childrenRaw === undefined
      ? undefined
      : Array.isArray(childrenRaw)
        ? childrenRaw.map(canonicalPlacedArtifact)
        : (() => {
            throw new Error("placed artifact: children must be an array");
          })();

  return {
    schemaVersion: PLACED_ARTIFACT_SCHEMA_VERSION,
    id: stringField(raw, "id", "root"),
    kind,
    transform: {
      x: numberField(transform, "x", "transform"),
      y: numberField(transform, "y", "transform"),
      rot: numberField(transform, "rot", "transform"),
    },
    footprint: {
      w: numberField(footprint, "w", "footprint"),
      h: numberField(footprint, "h", "footprint"),
    },
    category: stringField(raw, "category", "root") as ArtifactCategory,
    ...(children && children.length > 0 ? { children } : {}),
    data: { variant },
  };
}

export function parsePlacedArtifact(serialized: string): PlacedArtifact {
  if (typeof serialized !== "string")
    throw new Error("placed artifact: serialized payload must be a string");
  return canonicalPlacedArtifact(JSON.parse(serialized));
}

export function serializePlacedArtifact(artifact: PlacedArtifact): string {
  return JSON.stringify(canonicalPlacedArtifact(artifact));
}

export function placedArtifactFromVisualArtifact(item: {
  id: string;
  kind: ArtifactKind;
  x: number;
  y: number;
  rot: number;
  footprint: ArtifactFootprint;
  category: ArtifactCategory;
}): PlacedArtifact {
  const kind = placedKindForVariant(item.kind);
  return {
    schemaVersion: PLACED_ARTIFACT_SCHEMA_VERSION,
    id: item.id,
    kind,
    transform: { x: item.x, y: item.y, rot: item.rot },
    footprint: { ...item.footprint },
    category: item.category,
    data: { variant: item.kind },
  };
}

export function placedKindForVariant(variant: ArtifactKind): PlacedArtifactKind {
  for (const entry of Object.values(PLACED_ARTIFACT_KIND_REGISTRY))
    if (entry.variants.includes(variant)) return entry.kind;
  // Exhaustiveness guard for future ARTIFACT_KINDS additions: tests should fail before this is reachable.
  throw new Error(`placed artifact: no placed kind registered for ${variant}`);
}

export function artifactRegistryVariants(): readonly PlacedArtifactVariant[] {
  return ARTIFACT_KINDS;
}
