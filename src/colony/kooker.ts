// Talks to the REAL kooker-service-user (via the Vite proxy -> APISIX gateway). Each settler
// who moves to the planet registers and gets a KOOKER card (their kooker user id), persisted
// in kooker's own MySQL. Colonists are tagged with the citylife app via an @citylife.local email.
import { RNG } from '../engine/rng'

export interface KookerCard {
  id: number
  name: string
  username: string
  email: string
}

// Playful names in the kooker house style (Peanut, Cobra, Skoenlapper, Piesang, Boerie...).
const NAMES = [
  'Peanut', 'Cobra', 'Panda', 'Piesang', 'Suntan', 'Spanner', 'Jumper', 'Wheelie', 'Skoenlapper',
  'Mango', 'Biltong', 'Boerie', 'Vetkoek', 'Koeksister', 'Springbok', 'Dassie', 'Meerkat', 'Rooibos',
  'Bokkie', 'Mielie', 'Sosatie', 'Klippies', 'Naartjie', 'Guava', 'Protea', 'Kudu', 'Impala', 'Steenbok',
  'Duiker', 'Caracal', 'Lekker', 'Howzit', 'Shisa', 'Braai', 'Potjie', 'Skattie', 'Tannie', 'Boet',
  'Brakpan', 'Zinzaar', 'Skoonveld', 'Bobotie', 'Sambok', 'Witblitz', 'Mampoer', 'Snoek', 'Galjoen',
]

export function generateName(rng: RNG): string {
  return NAMES[rng.int(0, NAMES.length - 1)]!
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Register a settler with the real kooker user service. Returns their KOOKER card. */
export async function registerSettler(name: string): Promise<KookerCard> {
  const suffix = Math.random().toString(36).slice(2, 7)
  const username = `${slug(name)}_${suffix}`
  const email = `${username}@citylife.local`
  const res = await fetch('/kooker/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, username, email, locale: 'en', apps: ['citylife'] }),
  })
  if (!res.ok) throw new Error(`kooker register failed: HTTP ${res.status}`)
  const u = await res.json()
  return { id: u.id, name: u.name ?? name, username: u.username ?? username, email: u.email ?? email }
}

// NOTE: we deliberately do NOT GET /api/users from the browser. Pulling the full user list would
// leak everyone's logins into the client. Settlers are tracked locally (see settlers.ts); the
// game only ever POSTs its own registration. Locking down that public endpoint is an infra task.
