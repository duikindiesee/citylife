# Published home driveway surface — local browser evidence

Task API owner: `9dca82d9-1d26-4c52-82d4-3284061112e9` (first move-in driveway and road route). This branch stacks on CityLife #547, which stacks on #546/#524.

The owned-home spawn was logically drivable but rendered as bare ground beside the road. The renderer now paves only the validated, server-projected off-road driveway cells, using the same graded terrain surface as the car. Public road cells keep their asphalt. The mesh disappears when the authenticated home projection is absent; the client does not infer a driveway from a generic lot or claim ownership.

Local checks: TypeScript typecheck and production build passed; the geometry and parent camera Vitest cases passed 2/2. The full owned-car Chromium file passed 2/2 in 3.1 minutes. Its returning-resident case checks the exact X19 at the published home spawn, a nonempty driveway mesh for that plot, and keyboard drive from driveway onto a `roadSet` cell; its Gearbox case still covers park/re-entry and road driving. Screenshots: [paved home spawn](paved-home-spawn.png) and [road exit](road-exit.png). This is fixture evidence, not deployed authenticated gameplay or server-authoritative movement proof.

Remaining: the house is not visible in the default forward-facing chase view from this spawn, and the HUD still labels Gearbox at home. Confirm house rendering from a suitable view, test the full driveway turn/return, account switch, road topology, reviewed catalogue match, exact-head review, integration, deployment and actual player flow before closing first move-in acceptance.
