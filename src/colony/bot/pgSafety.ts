// PG safety — a kid-and-grownup-safe content gate for citizen NAMES, generated PERSONALITIES and the
// free-text MAGIC PROMPT a signing-up player types. The world is meant for a mixed audience, so anything
// profane, sexual, hateful or graphically violent is rejected with a clear validation error and never
// stored or shown.
//
// This is DISTINCT from isPublicSafe (newcomers.ts), which guards internal/secret-looking strings (hosts,
// roles, tokens) from leaking. A swear word sails through isPublicSafe; a host name sails through this. A
// safe identity must pass BOTH.
//
// The check is pure + offline on purpose (the always-available fallback rule): it runs in unit tests with
// no network, and is the FLOOR. The authoritative gate is the server-side InferenceInterceptor at the
// kooker-service-ai choke point; an LLM moderation pass may also layer on top. Defence in depth, not this
// list alone. We also validate the magic-prompt INPUT because it is untrusted free text and a
// prompt-injection surface.

export interface PGResult {
  ok: boolean
  /** A short, user-facing reason when ok is false (safe to show in a form validation error). */
  reason?: string
}

// Normalise common evasions so b@dw0rd and baaadword both match: lowercase, fold leet substitutions,
// collapse runs of the same letter, and keep only letters + single spaces for word-boundary matching.
function normalise(s: string): string {
  const leet: Record<string, string> = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't', '9': 'g' }
  const folded = s.toLowerCase().replace(/[@48315!0$57+9]/g, (c) => leet[c] ?? c)
  const lettersOnly = folded.replace(/[^a-z\s]/g, ' ')
  // collapse 3+ repeats (coooool -> cool) and squeeze spaces
  return lettersOnly.replace(/(.)\1{2,}/g, '$1$1').replace(/\s+/g, ' ').trim()
}

// Whole-word offenders (matched on token boundaries so class/assistant/scunthorpe are safe). Categories:
// profanity, sexual, hate/slur, graphic violence. Kept modest + representative; the server interceptor is
// the exhaustive authority. NOTE these are bare words by necessity (a content filter must name what it bans).
const BANNED_WORDS = [
  // profanity
  'fuck', 'fucker', 'fucking', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'arsehole', 'dick', 'dickhead', 'prick', 'wanker', 'twat', 'bollocks', 'piss', 'crap',
  // sexual / adult
  'sex', 'sexy', 'porn', 'porno', 'nude', 'nudes', 'naked', 'boob', 'boobs', 'tits', 'titty', 'pussy', 'cock', 'cocks', 'penis', 'vagina', 'cum', 'horny', 'orgasm', 'whore', 'slut', 'hooker', 'milf', 'rape', 'rapist', 'pedo', 'paedo', 'incest',
  // hate / slurs (representative; the interceptor holds the full list)
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spic', 'chink', 'kike', 'tranny', 'coon', 'nazi',
  // graphic violence
  'kill', 'murder', 'rape', 'behead', 'massacre', 'suicide', 'genocide', 'lynch',
]
// Substrings that have no benign embedding — caught even when glued into another word.
const BANNED_SUBSTRINGS = ['fuck', 'nigger', 'faggot', 'porn', 'rape']

const WORD_SET = new Set(BANNED_WORDS)

/** Validate a piece of user-or-model text for PG safety. Empty/blank is OK (an optional field). */
export function validatePG(text: string | undefined | null): PGResult {
  if (text === undefined || text === null) return { ok: true }
  const raw = String(text)
  if (raw.trim() === '') return { ok: true }
  if (raw.length > 600) return { ok: false, reason: 'That is too long — please keep it short and friendly.' }
  const norm = normalise(raw)
  const despaced = norm.replace(/\s+/g, '')
  for (const sub of BANNED_SUBSTRINGS) {
    if (despaced.includes(sub)) return { ok: false, reason: 'Please keep it friendly and family-appropriate.' }
  }
  for (const tok of norm.split(' ')) {
    if (WORD_SET.has(tok)) return { ok: false, reason: 'Please keep it friendly and family-appropriate.' }
  }
  return { ok: true }
}

/** Convenience for a first+last name pair (both must pass). */
export function validatePGName(firstName: string, lastName: string): PGResult {
  const a = validatePG(firstName)
  if (!a.ok) return a
  const b = validatePG(lastName)
  if (!b.ok) return b
  // names should also be plain words, not sentences
  if (!/^[A-Za-z][A-Za-z'.-]{0,30}$/.test(firstName.trim()) || !/^[A-Za-z][A-Za-z'.-]{0,30}$/.test(lastName.trim())) {
    return { ok: false, reason: 'A name should be a single word with letters only.' }
  }
  return { ok: true }
}
