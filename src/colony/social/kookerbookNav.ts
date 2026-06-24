import { isPublicSafe } from "../newcomers";

const CITIZEN_ID_PATTERN = /^citizen_[a-z0-9_]+$/;

export function isKookerbookCitizenId(citizenId: string): boolean {
  return CITIZEN_ID_PATTERN.test(citizenId) && isPublicSafe(citizenId);
}

export function kookerbookProfileUrl(
  currentHref: string,
  citizenId: string,
): string | null {
  if (!isKookerbookCitizenId(citizenId)) return null;
  const url = new URL(currentHref);
  url.search = "";
  url.searchParams.set("citizen", citizenId);
  return url.toString();
}

export function kookerbookInitialSelection(
  currentHref: string,
  loadedCitizenIds: readonly string[],
): string | null {
  const firstLoaded = loadedCitizenIds.find(isKookerbookCitizenId) ?? null;
  const requested = new URL(currentHref).searchParams.get("citizen");
  if (!requested || !isKookerbookCitizenId(requested)) return firstLoaded;
  return loadedCitizenIds.includes(requested) ? requested : firstLoaded;
}

export function kookerbookCanonicalProfileUrl(
  currentHref: string,
  loadedCitizenIds: readonly string[],
): string | null {
  const selected = kookerbookInitialSelection(currentHref, loadedCitizenIds);
  return selected ? kookerbookProfileUrl(currentHref, selected) : null;
}

export function kookerbookDirectoryLink(args: {
  currentHref: string;
  citizenId: string;
  alias: string;
  selectedCitizenId: string | null;
}): { href: string; ariaLabel: string; ariaCurrent?: "page" } | null {
  if (!isPublicSafe(args.alias)) return null;
  const href = kookerbookProfileUrl(args.currentHref, args.citizenId);
  if (!href) return null;
  return {
    href,
    ariaLabel: `Open Kookerbook profile for ${args.alias}`,
    ...(args.selectedCitizenId === args.citizenId
      ? { ariaCurrent: "page" as const }
      : {}),
  };
}
