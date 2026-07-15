import { create } from "zustand";
import { getAuthClient } from "../authClient";

export type AssetCategory =
  | "residential"
  | "commercial"
  | "foliage"
  | "prop"
  | "vehicle";

export interface WorldAsset {
  id: string;
  category: AssetCategory;
  modelUrl: string;
  scale: [number, number, number];
  animations: string[];
  metadata?: any;
}

interface WorldAssetsState {
  assets: Record<string, WorldAsset>;
  loading: boolean;
  error: string | null;
  fetchManifest: () => Promise<void>;
}

export const useWorldAssets = create<WorldAssetsState>((set) => ({
  assets: {},
  loading: false,
  error: null,
  fetchManifest: async () => {
    set({ loading: true, error: null });
    try {
      const token = await getAuthClient().getValidToken();
      // kooker-service-citylife-world local dev port
      const res = await fetch("http://localhost:3000/api/v1/assets", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error("Failed to fetch world assets manifest");
      const data: WorldAsset[] = await res.json();

      const assetMap: Record<string, WorldAsset> = {};
      data.forEach((a) => {
        assetMap[a.id] = a;
      });

      set({ assets: assetMap, loading: false });
    } catch (err: any) {
      console.warn(
        "Failed to load citylife-world microservice. Using fallback assets.",
        err,
      );
      set({ error: err.message, loading: false });
    }
  },
}));
