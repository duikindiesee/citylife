import { create } from 'zustand';
import { Biome } from '../terrain';

// North = 1, East = 2, South = 4, West = 8
export enum RoadMask {
  None = 0,
  N = 1,
  E = 2,
  S = 4,
  W = 8,
  // Common combinations
  StraightV = 5, // N | S
  StraightH = 10, // E | W
  CornerNE = 3, // N | E
  CornerES = 6, // E | S
  CornerSW = 12, // S | W
  CornerNW = 9, // N | W
  T_N = 11, // N | E | W
  T_E = 7,  // N | E | S
  T_S = 14, // E | S | W
  T_W = 13, // N | S | W
  Cross = 15 // N | E | S | W
}

export interface RoadTile {
  x: number;
  y: number;
  mask: number; // bitmask of connections
  type: 'street' | 'avenue' | 'highway' | 'gravel' | 'culdesac';
}

export type BuilderMode = 'roads' | 'raise' | 'lower' | 'flatten' | 'zoning_residential' | 'zoning_commercial' | 'bulldoze';

export interface BuilderState {
  tiles: Record<string, RoadTile>;
  builderActive: boolean;
  worldViewActive: boolean;
  builderMode: BuilderMode;
  activeRoadType: 'street' | 'gravel' | 'culdesac';
  isDrawing: boolean;
  landscapeEdits: Map<string, number>;
  sameSessionPlacements: Set<string>; // tracks newly placed items for free bulldozer undo
  
  toggleBuilder: () => void;
  toggleWorldView: () => void;
  setBuilderMode: (mode: BuilderMode) => void;
  setActiveRoadType: (type: 'street' | 'gravel' | 'culdesac') => void;
  setIsDrawing: (isDrawing: boolean) => void;
  plotRoad: (cells: { x: number; y: number }[], type: 'street' | 'gravel' | 'culdesac', sim?: any) => void;
  removeRoad: (x: number, y: number, sim?: any) => void;
  applyLandscapeEdit: (x: number, y: number, mode: 'raise' | 'lower' | 'flatten') => void;
  clearSessionPlacements: () => void;
  
  saveToDB: () => Promise<void>;
  loadFromDB: (sim?: any) => Promise<void>;
}

