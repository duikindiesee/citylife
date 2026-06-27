// Spec 112 slice 3 — player-facing roadmap data for the KOOKER beacon HUD.
// This stays pure and deterministic so the HUD, tests, and bot controls all read the same roadmap.

export type RoadmapPhase = "shipped" | "merging" | "next" | "later" | "parallel";

export interface RoadmapItem {
  id: string;
  title: string;
  summary: string;
  lane: "Player & UI" | "World" | "Bots" | "Content";
}

export interface RoadmapGroup {
  phase: RoadmapPhase;
  label: string;
  items: RoadmapItem[];
}

export const ROADMAP_PHASE_ORDER: RoadmapPhase[] = [
  "shipped",
  "merging",
  "next",
  "later",
  "parallel",
];

export const CITYLIFE_ROADMAP: RoadmapGroup[] = [
  {
    phase: "shipped",
    label: "Shipped",
    items: [
      {
        id: "phase1-mobile-rally-touch",
        title: "Mobile Road Rally touch controls",
        summary:
          "Phone-first throttle, brake, and steering controls feed the same rally drive input as keyboard play.",
        lane: "Player & UI",
      },
      {
        id: "phase1-garage-rally-spine",
        title: "Garage → car → meetup → race spine",
        summary:
          "Joe can tune the car, head to the night meetup, meet Cole, and enter the Road Rally loop.",
        lane: "Player & UI",
      },
    ],
  },
  {
    phase: "merging",
    label: "Merging",
    items: [
      {
        id: "phase1-gyro-gamepad-rally",
        title: "Gyro + Android TV gamepad rally inputs",
        summary:
          "Optional tilt steering and controller support remain additive while touch stays the default on phones.",
        lane: "Player & UI",
      },
    ],
  },
  {
    phase: "next",
    label: "Next",
    items: [
      {
        id: "phase2a-roadmap-hud",
        title: "KOOKER beacon Roadmap HUD",
        summary:
          "A phase-grouped in-world panel explains what is shipped, merging, next, later, and parallel.",
        lane: "Player & UI",
      },
      {
        id: "phase2a-commercial-district-signage",
        title: "District signage + POI read",
        summary:
          "Bring the scaled commercial district, mall pad, garage landmark, and POI labels into a readable city layer.",
        lane: "World",
      },
    ],
  },
  {
    phase: "later",
    label: "Later",
    items: [
      {
        id: "phase2b-open-world-drive",
        title: "Open-world cruising between landmarks",
        summary:
          "Move beyond the closed rally loop toward a Need-for-Speed-feel free-roam city drive.",
        lane: "World",
      },
      {
        id: "phase2c-channel-content-timeline",
        title: "Channel/content timeline surfaces",
        summary:
          "Use screenshot and render archives from Joe, Jack, and Floyd to feed city content moments.",
        lane: "Content",
      },
    ],
  },
  {
    phase: "parallel",
    label: "Parallel",
    items: [
      {
        id: "parallel-bot-review-lanes",
        title: "MoJoJo / Floyd / Jack review lanes",
        summary:
          "Bots keep reviewing, gathering proof, and routing safe slices while Joe stays in Player & UI.",
        lane: "Bots",
      },
    ],
  },
];

export function roadmapGroups(): RoadmapGroup[] {
  return ROADMAP_PHASE_ORDER.map((phase) => {
    const group = CITYLIFE_ROADMAP.find((g) => g.phase === phase);
    if (!group) throw new Error(`Missing roadmap phase ${phase}`);
    return group;
  });
}

export function isKookerBeaconPrompt(prompt: {
  label: string;
  targetName?: string;
} | null | undefined): boolean {
  if (!prompt) return false;
  const text = `${prompt.label} ${prompt.targetName ?? ""}`.toUpperCase();
  return text.includes("KOOKER");
}
