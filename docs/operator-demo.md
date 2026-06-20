# CityLife — operator demo runbook

How to run CityLife and capture the **true bot response** demo (plan Slice 11).

## 1. Log in

Open CityLife and authenticate at the Border Authority gate. The operator passcode is read from
`VITE_OPERATOR_PASSCODE` in the gitignored `.env.local` (never committed).

## 2. Activate true bot replies (one time)

Newcomer bots reply with **mock stand-ins** until a kooker PAT is configured; then they reply **live
from kooker inference**. To switch them on:

1. Mint a PAT in kooker-web — **UserProfile → Personal Access Token → Generate**, or the **CityLife**
   page → **Generate CityLife PAT**. Copy it.
2. From the repo root, run the activation helper (your token stays on the machine):
   ```bash
   node scripts/activate-real-bots.mjs <PAT>
   # or, starting from a kooker session token, mint the PAT first:
   node scripts/activate-real-bots.mjs --mint <kooker_session_token>
   ```
   It writes `VITE_CITYLIFE_PAT` into `.env.local` and prints the bot's real reply as a check.
3. Restart the dev server (`npm run dev`).

The PAT is a secret: it lives only in `.env.local` (gitignored) and is bundled into the client at
build time, so use a scoped / short-lived token for anything you publish.

## 3. Record the demo

1. **Border Control → A family arrives at the border.**
2. **Approve.** The bot boots, its generated life history is injected, and the border patrol asks the
   first question (the UI waits while the bot wakes).
3. The source badge reads **`kooker-inference`** (not `mock`), and the answer is a **true Hermes
   response** on screen.
4. Click the preset questions to keep talking — the questions are scripted, the replies are the
   bot's own.

## Where things live

- Bot lifecycle + life-history injection + inference adapter — `src/colony/bots.ts`
- Border Control UI + patrol↔bot chat — `src/colony/ui/ColonyApp.tsx`
- Forkable backend boundary (mock now, portable citylife-backend later) — `src/colony/backend.ts`
- Household generator — `src/colony/newcomers.ts`
- kooker-web CityLife page (mint PAT, track bots) — kooker-web `src/pages/CityLife.jsx`
- Inference choke point — `POST /api/v1/ai/route/chat` (OpenAI-compatible, `Authorization: Bearer <PAT>`)

## Reset

**Border Control → Reset game** clears the settlers, the bank, and the bots for a fresh start.
