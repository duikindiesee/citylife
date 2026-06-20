// Spec 083 P1 — THE NEGOTIATION ENGINE. The first trade in the city is construction: a moving-in
// citizen DREAMS a house, Viw the Builder quotes with a margin, the two trade capped rounds (trim
// the dream, concede the margin, meet in the middle or walk), and an agreed brief compiles to a
// real blueprint through the spec 077 pipeline. Everything here is PURE and DETERMINISTIC — no
// Math.random, no wall-clock — because inference only ever AUTHORS the words on top of these
// numbers (P3); the numbers must replay identically for the same seeds so the whole negotiation is
// unit-testable headless and the same city converges to the same houses twice.
import { validateBlueprint } from "../blueprintScript";

export interface Brief {
  w: number;
  d: number;
  storeys: 1 | 2;
  bedrooms: number;
  outdoor: "none" | "patio" | "pool";
  doorDir: "n" | "s";
}

export interface NegotiationRound {
  who: "viw" | "client";
  text: string;
  price: number;
}

export interface NegotiationSession {
  state: "agreed" | "walked";
  rounds: NegotiationRound[];
  agreedBrief?: Brief;
  agreedPrice?: number;
}

// Spec 077 P5's designHash (neighborhood.ts) is the seed family behind every per-citizen design
// choice, and spec 083 says the dream derives from the SAME seed that makes no two houses alike.
// That helper is module-private and this P1 slice ships without touching files other agents own,
// so the identical splitmix-style avalanche lives here too: same constants, same mixing, so a
// citizen's dream and its self-designed home draw from one design identity.
function designHash(seed: number, salt: number): number {
  let h = (seed ^ (salt * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

// The same cosy footprint proportions the street's self-designed homes use (spec 077 P5), clamped
// into the plot's house zone — a dream never spills past the land the citizen actually owns.
const FOOTPRINTS: ReadonlyArray<readonly [number, number]> = [
  [5, 4],
  [6, 5],
  [7, 5],
  [6, 6],
];

/** The client bot's DREAM, derived deterministically from its seed (spec 083 mechanic 3): a
 *  footprint inside the zone, 1-3 bedrooms, a varied outdoor flourish, and a door that usually
 *  faces the street (four dreams in five — the odd dreamer wants a back-lane entrance). Distinct
 *  hash salts from defaultBlueprint's, so the dream is its own design axis, not an echo. */
export function dreamBrief(
  seed: number,
  zone: { w: number; d: number },
  streetDir: "n" | "s",
): Brief {
  const h = (salt: number) => designHash(seed >>> 0, salt);
  const [fw, fd] = FOOTPRINTS[h(21) % FOOTPRINTS.length]!;
  const w = Math.max(1, Math.min(zone.w, fw));
  const d = Math.max(1, Math.min(zone.d, fd));
  // Bedrooms never outnumber the columns the footprint can hold, so every dream compiles.
  const bedrooms = Math.max(1, Math.min(1 + (h(22) % 3), w));
  const outdoorRoll = h(23) % 5;
  const outdoor: Brief["outdoor"] =
    outdoorRoll < 2 ? "none" : outdoorRoll < 4 ? "patio" : "pool";
  const storeys = (1 + (h(24) % 2)) as 1 | 2;
  const doorDir: Brief["doorDir"] =
    h(25) % 5 === 0 ? (streetDir === "n" ? "s" : "n") : streetDir;
  return { w, d, storeys, bedrooms, outdoor, doorDir };
}

/** Spec 083 — the quote is a PURE function of the brief: base 80 + 6 per footprint cell + 30 per
 *  bedroom + 50 for a second storey + the outdoor flourish premium (25 patio / 60 pool). Integer
 *  city coin, so the wallet move (P4) never sees a fraction. */
export function priceBrief(brief: Brief): number {
  const flourish =
    brief.outdoor === "pool" ? 60 : brief.outdoor === "patio" ? 25 : 0;
  return (
    80 +
    6 * brief.w * brief.d +
    30 * brief.bedrooms +
    (brief.storeys === 2 ? 50 : 0) +
    flourish
  );
}

const ROUND_CAP = 3;

// Viw the Builder is ONE crew with ONE seeded margin — a fixed builder seed across every deal, so
// the Builder Desk (player-facing) and the in-engine commissionLot (bot/HUD) quote identically.
export const VIW_SEED = 0x56495721; // 'VIW!'

/** A citizen's seeded build allowance (the real wallet move is P4b, ledger-gated). Generous enough
 *  that most commissions strike a deal — so the city actually gets built — yet tight enough that
 *  some dreamers trim a rung. 1.20-1.50 of the fair price, deterministic per client seed. */
export function seededBudget(clientSeed: number, dream: Brief): number {
  const mult = 120 + (designHash(clientSeed >>> 0, 99) % 31);
  return Math.round((priceBrief(dream) * mult) / 100);
}

/** One step down the spec 083 trim ladder: the pool becomes a patio, the patio goes, then a
 *  bedroom past the first, then the second storey. Null when the dream is already at the bone. */
function trimOnce(brief: Brief): { next: Brief; gave: string } | null {
  if (brief.outdoor === "pool")
    return { next: { ...brief, outdoor: "patio" }, gave: "the pool" };
  if (brief.outdoor === "patio")
    return { next: { ...brief, outdoor: "none" }, gave: "the patio" };
  if (brief.bedrooms > 1)
    return {
      next: { ...brief, bedrooms: brief.bedrooms - 1 },
      gave: "a bedroom",
    };
  if (brief.storeys === 2)
    return { next: { ...brief, storeys: 1 }, gave: "the upstairs" };
  return null;
}

// Deterministic dialogue templates (spec 083 mechanic 4: the script that runs when no inference
// pod authors the words). PG, friendly, well under the 280-char kookerbook cap, and screened in
// tests by isPublicSafe — so the brand-word family never appears; prices quote in plain city coin.
const OUTDOOR_PHRASE: Record<Brief["outdoor"], string> = {
  none: "no frills out back",
  patio: "a patio out back",
  pool: "a pool out back",
};

function openLine(v: number, price: number, brief: Brief): string {
  const beds = `${brief.bedrooms} bedroom${brief.bedrooms === 1 ? "" : "s"}`;
  return v === 0
    ? `A fine dream — ${beds}, ${OUTDOOR_PHRASE[brief.outdoor]}. My crew will raise it for ${price} city coin.`
    : `I priced the plans: ${beds}, ${OUTDOOR_PHRASE[brief.outdoor]}. ${price} city coin, timber and labour included.`;
}

function requoteLine(v: number, price: number): string {
  return v === 0
    ? `I hear you. I can shave my margin — ${price} city coin and the crew starts this week.`
    : `Tell you what: ${price} city coin. That is close to cost for a build like this.`;
}

function counterLine(v: number, gave: string | null, price: number): string {
  if (gave === null)
    return `There is nothing left to trim. ${price} city coin is everything I can put up.`;
  return v === 0
    ? `Too steep for my purse. Let go of ${gave} and I can offer ${price} city coin.`
    : `That is past my budget. Drop ${gave}; ${price} city coin is my offer.`;
}

function acceptLine(v: number, price: number): string {
  return v === 0
    ? `Deal! ${price} city coin and the lot is yours to build on.`
    : `Agreed — ${price} city coin. When can the crew start?`;
}

function middleLine(price: number): string {
  return `We are close. Split the difference at ${price} city coin and we shake on it.`;
}

function walkLine(): string {
  return `We are too far apart, friend. I will save a little longer and come back another season.`;
}

/** Spec 083 mechanic 4 — the capped convergence. Viw opens at priceBrief(dream) times a seeded
 *  margin (1.15-1.35 from his seed) and concedes a seeded step (5-9 points) each round; the client
 *  accepts anything inside its budget, else trims the dream one ladder step and counters with the
 *  fair (margin-free) price capped at its purse. At most three rounds each side. When the caps run
 *  out with the gap inside ten percent of the budget, the two meet in the middle; otherwise the
 *  client walks. All integer percent arithmetic — every replay lands on the same coin. */
export function negotiate(opts: {
  clientSeed: number;
  builderSeed: number;
  dream: Brief;
  budget: number;
}): NegotiationSession {
  const hb = (salt: number) => designHash(opts.builderSeed >>> 0, salt);
  const hc = (salt: number) => designHash(opts.clientSeed >>> 0, salt);
  let marginPct = 115 + (hb(41) % 21);
  const stepPct = 5 + (hb(42) % 5);
  const budget = Math.max(0, Math.floor(opts.budget));
  let brief: Brief = { ...opts.dream };
  const rounds: NegotiationRound[] = [];
  for (let r = 0; r < ROUND_CAP; r++) {
    const quote = Math.round((priceBrief(brief) * marginPct) / 100);
    const vv = hb(50 + r) % 2;
    rounds.push({
      who: "viw",
      text: r === 0 ? openLine(vv, quote, brief) : requoteLine(vv, quote),
      price: quote,
    });
    if (quote <= budget) {
      rounds.push({
        who: "client",
        text: acceptLine(hc(60 + r) % 2, quote),
        price: quote,
      });
      return {
        state: "agreed",
        rounds,
        agreedBrief: brief,
        agreedPrice: quote,
      };
    }
    if (r < ROUND_CAP - 1) {
      const trimmed = trimOnce(brief);
      if (trimmed) brief = trimmed.next;
      const counter = Math.min(budget, priceBrief(brief));
      rounds.push({
        who: "client",
        text: counterLine(
          hc(70 + r) % 2,
          trimmed ? trimmed.gave : null,
          counter,
        ),
        price: counter,
      });
      marginPct = Math.max(100, marginPct - stepPct);
    } else if (quote * 10 <= budget * 11) {
      // Caps spent but the last quote sits within ten percent of the purse: meet in the middle.
      const mid = Math.round((quote + budget) / 2);
      rounds.push({ who: "client", text: middleLine(mid), price: mid });
      return { state: "agreed", rounds, agreedBrief: brief, agreedPrice: mid };
    } else {
      rounds.push({ who: "client", text: walkLine(), price: budget });
    }
  }
  return { state: "walked", rounds };
}

/** Spec 083 mechanic 5 — the conclusion IS a blueprint. Compose the agreed brief into the spec 077
 *  DSL using the same authoring trick as defaultBlueprint: rooms are laid out once with the FRONT
 *  (door) on the y:0 edge — the living room covering the whole door wall, the bedroom band behind
 *  it, the outdoor flourish as the rear band — then mirrored vertically for a south door, so the
 *  yard always stays out back. Valid BY CONSTRUCTION for every brief dreamBrief / negotiate can
 *  produce: the front room always reaches the door edge and no room escapes the footprint. */
export function briefToBlueprint(brief: Brief, seed: number): string {
  const h = (salt: number) => designHash(seed >>> 0, salt);
  const { w, d } = brief;
  type R = {
    kind: string;
    x: number;
    y: number;
    w: number;
    d: number;
    win: 0 | 1;
  };
  // Out-of-contract briefs (hand-built, not from this engine) are clamped rather than rejected,
  // keeping the compiler total; for engine-produced briefs both clamps are identities.
  const beds = Math.max(1, Math.min(brief.bedrooms, w));
  const backD =
    brief.outdoor === "none" || d < 2
      ? 0
      : Math.max(1, Math.min(Math.floor(d / 3), d - 2));
  const innerD = d - backD;
  const livingD = Math.max(1, Math.min(Math.ceil(innerD / 2), innerD - 1));
  const bedD = innerD - livingD;
  let rooms: R[];
  if (bedD >= 1) {
    rooms = [{ kind: "living", x: 0, y: 0, w, d: livingD, win: 1 }];
    const colW = Math.floor(w / beds);
    for (let i = 0; i < beds; i++) {
      const x = i * colW;
      rooms.push({
        kind: "bedroom",
        x,
        y: livingD,
        w: i === beds - 1 ? w - x : colW,
        d: bedD,
        win: (h(31 + i) & 1) as 0 | 1,
      });
    }
  } else {
    // A footprint too shallow for a band behind the living room (never produced by dreamBrief):
    // the bedrooms sit BESIDE the living room on the front row instead, door wall still covered.
    const sideBeds = Math.min(beds, Math.max(0, w - 1));
    rooms = [
      { kind: "living", x: 0, y: 0, w: w - sideBeds, d: innerD, win: 1 },
    ];
    for (let i = 0; i < sideBeds; i++) {
      rooms.push({
        kind: "bedroom",
        x: w - sideBeds + i,
        y: 0,
        w: 1,
        d: innerD,
        win: (h(31 + i) & 1) as 0 | 1,
      });
    }
  }
  if (backD > 0 && brief.outdoor !== "none")
    rooms.push({ kind: brief.outdoor, x: 0, y: innerD, w, d: backD, win: 0 });
  if (brief.doorDir === "s")
    rooms = rooms.map((r) => ({ ...r, y: d - (r.y + r.d) }));
  const roomStr = rooms.map(
    (r) =>
      `room{kind:${r.kind} x:${r.x} y:${r.y} w:${r.w} d:${r.d} win:${r.win}}`,
  );
  const script = `house{w:${w} d:${d} wallH:${brief.storeys} door:${brief.doorDir}} ${roomStr.join(" ")}`;
  // The valid-by-construction claim is cheap to enforce; a violation here is an engine bug, and
  // failing loudly in dev beats raising a house the door-access contract cannot serve.
  const v = validateBlueprint(script);
  if (!v.ok)
    throw new Error(
      `spec 083: brief compiled to an invalid blueprint: ${v.errors.join("; ")}`,
    );
  return script;
}
