import { describe, expect, it } from 'vitest'
import { clampPlacement, frameRadiusMm, ghostAt, maxCenterDistMm, nudgePos } from './constraint'
import { fitStandingZoom, standingFrameCheck } from './framecheck'
import { generateShot } from './generate'
import { trueGhost } from './ghost'
import { computeResult } from './score'
import { effectiveContact } from './simulate'
import { DEFAULT_TABLE } from './table'
import type { LevelId } from './types'
import { degToRad, dist, radToDeg, vec, wrapToPi } from './vec'

// V2 free-placement suite (docs/decisions.md): the guess is a 2D position; physics
// resolves the actual contact from the aim line.

const T = DEFAULT_TABLE
const cfg = T.cfg
const r = cfg.ballRadiusMm
const O = vec(600, 400)
const C = vec(1500, 400)

describe('clampPlacement (v2)', () => {
  it('allows overlap all the way to the object ball centre', () => {
    const p = clampPlacement(vec(O.x + 5, O.y - 3), O, T)
    expect(p.x).toBeCloseTo(O.x + 5, 9)
    expect(p.y).toBeCloseTo(O.y - 3, 9)
  })

  it('allows a gap beyond touching, up to the placement bound', () => {
    const gapPos = vec(O.x + 2 * r + 40, O.y) // 40 mm gap
    const p = clampPlacement(gapPos, O, T)
    expect(p.x).toBeCloseTo(gapPos.x, 9)
  })

  it('clamps radially at maxCenterDistMm', () => {
    const far = vec(O.x + 500, O.y)
    const p = clampPlacement(far, O, T)
    expect(dist(p, O)).toBeCloseTo(maxCenterDistMm(r), 6)
  })

  it('clamps to table bounds near a rail', () => {
    const nearRail = vec(1000, r + 5)
    const p = clampPlacement(vec(1000, -50), nearRail, T)
    expect(p.y).toBeGreaterThanOrEqual(r - 1e-9)
  })

  it('frameRadius covers the whole placement disc plus the ball and margin', () => {
    expect(frameRadiusMm(r)).toBeGreaterThan(maxCenterDistMm(r) + r)
  })

  it('nudgePos moves by the delta and pins at the bound', () => {
    const start = ghostAt(0, O, r)
    const res = nudgePos(start, { x: 0.25, y: 0 }, O, T)
    expect(res.pos.x).toBeCloseTo(start.x + 0.25, 9)
    expect(res.atLimit).toBe(false)
    const atEdge = vec(O.x + maxCenterDistMm(r), O.y)
    const pinned = nudgePos(atEdge, { x: 1, y: 0 }, O, T)
    expect(pinned.atLimit).toBe(true)
    expect(dist(pinned.pos, O)).toBeCloseTo(maxCenterDistMm(r), 6)
  })
})

