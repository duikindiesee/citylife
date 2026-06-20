# Spec 073 — Porter Sheds: the economy you can finally see move

- status: built — slice 68 (mechanics/dev, PR #26); FIRST VISIBLE CUT — a logistics Porter Shed gated on materials/components/tools/reel + 2 porters, goods rendered as crate/sack PILES that grow and shrink with the live stock, porter carts running the roads while staffed (never over water), inert by default; 459 tests pass, verified live on 5188 (visible crate-pile + carts). Backlog: spread piles to every producer + carry a visible load between them.
- proposed-by: Mara Venn, road-mender and Council hand (LIVE Hermes, model kooker-codex via the kooker choke point) — the colony's founder-voice returns the first tick the inference recovered, and answers the new visual-first rule directly
- date: 2026-06-02
- depends-on: 023 (Storehouse Platforms — a place goods pile), 027 (Housewares Market — goods to homes), 008 (Ration Depot — food delivery), 007/013/031/044 (the producers whose output now moves), the engine road graph + the ambient pedestrians (the carriers reuse both), docs/specs/VISUAL-STANDARD.md, docs/research/2026-06-02-living-economy.md

## Why (the citizens' case)

Mara Venn has mended Landing One's roads since the founding, and she puts the new rule plainly: too much of the colony's life is trapped in the side panel. The chains are deep and the numbers are honest, but you cannot SEE them. If the linen line is failing you should see empty racks and idle carts on a quiet street, not just a bad figure; if a district is thriving its roads should look worked. She does not want a new hidden resource — she wants the economy the colony already has to finally have a body on the island. Her answer is the humblest building there is: a little shed by the road, a couple of porters, and goods that move where everyone can watch them. It is the first thing the colony would build purely so the world can be read with the eyes instead of the ledger.

## Mechanic

A new staffed **Porter Shed** sits beside a road. While staffed, its porters **visibly carry goods between nearby buildings** along the existing roads and footpaths: a porter (a walking figure with a handcart) sets out from a producer with a load and arrives at a consumer or a store, then walks back for the next. What you see on the island:

- **Piles outside buildings** — a producer with stock shows a small heap of its good (ore at the mine, linen rolls at the weavery, food crates at the depot, tool boxes at the crib); the heap **grows when the place is supplied and shrinks as the good is used**, so a full store looks full and a starved one looks bare.
- **Porters on the roads and paths** — handcarts and shoulder-poles moving between working buildings, so a busy chain has busy streets and an idle one has empty ones.
- **The water barrier obeyed** — no porter ever crosses open water; with no road or path linking two buildings, the goods simply do not move (and the pile just sits).

It does not invent a new good or change a single balance number — it is the **embodiment** of flows and stores the colony already has (the living-economy direction). A colony that never builds a Porter Shed behaves exactly as today; the goods still move in the ledger, you just cannot watch them. Inert until a shed stands and is staffed.

To keep the slice small, the Review & Build routine should ship the **first visible cut**: one Porter Shed kind, porters that run a visible cart between a producer and its store/consumer in range, and at least one good's **pile** rendered (per the VISUAL-STANDARD `pile` rule) growing and shrinking. The full set of piles and carrier types is the visual-debt backlog it then pays down.

## Rules & data

- New build kind **porter** (sector: logistics — it shares Logistics labour with the transit depots and storehouses). Build it beside a road.
- **Service radius** `porterRadius` (about 8 cells): a shed's porters serve producer/consumer/store buildings within reach. Placement matters — a shed only animates the chains it can walk to.
- **Carriers**: while a shed is staffed (Logistics staffing > 0), spawn up to `portersPerShed` (2) visible carriers that path on the **road/footpath network** between served buildings that have a good to move and somewhere to take it. Reuse the ambient-pedestrian + crew-truck movement; a carrier is a walking figure with a small cart token. **Never route over water** (the carrier keeps to land, like the people already do).
- **Piles** (per docs/specs/VISUAL-STANDARD.md): a building with stock of a good renders `floor(stock / pilePer)` quantised units (crates/sacks/rolls/ingots) on or beside its pad, capped to a tidy stack; the heap rises and falls with the live count. This is purely presentational — it reads the existing stock, it does not change it.
- **Inert by default**: with no Porter Shed, no carriers spawn and no piles are forced; the economy is exactly today's, just unseen. An unstaffed shed shows nothing.

## VISUAL (per the standard)

- **Porter Shed** — `form: box`, a low timber-brown shed, `size: [1, 0.8, 1]`, a darker plank roof part; sits beside the road. No animation required.
- **Porter (carrier)** — the existing pedestrian capsule with a small `box` handcart token in front, moving along roads/paths between served buildings; **bonus** anim is the cart's gentle bob. Stays on land, never on water.
- **Piles** — quantised `pile` units at the served buildings (`unit` per good: ore = `ingot`, linen = `bolt`, food = `crate`, tools = `box`), `pilePer` ~ one unit per modest quantity so a full store is a clear heap and a lean one is nearly bare.

## Cost — materials & labour

- **To build** one Porter Shed: `matPorter = 10` materials, `compPorter = 4` components, `toolPorter = 2` tool-kits, and `reelPorter = 1` reel (Mara's cart lashings + harness), raised by a small build crew `crewPorter = 3`. Treasury cost `porterCost = 320`.
- **To run**: `porterWorkers = 2` free colonists (the porters). No power, no water, no good consumed — it uses the roads and paths that already exist. Each shed serves only its radius, so a growing colony builds several.
- The cost is honest and modest, because the Porter Shed adds no new economic power — it buys the colony the ability to **see** the economy it already runs.

## Acceptance

- **Inert without a Porter Shed**: a colony with no shed has identical economy and renders no forced piles or carriers; all existing tests stay green.
- **A staffed shed makes goods move on screen**: with a shed beside a road and producers/stores in range holding goods, visible carriers run the roads/paths between them, and at least one good's pile is drawn and changes as the stock changes.
- **The water barrier holds**: no carrier path crosses open water; two buildings split by water with no road link show no movement.
- **Staffing gates it**: an unstaffed shed spawns no carriers.
- **Verify (the SEEN requirement)**: `npm run typecheck` + `npm test` pass; live on :5188, a real colony reads no shed and is unchanged, and an injected staffed Porter Shed shows porters carrying carts between buildings and a pile that grows/shrinks — the new thing is visible on the island, not just in the HUD, with no console errors.
