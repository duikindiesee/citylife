import {describe,it,expect} from "vitest";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import {readFileSync} from "node:fs";
import {ColonySim} from "../src/colony/sim";
import {makeNeighborhoodAt,ESTATE} from "../src/colony/neighborhood";
import {parcelFencePlacements,type FencePlacement} from "../src/colony/render/parcelFencePlacement";
import {testbedParcelInfo,applyDrivewayGatePose} from "../src/colony/render/starterGarageCamera";
import {testbedGroundRects,xzRectIntersectionArea,xzRectGap} from "../src/colony/render/testbedSurfaces";

const OVERLAP_TOL = 0.001; // 1 mm as m² is not area; we treat area <= 0.001 m² (~1 mm * 1 m) as touch
const GAP_MAX = 0.01; // 10 mm
const HINGE_MAX = 0.01; // 10 mm
const LATCH_MAX = 0.03; // 30 mm
const PANEL_HALF = 1.0; // 2 m panel, origin at centre
const GATE_HALF = 3.7 / 2;

async function loadGlb(rel: string) {
  const bytes = readFileSync(new URL(rel, import.meta.url));
  return new Promise<any>((resolve, reject) =>
    new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject)
  );
}

function boxDistance(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/** World box of the leaf geometry nearest the local hinge (x≈0), i.e. the hinge stile. */
function hingeStileBox(leaf: THREE.Object3D): THREE.Box3 {
  leaf.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  leaf.traverse((o: any) => {
    if (!o.isMesh) return;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    const v = new THREE.Vector3();
    const local = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      local.fromBufferAttribute(pos, i);
      o.localToWorld(v.copy(local));
      leaf.worldToLocal(local.copy(v));
      if (Math.abs(local.x) <= 0.06) {
        box.expandByPoint(v);
        any = true;
      }
    }
  });
  if (!any) box.setFromObject(leaf);
  return box;
}

function postBoxes(root: THREE.Object3D): { left: THREE.Box3; right: THREE.Box3 } {
  const posts: THREE.Box3[] = [];
  root.traverse((o: any) => {
    if (o.isMesh && String(o.name).startsWith("Gate_Post")) posts.push(new THREE.Box3().setFromObject(o));
  });
  posts.sort((a, b) => a.getCenter(new THREE.Vector3()).x - b.getCenter(new THREE.Vector3()).x);
  return { left: posts[0]!, right: posts[posts.length - 1]! };
}

function estateParcel() {
  const sim = new ColonySim(180);
  const parcels = makeNeighborhoodAt(sim.state.terrain, sim.state.terrain.landing, { small: false }).parcels;
  const parcel = parcels.find((p) => p.fenceType === "fence" && p.w === ESTATE.W) ?? parcels.find((p) => p.fenceType === "fence")!;
  return { sim, parcel, mapSize: sim.state.terrain.size };
}

describe("testbed driveway does not overlay the road", () => {
  it("driveway footprint ∩ road surface area is ~0, and the driveway touches the kerb", () => {
    const { parcel, mapSize } = estateParcel();
    const info = testbedParcelInfo(parcel, mapSize);
    const { road, drivewayRects } = testbedGroundRects(info);
    const overlap = drivewayRects.reduce((sum, r) => sum + xzRectIntersectionArea(r, road), 0);
    const main = drivewayRects.find((r) => r.name === "driveway")!;
    const gap = xzRectGap(main, road);
    expect(overlap, `driveway/apron overlaps the road by ${overlap.toFixed(4)} m²`).toBeLessThanOrEqual(OVERLAP_TOL);
    expect(gap, `driveway is ${gap.toFixed(4)} m from the road edge`).toBeLessThanOrEqual(GAP_MAX);
  });
});

