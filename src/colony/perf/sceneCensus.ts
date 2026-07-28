// Spec 158 — the resident-instance census.
//
// "Draw calls" alone hides the foliage problem: 75k instanced conifers are ONE draw call, so
// a draw-call counter says the scene is cheap while the shadow pass grinds through every
// instance. This walks the live scene graph and reports what is actually RESIDENT — how many
// instances, how many of them cast shadows, and which layer they belong to — so the HUD can
// name the layer rather than the symptom.
//
// Typed structurally (not against three.js classes) so it runs in node tests.

export interface CensusNode {
  name?: string;
  visible?: boolean;
  castShadow?: boolean;
  /** three sets this on InstancedMesh. */
  isInstancedMesh?: boolean;
  isMesh?: boolean;
  /** Live instance count (InstancedMesh.count), which can be below the allocated capacity. */
  count?: number;
  children?: CensusNode[];
}

export interface LayerCensus {
  name: string;
  instances: number;
  castShadow: boolean;
}

export interface SceneCensus {
  /** Instanced layers, biggest first. */
  layers: LayerCensus[];
  /** Total live instances across every InstancedMesh. */
  instances: number;
  /** Of those, how many belong to a layer that casts into the shadow map. */
  shadowInstances: number;
  /** Plain (non-instanced) visible meshes. */
  meshes: number;
  /** Of those, how many cast shadows. */
  shadowMeshes: number;
}

/** Walk a scene graph and count what is resident. Invisible subtrees are skipped: a hidden
 *  group costs nothing, and counting it would overstate the load. */
export function censusOf(root: CensusNode | null | undefined): SceneCensus {
  const layers: LayerCensus[] = [];
  let instances = 0;
  let shadowInstances = 0;
  let meshes = 0;
  let shadowMeshes = 0;

  const visit = (node: CensusNode | undefined | null): void => {
    if (!node) return;
    if (node.visible === false) return;
    if (node.isInstancedMesh) {
      const count = node.count ?? 0;
      instances += count;
      if (node.castShadow) shadowInstances += count;
      layers.push({
        name: node.name || "(unnamed instanced)",
        instances: count,
        castShadow: Boolean(node.castShadow),
      });
    } else if (node.isMesh) {
      meshes += 1;
      if (node.castShadow) shadowMeshes += 1;
    }
    const children = node.children;
    if (children) for (const child of children) visit(child);
  };

  visit(root);
  layers.sort((a, b) => b.instances - a.instances);
  return { layers, instances, shadowInstances, meshes, shadowMeshes };
}
