// Newcomer household generator (Phase 1 — plan Slice 4). Produces a fictional, public-safe FAMILY
// household (a lead persona plus members) deterministically from a seed, with safety metadata.
// No Hermes/backend here: this is the data the Border Control dialog, the surveyor, and the
// house/room designer build on. Per AGENTS.md, identities are generated, fictional, and screened
// against a denylist before they can be displayed or persisted.
import { RNG } from "../engine/rng";

export type HouseholdStatus =
  | "draft"
  | "triage"
  | "approved"
  | "active"
  | "held"
  | "rejected";
export type MemberRole = "adult" | "teen" | "child";

export interface HouseholdMember {
  name: string;
  age: number;
  role: MemberRole;
  occupation: string;
}

export interface LeadPersona {
  education: string;
  jobHistory: string;
  migrationMotivation: string;
}

/** Player-chosen attributes for the single adult citizen. Any omitted field is generated. Each is
 *  screened against the public-safe denylist; an unsafe value is ignored (falls back to generated). */
export interface HouseholdOverrides {
  name?: string; // the citizen's full name; its last word becomes the household surname
  age?: number; // clamped to 18..99
  profession?: string; // the citizen's occupation; also drives the lead's job history
}

export interface Household {
  id: string; // public slug, never an internal profile name
  displayName: string; // generated public-safe family name
  botHandle: string; // public alias only; the real Hermes profile id stays server-side
  members: HouseholdMember[]; // the family — each drives a room in the house later
  membersSummary: string;
  lead: LeadPersona;
  originLocation: string; // public Earth location string
  holdings: number; // Earth savings, deposited into their kooker wallet on accept
  status: HouseholdStatus;
  generated: true;
  publicSafe: boolean;
}

// Generated identities must never resemble internal/operator/secret strings (AGENTS.md safety).
const DENY = [
  /kooker/i,
  /hermes/i,
  /antigrav/i,
  /sportifine/i,
  /pacman/i,
  /duik/i,
  /admin/i,
  /\broot\b/i,
  /token/i,
  /secret/i,
  /password/i,
  /\bkey\b/i,
  /bearer/i,
  /\.co\.za/i,
  /localhost/i,
  /\bsvc\b/i,
  /cluster\.local/i,
];

/** True if a generated string is public-safe (no internal / secret-looking content).
 *  Exception: the Kookerverse Builder is literally named KOOKER. The 'kooker' brand word is denied so it
 *  can never leak into GENERATED newcomer / user-chosen identities, but the Builder's own authored labels
 *  ("KOOKER the Builder", "Hire KOOKER", …) are trusted system strings. So the uppercase brand KOOKER is
 *  permitted specifically (generated/user content is lower- or mixed-case and stays blocked), while every
 *  OTHER denied pattern still applies even to the Builder's strings. */
export function isPublicSafe(s: string): boolean {
  return !DENY.some((re) => {
    if (re.source === "kooker" && /\bKOOKER\b/.test(s)) return false; // allow the authored uppercase brand
    return re.test(s);
  });
}

// Whimsical, invented lists — fictional by construction, never real-person identities.
const SURNAMES = [
  "Quillfeather",
  "Marrowbrook",
  "Vandersnoot",
  "Pembernell",
  "Tindleworth",
  "Brackenhollow",
  "Fennwick",
  "Dolloway",
  "Crimblewood",
  "Stardle",
  "Mossgrove",
  "Halvergate",
  "Pibbleton",
  "Wynstead",
  "Ottergale",
  "Lunderquist",
];
const FIRSTS = [
  "Pim",
  "Sora",
  "Briony",
  "Tace",
  "Wren",
  "Odi",
  "Sven",
  "Mox",
  "Calla",
  "Renn",
  "Juno",
  "Bex",
  "Pax",
  "Nessa",
  "Tobin",
  "Elke",
  "Cosmo",
  "Wila",
  "Dax",
  "Sumi",
];
const ORIGINS = [
  "Cape Town, Earth",
  "Reykjavik, Earth",
  "Quezon City, Earth",
  "Valparaiso, Earth",
  "Tromso, Earth",
  "Kuching, Earth",
  "La Paz, Earth",
  "Gdansk, Earth",
  "Hobart, Earth",
  "Windhoek, Earth",
];
const ADULT_JOBS = [
  "Hydroponics tech",
  "Welder",
  "Medic",
  "Teacher",
  "Surveyor",
  "Reactor tech",
  "Logistics clerk",
  "Cook",
  "Botanist",
  "Mechanic",
  "Geologist",
  "Pilot",
];
const EDU = [
  "Trade certificate",
  "University degree",
  "Self-taught",
  "Apprenticeship",
  "Polytechnic diploma",
];
const MOTIVE = [
  "Seeking a fresh start off-world",
  "Following a work contract",
  "Escaping a crowded Earth",
  "Reuniting with family already settled",
  "A pioneering streak",
  "Drawn by the land grant",
];

