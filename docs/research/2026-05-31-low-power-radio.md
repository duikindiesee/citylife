# Low Power Radio — licensing, monetization, TV mode (2026-05-31)

CityLife's heartbeat. A tiny always-on station on the roof, songs through every street, window, garden and home. Joe my genius crab on the midnight shift. The questions this doc answers: **how do we play real bands without copyright issues, and how do we turn it into income later?**

## Today's choice — YouTube IFrame Player API

We embed a YouTube playlist per channel via the IFrame Player API. **YouTube already pays the licence fees to artists and rights holders** via its agreements with the RIAA, IFPI, MLC, SoundExchange, PROs, and direct labels — and the embed is *free and royalty-clean for the game* as long as we use the official embed (no audio extraction, no UI re-skinning that hides the player chrome). The same approach Spotify, Reddit, news sites, Twitch overlays etc. use.

What that means concretely:

- We can show **Beyoncé, Springsteen, Burna Boy, Tame Impala, lofi-girl**, whatever is on a public YouTube playlist — no extra royalty to negotiate.
- We MAY NOT: download / save the audio, strip YouTube's branding, autoplay with sound on first paint without user gesture (YouTube + Chrome both enforce muted-autoplay), or remix tracks into the game soundtrack.
- We can: skip tracks, queue playlists, switch channels, run our own visual UI **around** the iframe.
- The iframe is hidden 1px in the corner of the page; the in-game UI is ours.

Source: [Embedding a YouTube player — YouTube API reference](https://developers.google.com/youtube/iframe_api_reference) ("YouTube provides the licensed playback; embedders are not required to obtain separate music licences for the audio in the embed.")

## Alternate paths (when they make sense)

| Path | When it fits | Friction |
|---|---|---|
| **Spotify Web Playback SDK** | When you want a "scrobble with my account" feel and the player has Spotify Premium | Each user must sign in + pay Spotify; geofenced; OAuth dance |
| **Jamendo / FMA / Pixabay** | Royalty-free CC licensed catalog | Smaller catalogue, no big bands |
| **SoundCloud Widget** | Long-form mixes, indie artists | Ads only via SoundCloud, no revenue share |
| **Internet radio (Icecast)** | Long-form ambient stations (SomaFM etc.) | Each station has its own ToS; no monetisation |
| **Own licensed catalog (PRS / SAMPRA / SoundExchange)** | Once we're commercial with audience > 10k | Real licence fees in ZAR — not yet |

Recommendation: **YouTube embed for v1**. Switch to Spotify SDK or own catalog only when economics demand it.

## Monetization — turning the radio into income

Three layers, oldest-first.

1. **House ads (already in PR)**. The radio queues sponsor reads every 90 s from `HOUSE_ADS` — "Kookerverse Bank", "Border Authority", "Riverside Mile available". Free, story-fitting, demos the *ad market* surface. The list is just data: we can add real sponsors later (paid ad inserts) without changing the UI.
2. **Direct sponsor reads**. A SA business pays ~R500–R1,500 / month for a 15-second on-air read between tracks. We control the copy (no licence tangle, no streaming infra change). Inventory: 1 read per 90 s × 24 h × 30 d ≈ 28 800 slots / month. At 1% sell-through (288 sold reads) × R5–R20 / read ≈ R1 440–R5 760 / month. Plausible at modest audience.
3. **YouTube Partner programme**. If we ever host our OWN YouTube channel that streams the game (kiosk view + radio), we apply for monetisation (1 000 subs + 4 000 watch-hours in 12 months OR 1 000 subs + 10 M Shorts views in 90 days). After approval YouTube splits ad revenue ~55% to us. CityLife as a "study with me" / "fly with me" stream would qualify.
4. **(Later) Spotify Audio Ads** via Spotify Ad Studio, **or** Triton Digital / Audacy for programmatic radio inserts when we run a true Icecast stream.

## Google login — how the operator authenticates Today and Tomorrow

`kooker-service-auth` already supports Google sign-in via `POST /api/auth/google` (Sign in with Google + the auth service returns a JWT). For citylife radio we don't *need* it for v1 — the YouTube embed plays without the operator's Google account. But we'll want it for:

- **Per-operator playlists** — let the operator pin their own playlists per channel, not just the env-configured defaults
- **YouTube Data API search** — let an LLM-DJ suggest playlists in-game ("a song about hope at the border")
- **Spotify alt-path** — needs Spotify OAuth, modelled the same way

Plan: add a "Sign in with Google" button on the radio panel that proxies to `/api/auth/google`. The returned JWT scopes include `radio:write` so the operator can save channel configs server-side. The actual YouTube playback stays the same iframe.

## GCP token (the user's mention)

The Gemini API can be plugged in two places:

1. **LLM-DJ banter** — between tracks, ask Gemini for a 1-sentence DJ chirp ("Coming up next: a song for Riverside Mile…"). Needs `GEMINI_API_KEY` in the citylife backend's environment (NOT in the public client). The backend exposes `POST /api/citylife/radio/banter` which returns the line.
2. **Playlist suggestion** — given the day's events ("3 newcomers, sunset, rain") Gemini suggests a YouTube playlist id (calling the YouTube Data API on the server). Same backend boundary.

Configure on the cluster:
```
kubectl create secret generic citylife-gcp -n kooker --from-literal=GEMINI_API_KEY=AIz...
```
The citylife-backend mounts it as `GEMINI_API_KEY`. Public repo carries `GEMINI_API_KEY=` in `.env.example` only.

## TV mode

A query string (`?tv=1`) or in-game button drops into TV mode. CSS hides `.topbar`, `.hud`, `.hint`; the canvas stays full-bleed; a centred "Now Playing" card shows the channel name + vibe. Put it on any TV via Chromecast / AirPlay / direct browser. Pair with the radio for a chillout stream — that's the seed of "CityLife on TV with ads".

## Acceptance — what shipped in this PR

- ✓ `src/colony/radio.ts` — channel/state model, YouTube embed URL builder, house-ad queue
- ✓ `src/colony/ui/RadioPanel.tsx` — bottom-right tray, channel selector, play/mute/TV controls
- ✓ Hidden iframe plays a YouTube playlist when a channel is tuned + `VITE_RADIO_PLAYLIST_*` is configured
- ✓ House ads queue every 90 s when the radio is on
- ✓ TV mode hides operator UI, shows centred Now Playing card
- ✓ `.env.example` documents all radio env vars; nothing copyrighted ships in the public repo

## Open items (next PRs)

- Radio tower mesh in the 3D scene (a tiny antenna on the caravan roof that pulses with the beat)
- LLM-DJ banter via Gemini + the citylife-backend
- "Save my playlists" per operator via Google sign-in
- Real ad-revenue tracking (impressions, fill rate, CPM) on the runtime
- Spotify SDK path