describe("gate leaves stay on their posts, and the fence meets the gate", () => {
  async function assertGateFit(rel: string) {
    const gltf = await loadGlb(rel);
    const gaps: number[] = [];
    const latch: number[] = [];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const root = gltf.scene.clone(true);
      applyDrivewayGatePose(root, t);
      root.updateMatrixWorld(true);
      const left = root.getObjectByName("gate_leaf_left")!;
      const right = root.getObjectByName("gate_leaf_right")!;
      const posts = postBoxes(root);
      // Posts: smaller x is the +X or -X post depending on layout; match by centre x.
      const leftPost = posts.left.max.x < posts.right.min.x && left.position.x <= right.position.x ? posts.left : posts.left;
      const leafLeftX = left.getWorldPosition(new THREE.Vector3()).x;
      const leafRightX = right.getWorldPosition(new THREE.Vector3()).x;
      const postFor = (leafX: number) =>
        Math.abs(posts.left.getCenter(new THREE.Vector3()).x - leafX) <= Math.abs(posts.right.getCenter(new THREE.Vector3()).x - leafX)
          ? posts.left
          : posts.right;
      const dL = boxDistance(hingeStileBox(left), postFor(leafLeftX));
      const dR = boxDistance(hingeStileBox(right), postFor(leafRightX));
      gaps.push(dL, dR);
      if (t === 0) {
        const l = new THREE.Box3().setFromObject(left);
        const r = new THREE.Box3().setFromObject(right);
        const midGap = Math.max(0, Math.max(l.min.x, r.min.x) - Math.min(l.max.x, r.max.x));
        latch.push(midGap);
      }
      void leftPost;
    }
    const worst = Math.max(...gaps);
    expect(worst, `hinge stile is ${worst.toFixed(4)} m from its post`).toBeLessThanOrEqual(HINGE_MAX);
    if (latch.length) expect(latch[0]!, `closed latch gap ${latch[0]!.toFixed(4)} m`).toBeLessThanOrEqual(LATCH_MAX);
  }

  it("driveway gate: hinge stile stays within 10 mm of the post through the swing, closed latch gap ≤ 30 mm", async () => {
    await assertGateFit("../public/assets/citylife/props/picket-fence-gate-driveway.glb");
  });

  it("pedestrian gate: same hinge and latch rules", async () => {
    await assertGateFit("../public/assets/citylife/props/picket-fence-gate-pedestrian.glb");
  });

  it("every boundary panel end meets a post, including shortened gate-adjacent panels", () => {
    const { parcel, mapSize } = estateParcel();
    const placements = parcelFencePlacements(parcel, mapSize);
    const info = testbedParcelInfo(parcel, mapSize);
    const gatePlacement = placements.find((p) => p.piece === "gate-driveway")!;
    const posts: { x: number; z: number }[] = [];
    for (const p of placements) {
      if (p.piece === "post-line" || p.piece === "post-corner" || p.piece === "post-end") {
        posts.push({ x: p.position[0], z: p.position[2] });
      }
      if (p.piece === "gate-driveway") {
        const c = Math.cos(p.rotationY), s = Math.sin(p.rotationY);
        posts.push({ x: p.position[0] + c * GATE_HALF, z: p.position[2] + s * GATE_HALF });
        posts.push({ x: p.position[0] - c * GATE_HALF, z: p.position[2] - s * GATE_HALF });
      }
    }
    const near = (x: number, z: number) => Math.min(...posts.map((q) => Math.hypot(q.x - x, q.z - z)));
    const panelEnds: { x: number; z: number }[] = [];
    for (const p of placements.filter((q) => q.piece === "panel")) {
      const c = Math.cos(p.rotationY), s = Math.sin(p.rotationY);
      const onGateEdge = Math.abs((p.position[0]-gatePlacement.position[0])*(-Math.sin(gatePlacement.rotationY))+(p.position[2]-gatePlacement.position[2])*Math.cos(gatePlacement.rotationY))<.01 &&
        Math.abs((p.position[0]-gatePlacement.position[0])*Math.cos(gatePlacement.rotationY)+(p.position[2]-gatePlacement.position[2])*Math.sin(gatePlacement.rotationY))<4;
      const half = (p.length ?? 2) / 2;
      const a = { x: p.position[0] + c * half, z: p.position[2] + s * half };
      const b = { x: p.position[0] - c * half, z: p.position[2] - s * half };
      panelEnds.push(a, b);
      expect(near(a.x, a.z), `panel end at ${a.x.toFixed(3)},${a.z.toFixed(3)} is far from any post`).toBeLessThanOrEqual(0.05);
      expect(near(b.x, b.z), `panel end at ${b.x.toFixed(3)},${b.z.toFixed(3)} is far from any post`).toBeLessThanOrEqual(0.05);
    }
    const gate = placements.find((p) => p.piece === "gate-driveway")!;
    const c = Math.cos(gate.rotationY), s = Math.sin(gate.rotationY);
    const gatePosts = [
      { x: gate.position[0] + c * GATE_HALF, z: gate.position[2] + s * GATE_HALF },
      { x: gate.position[0] - c * GATE_HALF, z: gate.position[2] - s * GATE_HALF },
    ];
    const fencePosts = placements
      .filter((p) => p.piece === "post-line" || p.piece === "post-corner" || p.piece === "post-end")
      .map((p) => ({ x: p.position[0], z: p.position[2] }));
    const panelOrFenceNear = (x: number, z: number) =>
      Math.min(
        ...fencePosts.map((q) => Math.hypot(q.x - x, q.z - z)),
        ...panelEnds.map((q) => Math.hypot(q.x - x, q.z - z)),
      );
    for (const gp of gatePosts) {
      const d = panelOrFenceNear(gp.x, gp.z);
      expect(d, `gate post at ${gp.x.toFixed(3)},${gp.z.toFixed(3)} is ${d.toFixed(3)} m from the fence (gap between fence and gate)`).toBeLessThanOrEqual(GAP_MAX);
    }
    void info;
  });

  it("covers the complete outer boundary except the 3.7 m gate opening", () => {
    const { parcel, mapSize } = estateParcel();
    const placements=parcelFencePlacements(parcel,mapSize),posts=placements.filter(p=>p.piece.startsWith("post")).map(p=>p.position);
    const panels=placements.filter(p=>p.piece==="panel");
    const xs=posts.map(p=>p[0]),zs=posts.map(p=>p[2]);
    expect(Math.max(...xs)-Math.min(...xs)).toBe(parcel.w*4);
    expect(Math.max(...zs)-Math.min(...zs)).toBe(parcel.h*4);
    for(const p of panels){
      const half=(p.length??2)/2,c=Math.cos(p.rotationY),s=Math.sin(p.rotationY);
      for(const sign of [-1,1]){const x=p.position[0]+sign*c*half,z=p.position[2]+sign*s*half;expect(Math.min(...posts.map(q=>Math.hypot(q[0]-x,q[2]-z)))).toBeLessThanOrEqual(.05);}
    }
    const gate=placements.find(p=>p.piece==="gate-driveway")!;
    const neighbouringPanels=panels.filter(p=>Math.hypot(p.position[0]-gate.position[0],p.position[2]-gate.position[2])<4);
    expect(neighbouringPanels.length).toBeGreaterThanOrEqual(2);
    expect(gate).toBeDefined();
  });});
