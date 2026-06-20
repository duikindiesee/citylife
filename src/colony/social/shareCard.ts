// Daily social card — a branded "poster" of the colony, composed over a live hero snapshot.
// Kookerverse house style: vivid but toned. Dark space, cyan hairlines, one bold line, quiet stats.
// The pure helpers (headlineFor / shareStats / siteLabel) are unit-tested in node; the DOM builder
// touches `document` only when CALLED, so importing this module under the node test env stays safe.
import type { ColonyUiState } from "../runtime";

export type CardFormat = "wide" | "story";

export interface ShareStat {
  label: string;
  value: string;
}

export interface ShareCardInput {
  hero: string; // data URL (PNG) of the world snapshot
  sol: number;
  headline: string;
  tagline: string;
  stats: ShareStat[];
  site: string; // colony name + biome flavour, e.g. "Landing One · Crystal shore"
  format?: CardFormat;
}

/** House tagline — the one-liner that frames what CityLife is. */
export const DEFAULT_TAGLINE =
  "A floating-island colony that designs itself — one AI citizen at a time.";

// Map the latest shipped mechanic to a punchy headline. Declarative, a little cinematic, never shouty.
const HEADLINES: { match: RegExp; line: string }[] = [
  { match: /greenhouse|food|farm/i, line: "The colony learned to farm." },
  { match: /water/i, line: "Water reaches the far homes." },
  { match: /workshop|component/i, line: "Raw rock becomes machine parts." },
  { match: /mine|extraction/i, line: "The first mine bites into the rock." },
  {
    match: /immigrat|settler|population/i,
    line: "New settlers are on their way.",
  },
  { match: /housing|evolution/i, line: "The homes are starting to grow." },
  {
    match: /material|labour|labor/i,
    line: "Nothing rises without hands and supplies.",
  },
];

/** Turn the day's built spec title into a headline; falls back to the house line. */
export function headlineFor(specTitle: string | undefined): string {
  if (specTitle)
    for (const h of HEADLINES) if (h.match.test(specTitle)) return h.line;
  return "The city that builds itself.";
}

/** The quiet stat chips along the bottom of the card, drawn from the live UI state. */
export function shareStats(ui: ColonyUiState): ShareStat[] {
  return [
    { label: "Sol", value: String(ui.clock.day) },
    { label: "Pop", value: `${ui.colonists}/${ui.colony.capacity}` },
    { label: "Food", value: String(ui.colony.food) },
    { label: "Built", value: String(ui.colony.buildings) },
    { label: "Solar", value: `${ui.power.solarW.toFixed(1)}kW` },
  ];
}

/** "Landing One · Crystal shore" — the colony's name and the biome it sits on. */
export function siteLabel(ui: ColonyUiState): string {
  return `${ui.name} · ${ui.biome}`;
}

/** Suggested window aspect per format — the routine resizes the window to this before capturing.
 *  The card itself always fills the viewport, so a plain full-page screenshot is the whole poster. */
export const ASPECT: Record<CardFormat, number> = {
  wide: 16 / 9, // X / LinkedIn / YouTube thumb
  story: 9 / 16, // stories / shorts / Reels
};

const STYLE_ID = "kv-share-style";
export const CARD_ID = "kv-share-card";

