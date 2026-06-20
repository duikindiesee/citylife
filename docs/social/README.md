# CityLife — daily social card

A side routine that turns **yesterday's build** into one shareable poster every morning.
Vivid but toned: dark space, cyan hairlines, one bold line, quiet stats. Doing our own thing.

The card art + copy live in the game: [`src/colony/social/shareCard.ts`](../../src/colony/social/shareCard.ts).
It is exposed on the live runtime so a routine (or you) can render it over the running world.

## The API (on `window.__colony`)

```js
// Compose the poster over the current view (freezes a hero snapshot, hides the HUD). Returns false
// only if the renderer has not started. Pass the spec that shipped to pick the headline.
window.__colony.shareCard({
  specTitle: "Skyfarm Greenhouse: food production",
  format: "wide",
});
window.__colony.clearShareCard(); // restore the normal game view
```

- `specTitle` → headline (see `headlineFor`). Unknown/empty → "The city that builds itself."
- `format`: `'wide'` (16:9 banner, default) or `'story'` (9:16, bigger type for shorts/reels).
- Stats (Sol, Pop, Food, Built, Solar), the site label, and the tagline are read live from `getUiState()`.

The card always fills the viewport, so **a plain full-page screenshot is the whole poster** — no
cropping, no region math.

## Morning routine — "Kookerverse MORNING DISPATCH"

Runs once each morning (a side cron, like the design-council / review-build ticks). Goal-framed:

1. **Read the last day's build.** Newest spec in `docs/specs/built/` (and the day's commits on
   `mechanics/dev`). That spec title drives the headline.
2. **Drive the live game** on :5188 (auto-login is on). Run the colony to a lively state, then
   `setPreset('planet')` for the floating-island-in-space hero. (`format: 'story'` → resize the
   window portrait first for a vertical short.)
3. **Render + capture.** `window.__colony.shareCard({ specTitle })`, tuck the cursor in a corner,
   then take a full-page screenshot (saved + delivered with the run).
4. **Archive the copy.** Write `caption.md` (headline, stats, ready-to-paste captions) to
   `D:\infra\projects\citylife-social\YYYY-MM-DD\` and drop the rendered image beside it.
5. Keep :5188 running; reload to a clean colony when done. Never commit daily images to git.

## Headlines (spec → line)

| the build touched…       | the poster says                           |
| ------------------------ | ----------------------------------------- |
| greenhouse / food / farm | The colony learned to farm.               |
| water                    | Water reaches the far homes.              |
| workshop / component     | Raw rock becomes machine parts.           |
| mine / extraction        | The first mine bites into the rock.       |
| immigration / settlers   | New settlers are on their way.            |
| housing / evolution      | The homes are starting to grow.           |
| materials / labour       | Nothing rises without hands and supplies. |
| _anything else_          | The city that builds itself.              |
