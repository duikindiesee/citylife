# Research brief — storytelling, first-person 3D, floating slab, bot-to-bot UI (2026-05-31)

Sources for the next few phases. Every bullet is one concrete action with a citation.

## 1) Storytelling — felt arrival in 5–10 minutes
- Stamp each newcomer with a Lifepath Journal entry the moment they cross the border (Cities: Skylines 2 records name, address, occupation, happiness, personal Chirper feed when you Follow a citizen). Converts a menu choice into a tracked life event you can revisit.
- Run plot selection as a Chirper-style ticker, not a modal (C:S2 redesigned Chirper to look like a texting app so it reads as ambient narration). The city brain "chirps" reactions as the player chooses.
- Make the house assemble physically in front of the player (Manor Lords visibly hauls logs and raises the frame in real time). Spawn the newcomer at the border post, then animate frame-up over ~30s while the city brain narrates.
- Eliminate failure states for the arrival flow (Tiny Glade: no currency, no loss, instant undo on every nudge). The arrival is the tutorial — freeze sim consequences until they have walked the plot once.
- Use a personality-driven narrator, not neutral prompts (RimWorld's named AI Storytellers — Cassandra / Phoebe / Randy). Give the city brain a fixed voice and biases.

## 2) First-person drop-in without breaking the sim
- One icon + hotkey to enter / exit, smoothed transition (C:S2 First Person Camera Continued mod uses Alt+F + a configurable transitionSpeed; Manor Lords uses an eye icon under the portrait).
- Five tunables: FOV, walkSpeed, runSpeed, cimHeight, transitionSpeed (the exact ones the FPCC mod author found shippable — do not invent your own list).
- Disable jump and vault, allow run (Manor Lords visit mode: "can run but cannot jump"; fences are walls). Sidesteps every collider edge case the sim was not built for.
- Hide all builder UI; keep only an exit affordance and the Chirper ticker (Manor Lords cinematic mode).
- Follow-a-citizen mode with WASD-to-exit (FPCC: UP/DOWN to shift, RMB to preview, WASD to exit follow). Lets the player "be that citizen" without committing them to manual control.

## 3) three.js first-person controls (late 2025 / 2026)
- Start from `examples/games_fps.html` (Capsule + Octree), NOT PointerLockControls alone.
- Defaults: `GRAVITY = 30`, `STEPS_PER_FRAME = 5`, `Capsule(Vector3(0, 0.35, 0), Vector3(0, 1, 0), 0.35)`. These are upstream defaults — copy them.
- Build collider with `worldOctree.fromGraphNode(scene)`, resolve with `worldOctree.capsuleIntersect(playerCollider)`, treat `result.normal.y >= 0.15` as walkable.
- Substep physics 5× per frame — three.js issue #21921 documents a wall-clip bug at low FPS without substepping.
- Use PointerLockControls only for mouse-look, not movement. Pair it with your own velocity integrator from the games_fps example.
- Skip raycast-per-vertex terrain collision; bake the heightfield into the same Octree (`fromGraphNode` consumes any THREE.Mesh).

## 4) Floating slab in space (the Dark City look)
- Two stitched meshes sharing the rim: top = displaced PlaneGeometry from heightmap, bottom = inverted dome / stalactite mesh with flipped normals. Heightmaps cannot represent overhangs, so the underside must be its own geometry.
- Starfield on a sphere with `side: THREE.BackSide` and a procedural Perlin-layer shader (two cnoise calls — cluster-scale + star-scale). No particle overhead, no skybox seams. Wrap negative-power inputs in `abs()` to avoid the GTX 10-series black-screen bug.
- Edge falloff via vertex-color alpha on the rim ring; tint the underside dark; add exponential fog (`FogExp2`) so the underside dissolves into space.
- Anti-tile the top surface with random-offset sampling (Inigo Quilez technique), blended via splat map.
- Skip the heightmap displacementMap path; do displacement in a custom vertex shader so you can compute normals analytically in the same pass.

## 5) Bot-to-bot dialog UI
- Render two-bot conversation as a Chirper-style stack of short attributed turns, not a chat log (C:S2 chirp UI).
- Let the player interrupt at any time by speaking or typing (Suck Up! uses live voice/text against an LLM with per-NPC personality + memory + emotional state). Queue so a player utterance cancels the next NPC turn, not the current one.
- Show a live trust / state meter for each bot (Suck Up!'s Suck Up Meter tracks NPC suspicion). Gives the conversation visible stakes.
- Pipe NPC audio through ASR-in / TTS-out with a viseme layer (NVIDIA ACE Covert Protocol stack — Riva ASR + Audio2Face, GDC 2024). For browser: Web Speech API + a lightweight viseme driver.
- Cap context at the six most recent turns; summarize older state into persona/memory fields (cross-platform LLM-NPC dialogue paper, arXiv 2504.13928). Anything longer bloats latency and the player stops feeling heard.

## Sources
- three.js games_fps example (dev): https://github.com/mrdoob/three.js/blob/dev/examples/games_fps.html
- three.js FPS wall-clip issue #21921: https://github.com/mrdoob/three.js/issues/21921
- PointerLockControls docs: https://threejs.org/docs/#examples/en/controls/PointerLockControls
- Starry shader for sky sphere: https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578
- Heightmap normals in vertex shader: https://discourse.threejs.org/t/calculating-normals-from-heightmap-in-vertex-shader/13014
- Semi-realistic landscapes (nathanpointer): https://nathanpointer.com/blog/landscapes
- First Person Camera Continued (C:S2 mod): https://github.com/Cgameworld/FirstPersonCameraContinued
- Manor Lords first-person visit (StealthOptional): https://stealthoptional.com/article/manor-lords-first-person
- Manor Lords cinematic mode tweet: https://x.com/LordsManor/status/1765066824440594920
- Manor Lords Unreal dev interview: https://www.unrealengine.com/en-US/developer-interviews/solo-dev-makes-sophisticated-sim-manor-lords-using-unreal-engine
- C:S2 Chirper redesign (Neowin): https://www.neowin.net/news/chirper-social-media-returns-in-cities-skylines-2-as-citizens-get-more-complex-lives/
- C:S2 Lifepath Journal (PCGamer): https://www.pcgamer.com/chirper-might-actually-be-useful-for-keeping-track-of-your-citizens-lifepaths-in-cities-skylines-2/
- C:S2 Citizen Simulation deep dive (MP1st): https://mp1st.com/news/cities-skylines-2-citizen-simulation-and-lifepath-deep-dive-released-game-features-its-own-version-of-twitter
- RimWorld AI Storytellers: https://rimworldwiki.com/wiki/AI_Storytellers
- Tiny Glade (Game UI Database): https://www.gameuidatabase.com/gameData.php?id=2052
- Suck Up! site: https://www.playsuckup.com/
- Suck Up! mechanics breakdown (Shapes): https://shapes.inc/fandom/suck-up/gameplay-mechanics
- Suck Up! breakdown (Keith Schacht): https://keithschacht.com/2024/Nov/26/vampire-game-based-around-ai-voice-suck-up/
- NVIDIA ACE Covert Protocol (GDC 2024): https://www.nvidia.com/en-us/geforce/news/nvidia-ace-gdc-gtc-2024-ai-character-game-and-app-demo-videos/
- Inworld GDC 2024 hands-on (WCCFTech): https://wccftech.com/inworld-ai-npc-gdc-2024-hands-on-nvidia-and-ubisoft-show-a-glimpse-of-the-future/
- LLM-driven NPCs cross-platform dialogue (arXiv): https://arxiv.org/html/2504.13928v1
