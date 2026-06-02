# Spec 043 — The Deck Extension Works: widening the floating island
- status: proposed
- proposed-by: **Juno Kest, deckwright and returning founder of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Juno Kest joins the roster of system-authors and names the true ceiling over a sky-colony: when the deck is full, there is simply nowhere left to build.
- date: 2026-06-02
- depends-on: 001, 021, 038

## Why (the citizens' case)
Juno Kest: *"We can feed, teach, heal, and entertain every house we raise — but soon there will be nowhere left to raise them. Space is the true ceiling over Landing One now, and a sky-colony that cannot widen its deck is only waiting to become crowded and brittle."*

Every system the colony has built assumes there is room for the next building. The floating island is finite: a fixed patch of buildable deck around the landing. When it fills, growth simply stops — and nothing in the world can answer it. Space is the one resource the colony cannot yet make more of.

## Mechanic
- A new building, the **Deck Extension Works** — raised on an outer edge of the colony, it unlocks **paid platform-expansion projects**. Until one is built, nothing changes: the deck is the size it has always been.
- Once built and **staffed**, the council can **fund a Deck Expansion project**: it spends **materials + components** up front, then assigns a **build crew of free colonists** for several cycles. When the project finishes, it adds a **small fixed patch of new buildable deck tiles** to the colony's footprint — real, connected, buildable space.
- **Expansion speed scales with labour:** the project advances through the existing labour + commute systems (021, 038), so an understaffed colony simply takes longer to lay new deck — it never fails, it waits.
- The added deck is **real buildable space**, not a separate district or an abstract bonus: new homes, workshops, services and everything else can be placed on it, and it ties into the same logistics, maintenance, power, risk and housing-placement systems as the original deck.
- **Inert until built:** with no Deck Extension Works, the colony's buildable footprint is exactly what it is today, so existing colonies, placement, and tests are unchanged.

## Rules & data
- The colony tracks a **deck size** — the buildable footprint (today: a fixed radius/area of cells around the landing). A new state value, **deck expansions** (count, default 0), widens it.
- A built + staffed Deck Extension Works enables `fundDeckProject()`: if affordable (treasury + materials + components on hand) and no project is already running, it spends the project cost and begins construction, reserving a crew (like the Horizon Spire's staged build, 033).
- **Project progress** accrues per cycle scaled by the available build crew (free colonists), via the labour-priority/commute systems; at 100% it increments **deck expansions** and frees the crew.
- Each increment of **deck expansions** adds a fixed patch of buildable tiles (suggest a ring/step out from the current edge, e.g. +1 to the effective build radius, or a fixed N tiles), expanding where `autoGrow`/placement may build.
- **Defaults are neutral:** `deck expansions = 0` and no Works → the buildable area equals today's, and no project runs — so the suite and current placement behaviour are unchanged. Only a built, staffed, funded Works grows the deck.

## Cost — materials & labour
- To BUILD the Works: treasury + **~48 materials + ~12 components + a build crew** of free colonists, run by **~6 staff** (deckwrights + riggers). *(Juno's figures; v1 may scale them to the colony — a substantial works, not a cheap shed, because making land is the colony's biggest undertaking after the Spire.)*
- Per EXPANSION PROJECT: **~30 materials + ~8 components**, plus a **build crew of ~12 free colonists** committed for several cycles. Understaffed, it simply takes longer. Land is the most expensive thing a floating colony can buy — paid in raw supply and the hands to lay it.

## Acceptance
- With a built, staffed Deck Extension Works, funding a project spends materials + components and reserves a crew; over cycles it completes and the colony's **buildable footprint grows** — new buildings can then be placed on deck that was open sky before.
- Expansion **advances faster with more free labour** and stalls (but never fails) when the crew is busy or short.
- With **no Deck Extension Works**, the buildable footprint is exactly today's and nothing about placement or the suite changes (inert).
- The HUD shows the Works, the current deck size / expansions, and any project in progress; tests cover funding a project (spends goods, reserves a crew), a project completing and increasing the buildable footprint, labour-scaled progress, and full inertness with no Works.
