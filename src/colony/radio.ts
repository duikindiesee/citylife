// Low Power Radio — CityLife's heartbeat. A tiny always-on station on the roof, sending songs
// through every street, window, garden and home. Joe my genius crab is on the midnight shift.
//
// HOW IT'S LICENSED (the user's question — "play real bands without copyright?").
// We use YouTube's IFrame Player API: YouTube already pays the artists via their licensing deals,
// the embed is free and royalty-clean for the game. We do NOT host any audio ourselves. Each
// channel is a YouTube playlist or channel id the operator configures in their gitignored env.
//
// Future monetization (see docs/research/2026-05-31-low-power-radio.md):
//   • House ads (the colony's own "Kookerverse Bank" sponsorship) — free, story-fitting
//   • Sponsor reads (real businesses) — direct revenue, no licensing tangle
//   • YouTube Partner revenue share — if/when the channel is approved
//   • Spotify Web Playback SDK — alternate, requires Spotify Premium per listener

export type ChannelKind = "youtube-playlist" | "youtube-video";

export interface RadioChannel {
  id: string; // stable slug
  name: string; // display name
  vibe: string; // one-liner
  kind: ChannelKind;
  ref: string; // YouTube playlist id (PL...) or video id
  /** Optional sponsor line shown between tracks — the seed of the in-game ad market. */
  sponsor?: string;
}

export interface AdSlot {
  id: string;
  sponsor: string;
  copy: string;
  ts: number;
}

export interface RadioState {
  on: boolean;
  muted: boolean;
  channelId: string | null;
  channels: RadioChannel[];
  /** Recent house ads / sponsor reads — the in-game ad ticker. */
  ads: AdSlot[];
}

/** Default channels — generic vibes that match the colony's zones. Real playlist IDs come from
 *  the operator's gitignored env (VITE_RADIO_PLAYLIST_*); the defaults here are empty placeholders
 *  so nothing copyrighted ships in the public repo. */
export const DEFAULT_CHANNELS: RadioChannel[] = [
  {
    id: "drive",
    name: "Drive",
    vibe: "lo-fi for the long commute",
    kind: "youtube-playlist",
    ref: "",
  },
  {
    id: "coast",
    name: "Coast",
    vibe: "chillwave by the crystal shore",
    kind: "youtube-playlist",
    ref: "",
  },
  {
    id: "space",
    name: "Space",
    vibe: "synthwave above the floating island",
    kind: "youtube-playlist",
    ref: "",
  },
  {
    id: "forest",
    name: "Forest",
    vibe: "folk & ambient under the violet trees",
    kind: "youtube-playlist",
    ref: "",
  },
  {
    id: "industry",
    name: "Industry",
    vibe: "metal & electronics from the downwind south",
    kind: "youtube-playlist",
    ref: "",
  },
];

/** House ads that play between channel switches — the demo of the monetisation surface. */
export const HOUSE_ADS: Array<Omit<AdSlot, "id" | "ts">> = [
  {
    sponsor: "Kookerverse Bank",
    copy: "Every settler gets a wallet on day one. Deposits insured by the colony charter.",
  },
  {
    sponsor: "Border Authority",
    copy: "No open doors. Welcome home, the proper way — at the border post.",
  },
  {
    sponsor: "Riverside Mile",
    copy: "Plots still available on the freshwater bend. Speak to the Border Patrol Officer.",
  },
  {
    sponsor: "Civic Centre",
    copy: "School, clinic, and fire post anchor the centre. Your kids will grow up safe.",
  },
  {
    sponsor: "The Joekookerbot Hour",
    copy: "Coming up next on Low Power Radio — Joe my genius crab takes the midnight shift.",
  },
];

function envChannels(): RadioChannel[] {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> })
      .env ?? {};
  const map: Record<string, string | undefined> = {
    drive: env.VITE_RADIO_PLAYLIST_DRIVE,
    coast: env.VITE_RADIO_PLAYLIST_COAST,
    space: env.VITE_RADIO_PLAYLIST_SPACE,
    forest: env.VITE_RADIO_PLAYLIST_FOREST,
    industry: env.VITE_RADIO_PLAYLIST_INDUSTRY,
  };
  return DEFAULT_CHANNELS.map((c) => ({ ...c, ref: map[c.id] ?? c.ref }));
}

/** Pull a YouTube playlist id and optional starting video id out of any common input shape:
 *    PLABC...                              → { listId: 'PLABC...' }
 *    youtube.com/watch?v=VID&list=PL...    → { listId: 'PL...', videoId: 'VID' }
 *    youtube.com/playlist?list=PL...       → { listId: 'PL...' }
 *    youtu.be/VID?list=PL...               → { listId: 'PL...', videoId: 'VID' }
 *    VID&list=PL...                        → { listId: 'PL...', videoId: 'VID' }
 *    a bare 11-char VID                    → { videoId: 'VID' }
 */
