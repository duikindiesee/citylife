// Spec 076 — when a citizen is approved at the border, mint them as a REAL kooker sub-user with their
// own Hermes pod, owned by the logged-in player (parentUserId). The pod becomes the citizen's brain:
// conversations run through it (full Hermes power) and it meters its own inference. Telegram is
// optional — omitted here, so the citizen lives purely in-game (the player can connect Telegram later).
//
// This is best-effort: the call is fired from the approval flow and never blocks the game. If the
// backend isn't reachable (offline / not yet deployed), the engine-side citizen still works; only the
// out-of-process pod is missing, which an admin can re-provision.
import { getAuthClient } from "../authClient";

const SPAWN_PATH = "/kooker/api/v1/citylife/citizens";

export interface SpawnCitizenInput {
  firstName: string;
  lastName: string;
  age?: number;
  profession?: string;
  telegramBotToken?: string;
  telegramUserId?: string;
}

export type SpawnResult =
  | { ok: true; citizenUserId?: number; profileId?: number; status?: string }
  | { ok: false; error: string };

/** Split a free-text full name into first + last for the backend persona. */
export function splitName(name: string): {
  firstName: string;
  lastName: string;
} {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Citizen", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/** POST the approved citizen to the kooker-service-user spawn endpoint AS THE LOGGED-IN PLAYER, so the
 *  citizen sub-user's parentUserId is set to the player and inference is metered to the citizen. */
export async function spawnCitizenSubUser(
  input: SpawnCitizenInput,
): Promise<SpawnResult> {
  const token = await getAuthClient().getValidToken();
  if (!token) return { ok: false, error: "not signed in" };
  try {
    const resp = await fetch(SPAWN_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = (await resp.json()) as {
      userId?: number;
      profileId?: number;
      status?: string;
    };
    return {
      ok: true,
      citizenUserId: data.userId,
      profileId: data.profileId,
      status: data.status,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network error",
    };
  }
}