const CARD_CSS = `
.kv-card{position:fixed;inset:0;z-index:2147483000;overflow:hidden;isolation:isolate;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;color:#e8f1f4;background:#05080d}
.kv-card *{box-sizing:border-box;margin:0}
.kv-hero{position:absolute;inset:0;background-size:cover;background-position:center 42%;
  filter:saturate(1.08) contrast(1.04) brightness(1.02)}
.kv-vignette{position:absolute;inset:0;background:
  radial-gradient(125% 95% at 50% 36%,transparent 44%,rgba(2,4,8,.55) 100%),
  linear-gradient(180deg,rgba(2,6,12,.62) 0%,transparent 24%,transparent 48%,rgba(2,5,11,.9) 100%)}
.kv-frame{position:absolute;inset:18px;border:1px solid rgba(95,208,230,.26);border-radius:5px;pointer-events:none}
.kv-frame::before,.kv-frame::after{content:'';position:absolute;width:22px;height:22px;border:0 solid #5fd0e6}
.kv-frame::before{top:-1px;left:-1px;border-top-width:2px;border-left-width:2px}
.kv-frame::after{bottom:-1px;right:-1px;border-bottom-width:2px;border-right-width:2px}
.kv-top{position:absolute;top:36px;left:42px;right:42px;display:flex;align-items:center;gap:14px}
.kv-wordmark{font-weight:800;letter-spacing:.2em;font-size:25px;line-height:1}
.kv-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5fd0e6;
  margin-left:9px;vertical-align:middle;box-shadow:0 0 12px 2px rgba(95,208,230,.7)}
.kv-kicker{font-size:10.5px;letter-spacing:.36em;color:#5fd0e6;opacity:.82;padding-bottom:1px}
.kv-sol{margin-left:auto;font-size:11px;letter-spacing:.28em;color:#bfd2da;
  border:1px solid rgba(95,208,230,.35);padding:5px 12px;border-radius:999px;white-space:nowrap}
.kv-bottom{position:absolute;left:42px;right:42px;bottom:40px}
.kv-site{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#7fd6e8;margin-bottom:13px}
.kv-headline{font-weight:800;letter-spacing:-.012em;line-height:1.02;font-size:56px;
  text-shadow:0 2px 34px rgba(0,0,0,.55);max-width:84%}
.kv-stats{display:flex;gap:9px;margin-top:22px;flex-wrap:wrap}
.kv-chip{display:inline-flex;align-items:baseline;gap:7px;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:#9fb4bd;background:rgba(8,16,24,.46);border:1px solid rgba(95,208,230,.22);
  padding:7px 12px;border-radius:9px}
.kv-chip b{font-size:16px;letter-spacing:0;color:#eaf3f6;font-weight:700}
.kv-tag{margin-top:20px;font-size:13.5px;color:#aebfc7;letter-spacing:.01em;max-width:64%;line-height:1.45}
.kv-story .kv-headline{font-size:78px;max-width:94%}
.kv-story .kv-hero{background-position:center 47%}
.kv-story .kv-bottom{bottom:150px}
.kv-story .kv-tag{max-width:90%;font-size:18px}
.kv-story .kv-wordmark{font-size:30px}
.kv-story .kv-chip{font-size:13px}
.kv-story .kv-chip b{font-size:20px}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const st = doc.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CARD_CSS;
  doc.head.appendChild(st);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

/** Build the card element (does not mount it). Pure DOM — only runs when called, never on import. */
export function buildShareCard(
  input: ShareCardInput,
  doc: Document = document,
): HTMLElement {
  ensureStyle(doc);
  const fmt = input.format ?? "wide";
  const root = doc.createElement("div");
  root.id = CARD_ID;
  root.className = `kv-card kv-${fmt}`;
  root.innerHTML = `
    <div class="kv-hero" style="background-image:url('${input.hero}')"></div>
    <div class="kv-vignette"></div>
    <div class="kv-frame"></div>
    <header class="kv-top">
      <span class="kv-wordmark">CITYLIFE<span class="kv-dot"></span></span>
      <span class="kv-kicker">A KOOKERVERSE COLONY</span>
      <span class="kv-sol">SOL ${input.sol}</span>
    </header>
    <footer class="kv-bottom">
      <div class="kv-site">${escapeHtml(input.site)}</div>
      <h1 class="kv-headline">${escapeHtml(input.headline)}</h1>
      <div class="kv-stats">${input.stats.map((s) => `<span class="kv-chip"><b>${escapeHtml(s.value)}</b>${escapeHtml(s.label)}</span>`).join("")}</div>
      <div class="kv-tag">${escapeHtml(input.tagline)}</div>
    </footer>`;
  return root;
}