describe('effectiveContact (v2 physics)', () => {
  it('an on-circle placement on the reachable side contacts exactly where placed', () => {
    for (const deg of [0, 20, 45, -30, 70]) {
      const theta = degToRad(deg)
      const u = ghostAt(theta, O, r)
      const eff = effectiveContact(C, u, O, r)
      expect(eff).not.toBeNull()
      expect(Math.abs(wrapToPi((eff?.theta ?? 0) - theta))).toBeLessThan(1e-9)
      expect(eff?.contactCenter.x).toBeCloseTo(u.x, 6)
      expect(eff?.contactCenter.y).toBeCloseTo(u.y, 6)
    }
  })

  it('an overlapping placement contacts EARLIER along the aim line than placed', () => {
    // ghost pushed 15 mm into the object ball along the straight-through line
    const u = vec(O.x + 2 * r - 15, O.y)
    const eff = effectiveContact(C, u, O, r)
    expect(eff).not.toBeNull()
    // actual contact centre is at distance exactly 2r from O
    expect(dist(eff?.contactCenter ?? O, O)).toBeCloseTo(2 * r, 6)
    // and it happens before reaching the placed position
    expect(eff?.tMm ?? 0).toBeLessThan(dist(C, u))
  })

  it('a gapped placement on the aim line still contacts at 2r (the cue ball rolls on)', () => {
    const u = vec(O.x + 2 * r + 30, O.y) // 30 mm short of touching
    const eff = effectiveContact(C, u, O, r)
    expect(eff).not.toBeNull()
    expect(dist(eff?.contactCenter ?? O, O)).toBeCloseTo(2 * r, 6)
    expect(eff?.tMm ?? 0).toBeGreaterThan(dist(C, u)) // contact is PAST the placed ghost
  })

  it('an aim line passing more than 2r from O is a whiff', () => {
    // place the ghost far to the side with a gap: the ray from C misses the ball
    const u = vec(O.x, O.y + 2 * r + 50)
    const eff = effectiveContact(C, u, O, r)
    expect(eff).toBeNull()
    const res = computeResult({ ghostPos: u, cue: C, object: O, targetPocketId: 0 }, T)
    expect(res.outcome).toBe('whiff')
    expect(res.potted).toBe(false)
    expect(res.sim.event).toBeNull()
  })

  it('a placement on the FAR side of O resolves to a near-side contact (physics, not magic)', () => {
    const u = ghostAt(degToRad(175), O, r) // nearly behind O relative to the cue
    const eff = effectiveContact(C, u, O, r)
    expect(eff).not.toBeNull()
    // the actual contact is on the hemisphere facing the cue ball
    const contactAngle = radToDeg(Math.abs(wrapToPi(eff?.theta ?? 0)))
    expect(contactAngle).toBeLessThan(90)
  })
})

describe('v2 scoring fields', () => {
  it('positionErrorMm is the straight distance to the true ghost; radial sign convention holds', () => {
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const G = trueGhost(O, pk, cfg)
    const overlap = computeResult(
      { ghostPos: vec(O.x + 2 * r - 10, O.y), cue: C, object: O, targetPocketId: 0 },
      T,
    )
    expect(overlap.radialErrorMm).toBeCloseTo(-10, 6)
    const gap = computeResult(
      { ghostPos: vec(O.x + 2 * r + 10, O.y), cue: C, object: O, targetPocketId: 0 },
      T,
    )
    expect(gap.radialErrorMm).toBeCloseTo(10, 6)
    const perfect = computeResult({ ghostPos: G, cue: C, object: O, targetPocketId: 0 }, T)
    expect(perfect.positionErrorMm).toBeCloseTo(0, 9)
    expect(perfect.band).toBe('perfect')
    expect(perfect.potted).toBe(true)
  })

  it('a pure radial error on the true line barely changes the pot (aim line unchanged)', () => {
    // Ghost on the C→G aim line but 20 mm short: same aim line ⇒ same effective contact.
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const G = trueGhost(O, pk, cfg)
    const dir = { x: G.x - C.x, y: G.y - C.y }
    const len = Math.hypot(dir.x, dir.y)
    const short = vec(G.x - (dir.x / len) * 20, G.y - (dir.y / len) * 20)
    const res = computeResult({ ghostPos: short, cue: C, object: O, targetPocketId: 0 }, T)
    expect(res.potted).toBe(true) // physics forgives the depth error on the true line
    expect(res.positionErrorMm).toBeCloseTo(20, 1) // but the score does not
    expect(res.band).toBe('miss')
  })
})

describe('v2 frameability over generated shots', () => {
  it('every generated shot fits pocket + placement region on the reference viewport', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (let seed = 500; seed < 560; seed++) {
        const s = generateShot(seed, level, T)
        expect(standingFrameCheck(s.cue, s.object, s.pocketId, T)).toBe(true)
      }
    }
  })
})