export function parseYouTubeRef(ref: string): {
  listId?: string;
  videoId?: string;
} {
  const r = ref.trim();
  if (!r) return {};
  // Bare playlist id (PL...) or any youtube list prefix.
  if (/^(PL|OLAK5uy|RD|UU|FL)[A-Za-z0-9_-]+$/.test(r)) return { listId: r };
  // Query-string style: either `v=...&list=...` directly, or anything after a `?`.
  const query = r.includes("?") ? r.slice(r.indexOf("?") + 1) : r;
  const qp = new URLSearchParams(query);
  const listFromQp = qp.get("list") || undefined;
  let vidFromQp = qp.get("v") || undefined;
  // If a `list=` is present but no `v=`, the first segment is sometimes the bare video id
  // (e.g. user pasted `VID&list=PL...` after dropping the `v=` prefix). Pick it up.
  if (listFromQp && !vidFromQp) {
    const first = query.split("&")[0] ?? "";
    if (/^[A-Za-z0-9_-]{11}$/.test(first)) vidFromQp = first;
  }
  if (listFromQp || vidFromQp)
    return { listId: listFromQp, videoId: vidFromQp };
  // youtu.be/VIDEO_ID or youtube.com/embed/VIDEO_ID with no query string.
  const m = r.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed|shorts)\/)([A-Za-z0-9_-]{6,})/,
  );
  if (m) return { videoId: m[1] };
  // Last resort: looks like a raw 11-char video id.
  if (/^[A-Za-z0-9_-]{11}$/.test(r)) return { videoId: r };
  return {};
}

/** Build the YouTube IFrame URL for a channel. YouTube handles licensing for embedded playback. */
export function channelEmbedUrl(
  channel: RadioChannel,
  opts: { autoplay?: boolean; muted?: boolean } = {},
): string {
  if (!channel.ref) return "";
  const { listId, videoId } = parseYouTubeRef(channel.ref);
  const params = new URLSearchParams({
    autoplay: opts.autoplay ? "1" : "0",
    mute: opts.muted ? "1" : "0",
    loop: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  // origin= is the YouTube IFrame Player API's recommended security param. We only know it in the
  // browser; in tests/SSR (no `window`) we skip it — YouTube still accepts commands without it.
  if (typeof window !== "undefined" && window.location?.origin)
    params.set("origin", window.location.origin);
  if (listId) {
    params.set("listType", "playlist");
    params.set("list", listId);
    // If we ALSO have a starting video, embed that video so the playlist starts on it.
    if (videoId)
      return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
    return `https://www.youtube.com/embed/videoseries?${params.toString()}`;
  }
  if (videoId) {
    // No list, just a single video — loop it back to itself.
    params.set("playlist", videoId);
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }
  return "";
}

export function createRadio(): RadioState {
  // muted=true by default so YouTube + Chrome allow autoplay; the operator's first Unmute click
  // fires a postMessage to the YouTube IFrame Player API — no iframe reload, no track restart.
  return {
    on: false,
    muted: true,
    channelId: null,
    channels: envChannels(),
    ads: [],
  };
}

export function tuneTo(state: RadioState, channelId: string): RadioState {
  const channel = state.channels.find((c) => c.id === channelId);
  if (!channel) return state;
  return { ...state, channelId, on: true };
}

export function toggleOn(state: RadioState): RadioState {
  // First on: pick the first configured channel (or first default)
  if (!state.on) {
    const firstConfigured = state.channels.find((c) => c.ref);
    return {
      ...state,
      on: true,
      channelId:
        state.channelId ?? firstConfigured?.id ?? state.channels[0]?.id ?? null,
    };
  }
  return { ...state, on: false };
}

export function toggleMuted(state: RadioState): RadioState {
  return { ...state, muted: !state.muted };
}

/** Queue a house ad — the demo of the ad-revenue surface. */
export function spinHouseAd(
  state: RadioState,
  now: number,
  rng: () => number = Math.random,
): RadioState {
  const pick = HOUSE_ADS[Math.floor(rng() * HOUSE_ADS.length)]!;
  const ad: AdSlot = {
    id: `ad_${now}`,
    sponsor: pick.sponsor,
    copy: pick.copy,
    ts: now,
  };
  return { ...state, ads: [ad, ...state.ads].slice(0, 8) };
}

export function currentChannel(state: RadioState): RadioChannel | null {
  return state.channels.find((c) => c.id === state.channelId) ?? null;
}

/** True if at least one channel has a configured playlist — the operator wired the env. */
export function anyConfigured(state: RadioState): boolean {
  return state.channels.some((c) => !!c.ref);
}