export const useRoadNetwork = create<BuilderState>((set, get) => ({
  tiles: {},
  builderActive: false,
  worldViewActive: false,
  builderMode: 'roads',
  activeRoadType: 'street',
  isDrawing: false,
  landscapeEdits: new Map(),
  sameSessionPlacements: new Set(),

  setIsDrawing: (isDrawing) => set({ isDrawing }),
  toggleBuilder: () => set(state => {
    const active = !state.builderActive;
    // Clear sameSessionPlacements when closing or opening builder
    return { 
      builderActive: active, 
      worldViewActive: false,
      sameSessionPlacements: new Set() 
    };
  }),
  toggleWorldView: () => set(state => ({ worldViewActive: !state.worldViewActive, builderActive: false })),
  setBuilderMode: (mode) => set({ builderMode: mode }),
  setActiveRoadType: (type) => set({ activeRoadType: type }),
  clearSessionPlacements: () => set({ sameSessionPlacements: new Set() }),

  plotRoad: (cells, type, sim) => {
    set((state) => {
      // Spec 140 — the store is the last gate before cells enter sim road state: no road cell on
      // beach sand, ever. The whole stroke is rejected (mirroring the builder UI, which previews
      // the offending cells in red and blocks the blueprint), so a scripted window.__colony caller
      // can't slip pavement onto the sand behind the UI's back. Water deliberately stays a UI-only
      // gate here — that is the pre-existing contract (scripted strokes lay anywhere off-beach),
      // and the ribbon's cellOkOn already refuses to render asphalt over water.
      if (sim) {
        const t = sim.state.terrain;
        const bad = cells.some(
          (c) =>
            t.inBounds(c.x, c.y) && t.biome[t.idx(c.x, c.y)] === Biome.Beach,
        );
        if (bad) {
          console.warn('plotRoad rejected: stroke crosses beach sand (spec 140)');
          return {};
        }
      }
      const newTiles = { ...state.tiles };
      const newPlacements = new Set(state.sameSessionPlacements);
      
      // Mark all incoming cells as having roads (initially without connections)
      let anyNewCell = false;
      for (const c of cells) {
        const key = `${c.x},${c.y}`;
        if (!newTiles[key]) {
          newTiles[key] = { x: c.x, y: c.y, mask: 0, type };
          newPlacements.add(key);
          anyNewCell = true;
        }
      }

      // Re-evaluate connections for the newly added cells and their neighbours
      const getMask = (x: number, y: number) => {
        let mask = 0;
        if (newTiles[`${x},${y - 1}`]) mask |= RoadMask.N;
        if (newTiles[`${x + 1},${y}`]) mask |= RoadMask.E;
        if (newTiles[`${x},${y + 1}`]) mask |= RoadMask.S;
        if (newTiles[`${x - 1},${y}`]) mask |= RoadMask.W;
        return mask;
      };

      for (const c of cells) {
        // Update the cell itself
        newTiles[`${c.x},${c.y}`] = { 
          ...newTiles[`${c.x},${c.y}`], 
          mask: getMask(c.x, c.y) 
        };
        
        // Update its neighbours
        const neighbors = [
          { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
        ];
        
        for (const n of neighbors) {
          const nx = c.x + n.dx;
          const ny = c.y + n.dy;
          const nKey = `${nx},${ny}`;
          if (newTiles[nKey]) {
            newTiles[nKey] = {
              ...newTiles[nKey],
              mask: getMask(nx, ny)
            };
          }
        }
      }

      // Sync with simulation state
      if (sim) {
        const s = sim.state;
        s.roads = [];
        s.roadSet.clear();
        for (const key in newTiles) {
          const tile = newTiles[key];
          s.roadSet.add(`${tile.x},${tile.y}`);
          s.roads.push({ x: tile.x, y: tile.y, kind: tile.type });
        }
        s.roadsVersion++;
        // Spec 127 — record the drawn road's centre-line so the ribbon surface renders it.
        // Blueprints are Bresenham 45°-snapped straights, so [first, last] IS the centre-line;
        // width 1 = a 4m ribbon matching a hand-drawn one-cell road. Single-cell roads are
        // cul-de-sacs and render as bulbs instead. ONLY when the stroke created a NEW tile
        // (verify P2): re-tracing an existing road must not append a duplicate way — a
        // duplicated centre-line makes every cell along it read as a junction, suppressing
        // all markings and slabbing the whole road.
        if (cells.length >= 2 && anyNewCell) {
          const first = cells[0];
          const last = cells[cells.length - 1];
          if (!s.roadWays) s.roadWays = [];
          s.roadWays.push({
            path: [
              { x: first.x, y: first.y },
              { x: last.x, y: last.y },
            ],
            kind: "street",
            width: 1,
            source: "builder",
          });
        }
      }

      return { tiles: newTiles, sameSessionPlacements: newPlacements };
    });
  },

  removeRoad: (x, y, sim) => {
    set((state) => {
      const newTiles = { ...state.tiles };
      const key = `${x},${y}`;
      if (!newTiles[key]) return {};
      
      delete newTiles[key];
      
      const newPlacements = new Set(state.sameSessionPlacements);
      newPlacements.delete(key);

      const getMask = (nx: number, ny: number) => {
        let mask = 0;
        if (newTiles[`${nx},${ny - 1}`]) mask |= RoadMask.N;
        if (newTiles[`${nx + 1},${ny}`]) mask |= RoadMask.E;
        if (newTiles[`${nx},${ny + 1}`]) mask |= RoadMask.S;
        if (newTiles[`${nx - 1},${ny}`]) mask |= RoadMask.W;
        return mask;
      };

      const neighbors = [
        { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
      ];
      for (const n of neighbors) {
        const nx = x + n.dx;
        const ny = y + n.dy;
        const nKey = `${nx},${ny}`;
        if (newTiles[nKey]) {
          newTiles[nKey] = {
            ...newTiles[nKey],
            mask: getMask(nx, ny)
          };
        }
      }

      // Sync with simulation state
      if (sim) {
        const s = sim.state;
        s.roads = [];
        s.roadSet.clear();
        s.roadKind.clear();
        for (const k in newTiles) {
          const tile = newTiles[k];
          s.roadSet.add(`${tile.x},${tile.y}`);
          s.roads.push({ x: tile.x, y: tile.y, kind: tile.type });
          s.roadKind.set(`${tile.x},${tile.y}`, tile.type);
        }
        s.roadsVersion++;
        // Spec 127 verify P2 — prune builder-drawn ways whose endpoints are BOTH bulldozed,
        // so a fully-removed road loses its ribbon too. A middle-cut road keeps its way
        // (partial ghost, known limitation) until its ends go; boot ways are never pruned.
        if (s.roadWays) {
          s.roadWays = s.roadWays.filter((w: any) => {
            if (w.source !== "builder") return true;
            const a = w.path[0];
            const b = w.path[w.path.length - 1];
            return (
              s.roadSet.has(`${a.x},${a.y}`) || s.roadSet.has(`${b.x},${b.y}`)
            );
          });
        }
      }

      return { tiles: newTiles, sameSessionPlacements: newPlacements };
    });
  },

  loadFromDB: async (sim?: any) => {
    let tiles: Record<string, any> = {};
    try {
      const res = await fetch('/api/roads');
      if (res.ok) {
        const data = await res.json();
        tiles = data.tiles || {};
      } else {
        console.warn('Failed to load roads from DB');
      }
    } catch (e) {
      console.warn('Backend not running, falling back to local storage', e);
      const local = localStorage.getItem('citylife_roads');
      if (local) {
        try {
          tiles = JSON.parse(local);
        } catch (pe) {
          console.error('Failed to parse local storage roads', pe);
        }
      }
    }
    
    // Sync with simulation state
    if (sim) {
      if (Object.keys(tiles).length > 0) {
        const s = sim.state;
        s.roads = [];
        s.roadSet.clear();
        s.roadKind.clear();
        for (const k in tiles) {
          const tile = tiles[k];
          s.roadSet.add(`${tile.x},${tile.y}`);
          s.roads.push({ x: tile.x, y: tile.y, kind: tile.type });
          s.roadKind.set(`${tile.x},${tile.y}`, tile.type);
        }
        s.roadsVersion++;
      } else if (sim.state.roads && sim.state.roads.length > 0) {
        // Load the starter simulation roads into tiles!
        const initialTiles: Record<string, any> = {};
        for (const r of sim.state.roads) {
          const key = `${r.x},${r.y}`;
          initialTiles[key] = {
            x: r.x,
            y: r.y,
            mask: 0,
            type: r.kind || 'street'
          };
        }
        
        const getMask = (x: number, y: number) => {
          let mask = 0;
          if (initialTiles[`${x},${y - 1}`]) mask |= RoadMask.N;
          if (initialTiles[`${x + 1},${y}`]) mask |= RoadMask.E;
          if (initialTiles[`${x},${y + 1}`]) mask |= RoadMask.S;
          if (initialTiles[`${x - 1},${y}`]) mask |= RoadMask.W;
          return mask;
        };
        
        for (const key in initialTiles) {
          const t = initialTiles[key];
          t.mask = getMask(t.x, t.y);
        }
        
        tiles = initialTiles;
      }
    }

    set({ tiles });
  },

  applyLandscapeEdit: (x, y, mode) => {
    set((state) => {
      const newEdits = new Map(state.landscapeEdits);
      // Brush size = 3x3 for now, we apply to surrounding cells too
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          const key = `${cx},${cy}`;
          const currentOffset = newEdits.get(key) || 0;
          
          if (mode === 'raise') {
            newEdits.set(key, currentOffset + 0.1);
          } else if (mode === 'lower') {
            newEdits.set(key, currentOffset - 0.1);
          } else if (mode === 'flatten') {
            // Flatten sets the target radius to exactly the center cell's current height offset
            // We'd need to know the base terrain height to truly flatten to world height,
            // but for simplicity, we just set the offset of neighbors to match the center cell's offset.
            const centerKey = `${x},${y}`;
            const centerOffset = newEdits.get(centerKey) || 0;
            newEdits.set(key, centerOffset);
          }
        }
      }
      return { landscapeEdits: newEdits };
    });
  },

  saveToDB: async () => {
    const tiles = get().tiles;
    try {
      await fetch('/api/roads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiles })
      });
    } catch (e) {
      console.warn('Backend not running, saving to local storage', e);
      localStorage.setItem('citylife_roads', JSON.stringify(tiles));
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).useRoadNetwork = useRoadNetwork;
}

