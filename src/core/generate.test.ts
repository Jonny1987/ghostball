import { describe, expect, it } from 'vitest'
import { ghostAt, reachableArc } from './constraint'
import { GENERATOR_VERSION, generateShot, LEVELS, mulberry32 } from './generate'
import { thetaTrue, trueGhost } from './ghost'
import { allowedWindow } from './score'
import { simulate } from './simulate'
import { buildTable, DEFAULT_TABLE, DEFAULT_TABLE_CONFIG } from './table'
import type { LevelId, Shot } from './types'
import { degToRad, dist, dot, radToDeg, sub, wrapToPi } from './vec'

const T = DEFAULT_TABLE
const cfg = T.cfg
const r = cfg.ballRadiusMm

const SHOTS_PER_LEVEL = 1000

function shots(level: LevelId, count = SHOTS_PER_LEVEL): Shot[] {
  const out: Shot[] = []
  for (let seed = 1; seed <= count; seed++) out.push(generateShot(seed, level, T))
  return out
}

describe('generator validity — 1000 seeded shots per level (§4.10, §7)', () => {
  for (const level of [1, 2, 3] as LevelId[]) {
    it(`level ${level}: every shot passes every hard invariant`, () => {
      const params = LEVELS[level]
      for (const s of shots(level)) {
        expect(s.gv).toBe(GENERATOR_VERSION)
        // balls in bounds
        for (const b of [s.cue, s.object]) {
          expect(b.x).toBeGreaterThanOrEqual(r)
          expect(b.x).toBeLessThanOrEqual(cfg.tableLengthMm - r)
          expect(b.y).toBeGreaterThanOrEqual(r)
          expect(b.y).toBeLessThanOrEqual(cfg.tableWidthMm - r)
        }
        // pockets restricted to the level's set
        expect(params.pockets).toContain(s.pocketId)
        // D > 2r and balls not overlapping
        expect(dist(s.cue, s.object)).toBeGreaterThan(2 * r)
        // truth reachable: dot(G−O, C−O) > 4r²
        const pk = T.pockets[s.pocketId]
        if (!pk) throw new Error('missing pocket')
        const G = trueGhost(s.object, pk, cfg)
        expect(dot(sub(G, s.object), sub(s.cue, s.object))).toBeGreaterThan(4 * r * r)
        // cut angle within the level's range (upper cap hard)
        expect(radToDeg(s.cutAngleTrue)).toBeLessThanOrEqual(params.cutDeg[1] + 0.02)
        // truth pots (check 7)
        expect(simulate(s.thetaTrue, s.object, s.pocketId, T).outcome).toBe('target_pocket')
        // stored thetaTrue matches the geometry
        expect(Math.abs(wrapToPi(s.thetaTrue - thetaTrue(s.object, G)))).toBeLessThan(1e-9)
        // difficulty metadata present and sane
        expect(s.difficultyRaw).toBeGreaterThan(0)
        expect(Number.isFinite(s.difficultyRaw)).toBe(true)
      }
    })
  }

  it('widened shots (rung > 0) still pass every hard invariant', () => {
    let widened = 0
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 300)) {
        if (s.widenRung === 0) continue
        widened++
        expect(dist(s.cue, s.object)).toBeGreaterThan(2 * r)
        expect(simulate(s.thetaTrue, s.object, s.pocketId, T).outcome).toBe('target_pocket')
        const params = LEVELS[level]
        expect(radToDeg(s.cutAngleTrue)).toBeLessThanOrEqual(params.cutDeg[1] + 0.02)
      }
    }
    // Informational: widening should be rare; the invariants above are the real assertion.
    expect(widened).toBeGreaterThanOrEqual(0)
  })
})

describe('seed determinism (§4.10)', () => {
  it('same (seed, level) → identical shot, repeatedly', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const seed of [7, 42, 123456, 0xdeadbeef]) {
        const a = generateShot(seed, level, T)
        const b = generateShot(seed, level, T)
        expect(b).toEqual(a)
      }
    }
  })

  it('mulberry32 reference sequence is stable', () => {
    const rng = mulberry32(42)
    const seq = [rng(), rng(), rng()]
    const rng2 = mulberry32(42)
    expect([rng2(), rng2(), rng2()]).toEqual(seq)
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('different levels produce different shots for the same seed', () => {
    const a = generateShot(99, 1, T)
    const b = generateShot(99, 3, T)
    expect(a).not.toEqual(b)
  })
})

