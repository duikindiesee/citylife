// Spec 077 P6 — BOT SELF-DESIGN. A citizen bot designs its own home the way the spec promised:
// start from a design, INSPECT it (BlueprintReport — the numbers a small model can reason over),
// apply ONE targeted mutation through the same pure edit grammar the builder UI buttons call, and
// repeat — capped at three iterations so a bot can never wander. Fully deterministic: the same seed,
// zone and starting design always walk the same path to the same house. No wall-clock, no random.
import { parseBlueprint, blueprintToScript, validateBlueprint, type ParsedBlueprint } from '../blueprintScript'
import { compileBlueprint } from '../houseBuilder'
import { addRoom, resizeRoom, toggleWin, setWallH } from './blueprintEdit'
import type { DoorDir } from '../voxelHouse'

/** What a design IS, in numbers — the self-inspection a bot reads between edits. */
export interface BlueprintReport {
  storeys: number
  rooms: number
  roomAreas: Record<string, number> // plot-cell area per room kind (post-overlap is approximated by authored rects)
  windowCount: number // compiled window blocks (the facade actually built)
  blockCount: number
  estMaterials: number
  hasOutdoor: boolean // a patio or pool
  bedrooms: number
}

/** Compile a script against its zone and report the numbers. Pure. */
export function blueprintReport(script: string, zone: { w: number; d: number }, seed: number): BlueprintReport {
  const p = parseBlueprint(script)
  const compiled = compileBlueprint(script, { w: zone.w, d: zone.d, seed })
  const roomAreas: Record<string, number> = {}
  for (const r of p.rooms) roomAreas[r.kind] = (roomAreas[r.kind] ?? 0) + r.w * r.d
  return {
    storeys: compiled.storeys,
    rooms: p.rooms.length,
    roomAreas,
    windowCount: compiled.blocks.filter((b) => b.kind === 'window').length,
    blockCount: compiled.blocks.length,
    estMaterials: validateBlueprint(script).estMaterials,
    hasOutdoor: p.rooms.some((r) => r.kind === 'patio' || r.kind === 'pool'),
    bedrooms: p.rooms.filter((r) => r.kind === 'bedroom').length,
  }
}

export interface SelfDesignResult {
  script: string
  report: BlueprintReport
  iterations: { mutation: string; report: BlueprintReport }[]
}

/** One targeted improvement per iteration, chosen from the report exactly as the spec's bot loop
 *  would: give the home an outdoor space, then a bedroom, then daylight, then a second storey when
 *  the footprint is crowded — else grow the living room. Returns the mutated design + what was done. */
function improveOnce(p: ParsedBlueprint, report: BlueprintReport, seed: number): { next: ParsedBlueprint; mutation: string } {
  if (!report.hasOutdoor) {
    return { next: addRoom(p, (seed & 1) === 0 ? 'patio' : 'pool'), mutation: 'add-outdoor' }
  }
  if (report.bedrooms === 0) {
    return { next: addRoom(p, 'bedroom'), mutation: 'add-bedroom' }
  }
  // Spec 084 S4 — bigger homes deserve more daylight: the target scales with the footprint
  // (max of 8 and half the perimeter span), inert at today's cottage sizes.
  if (report.windowCount < Math.max(8, Math.round((p.w + p.d) / 2))) {
    const dark = p.rooms.findIndex((r) => !r.win && r.kind !== 'patio' && r.kind !== 'pool' && r.kind !== 'garage')
    if (dark >= 0) return { next: toggleWin(p, dark), mutation: 'add-windows' }
  }
  if (report.storeys < 2 && report.roomAreas['living'] !== undefined && p.w * p.d - (report.roomAreas['patio'] ?? 0) - (report.roomAreas['pool'] ?? 0) >= p.w * p.d * 0.7) {
    return { next: setWallH(p, 2), mutation: 'add-storey' }
  }
  const living = p.rooms.findIndex((r) => r.kind === 'living')
  if (living >= 0) return { next: resizeRoom(p, living, 1, 0), mutation: 'grow-living' }
  return { next: p, mutation: 'content' }
}

/** The capped self-design loop. Starts from `startScript` (or the caller passes the citizen's current
 *  design), inspects, mutates once, re-inspects — at most `cap` (default 3) rounds, stopping early
 *  when an edit no longer changes the design. Every intermediate design is validated; an invalid
 *  mutation is discarded and the loop stops with the last good design. */
export function selfDesign(
  startScript: string,
  zone: { w: number; d: number },
  seed: number,
  doorDir: DoorDir,
  cap = 3,
): SelfDesignResult {
  let current = startScript
  const iterations: SelfDesignResult['iterations'] = []
  for (let i = 0; i < cap; i++) {
    const report = blueprintReport(current, zone, seed)
    const parsed = parseBlueprint(current)
    const { next, mutation } = improveOnce(parsed, report, seed)
    if (mutation === 'content') break
    const nextScript = blueprintToScript({ ...next, doorDir })
    if (!validateBlueprint(nextScript).ok) break
    if (nextScript === current) break
    current = nextScript
    iterations.push({ mutation, report: blueprintReport(current, zone, seed) })
  }
  return { script: current, report: blueprintReport(current, zone, seed), iterations }
}
