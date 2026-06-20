// Spec 081 P0 — the deterministic ad poster. A PURE model (title / tagline / accent / badge) built
// from a business, plus a canvas painter that draws it. No Date.now, no Math.random (joins the 077
// forbidden list) so the same shop paints an identical poster across reloads; the renderer wraps the
// painted canvas in a CanvasTexture and (P2) swaps in a generated image when one arrives. Prompt/board
// text is screened through isPublicSafe — the same gate citizen names use — so no token/brand/secret
// words ever reach a poster.
import { BUSINESSES, type BusinessId } from "./businesses";
import { isPublicSafe } from "../newcomers";

export interface PosterModel {
  title: string;
  tagline: string;
  accent: number; // hex 0xRRGGBB
  badge: string; // short top label — the app line, or FOR SALE for an open lot
  forSale: boolean;
}

/** The welcome PSA shown when there are no shops yet, so the zone edge never renders blank. */
export const PSA_POSTER: PosterModel = {
  title: "Landing One",
  tagline: "Shops coming soon — commercial plots for sale",
  accent: 0x18e0ff,
  badge: "WELCOME",
  forSale: false,
};

/** Build the deterministic poster model for a business, or the welcome PSA when none / unknown.
 *  Screened through isPublicSafe; an unsafe field falls back to a neutral string. */
export function posterModel(business?: BusinessId): PosterModel {
  if (!business) return PSA_POSTER;
  const b = BUSINESSES[business];
  if (!b) return PSA_POSTER;
  const forSale = b.app === "open lot";
  return {
    title: isPublicSafe(b.name) ? b.name : "A Kooker shop",
    tagline: isPublicSafe(b.tagline) ? b.tagline : "",
    accent: b.palette,
    badge: forSale ? "FOR SALE" : b.app,
    forSale,
  };
}

/** Paint the poster onto a 2D context (browser only; the renderer wraps it in a CanvasTexture).
 *  Pure given (ctx, model, w, h) — no clock, no random — so the canvas is reproducible. */
export function paintPoster(
  ctx: CanvasRenderingContext2D,
  m: PosterModel,
  w: number,
  h: number,
): void {
  const hex = (n: number) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  ctx.fillStyle = "#10131a";
  ctx.fillRect(0, 0, w, h); // dark slate ground so the accent + text pop
  ctx.fillStyle = hex(m.accent);
  ctx.fillRect(0, 0, w, h * 0.22); // accent header band
  ctx.fillRect(0, h * 0.86, w, h * 0.05); // accent footer rule
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#10131a";
  ctx.font = `bold ${Math.round(h * 0.12)}px sans-serif`;
  ctx.fillText(m.badge.toUpperCase().slice(0, 22), w * 0.06, h * 0.11); // badge sits on the header band
  ctx.fillStyle = "#f6f7fb";
  ctx.font = `bold ${Math.round(h * 0.18)}px sans-serif`;
  ctx.fillText(m.title.slice(0, 18), w * 0.06, h * 0.42);
  ctx.fillStyle = "#aeb6c6";
  ctx.font = `${Math.round(h * 0.1)}px sans-serif`;
  wrapText(ctx, m.tagline, w * 0.06, h * 0.62, w * 0.88, h * 0.12);
  ctx.fillStyle = hex(m.accent);
  ctx.fillRect(w * 0.06, h * 0.905, w * 0.2, h * 0.028); // a small accent chip on the footer
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}