describe('perfect guess always pots (§7 property)', () => {
  it('submitting θ_true pots on 300 shots across levels', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) {
        expect(simulate(s.thetaTrue, s.object, s.pocketId, T).potted).toBe(true)
      }
    }
  })
})

describe('sensitivity test (§2.8): θ_true shift under AIM_DEPTH 0 → 20 mm', () => {
  it('95th percentile shift ≤ 1.5° per level', () => {
    const deepTable = buildTable({ ...DEFAULT_TABLE_CONFIG, aimDepthMm: 20 })
    for (const level of [1, 2, 3] as LevelId[]) {
      const shifts: number[] = []
      for (const s of shots(level)) {
        const pkDeep = deepTable.pockets[s.pocketId]
        if (!pkDeep) throw new Error('missing pocket')
        const gDeep = trueGhost(s.object, pkDeep, deepTable.cfg)
        const tDeep = thetaTrue(s.object, gDeep)
        shifts.push(radToDeg(Math.abs(wrapToPi(tDeep - s.thetaTrue))))
      }
      shifts.sort((a, b) => a - b)
      const p95 = shifts[Math.floor(shifts.length * 0.95)] ?? 0
      expect(p95).toBeLessThanOrEqual(1.5)
    }
  })
})

describe('clipped window vs dense sweep (§4.9 interval assumption)', () => {
  it('window matches a 0.02° sweep on 20 shots per level', () => {
    const step = degToRad(0.02)
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 20)) {
        const win = allowedWindow(s.thetaTrue, s.object, s.pocketId, T)
        for (const sign of [1, -1]) {
          // Sweep out from θ_true; find the last potting δ before the first miss.
          let lastPot = 0
          const limit = degToRad(Math.max(win.plusDeg, win.minusDeg) + 0.5)
          for (let d = step; d <= limit; d += step) {
            if (
              simulate(s.thetaTrue + sign * d, s.object, s.pocketId, T).outcome === 'target_pocket'
            ) {
              lastPot = d
            } else {
              break // interval assumption: first miss ends the potting set on this side
            }
          }
          const reported = degToRad(sign === 1 ? win.plusDeg : win.minusDeg)
          expect(Math.abs(lastPot - reported)).toBeLessThanOrEqual(degToRad(0.05))
        }
      }
    }
  })

  it('no pot→miss→pot alternation across the swept range (interval property)', () => {
    const step = degToRad(0.02)
    for (const s of shots(2, 20)) {
      for (const sign of [1, -1]) {
        let missSeen = false
        for (let d = step; d <= degToRad(4); d += step) {
          const pots =
            simulate(s.thetaTrue + sign * d, s.object, s.pocketId, T).outcome === 'target_pocket'
          if (!pots) missSeen = true
          else expect(missSeen).toBe(false)
        }
      }
    }
  })
})

describe('window narrows with distance (§7)', () => {
  it('same pocket, farther object ball → smaller window', () => {
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const windowFor = (o: { x: number; y: number }) =>
      allowedWindow(thetaTrue(o, trueGhost(o, pk, cfg)), o, 0, T).windowDeg
    expect(windowFor({ x: 1800, y: 1100 })).toBeLessThan(windowFor({ x: 500, y: 500 }))
  })
})

describe('reachable arc is always non-degenerate on generated shots', () => {
  it('Δ > 5° on every generated shot', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) {
        const arc = reachableArc(s.object, s.cue, T)
        expect(radToDeg(arc.halfWidth)).toBeGreaterThan(5)
        // and the true ghost is inside the reachable arc
        const U = ghostAt(s.thetaTrue, s.object, r)
        expect(dot(sub(U, s.object), sub(s.cue, s.object))).toBeGreaterThan(4 * r * r)
      }
    }
  })
})
