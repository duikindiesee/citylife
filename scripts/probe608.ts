// Spec 084 S6 — one-shot layout + traffic probe for the 608 world (run: npx vite-node scripts/probe608.ts).
// Prints the seed-4242 estate layout and the traffic preconditions so re-baseline failures diagnose fast.
import { ColonySim } from '../src/colony/sim'
import { makeNeighborhood } from '../src/colony/neighborhood'

const sim = new ColonySim(4242)
const t = sim.state.terrain
console.log('landing', t.landing)
const n = makeNeighborhood(t)
console.log('parcels', n.parcels.length, 'carriage', n.carriage.length)
for (const p of n.parcels) {
  console.log(p.id, 'W', p.w, 'zone', `${p.houseZone.w}x${p.houseZone.d}`, 'at', p.x, p.y, 'distToWater', t.distToWater[t.idx(Math.round(p.x), Math.round(p.y))])
}

sim.state.colonists = 60
sim.state.materials = 4000
sim.state.food = 4000
for (const days of [8, 16, 24]) {
  while (sim.state.clock.day < days) sim.step()
  const kinds = new Map<string, number>()
  for (const b of sim.state.buildings) kinds.set(b.artifact.kind, (kinds.get(b.artifact.kind) ?? 0) + 1)
  console.log(`day ${days}: buildings`, sim.state.buildings.length, Object.fromEntries(kinds))
  console.log('  roads', sim.state.roads.length, 'cars', sim.state.cars.length, 'colonists', Math.round(sim.state.colonists))
}
