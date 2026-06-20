// The action schema the governor accepts. Anything a provider returns is validated
// and coerced through here, so a small model literally cannot drive illegal actions.
import { ORDINANCES } from "../engine/api";
import type { GameAction, GameActionName } from "../engine/types";

const VALID_ACTIONS: GameActionName[] = [
  "setTaxRate",
  "setBudget",
  "passOrdinance",
  "zoneRect",
  "placeBuilding",
  "noop",
];
const TAX_ZONES = ["residential", "commercial", "industrial"];
const BUDGET_CATS = ["transport", "safety", "health", "environment"];
const ZONE_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "park",
  "road",
  "empty",
];

/** Markdown menu injected into the LLM prompt. */
export const ACTION_MENU = `You may use ONLY these actions. Return a JSON array of action objects.
Each object: { "action": <name>, "args": [...], "why": "<short reason>" }

- setTaxRate   args: [zone, rate]      zone ∈ {residential, commercial, industrial}; rate 0.0–0.25
- setBudget    args: [category, amount] category ∈ {transport, safety, health, environment}; amount ≥ 0 (typical 200–4000)
- passOrdinance args: [id]             id ∈ {${ORDINANCES.join(", ")}}
- zoneRect     args: [x1, y1, x2, y2, type]  type ∈ {residential, commercial, industrial, park}
- placeBuilding args: [x, y, id]       id e.g. "fire_station","hospital","park" (costs 4000)
- noop         args: []                do nothing this cycle

Reply with ONLY the JSON array, no prose. Keep it short.`;

/** JSON-schema-ish description (handy for Ollama 'format' / docs). */
export const ACTION_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      action: { type: "string", enum: VALID_ACTIONS },
      args: { type: "array" },
      why: { type: "string" },
    },
    required: ["action", "args"],
  },
};

function coerceArgs(action: GameActionName, args: unknown[]): unknown[] | null {
  switch (action) {
    case "setTaxRate": {
      const zone = String(args[0]);
      let rate = Number(args[1]);
      if (!TAX_ZONES.includes(zone) || Number.isNaN(rate)) return null;
      if (rate > 1) rate = rate / 100; // tolerate "9" meaning 9%
      return [zone, Math.max(0, Math.min(0.25, rate))];
    }
    case "setBudget": {
      const cat = String(args[0]);
      const amt = Number(args[1]);
      if (!BUDGET_CATS.includes(cat) || Number.isNaN(amt)) return null;
      return [cat, Math.max(0, amt)];
    }
    case "passOrdinance": {
      const id = String(args[0]);
      if (!(ORDINANCES as readonly string[]).includes(id)) return null;
      return [id];
    }
    case "zoneRect": {
      const nums = args.slice(0, 4).map(Number);
      const type = String(args[4]);
      if (nums.some(Number.isNaN) || !ZONE_TYPES.includes(type)) return null;
      return [...nums, type];
    }
    case "placeBuilding": {
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (Number.isNaN(x) || Number.isNaN(y)) return null;
      return [x, y, String(args[2] ?? "service")];
    }
    case "noop":
      return [];
    default:
      return null;
  }
}

/** Validate + coerce arbitrary provider output into safe GameActions. */
export function validateActions(raw: unknown, max: number): GameAction[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as any).actions)
  )
    arr = (raw as any).actions;
  else return [];

  const out: GameAction[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const action = (item as any).action as GameActionName;
    if (!VALID_ACTIONS.includes(action)) continue;
    const rawArgs = Array.isArray((item as any).args) ? (item as any).args : [];
    const args = coerceArgs(action, rawArgs);
    if (!args) continue;
    const why =
      typeof (item as any).why === "string" ? (item as any).why : undefined;
    out.push({ action, args, why });
    if (out.length >= max) break;
  }
  return out;
}

/** Pull the first JSON array/object out of a possibly chatty LLM response. */
export function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  // try array first
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const s = text.indexOf(open);
    const e = text.lastIndexOf(close);
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1));
      } catch {
        /* keep trying */
      }
    }
  }
  return null;
}
