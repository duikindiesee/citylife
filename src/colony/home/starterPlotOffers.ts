import { getAuthClient } from "../authClient";
import { classifyPurchaseStatus, HOME_PURCHASE_PATH, type HomeTruth, type PurchaseOutcome } from "./starterProperty";

export const AVAILABLE_PLOTS_PATH = "/kooker/api/v1/citylife/players/me/home/available-plots";

/** Selection/display fields from a published server offer. Never a client price authority. */
export interface StarterPlotOffer {
  readonly plotId: string;
  readonly frameId: string;
  readonly priceKco: number;
  readonly neighbourhoodKey: string;
  readonly worldId: string;
  readonly layoutRevision: string;
  readonly width: number;
  readonly depth: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && value.trim() === value;
}

export function parseStarterPlotOffers(raw: unknown): StarterPlotOffer[] | null {
  if (!Array.isArray(raw)) return null;
  const offers: StarterPlotOffer[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const offer = record(entry), geometry = record(offer?.geometry), parcel = record(geometry?.parcel);
    if (!offer || !geometry || !parcel || !identifier(offer.plotId) || !identifier(offer.frameId) ||
      !identifier(geometry.worldId) || !identifier(geometry.neighbourhoodKey) ||
      geometry.plotId !== offer.plotId || typeof geometry.layoutRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(geometry.layoutRevision) ||
      typeof offer.priceKco !== "number" || !Number.isFinite(offer.priceKco) || offer.priceKco < 0 ||
      typeof parcel.width !== "number" || !Number.isSafeInteger(parcel.width) || parcel.width <= 0 ||
      typeof parcel.depth !== "number" || !Number.isSafeInteger(parcel.depth) || parcel.depth <= 0 ||
      ids.has(offer.plotId)) return null; // a broken catalogue is not an empty or partially invented one
    ids.add(offer.plotId);
    offers.push({plotId:offer.plotId, frameId:offer.frameId, priceKco:offer.priceKco,
      neighbourhoodKey:geometry.neighbourhoodKey, worldId:geometry.worldId,
      layoutRevision:geometry.layoutRevision, width:parcel.width, depth:parcel.depth});
  }
  return offers.sort((a,b) => a.plotId < b.plotId ? -1 : a.plotId > b.plotId ? 1 : 0);
}

export async function fetchStarterPlotOffers(): Promise<StarterPlotOffer[] | null> {
  const auth = getAuthClient(), userId = auth.operator?.userId;
  if (!userId) return null;
  try {
    const token = await auth.getValidToken();
    if (!token || auth.operator?.userId !== userId) return null;
    const response = await fetch(AVAILABLE_PLOTS_PATH, {headers:{Authorization:`Bearer ${token}`}});
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return auth.operator?.userId === userId ? parseStarterPlotOffers(body) : null;
  } catch { return null; }
}

/** Submit only the immutable selection from the latest offered list. The server independently
 * validates availability, geometry, neighbourhood policy, price and token-derived ownership.
 */
export async function postPurchasePlot(
  plotId: string,
  offers: readonly StarterPlotOffer[],
): Promise<PurchaseOutcome> {
  const offer = offers.find(item => item.plotId === plotId);
  if (!offer) return {kind:"disabled"};
  return postSelection(offer);
}

/** Retry the existing insufficient-funds intent after reload; never select new land from it. */
export async function postResumePlotPurchase(truth: HomeTruth): Promise<PurchaseOutcome> {
  if (truth.status !== "REJECTED_INSUFFICIENT_FUNDS" || !truth.plotId || !truth.neighbourhoodKey ||
      !truth.layoutRevision || !/^[a-f0-9]{64}$/.test(truth.layoutRevision)) return {kind:"disabled"};
  return postSelection({plotId:truth.plotId, neighbourhoodKey:truth.neighbourhoodKey,
    layoutRevision:truth.layoutRevision});
}

async function postSelection(offer: Pick<StarterPlotOffer, "plotId" | "neighbourhoodKey" | "layoutRevision">): Promise<PurchaseOutcome> {
  const auth = getAuthClient(), userId = auth.operator?.userId;
  if (!userId) return {kind:"disabled"};
  try {
    const token = await auth.getValidToken();
    if (!token || auth.operator?.userId !== userId) return {kind:"disabled"};
    const response = await fetch(HOME_PURCHASE_PATH, {
      method:"POST", headers:{"content-type":"application/json", Authorization:`Bearer ${token}`,
        "Idempotency-Key":`citylife:plot-purchase:${userId}:${offer.plotId}:${offer.layoutRevision}`},
      body:JSON.stringify({neighbourhoodKey:offer.neighbourhoodKey, plotId:offer.plotId,
        layoutRevision:offer.layoutRevision}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (auth.operator?.userId !== userId) return {kind:"disabled"};
    // This endpoint returns 202 for a processing intent; 409 is a stale/conflicting
    // parcel selection and needs a fresh read rather than another blind POST.
    if (response.status === 409) return {kind:"error", status:409};
    if (response.ok && record(body)?.status !== "PLOT_OWNED" && record(body)?.status !== "PENDING")
      return {kind:"error", status:response.status};
    if (response.ok && record(body)?.status === "PENDING") return {kind:"pending"};
    return classifyPurchaseStatus(response.status, body);
  } catch { return {kind:"error"}; }
}
