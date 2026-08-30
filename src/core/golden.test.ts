import { describe, expect, it } from 'vitest'
import { clampToReachable, ghostAt, placeFromDrag, reachableArc } from './constraint'
import { cutAngle, departureDir, thetaTrue, trueGhost } from './ghost'
import { allowedWindow, computeResult, contactFullness, jawWindow } from './score'
import { missMetrics, raySegment, simulate } from './simulate'
import { DEFAULT_TABLE } from './table'
import { degToRad, dist, dot, radToDeg, sub, unit, vec } from './vec'

// Golden test vectors — PLAN.md §4.11. Fixtures tolerance ±0.02 mm/° unless noted.
const T = DEFAULT_TABLE
const cfg = T.cfg
const O = vec(600, 400)
const C = vec(1500, 400)
const P0 = T.pockets[0]
if (!P0) throw new Error('pocket 0 missing')

describe('§4.11 golden vectors — pocket 0 geometry', () => {
  it('derives pocket 0 exactly (§4.3–§4.4)', () => {
    expect(P0.j1.x).toBeCloseTo(80.822, 2)
    expect(P0.j1.y).toBeCloseTo(0, 6)
    expect(P0.j2.x).toBeCloseTo(0, 6)
    expect(P0.j2.y).toBeCloseTo(80.822, 2)
    expect(P0.m.x).toBeCloseTo(40.411, 2)
    expect(P0.m.y).toBeCloseTo(40.411, 2)
    expect(P0.wEff).toBeCloseTo(33.575, 3)
  })

  it('vector 1: true ghost, θ_true, d̂_true', () => {
    expect(dist(O, P0.m)).toBeCloseTo(665.17, 1)
    const G = trueGhost(O, P0, cfg)
    expect(G.x).toBeCloseTo(648.079, 2)
    expect(G.y).toBeCloseTo(430.896, 2)
    expect(Math.abs(radToDeg(thetaTrue(O, G)) - 32.73)).toBeLessThanOrEqual(0.02)
    const d = departureDir(O, G)
    expect(d.x).toBeCloseTo(-0.84128, 4)
    expect(d.y).toBeCloseTo(-0.54061, 4)
  })

  it('vector 2: reachability and arc half-width', () => {
    const G = trueGhost(O, P0, cfg)
    expect(dot(sub(G, O), sub(C, O))).toBeGreaterThan(3266.12)
    expect(dot(sub(G, O), sub(C, O))).toBeCloseTo(43271, 0)
    const arc = reachableArc(O, C, T)
    // Δ before ARC_EPS = arccos(57.15/900) = 86.36°; halfWidth is post-ARC_EPS.
    expect(radToDeg(arc.halfWidth) + 0.5).toBeCloseTo(86.36, 2)
    expect(radToDeg(arc.halfWidth)).toBeCloseTo(85.86, 2)
    expect(radToDeg(arc.thetaC)).toBeCloseTo(0, 6)
  })

  it('vector 3: cut angle with §4.6 identity cross-check', () => {
    const G = trueGhost(O, P0, cfg)
    const phi = cutAngle(C, G, O)
    expect(radToDeg(phi)).toBeCloseTo(34.8, 1)
    // cos φ = (D·cos ψ − 2r)/√(D² + 4r² − 4rD·cos ψ), ψ = 32.73°, D = 900 (§4.6)
    const psi = thetaTrue(O, G) // θC = 0 here so ψ = θ_true
    const D = 900
    const r2 = 2 * cfg.ballRadiusMm
    const num = D * Math.cos(psi) - r2
    const den = Math.sqrt(D * D + r2 * r2 - 2 * r2 * D * Math.cos(psi))
    expect(Math.cos(phi)).toBeCloseTo(num / den, 4)
  })

  it('vector 4: jaw-subtended window ±', () => {
    const jaw = jawWindow(O, 0, T)
    expect(radToDeg(jaw.plus)).toBeCloseTo(2.85, 1)
    expect(radToDeg(jaw.minus)).toBeCloseTo(2.8, 1)
    // small-angle sanity: ≈ (w_eff/|M−O|)·cos α
    const alpha = degToRad(12.28)
    const approx = radToDeg((P0.wEff / dist(O, P0.m)) * Math.cos(alpha))
    expect(approx).toBeCloseTo(2.83, 1)
  })

  it('vector 5: submit at θ_user = 35° — potted with margin, near-jaw regression', () => {
    const thetaUser = degToRad(35)
    const U = ghostAt(thetaUser, O, cfg.ballRadiusMm)
    expect(U.x).toBeCloseTo(646.815, 2)
    expect(U.y).toBeCloseTo(432.78, 2)

    const res = computeResult({ thetaUser, cue: C, object: O, targetPocketId: 0 }, T)
    expect(Math.abs(res.thetaErrorDeg - 2.27)).toBeLessThanOrEqual(0.02)
    expect(res.arcErrorMm).toBeCloseTo(2.26, 1)
    expect(res.contactErrorMm).toBeCloseTo(1.13, 1)
    expect(res.potted).toBe(true)
    expect(res.outcome).toBe('target_pocket')
    expect(res.mouthOffsetMm).toBeCloseTo(26.82, 1)
    expect(res.marginMm).toBeCloseTo(6.75, 1)
    expect(res.cutAngleUserDeg).toBeCloseTo(37.2, 1)
    expect(res.overcut).toBe(true)
    expect(res.contactFullness).toBeCloseTo(0.395, 2)
    expect(res.band).toBe('good')
    // Window fields ±0.05° here: the E1 edge ray clears the cushion span by ~0.05 mm (§4.11).
    expect(res.windowPlusDeg).toBeCloseTo(2.85, 1)
    expect(res.windowMinusDeg).toBeCloseTo(2.8, 1)
    expect(res.windowClipped).toBe(false)
  })

  it('vector 5 regression potNearJawIsNotCushion: the y=r crossing sits in the mouth gap', () => {
    // d̂ at θ_user = 35° crosses y = r at t ≈ 647.6, x ≈ 69.55 < a = 80.822 — mouth gap,
    // not cushion. The naive full-rail rule would misclassify this pot as a cushion hit.
    const sim = simulate(degToRad(35), O, 0, T)
    expect(sim.outcome).toBe('target_pocket')
    expect(sim.event?.kind).toBe('pot')
    expect(sim.event?.t).toBeCloseTo(660.0, 0)
  })

  it('vector 6: nudge step arc lengths', () => {
    const r2 = 2 * cfg.ballRadiusMm
    expect(r2 * degToRad(0.25)).toBeCloseTo(0.249, 2)
    expect(r2 * degToRad(1.0)).toBeCloseTo(0.998, 2)
  })
})

