# Spec 071 — The Folio Library: the colony keeps some of its own books

- status: proposed
- proposed-by: Senna Coetzee, folio-binder at the Folio House who stitches the books the colony ships away (claude — council fallback; the kooker inference daily token quota was exhausted this tick, so the council wrote in-character)
- date: 2026-06-02
- depends-on: 044 (Skybound Folios — the export good this finally gives a use at home), 010/014 (Holo-Theatre + reel-fed theatres — the culture system this joins as a second, reel-free source), 015 (Full-Service Top Tier — culture is one of the things the top homes need), 023 (Storehouse Platforms — the folio stores the Library lends from)

## Why (the citizens' case)
Senna Coetzee stitches folios all day at the Folio House — fine bound books, the colony's proudest work — and watches every last one craned onto the Exchange dock and sold away. Not one stays on Landing One. She will tell you the shame of it plainly: a colony that makes the finest books in the cloudsea and cannot lend a single one to its own children. The homes get their culture from the holo-theatres, and that is good, but the theatres run on reels, and when the reels run short the theatres go dark and the homes lose their culture with them. Senna wants a Reading Room: a quiet hall stocked with the colony's own folios, a few librarians, and shelves the people can actually use. It would give the folios a reason to stay home, it would give the homes a second way to stay cultured that does not depend on the reel foundry, and it would put a hard, honest choice on the council books at last — sell every folio for coin, or keep a few back so your own people can read. Nothing the colony builds yet makes it choose between the export trade and its own civic life. This would.

## Mechanic
A new staffed **Folio Library** (a Reading Room) lends the colony's **folios** to its homes as culture. It is folio-fed the way the holo-theatres (014) are reel-fed: a staffed Library that has folios in the stores to lend provides **letters** — a culture contribution to the homes around it, feeding the same culture the theatres feed and the top housing tier (015) needs. Because it runs on folios, not reels, it is a **second culture path**: a colony whose reels run short and whose theatres go dark can still keep its homes cultured through its libraries, so long as it keeps a few folios back from the export dock.

That is the heart of it: the Library draws a few folios a day from the stores to lend, which is a **domestic demand** competing with the export trade for the first time. Ship every folio out through the Exchange and the Market Stall and the Library shelves go bare and lend nothing; keep a few home and the homes stay read. A colony that never builds a Library behaves exactly as today — its folios are still pure export, its culture is still whatever the theatres give it, and nothing is drawn or changed. The mechanic is inert until a Library stands.

## Rules & data
- New build kind **library** (sector: services). Colour a warm parchment-gold.
- A staffed Library serves up to `libraryCultureCap = 40` residents with letters-culture, contributing to the colony's culture coverage the same way a theatre does — but only while it is **staffed** AND has folios in the stores to lend.
- **Folio draw (the domestic demand)**: a lending Library draws `libraryFoliosPerDay = 1` folio per day from `state.folios`. It only lends (and only gives culture) on a day it can draw — if `state.folios` is 0, the shelves are bare, the Library lends nothing and its culture contribution for that day is 0. It never drives folios below 0.
- The Library's culture contribution scales with its staffing (the usual sector-staffing fraction) and is gated on having folios, the way a theatre's culture is gated on having reels (014).
- **Inert by default**: with no Library, no folios are drawn and the colony's culture is exactly what the theatres give it today.

## Cost — materials & labour
- **To build**: `matLibrary = 40` materials, `compLibrary = 10` components, `toolLibrary = 1` tool-kit (the shelving and the binding-presses), raised by a build crew of `crewLibrary = 5` free colonists. Treasury cost `libraryCost = 800`.
- **To run**: `libraryWorkers = 4` free colonists (the librarians), a `libraryPowerLoad = 0.3` grid load for the reading lamps, and `libraryFoliosPerDay = 1` folio per day drawn from the stores to lend. No water, no food.
- The real ongoing cost is the **folios themselves**: every folio shelved at a Library is a folio not sold abroad, so the Library is paid for in forgone export coin as much as in labour. That is the choice it puts on the council.

## Acceptance
- **Inert without a Library**: a colony with no Library has its culture coverage and its stored folios identical to before this spec over a long run; all existing tests stay green.
- **A Library lifts culture**: an identical pair of colonies, one with a staffed, folio-stocked Library and one without, the one with the Library reads a higher culture coverage (a second culture path that needs no reels).
- **The domestic demand is real**: a staffed Library draws folios from the stores each day (stored folios fall while it lends), and when folios reach 0 the Library's culture contribution drops to 0 (the shelves are bare) without error; folios never go negative.
- **Reel-free resilience**: a colony with no reels (theatres dark) but a folio-stocked Library still keeps some culture for its homes.
- **Verify**: `npm run typecheck` clean and `npm test` green with new economy tests for the cases above; live on :5188 a real colony reads no Library and is unchanged, and an injected staffed, folio-stocked Library shows the higher culture and the daily folio draw, with no console errors.