function pick<T>(rng: RNG, arr: T[]): T {
  return arr[rng.int(0, arr.length - 1)]!;
}

/** Generate one fictional family household deterministically from a seed. When `overrides` are given,
 *  the player's chosen name / age / profession replace the generated ones for the single adult citizen
 *  (each only if public-safe); everything else stays generated. */
export function generateHousehold(
  seed: number,
  overrides?: HouseholdOverrides,
): Household {
  const rng = new RNG(seed >>> 0);
  const chosenName = overrides?.name?.trim();
  const useChosenName = !!chosenName && isPublicSafe(chosenName);
  // The surname (household name) follows the chosen name's last word, else a generated one.
  const surname = useChosenName
    ? chosenName!.split(/\s+/).pop() || pick(rng, SURNAMES)
    : pick(rng, SURNAMES);
  const chosenProfession = overrides?.profession?.trim();
  const useChosenProfession =
    !!chosenProfession && isPublicSafe(chosenProfession);
  const useChosenAge =
    typeof overrides?.age === "number" && Number.isFinite(overrides.age);
  // 1 newcomer = 1 bot (operator directive). The colony now receives a SINGLE adult citizen who becomes
  // exactly one Hermes avatar — the family generator is kept (members[] is still the spine downstream) but
  // constrained to one person so the border-patrol → bot → citizen path maps one settler to one pod.
  const adults = 1;
  const kids = 0;

  const used = new Set<string>();
  const uniqueFirst = (): string => {
    for (let i = 0; i < 12; i++) {
      const n = pick(rng, FIRSTS);
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    return pick(rng, FIRSTS) + rng.int(2, 9);
  };

  const members: HouseholdMember[] = [];
  for (let i = 0; i < adults; i++) {
    members.push({
      name: useChosenName ? chosenName! : `${uniqueFirst()} ${surname}`,
      age: useChosenAge
        ? Math.max(18, Math.min(99, Math.round(overrides!.age!)))
        : rng.int(24, 54),
      role: "adult",
      occupation: useChosenProfession
        ? chosenProfession!
        : pick(rng, ADULT_JOBS),
    });
  }
  for (let i = 0; i < kids; i++) {
    const age = rng.int(2, 17);
    members.push({
      name: `${uniqueFirst()} ${surname}`,
      age,
      role: age >= 13 ? "teen" : "child",
      occupation: age >= 6 ? "Student" : "Pre-school",
    });
  }

  const lead: LeadPersona = {
    education: pick(rng, EDU),
    jobHistory: `${rng.int(2, 20)} years as a ${members[0]!.occupation.toLowerCase()}`,
    migrationMotivation: pick(rng, MOTIVE),
  };
  const membersSummary =
    `${adults} adult${adults > 1 ? "s" : ""}` +
    (kids > 0
      ? `, ${kids} ${kids > 1 ? "children" : "child"}`
      : ", no children");
  const slug = (seed >>> 0).toString(36);

  const household: Household = {
    id: `household_${slug}`,
    displayName: `The ${surname} Household`,
    botHandle: `${surname.toLowerCase()}-${slug}`,
    members,
    membersSummary,
    lead,
    originLocation: pick(rng, ORIGINS),
    holdings: rng.int(8000, 60000),
    status: "draft",
    generated: true,
    publicSafe: true,
  };

  // Final safety pass: if anything generated looks internal/secret, mark unsafe so callers withhold it.
  const blob = [
    household.displayName,
    household.botHandle,
    household.originLocation,
    ...members.map((m) => m.name),
    lead.jobHistory,
    lead.migrationMotivation,
  ].join(" | ");
  household.publicSafe = isPublicSafe(blob);
  return household;
}
