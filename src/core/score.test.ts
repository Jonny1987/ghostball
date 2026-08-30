import { describe, expect, it } from 'vitest'
import { generateShot } from './generate'
import { trueGhost } from './ghost'
import { computeResult, fullnessBand, gradeBand } from './score'
import { DEFAULT_TABLE } from './table'
import type { LevelId } from './types'
import { degToRad, radToDeg, vec } from './vec'

const T = DEFAULT_TABLE

describe('grade bands (§2.7)', () => {
  it('band edges', () => {
    expect(gradeBand(0)).toBe('perfect')
    expect(gradeBand(0.5)).toBe('perfect')
    expect(gradeBand(0.51)).toBe('excellent')
    expect(gradeBand(1.5)).toBe('excellent')
    expect(gradeBand(1.51)).toBe('good')
    expect(gradeBand(3)).toBe('good')
    expect(gradeBand(3.01)).toBe('close')
    expect(gradeBand(6)).toBe('close')
    expect(gradeBand(6.01)).toBe('miss')
  })
})

describe('fullness bands (§4.9)', () => {
  it('verbal band mapping', () => {
    expect(fullnessBand(0.9)).toBe('nearly full ball')
    expect(fullnessBand(0.683)).toBe('about ¾ ball')
    expect(fullnessBand(0.5)).toBe('about ½ ball')
    expect(fullnessBand(0.2)).toBe('about ¼ ball')
    expect(fullnessBand(0.1)).toBe('very thin')
  })
})

describe('result payload invariants', () => {
  it('directionErrorDeg ≡ thetaErrorDeg (§4.9 identity)', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (let seed = 1; seed <= 50; seed++) {
        const s = generateShot(seed, level, T)
        const res = computeResult(
          {
            thetaUser: s.thetaTrue + degToRad(1.7),
            cue: s.cue,
            object: s.object,
            targetPocketId: s.pocketId,
          },
          T,
        )
        expect(res.directionErrorDeg).toBe(res.thetaErrorDeg)
        expect(res.thetaErrorDeg).toBeCloseTo(1.7, 4)
        expect(res.arcErrorMm).toBeCloseTo(2 * T.cfg.ballRadiusMm * degToRad(1.7), 6)
        expect(res.contactErrorMm).toBeCloseTo(res.arcErrorMm / 2, 9)
      }
    }
  })

  it('β ≤ clipped window ⟹ potted (§4.9 guarantee b) on generated shots', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (let seed = 100; seed < 150; seed++) {
        const s = generateShot(seed, level, T)
        const base = computeResult(
          { thetaUser: s.thetaTrue, cue: s.cue, object: s.object, targetPocketId: s.pocketId },
          T,
        )
        expect(base.potted).toBe(true)
        // Probe just inside the clipped window on each side.
        for (const sign of [1, -1]) {
          const sideDeg = sign === 1 ? base.windowPlusDeg : base.windowMinusDeg
          if (sideDeg < 0.05) continue
          const probe = computeResult(
            {
              thetaUser: s.thetaTrue + sign * degToRad(sideDeg - 0.03),
              cue: s.cue,
              object: s.object,
              targetPocketId: s.pocketId,
            },
            T,
          )
          expect(probe.potted).toBe(true)
        }
      }
    }
  })

  it('overcut flag matches thin/full direction', () => {
    const O = vec(600, 400)
    const C = vec(1500, 400)
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const G = trueGhost(O, pk, T.cfg)
    const tTrue = Math.atan2(G.y - O.y, G.x - O.x)
    // Rotating the ghost toward a bigger cut increases φ_user → overcut ("too thin").
    const over = computeResult(
      { thetaUser: tTrue + degToRad(2), cue: C, object: O, targetPocketId: 0 },
      T,
    )
    const under = computeResult(
      { thetaUser: tTrue - degToRad(2), cue: C, object: O, targetPocketId: 0 },
      T,
    )
    expect(over.cutAngleUserDeg).toBeGreaterThan(over.cutAngleTrueDeg)
    expect(over.overcut).toBe(true)
    expect(under.cutAngleUserDeg).toBeLessThan(under.cutAngleTrueDeg)
    expect(under.overcut).toBe(false)
  })

  it('a clear miss reports missMm > 0 and no margin', () => {
    const O = vec(600, 400)
    const C = vec(1500, 400)
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const G = trueGhost(O, pk, T.cfg)
    const tTrue = Math.atan2(G.y - O.y, G.x - O.x)
    const res = computeResult(
      { thetaUser: tTrue + degToRad(8), cue: C, object: O, targetPocketId: 0 },
      T,
    )
    expect(res.potted).toBe(false)
    expect(res.band).toBe('miss')
    expect(res.missMm).not.toBeNull()
    expect(res.missMm ?? 0).toBeGreaterThan(0)
    expect(res.marginMm).toBeNull()
  })

  it('window monotonicity sanity: reported window is positive on real shots', () => {
    for (let seed = 200; seed < 220; seed++) {
      const s = generateShot(seed, 2, T)
      const res = computeResult(
        { thetaUser: s.thetaTrue, cue: s.cue, object: s.object, targetPocketId: s.pocketId },
        T,
      )
      expect(res.allowedWindowDeg).toBeGreaterThan(0)
      expect(res.windowPlusDeg).toBeGreaterThan(0)
      expect(res.windowMinusDeg).toBeGreaterThan(0)
      expect(radToDeg(degToRad(res.allowedWindowDeg))).toBeCloseTo(res.allowedWindowDeg, 9)
    }
  })
})
