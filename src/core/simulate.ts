import type { SimEvent, SimResult, Table } from './types'
import { add, cross, dot, EPS, scale, sub, unit, type Vec2 } from './vec'

export interface RayHit {
  t: number
  s: number
  point: Vec2
}

// Ray P + t·d vs segment A→B (§4.8). Valid iff t > EPS and 0 ≤ s ≤ 1; parallel → null.
export function raySegment(p: Vec2, d: Vec2, a: Vec2, b: Vec2): RayHit | null {
  const v = sub(b, a)
  const den = cross(d, v)
  if (Math.abs(den) < EPS) return null
  const w = sub(a, p)
  const t = cross(w, v) / den
  const s = cross(w, d) / den
  if (t > EPS && s >= 0 && s <= 1) return { t, s, point: add(p, scale(d, t)) }
  return null
}

// Full submit simulation per the corrected event model (PLAN.md §4.8):
// pot events per pocket; cushion events only on jaw-bounded spans; mouth-gap crossings become
// jaw-rattle events iff that pocket has no valid pot event; minimum-t valid event wins.
export function simulate(
  thetaUser: number,
  object: Vec2,
  targetPocketId: number,
  table: Table,
): SimResult {
  const d = scale(unit(thetaUser), -1) // d̂ = normalize(O − U) = −ê(θ_user)
  const cosAlphaMax = Math.cos(table.cfg.alphaMaxRad)

  const events: SimEvent[] = []
  const potByPocket = new Map<number, SimEvent>()

  for (const pk of table.pockets) {
    const hit = raySegment(object, d, pk.e2, pk.e1)
    if (!hit) continue
    if (dot(d, pk.n) < cosAlphaMax) continue // approach-angle cap (§4.4)
    const u = (hit.s - 0.5) * 2 * pk.wEff // signed mouth offset along t̂ (s=1 at E1)
    const ev: SimEvent = {
      kind: 'pot',
      t: hit.t,
      point: hit.point,
      pocketId: pk.id,
      mouthOffsetMm: u,
      marginMm: pk.wEff - Math.abs(u),
    }
    events.push(ev)
    potByPocket.set(pk.id, ev)
  }

  for (const track of table.tracks) {
    const dAxis = track.axis === 'y' ? d.y : d.x
    if (Math.abs(dAxis) < EPS) continue // parallel to the track line — no crossing
    const pAxis = track.axis === 'y' ? object.y : object.x
    const t = (track.value - pAxis) / dAxis
    if (t <= EPS) continue
    const q = track.axis === 'y' ? object.x + t * d.x : object.y + t * d.y
    const point = add(object, scale(d, t))

    const inSpan = track.spans.some(([lo, hi]) => q >= lo && q <= hi)
    if (inSpan) {
      events.push({ kind: 'cushion', t, point })
      continue
    }
    const gap = track.gaps.find(([lo, hi]) => q > lo && q < hi)
    if (gap && !potByPocket.has(gap[2])) {
      // Entering a mouth region with no valid capture: jaw rattle (§4.8).
      events.push({ kind: 'rattle', t, point, pocketId: gap[2] })
    }
    // Gap crossing with a valid pot event for that pocket: ignored — the ball is on its way in.
  }

  if (events.length === 0) {
    return { outcome: 'cushion', potted: false, event: null, pocketId: null, detail: null }
  }

  let best = events[0] as SimEvent
  for (const ev of events) if (ev.t < best.t) best = ev

  if (best.kind === 'pot') {
    const isTarget = best.pocketId === targetPocketId
    return {
      outcome: isTarget ? 'target_pocket' : 'wrong_pocket',
      potted: isTarget,
      event: best,
      pocketId: best.pocketId ?? null,
      detail: null,
    }
  }
  if (best.kind === 'rattle') {
    return {
      outcome: 'cushion',
      potted: false,
      event: best,
      pocketId: best.pocketId ?? null,
      detail: 'rattled',
    }
  }
  return { outcome: 'cushion', potted: false, event: best, pocketId: null, detail: null }
}

export interface MissMetrics {
  missMm: number | null // >0 missed by that much; ≤0 inside jaws (margin = −missMm)
  mouthOffsetMm: number | null // signed u* along t̂ at the infinite-line crossing
  wrongDirection: boolean
}

// Intersect the infinite ball line with the infinite target-mouth line (§4.8).
export function missMetrics(
  thetaUser: number,
  object: Vec2,
  targetPocketId: number,
  table: Table,
): MissMetrics {
  const d = scale(unit(thetaUser), -1)
  const pk = table.pockets[targetPocketId]
  if (!pk) return { missMm: null, mouthOffsetMm: null, wrongDirection: false }
  const den = cross(d, pk.t)
  if (Math.abs(den) < EPS) return { missMm: null, mouthOffsetMm: null, wrongDirection: false }
  const w = sub(pk.m, object)
  const t = cross(w, pk.t) / den
  const u = cross(w, d) / den
  if (t < 0) return { missMm: null, mouthOffsetMm: null, wrongDirection: true }
  return { missMm: Math.abs(u) - pk.wEff, mouthOffsetMm: u, wrongDirection: false }
}

export interface EffectiveContact {
  theta: number // angle of the actual cue-ball centre around O at first contact
  contactCenter: Vec2
  tMm: number // distance travelled from C
}

// V2 physics (docs/decisions.md): the placed ghost expresses an AIM — the cue ball is
// driven from C along the ray through the placed position U and keeps rolling. The actual
// contact is the first point on that ray whose centre is 2r from O. An overlapping or
// short ghost therefore contacts at a slightly different angle than placed; a ghost far
// enough off line means the cue ball never touches the object ball at all (a whiff).
export function effectiveContact(
  cue: Vec2,
  ghostPos: Vec2,
  object: Vec2,
  ballRadiusMm: number,
): EffectiveContact | null {
  const aim = sub(ghostPos, cue)
  const aimLen = Math.hypot(aim.x, aim.y)
  if (aimLen < EPS) return null
  const dir = { x: aim.x / aimLen, y: aim.y / aimLen }
  const oc = sub(object, cue)
  const proj = dot(oc, dir)
  const r2 = 2 * ballRadiusMm
  if (proj <= 0) return null // object ball is behind the aim direction
  const perpSq = dot(oc, oc) - proj * proj
  if (perpSq > r2 * r2) return null // aim line passes more than 2r from O — clean whiff
  const h = Math.sqrt(Math.max(0, r2 * r2 - perpSq))
  const t = proj - h // first intersection (callers guarantee C starts outside 2r of O)
  if (t <= EPS) return null
  const contactCenter = add(cue, scale(dir, t))
  return {
    theta: Math.atan2(contactCenter.y - object.y, contactCenter.x - object.x),
    contactCenter,
    tMm: t,
  }
}
