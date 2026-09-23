import { getAuthClient } from "../authClient";
import { COLONY } from "../config";
import { parseBlueprint, validateBlueprint } from "../blueprintScript";
import { fetchPublishedStarterWorld, type PublishedPlayerInventory } from "./starterWorldCatalogue";
import type { StarterParcelGeometry } from "../starterParcelSurvey";
import type { DoorDir } from "../voxelHouse";

export const HOUSE_BUILD_PATH = "/kooker/api/v1/citylife/players/me/home/build";
export interface HouseBuildContext {
  plotId: string; frameId: string; layoutRevision: string;
  geometry: StarterParcelGeometry; script: string | null; completed: boolean;
}
export interface HouseBuildSession {
  userId: string; context: HouseBuildContext; inventory: PublishedPlayerInventory; door: DoorDir;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid house details");
  return value as Record<string, unknown>;
};
export function houseDoor(geometry: StarterParcelGeometry): DoorDir {
  const h = geometry.houseZone, end = geometry.driveway.at(-1);
  if (!end) throw new Error("Driveway is unavailable");
  if (end.x === h.x + Math.floor(h.width / 2)) {
    if (end.y === h.y - 1) return "n";
    if (end.y === h.y + h.depth) return "s";
  }
  if (end.y === h.y + Math.floor(h.depth / 2)) {
    if (end.x === h.x - 1) return "w";
    if (end.x === h.x + h.width) return "e";
  }
  throw new Error("Your house entrance does not meet its driveway");
}
export function parseHouseBuildContext(raw: unknown, inventory: PublishedPlayerInventory): HouseBuildContext {
  const value = object(raw), geometry = object(value.geometry), zone = object(geometry.houseZone);
  if (typeof value.plotId !== "string" || typeof value.frameId !== "string" ||
      !inventory.plotIds.includes(value.plotId) || inventory.plotFrames.get(value.plotId) !== value.frameId ||
      value.layoutRevision !== inventory.layoutRevision || geometry.worldId !== inventory.worldId ||
      geometry.plotId !== value.plotId || geometry.layoutRevision !== value.layoutRevision ||
      typeof value.completed !== "boolean" || !(value.script === null || typeof value.script === "string") ||
      !Array.isArray(geometry.driveway) || !geometry.driveway.length ||
      ![zone.x,zone.y,zone.width,zone.depth].every(Number.isSafeInteger) ||
      Number(zone.width) < 1 || Number(zone.width) > 24 || Number(zone.depth) < 1 || Number(zone.depth) > 24)
    throw new Error("Your plot does not match the published world. Please retry.");
  const context = value as unknown as HouseBuildContext;
  const door = houseDoor(context.geometry);
  if (context.completed && !context.script) throw new Error("Completed house design is missing");
  if (context.script) {
    const design = parseBlueprint(context.script);
    if (!validateBlueprint(context.script).ok || design.w !== zone.width || design.d !== zone.depth || design.doorDir !== door)
      throw new Error("Saved house design does not match your plot");
  }
  return context;
}
async function request(userId: string, body?: unknown): Promise<unknown> {
  const auth = getAuthClient();
  if (auth.operator?.userId !== userId) throw new Error("Your account changed. Reload the builder.");
  const token = await auth.getValidToken();
  if (!token || auth.operator?.userId !== userId) throw new Error("Sign in again to build your house.");
  const response = await fetch(HOUSE_BUILD_PATH, {method:body ? "POST" : "GET",cache:"no-store",
    headers:{Authorization:`Bearer ${token}`, ...(body ? {"Content-Type":"application/json"} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(15_000)});
  const result: unknown = await response.json().catch(() => null);
  if (auth.operator?.userId !== userId) throw new Error("Your account changed. Reload the builder.");
  if (!response.ok) throw new Error(response.status === 422 ? "Check your design: an indoor room must meet the driveway entrance."
    : response.status === 409 ? "Your plot or saved house changed. Reload before continuing."
    : "House building is unavailable. Please retry.");
  return result;
}
export async function loadHouseBuild(): Promise<HouseBuildSession> {
  const userId = getAuthClient().operator?.userId;
  if (!userId) throw new Error("Sign in to CityLife before building your house.");
  const inventory = await fetchPublishedStarterWorld(`seed-${COLONY.render.seed}`);
  const context = parseHouseBuildContext(await request(userId), inventory);
  return {userId,inventory,context,door:houseDoor(context.geometry)};
}
export async function completeHouseBuild(session: HouseBuildSession, script: string): Promise<HouseBuildContext> {
  const {plotId,layoutRevision} = session.context;
  const receipt = parseHouseBuildContext(await request(session.userId,{plotId,layoutRevision,script}), session.inventory);
  if (!receipt.completed || receipt.plotId !== plotId || receipt.script !== script)
    throw new Error("House completion is not confirmed. Retry the same design.");
  const truth = parseHouseBuildContext(await request(session.userId),session.inventory);
  if (!truth.completed || truth.plotId !== plotId || truth.script !== script)
    throw new Error("Your saved house could not be confirmed. Retry the same design.");
  return truth;
}
