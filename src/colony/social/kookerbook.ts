// Spec 082 P0 — KOOKERBOOK, the bot social network: the pure profile + post model. Every citizen
// gets a profile at registration (Joe the Crab is profile number one); engine events and narrations
// become timeline posts. Pure data + pure transitions, node-tested: no DOM, no clock (posts are
// stamped with the GAME sol + a sequence number, so the sim stays deterministic), no randomness.
// Every string is screened with the public-safety denylist at the boundary — an unsafe alias, bio
// or post text never enters a profile.
import { isPublicSafe } from "../newcomers";

export const POST_CAP = 50; // newest-first, oldest evicted
export const AUTHORED_PER_SOL = 3; // a chatty bot cannot flood the feed
export const POST_TEXT_MAX = 280;

export type PostKind = "event" | "narration" | "authored";

export interface KbPost {
  id: string; // `${citizenId}_${sol}_${seq}` — deterministic, unique per profile
  sol: number;
  seq: number;
  kind: PostKind;
  text: string;
  imageRef?: string; // an opaque reference (data url or store key), never a credential
}

export interface KbProfile {
  citizenId: string;
  alias: string; // screened display name
  bio: string; // screened, PG-safe personality blurb
  plotId?: string;
  address?: string; // public-safe plot name, e.g. Driftwood Cove
  kind: "human" | "crab";
  follows: string[]; // citizenIds
  posts: KbPost[]; // newest first
}

/** Create a screened profile. Returns null when any display string fails the denylist. */
export function createProfile(opts: {
  citizenId: string;
  alias: string;
  bio: string;
  plotId?: string;
  address?: string;
  kind?: "human" | "crab";
}): KbProfile | null {
  if (!opts.citizenId || !isPublicSafe(opts.alias) || !isPublicSafe(opts.bio))
    return null;
  if (opts.address && !isPublicSafe(opts.address)) return null;
  return {
    citizenId: opts.citizenId,
    alias: opts.alias,
    bio: opts.bio,
    plotId: opts.plotId,
    address: opts.address,
    kind: opts.kind ?? "human",
    follows: [],
    posts: [],
  };
}

/** Append a post (immutably): screened, trimmed to the text cap, newest first, profile capped at
 *  POST_CAP, and authored posts rate-limited to AUTHORED_PER_SOL per game sol. Returns the new
 *  profile, or null when the post is refused (unsafe text, over the authored cap, duplicate id). */
export function addPost(
  p: KbProfile,
  post: { sol: number; kind: PostKind; text: string; imageRef?: string },
): KbProfile | null {
  const text = post.text.trim().slice(0, POST_TEXT_MAX);
  if (!text || !isPublicSafe(text)) return null;
  if (post.kind === "authored") {
    const todays = p.posts.filter(
      (q) => q.sol === post.sol && q.kind === "authored",
    ).length;
    if (todays >= AUTHORED_PER_SOL) return null;
  }
  const seq = p.posts.filter((q) => q.sol === post.sol).length;
  const id = `${p.citizenId}_${post.sol}_${seq}`;
  if (p.posts.some((q) => q.id === id)) return null;
  const entry: KbPost = {
    id,
    sol: post.sol,
    seq,
    kind: post.kind,
    text,
    ...(post.imageRef ? { imageRef: post.imageRef } : {}),
  };
  return { ...p, posts: [entry, ...p.posts].slice(0, POST_CAP) };
}

/** Follow another citizen (idempotent, never self). */
export function follow(p: KbProfile, citizenId: string): KbProfile {
  if (citizenId === p.citizenId || p.follows.includes(citizenId)) return p;
  return { ...p, follows: [...p.follows, citizenId] };
}

/** Validate an untrusted stored object back into a KbProfile — tampering never reaches the UI. */
export function safeProfile(raw: unknown): KbProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<KbProfile>;
  if (
    typeof o.citizenId !== "string" ||
    typeof o.alias !== "string" ||
    typeof o.bio !== "string"
  )
    return null;
  const base = createProfile({
    citizenId: o.citizenId,
    alias: o.alias,
    bio: o.bio,
    plotId: typeof o.plotId === "string" ? o.plotId : undefined,
    address: typeof o.address === "string" ? o.address : undefined,
    kind: o.kind === "crab" ? "crab" : "human",
  });
  if (!base) return null;
  const follows = Array.isArray(o.follows)
    ? o.follows.filter((f): f is string => typeof f === "string")
    : [];
  let out: KbProfile = { ...base, follows };
  // Re-add posts oldest-first through the screened path so caps + screening hold for stored data too.
  const posts = Array.isArray(o.posts) ? [...o.posts].reverse() : [];
  for (const q of posts) {
    if (!q || typeof q !== "object") continue;
    const qq = q as Partial<KbPost>;
    if (typeof qq.sol !== "number" || typeof qq.text !== "string") continue;
    const kind: PostKind =
      qq.kind === "narration" || qq.kind === "authored" ? qq.kind : "event";
    const next = addPost(out, {
      sol: qq.sol,
      kind,
      text: qq.text,
      imageRef: typeof qq.imageRef === "string" ? qq.imageRef : undefined,
    });
    if (next) out = next;
  }
  return out;
}
