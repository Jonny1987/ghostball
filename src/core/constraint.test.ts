import { describe, expect, it } from 'vitest'
import {
  COARSE_STEP,
  clampToReachable,
  FINE_STEP,
  ghostAt,
  nudge,
  placeFromDrag,
  reachableArc,
} from './constraint'
import { DEFAULT_TABLE } from './table'
import { degToRad, dist, dot, radToDeg, sub, vec, wrapToPi } from './vec'

const T = DEFAULT_TABLE
const r = T.cfg.ballRadiusMm
const O = vec(1000, 600)

describe('constraint circle and projection', () => {
  it('projection always lands on the circle: |U(θ)−O| ≡ 2r', () => {
    const C = vec(1800, 900)
    for (let i = 0; i < 100; i++) {
      const q = vec(200 + i * 20, 100 + ((i * 37) % 1100))
      const theta = placeFromDrag(q, O, C, 0, T)
      expect(dist(ghostAt(theta, O, r), O)).toBeCloseTo(2 * r, 9)
    }
  })

  it('projection is idempotent', () => {
    const C = vec(1800, 900)
    const q = vec(400, 1100)
    const t1 = placeFromDrag(q, O, C, 0, T)
    const u1 = ghostAt(t1, O, r)
    const t2 = placeFromDrag(u1, O, C, t1, T)
    expect(t2).toBeCloseTo(t1, 9)
  })

  it('an in-arc drag point projects to its own radial angle (nearest point)', () => {
    const C = vec(1800, 600)
    const q = vec(1080, 680) // 45° from O — inside the ~±85.9° reachable arc about θC = 0
    const theta = placeFromDrag(q, O, C, 0, T)
    expect(theta).toBeCloseTo(Math.atan2(q.y - O.y, q.x - O.x), 9)
  })
})

describe('ψ = Δ boundary suite (the condition the research docs disagreed on)', () => {
  const farO = vec(400, 600)
  const cases = [
    { name: 'near cue (D = 2r + 10 mm)', O, C: vec(O.x + 2 * r + 10, O.y) },
    { name: 'mid cue (D = 900 mm)', O, C: vec(O.x + 900, O.y) },
    { name: 'far cue (D = 2000 mm)', O: farO, C: vec(farO.x + 2000, farO.y) },
  ]
  const eps = degToRad(0.01)

  for (const { name, O: caseO, C } of cases) {
    it(`${name}: Δ−ε reachable, Δ+ε clamped, both arc ends`, () => {
      const arc = reachableArc(caseO, C, T)
      expect(arc.halfWidth).toBeGreaterThan(0)
      for (const side of [1, -1]) {
        const inside = arc.thetaC + side * (arc.halfWidth - eps)
        const outside = arc.thetaC + side * (arc.halfWidth + eps)
        expect(clampToReachable(inside, caseO, C, T)).toBeCloseTo(inside, 6)
        expect(clampToReachable(outside, caseO, C, T)).toBeCloseTo(
          arc.thetaC + side * arc.halfWidth,
          6,
        )
      }
      // exactly Δ is handled consistently (stays at the limit)
      const atLimit = arc.thetaC + arc.halfWidth
      expect(clampToReachable(atLimit, caseO, C, T)).toBeCloseTo(atLimit, 6)
    })
  }

  it('reachability condition matches 4r²: clamped θ always satisfies dot(U−O, C−O) ≥ 4r²·cos(ARC_EPS-ish)', () => {
    const C = vec(1900, 800)
    for (let i = 0; i < 72; i++) {
      const theta = (i / 72) * 2 * Math.PI - Math.PI
      const clamped = clampToReachable(theta, O, C, T)
      const U = ghostAt(clamped, O, r)
      // Clamped positions satisfy the §4.6 condition (up to the ARC_EPS shrink).
      expect(dot(sub(U, O), sub(C, O))).toBeGreaterThanOrEqual(4 * r * r * 0.999)
    }
  })
})

describe('nudge', () => {
  const C = vec(1800, 900)

  it('fine step moves exactly 0.25° inside the arc and is invertible', () => {
    const arc = reachableArc(O, C, T)
    const theta0 = arc.thetaC
    const fwd = nudge(theta0, FINE_STEP, O, C, T)
    expect(radToDeg(Math.abs(wrapToPi(fwd.theta - theta0)))).toBeCloseTo(0.25, 6)
    expect(fwd.atLimit).toBe(false)
    const back = nudge(fwd.theta, -FINE_STEP, O, C, T)
    expect(back.theta).toBeCloseTo(theta0, 9)
  })

  it('coarse step moves 1.0°', () => {
    const arc = reachableArc(O, C, T)
    const fwd = nudge(arc.thetaC, COARSE_STEP, O, C, T)
    expect(radToDeg(Math.abs(wrapToPi(fwd.theta - arc.thetaC)))).toBeCloseTo(1.0, 6)
  })

  it('pins at the arc limit and reports atLimit', () => {
    const arc = reachableArc(O, C, T)
    const nearLimit = arc.thetaC + arc.halfWidth - degToRad(0.05)
    const res = nudge(nearLimit, FINE_STEP, O, C, T)
    expect(res.theta).toBeCloseTo(arc.thetaC + arc.halfWidth, 6)
    expect(res.atLimit).toBe(true)
    // Nudging further while pinned stays pinned.
    const again = nudge(res.theta, FINE_STEP, O, C, T)
    expect(again.theta).toBeCloseTo(res.theta, 9)
    expect(again.atLimit).toBe(true)
  })
})

describe('table-bounds guard', () => {
  it('walks the ghost back inside the table when the arc pokes out of bounds', () => {
    // Object ball 5 mm off the bottom rail with the cue beside it: the reachable arc
    // includes downward angles whose U would sit below the bed.
    const nearRail = vec(1000, r + 5)
    const C = vec(1600, r + 5)
    const theta = clampToReachable(degToRad(-80), nearRail, C, T)
    const U = ghostAt(theta, nearRail, r)
    expect(U.y).toBeGreaterThanOrEqual(r - 1e-6)
    // Without the guard, θ = −80° stays in-arc and U.y ≈ −22.7 — assert the guard moved it.
    expect(radToDeg(theta)).toBeGreaterThan(-6)
    expect(radToDeg(theta)).toBeLessThan(0)
  })
})
