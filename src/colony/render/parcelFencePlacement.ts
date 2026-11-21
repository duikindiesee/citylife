import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";

export type FencePiece = "panel" | "post-line" | "post-corner" | "post-end" | "gate-driveway";
export interface FencePlacement { piece: FencePiece; position: [number, number, number]; rotationY: number }

/** Convert the authoritative cell ring to deterministic metre placements. */
export function parcelFencePlacements(parcel: Parcel, mapSize: number): FencePlacement[] {
  if (parcel.fenceType !== "fence") return [];
  const world = (x:number,y:number): [number,number,number] => [(x-mapSize/2)*CELL_SIZE,0,(y-mapSize/2)*CELL_SIZE];
  const ring = new Set(parcel.fence.map(c => `${c.x},${c.y}`));
  const placements: FencePlacement[] = [];
  // Ring-cell centres are the regular 4 m posts. The gate GLB owns its two offset gate posts.
  for (const c of parcel.fence) {
    placements.push({piece:"post-line",position:world(c.x,c.y),rotationY:0});
  }
  const edgeSeen = new Set<string>();
  for (const c of parcel.fence) {
    for (const [dx,dy,rotationY] of [[1,0,0],[0,1,Math.PI/2]] as const) {
      if (!ring.has(`${c.x+dx},${c.y+dy}`)) continue;
      const key = `${Math.min(c.x,c.x+dx)},${Math.min(c.y,c.y+dy)}:${dx},${dy}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      const a=world(c.x,c.y), b=world(c.x+dx,c.y+dy);
      const horizontal = dx === 1;
      const axisStart = horizontal ? a[0] : a[2];
      const axisEnd = horizontal ? b[0] : b[2];
      const fixed = horizontal ? a[2] : a[0];
      // Every ordinary 4 m edge gets a midpoint post and two 2 m panels.
      placements.push({piece:"post-line",position:horizontal?[ (a[0]+b[0])/2,0,a[2] ]:[ a[0],0,(a[2]+b[2])/2 ],rotationY:0});
      placements.push({piece:"panel",position:horizontal?[(axisStart+axisEnd)/2-1,0,fixed]:[fixed,0,(axisStart+axisEnd)/2-1],rotationY});
      placements.push({piece:"panel",position:horizontal?[(axisStart+axisEnd)/2+1,0,fixed]:[fixed,0,(axisStart+axisEnd)/2+1],rotationY});
    }
  }
  // The two panels immediately beside the street gate finish exactly at the gate's ±1.85 m posts.
  // Find the ring cell next to the gate on either street axis; each receives one outer panel.
  const gateWorld = world(parcel.gate.x,parcel.gate.y);
  // Gate leaves are aligned to local X; on the supported layouts the gate edge lies along world X.
  const streetAxisX = true;
  const axis = 0;
  for (const sign of [-1,1]) {
    const neighbour = streetAxisX ? `${parcel.gate.x+sign},${parcel.gate.y}` : `${parcel.gate.x},${parcel.gate.y+sign}`;
    if (!ring.has(neighbour)) continue;
    const neighbourWorld = streetAxisX ? world(parcel.gate.x+sign,parcel.gate.y) : world(parcel.gate.x,parcel.gate.y+sign);
    const end = (axis === 0 ? gateWorld[0] : gateWorld[2]) + sign * 1.85;
    const outer = axis === 0 ? neighbourWorld[0] : neighbourWorld[2];
    const centre = (end + outer) / 2;
    placements.push({piece:"panel",position:axis===0?[centre,0,gateWorld[2]]:[gateWorld[0],0,centre],rotationY:axis===0?0:Math.PI/2});
  }
  placements.push({piece:"gate-driveway",position:world(parcel.gate.x,parcel.gate.y),rotationY:parcel.side === 1 ? 0 : Math.PI});
  return placements;
}