describe('§4.11 vectors 7–10 — degeneracies and event-model regressions', () => {
  it('drag at O returns prevθ', () => {
    expect(placeFromDrag(vec(600, 400), O, C, 1.234, T)).toBe(1.234)
  })

  it('clamps beyond ±Δ and pins at the limit', () => {
    const arc = reachableArc(O, C, T)
    const beyond = arc.thetaC + arc.halfWidth + degToRad(5)
    const clamped = clampToReachable(beyond, O, C, T)
    expect(clamped).toBeCloseTo(arc.thetaC + arc.halfWidth, 6)
  })

  it('degenerate D = 2r + 0.001 mm ⇒ Δ = 0 ⇒ θ′ = θC', () => {
    const nearC = vec(O.x + 2 * cfg.ballRadiusMm + 0.001, O.y)
    const arc = reachableArc(O, nearC, T)
    expect(arc.halfWidth).toBe(0)
    expect(clampToReachable(degToRad(120), O, nearC, T)).toBeCloseTo(arc.thetaC, 9)
  })

  it('ray parallel to mouth → raySegment null and missMetrics nulls', () => {
    const pk1 = T.pockets[1]
    if (!pk1) throw new Error('pocket 1 missing')
    expect(raySegment(vec(100, 0), vec(1, 0), pk1.e2, pk1.e1)).toBeNull()
    // θ = 180° gives d̂ = (1, 0), parallel to pocket 1's mouth tangent.
    const miss = missMetrics(Math.PI, vec(100, 500), 1, T)
    expect(miss.missMm).toBeNull()
    expect(miss.wrongDirection).toBe(false)
  })

  it('heading away → wrong_direction', () => {
    // θ_user = 212.73° points d̂ away from pocket 0 (opposite the true aim).
    const miss = missMetrics(degToRad(32.73) + Math.PI, O, 0, T)
    expect(miss.wrongDirection).toBe(true)
    expect(miss.missMm).toBeNull()
  })

  it('wrong-pocket capture', () => {
    // Aim straight at pocket 2's mouth while pocket 0 is the target.
    const pk2 = T.pockets[2]
    if (!pk2) throw new Error('pocket 2 missing')
    const d = { x: pk2.m.x - O.x, y: pk2.m.y - O.y }
    const theta = Math.atan2(-d.y, -d.x) // ê = −d̂
    const sim = simulate(theta, O, 0, T)
    expect(sim.outcome).toBe('wrong_pocket')
    expect(sim.pocketId).toBe(2)
  })

  it('α = 45° along-cushion corner roll pots', () => {
    // Ball centre at y = r rolling +x into pocket 2: parallel to its own track line,
    // arrives at the corner mouth at exactly 45° — must pass the 60° cap.
    const start = vec(2000, cfg.ballRadiusMm)
    const sim = simulate(Math.PI, start, 2, T) // θ = 180° ⇒ d̂ = (1, 0)
    expect(sim.outcome).toBe('target_pocket')
    expect(sim.pocketId).toBe(2)
  })

  it('α = 75° side-mouth graze fails the cap and rattles (vector 10 family)', () => {
    // d̂ = (sin75°, −cos75°) from O chosen so the y=r crossing lands mid-gap at x = 1270.
    const d = { x: Math.sin(degToRad(75)), y: -Math.cos(degToRad(75)) }
    const oy = 300
    const ox = 1270 - (d.x / -d.y) * (oy - cfg.ballRadiusMm)
    const theta = Math.atan2(-d.y, -d.x)
    const sim = simulate(theta, vec(ox, oy), 1, T)
    expect(sim.outcome).toBe('cushion')
    expect(sim.detail).toBe('rattled')
    expect(sim.pocketId).toBe(1)
  })

  it('vector 8 straightSidePotIsNotCushion: dead-centre side pot', () => {
    const obj = vec(1270, 400)
    const sim = simulate(degToRad(90), obj, 1, T) // ê = (0,1) ⇒ d̂ = (0,−1)
    expect(sim.outcome).toBe('target_pocket')
    expect(sim.event?.t).toBeCloseTo(400, 1)
    expect(sim.event?.mouthOffsetMm).toBeCloseTo(0, 3)
    expect(sim.event?.marginMm).toBeCloseTo(39.925, 2)
  })

  it('vector 9 shadowed window: rail clips the jaw-subtended window', () => {
    const obj = vec(2000, 100)
    const G = trueGhost(obj, P0, cfg)
    expect(G.x).toBeCloseTo(2057.12, 1)
    expect(G.y).toBeCloseTo(101.74, 1)
    const tTrue = thetaTrue(obj, G)

    const jaw = jawWindow(obj, 0, T)
    expect(radToDeg(jaw.plus)).toBeCloseTo(0.723, 2)
    expect(radToDeg(jaw.minus)).toBeCloseTo(0.706, 2)

    // The truth itself pots (generator check 7 relies on this).
    expect(simulate(tTrue, obj, 0, T).outcome).toBe('target_pocket')

    // The ray at mouth offset u = +30 mm is inside the naive window but clips the rail.
    const aimAt = { x: P0.m.x + 30 * P0.t.x, y: P0.m.y + 30 * P0.t.y }
    const dir = sub(aimAt, obj)
    const thetaAtU30 = Math.atan2(-dir.y, -dir.x)
    const simAt = simulate(thetaAtU30, obj, 0, T)
    expect(simAt.outcome).toBe('cushion')
    expect(simAt.event?.point.x).toBeCloseTo(286.6, 0)

    const win = allowedWindow(tTrue, obj, 0, T)
    expect(win.clipped).toBe(true)
    // E1 side clipped below the u=+30 ray's deviation (~0.645°).
    const e1SideDeg = Math.min(win.plusDeg, win.minusDeg) // shadowed side is the smaller one
    expect(e1SideDeg).toBeLessThan(0.65)
    expect(win.windowDeg).toBeLessThan(radToDeg(Math.min(jaw.plus, jaw.minus)))
  })

  it('fullness formula spot values', () => {
    expect(contactFullness(0)).toBeCloseTo(1, 6)
    expect(contactFullness(degToRad(14.5))).toBeCloseTo(0.7496, 3)
    expect(contactFullness(degToRad(37.2))).toBeCloseTo(0.3954, 3)
    expect(contactFullness(degToRad(90))).toBeCloseTo(0, 6)
    expect(contactFullness(degToRad(18.5))).toBeCloseTo(0.6827, 3)
  })
})

describe('unit-circle helper sanity', () => {
  it('unit(θ) and departure are opposite', () => {
    const theta = degToRad(35)
    const e = unit(theta)
    const U = ghostAt(theta, O, cfg.ballRadiusMm)
    const d = departureDir(O, U)
    expect(d.x).toBeCloseTo(-e.x, 9)
    expect(d.y).toBeCloseTo(-e.y, 9)
  })
})
