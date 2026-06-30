import { create } from 'zustand';

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
  type: 'street' | 'avenue' | 'highway' | 'gravel';
}

export type BuilderMode = 'roads' | 'raise' | 'lower' | 'flatten' | 'zoning_residential' | 'zoning_commercial' | 'bulldoze';

export interface BuilderState {
  tiles: Record<string, RoadTile>;
  builderActive: boolean;
  worldViewActive: boolean;
  builderMode: BuilderMode;
  activeRoadType: 'street' | 'gravel';
  isDrawing: boolean;
  landscapeEdits: Map<string, number>;
  
  toggleBuilder: () => void;
  toggleWorldView: () => void;
  setBuilderMode: (mode: BuilderMode) => void;
  setActiveRoadType: (type: 'street' | 'gravel') => void;
  setIsDrawing: (isDrawing: boolean) => void;
  plotRoad: (cells: { x: number; y: number }[], type: 'street' | 'gravel') => void;
  applyLandscapeEdit: (x: number, y: number, mode: 'raise' | 'lower' | 'flatten') => void;
  
  saveToDB: () => Promise<void>;
  loadFromDB: () => Promise<void>;
}

export const useRoadNetwork = create<BuilderState>((set, get) => ({
  tiles: {},
  builderActive: false,
  worldViewActive: false,
  builderMode: 'roads',
  activeRoadType: 'street',
  isDrawing: false,
  landscapeEdits: new Map(),

  setIsDrawing: (isDrawing) => set({ isDrawing }),
  toggleBuilder: () => set(state => ({ builderActive: !state.builderActive, worldViewActive: false })),
  toggleWorldView: () => set(state => ({ worldViewActive: !state.worldViewActive, builderActive: false })),
  setBuilderMode: (mode) => set({ builderMode: mode }),
  setActiveRoadType: (type) => set({ activeRoadType: type }),

  plotRoad: (cells, type) => {
    set((state) => {
      const newTiles = { ...state.tiles };
      
      // Mark all incoming cells as having roads (initially without connections)
      for (const c of cells) {
        const key = `${c.x},${c.y}`;
        if (!newTiles[key]) {
          newTiles[key] = { x: c.x, y: c.y, mask: 0, type };
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

      return { tiles: newTiles };
    });
  },

  loadFromDB: async () => {
    try {
      const res = await fetch('/api/roads');
      if (res.ok) {
        const data = await res.json();
        set({ tiles: data.tiles });
      } else {
        console.warn('Failed to load roads from DB');
      }
    } catch (e) {
      console.warn('Backend not running, falling back to local storage', e);
      const local = localStorage.getItem('citylife_roads');
      if (local) set({ tiles: JSON.parse(local) });
    }
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
