import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";

export type FencePiece = "panel" | "post-line" | "post-corner" | "post-end" | "gate-driveway";
export interface FencePlacement { piece: FencePiece; position: [number, number, number]; rotationY: number }

/** Convert the authoritative cell ring to deterministic metre placements. */
export function parcelFencePlacements(parcel: Parcel, mapSize: number): FencePlacement[] {
  if (parcel.fenceType !== "fence") return [];
  const world = (x:number,y:number): [number,number,number] => [(x-mapSize/2)*CELL_SIZE,0,(y-mapSize/2)*CELL_SIZE];
  const ring = new Set(parcel.fence.map(c => `${c.x},${c.y}`));
  const edges = new Set<string>();
  const gateCell = `${parcel.gate.x},${parcel.gate.y}`;
  const placements: FencePlacement[] = [];
  for (const c of parcel.fence) {
    const xNeighbor = ring.has(`${c.x+1},${c.y}`);
    const yNeighbor = ring.has(`${c.x},${c.y+1}`);
    const xPrev = ring.has(`${c.x-1},${c.y}`);
    const yPrev = ring.has(`${c.x},${c.y-1}`);
    const degree = Number(xNeighbor)+Number(yNeighbor)+Number(xPrev)+Number(yPrev);
    const corner = (xNeighbor || xPrev) && (yNeighbor || yPrev);
    placements.push({piece:degree <= 1 ? "post-end" : corner ? "post-corner" : "post-line", position:world(c.x,c.y), rotationY:0});
    for (const [dx,dy,rotationY] of [[1,0,0],[0,1,Math.PI/2]] as const) {
      if (!ring.has(`${c.x+dx},${c.y+dy}`)) continue;
      const key = `${c.x},${c.y}:${dx},${dy}`;
      if (edges.has(key)) continue;
      edges.add(key);
      const a=world(c.x,c.y), b=world(c.x+dx,c.y+dy);
      // Fence cells describe post locations. The gate asset occupies the complete gate cell,
      // so neither of that cell's adjoining edges may receive a panel.
      if (`${c.x},${c.y}` === gateCell || `${c.x+dx},${c.y+dy}` === gateCell) continue;
      placements.push({piece:"panel",position:[a[0]+(b[0]-a[0])*0.25,0,a[2]+(b[2]-a[2])*0.25],rotationY});
      placements.push({piece:"panel",position:[a[0]+(b[0]-a[0])*0.75,0,a[2]+(b[2]-a[2])*0.75],rotationY});
    }
  }
  placements.push({piece:"gate-driveway",position:world(parcel.gate.x,parcel.gate.y),rotationY:parcel.side === 1 ? 0 : Math.PI});
  return placements;
}
