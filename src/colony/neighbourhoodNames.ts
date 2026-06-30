export const CITYLIFE_NEIGHBOURHOOD_NAMES = [
  "Kookerbos Woods",
  "Driftwood Shore",
  "Lantern Hollow",
  "Crewhouse Quarter",
  "Saltkern Bay",
  "Ridgeline",
] as const;

export type CityLifeNeighbourhoodName =
  (typeof CITYLIFE_NEIGHBOURHOOD_NAMES)[number];

export type NamedNeighbourhood = {
  name: CityLifeNeighbourhoodName;
  x: number;
  y: number;
  radius: number;
};

export type NeighbourhoodLabel = {
  name: CityLifeNeighbourhoodName;
  relation: "in" | "near";
};

export function nearestNeighbourhoodLabel(
  pos: { x: number; y: number },
  places: readonly NamedNeighbourhood[],
): NeighbourhoodLabel | null {
  let best: NamedNeighbourhood | null = null;
  let bestD = Infinity;
  for (const place of places) {
    const d = (pos.x - place.x) ** 2 + (pos.y - place.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = place;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    relation: Math.sqrt(bestD) <= best.radius ? "in" : "near",
  };
}