describe('v2.2 standing framing: the ghost itself is centred, the zoom never breathes', () => {
  it('for any legal ghost position: ghost at centre-x, pocket in frame, FOV ghost-independent', () => {
    const aspect = 390 / 844
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7, 0.7],
      [-0.7, -0.7],
    ] as const
    for (const level of [1, 2, 3] as LevelId[]) {
      for (let seed = 800; seed < 820; seed++) {
        const s = generateShot(seed, level, T)
        const base = fitStandingZoom(s.cue, s.object, s.pocketId, T, aspect)
        for (const [dx, dy] of offsets) {
          const g = vec(s.object.x + dx * maxCenterDistMm(r), s.object.y + dy * maxCenterDistMm(r))
          const fit = fitStandingZoom(s.cue, s.object, s.pocketId, T, aspect, undefined, g)
          const fwd = fit.look
          const right = norm3(cross3(fwd, { x: 0, y: 0, z: 1 }))
          const up = cross3(right, fwd)
          const proj = (p: V3): { x: number; y: number } => {
            const v = { x: p.x - fit.eye.x, y: p.y - fit.eye.y, z: p.z - fit.eye.z }
            const zc = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z
            return {
              x: (v.x * right.x + v.y * right.y + v.z * right.z) / zc,
              y: (v.x * up.x + v.y * up.y + v.z * up.z) / zc,
            }
          }
          // (a) the ghost projects to the horizontal screen centre
          expect(Math.abs(proj({ x: g.x, y: g.y, z: r }).x)).toBeLessThan(0.02)
          // (b) the zoom is EXACTLY constant per shot — the FOV pass never sees the
          // ghost, so following it only yaws the camera
          expect(fit.vFovDeg).toBe(base.vFovDeg)
          // (c) the target pocket stays inside the frame at that fixed zoom
          const pk = T.pockets[s.pocketId]
          if (!pk) throw new Error('pocket missing')
          const halfV = Math.tan(degToRad(fit.vFovDeg / 2))
          for (const pp of [pk.j1, pk.j2, pk.m]) {
            const t = proj({ x: pp.x, y: pp.y, z: 0 })
            expect(Math.abs(t.x)).toBeLessThanOrEqual(halfV * aspect + 1e-6)
            expect(Math.abs(t.y)).toBeLessThanOrEqual(halfV + 1e-6)
          }
          // (d) the cue ball stays fully inside the frame too (v2.4)
          for (const cp of [
            { x: s.cue.x, y: s.cue.y, z: 0 },
            { x: s.cue.x, y: s.cue.y, z: 2 * r },
            { x: s.cue.x + r, y: s.cue.y, z: r },
            { x: s.cue.x - r, y: s.cue.y, z: r },
          ]) {
            const t = proj(cp)
            expect(Math.abs(t.x)).toBeLessThanOrEqual(halfV * aspect + 1e-6)
            expect(Math.abs(t.y)).toBeLessThanOrEqual(halfV + 1e-6)
          }
        }
      }
    }
  })
})

describe('v2.1 standing framing: ghost region horizontally centred', () => {
  it('the object ball (placement-region centre) projects to screen centre-x on every generated shot', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (let seed = 700; seed < 740; seed++) {
        const s = generateShot(seed, level, T)
        const fit = fitStandingZoom(s.cue, s.object, s.pocketId, T, 390 / 844)
        // rebuild the camera basis from the returned look and check O's tangent-x ≈ 0
        const fwd = fit.look
        const right = norm3(cross3(fwd, { x: 0, y: 0, z: 1 }))
        const v = { x: s.object.x - fit.eye.x, y: s.object.y - fit.eye.y, z: r - fit.eye.z }
        const zc = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z
        const xt = (v.x * right.x + v.y * right.y + v.z * right.z) / zc
        expect(Math.abs(xt)).toBeLessThan(0.02) // ≲ 1° off exact centre
        expect(fit.fits).toBe(true)
      }
    }
  })
})

function cross3(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function norm3(a: V3): V3 {
  const l = Math.hypot(a.x, a.y, a.z)
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}
interface V3 {
  x: number
  y: number
  z: number
}
