import {
  clamp,
  computeResult,
  cutAngle,
  DEFAULT_TABLE,
  type FullResult,
  GENERATOR_VERSION,
  generateShot,
  ghostAt,
  type LevelId,
  nudge,
  placeFromDrag,
  radToDeg,
  type Shot,
} from './core'
import { TopDownView } from './debug/topdown'
import { buildFeedback } from './ui/feedback'
import { buildHud, updateChip } from './ui/hud'
import { loadSettings, loadStats, recordAttempt, saveSettings, suggestLevelUp } from './ui/storage'
import { Store } from './ui/store'

// App wiring (PLAN.md §3). M1b: the top-down renderer is the interim main view; the 3D
// scene takes over in M2 and this view moves behind ?debug=1 + the result mini-map.

const table = DEFAULT_TABLE

interface UrlParams {
  seed: number | null
  level: LevelId | null
  gv: number | null
  debug: boolean
}

function parseUrl(): UrlParams {
  const q = new URLSearchParams(location.search)
  const seedRaw = q.get('seed')
  const levelRaw = q.get('level')
  const gvRaw = q.get('gv')
  const seed = seedRaw !== null && /^\d+$/.test(seedRaw) ? Number(seedRaw) >>> 0 : null
  const levelNum = levelRaw !== null ? Number(levelRaw) : null
  const level = levelNum === 1 || levelNum === 2 || levelNum === 3 ? (levelNum as LevelId) : null
  const gv = gvRaw !== null && /^\d+$/.test(gvRaw) ? Number(gvRaw) : null
  return { seed, level, gv, debug: q.get('debug') === '1' }
}

function updateUrl(shot: Shot): void {
  const q = new URLSearchParams(location.search)
  q.set('seed', String(shot.seed))
  q.set('level', String(shot.level))
  q.set('gv', String(shot.gv))
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`)
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

function freshShot(level: LevelId, seed = randomSeed()): Shot {
  return generateShot(seed, level, table)
}

function toast(message: string, actions?: Array<{ label: string; onClick: () => void }>): void {
  const t = document.createElement('div')
  t.className = 'toast'
  const span = document.createElement('span')
  span.textContent = message
  t.append(span)
  for (const a of actions ?? []) {
    const btn = document.createElement('button')
    btn.className = 'pill'
    btn.textContent = a.label
    btn.addEventListener('click', () => {
      a.onClick()
      t.remove()
    })
    t.append(btn)
  }
  document.body.append(t)
  if (!actions?.length) setTimeout(() => t.remove(), 4000)
}

function boot(): void {
  const app = document.getElementById('app')
  if (!app) throw new Error('no #app')
  app.innerHTML = ''

  const params = parseUrl()
  const settings = loadSettings()
  const level = params.level ?? settings.level

  let shot: Shot
  if (params.seed !== null && params.gv !== null && params.gv !== GENERATOR_VERSION) {
    toast('That shot link is from an older version — generated a fresh shot instead.')
    shot = freshShot(level)
  } else {
    shot = freshShot(level, params.seed ?? randomSeed())
  }

  const store = new Store({
    phase: 'aiming',
    stance: 'standing',
    shot,
    theta: shot.thetaTrue, // replaced by the jittered spawn below
    result: null,
    level,
    assisted: false,
    peeking: false,
    stats: loadStats(),
    settings,
  })

  // Ghost spawns on the arc at the straight-through angle jittered ±15–30° (§1 core loop):
  // never a cold start, never leaking the answer.
  const spawnTheta = (s: Shot): number => {
    const jitterMag = (15 + 15 * seededFrac(s.seed)) * (Math.PI / 180)
    const sign = seededFrac(s.seed ^ 0x5bd1e995) < 0.5 ? -1 : 1
    return placeFromDrag(
      ghostAt(s.thetaTrue + sign * jitterMag, s.object, table.cfg.ballRadiusMm),
      s.object,
      s.cue,
      s.thetaTrue,
      table,
    )
  }
  store.set({ theta: spawnTheta(shot) })
  updateUrl(shot)

  // layout: canvas fills the viewport behind the HUD
  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'canvas-wrap'
  const canvas = document.createElement('canvas')
  canvas.className = 'main-canvas'
  canvasWrap.append(canvas)
  app.append(canvasWrap)

  const view = new TopDownView(canvas, table, {
    interactive: true,
    onDrag: (p) => {
      const s = store.get()
      if (s.phase !== 'aiming') return
      store.set({ theta: placeFromDrag(p, s.shot.object, s.shot.cue, s.theta, table) })
    },
  })

  const resize = (): void => {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    view.resize(canvasWrap.clientWidth, canvasWrap.clientHeight, dpr)
    view.render(store.get())
  }
  window.addEventListener('resize', resize)

  const feedback = buildFeedback(app)

  // screen-space nudge sign with hysteresis (§4.7)
  let lastNudgeSign = 1
  const resolveNudgeSign = (arrow: 'left' | 'right'): number => {
    const tangentX = view.nudgeTangentScreenX(store.get().theta)
    let sign: number
    if (Math.abs(tangentX) < 0.15) {
      sign = lastNudgeSign // degenerate projection — hysteresis holds the last mapping
    } else {
      sign = tangentX > 0 ? 1 : -1
    }
    lastNudgeSign = sign
    return arrow === 'right' ? sign : -sign
  }

  const submit = (): void => {
    const s = store.get()
    if (s.phase !== 'aiming') return
    const result: FullResult = computeResult(
      {
        thetaUser: s.theta,
        cue: s.shot.cue,
        object: s.shot.object,
        targetPocketId: s.shot.pocketId,
      },
      table,
    )
    const stats = recordAttempt(s.stats, s.level, {
      errDeg: result.thetaErrorDeg,
      band: result.band,
      potted: result.potted,
      assisted: s.assisted,
      difficultyRaw: s.shot.difficultyRaw,
    })
    store.set({ phase: 'result', result, stats })
    feedback.show(result, null)
    maybeSuggestLevelUp()
  }

  const nextShot = (level2 = store.get().level, seed = randomSeed()): void => {
    const s2 = freshShot(level2, seed)
    feedback.hide()
    store.set({
      phase: 'aiming',
      shot: s2,
      theta: spawnTheta(s2),
      result: null,
      assisted: false,
      peeking: false,
      level: level2,
    })
    updateUrl(s2)
  }

  let levelToastShown = false
  const maybeSuggestLevelUp = (): void => {
    const s = store.get()
    if (levelToastShown || !suggestLevelUp(s.stats, s.level)) return
    levelToastShown = true
    const nextLevel = (s.level + 1) as LevelId
    toast("You're potting everything — try the next level?", [
      { label: 'Switch', onClick: () => nextShot(nextLevel) },
      { label: 'Stay', onClick: () => undefined },
    ])
  }

  const hud = buildHud(app, store, {
    onNudge: (arrow, step) => {
      const s = store.get()
      if (s.phase !== 'aiming') return false
      const signed = resolveNudgeSign(arrow) * step
      const res = nudge(s.theta, signed, s.shot.object, s.shot.cue, table)
      store.set({ theta: res.theta })
      return res.atLimit
    },
    onSubmit: submit,
    onNext: () => nextShot(),
    onRetry: () => {
      const s = store.get()
      feedback.hide()
      // same shot, flagged assisted — excluded from streaks/averages (§5)
      store.set({ phase: 'aiming', result: null, assisted: true, theta: spawnTheta(s.shot) })
    },
    onPeek: (active) => {
      const s = store.get()
      if (active && s.phase === 'aiming') {
        store.set({ peeking: true, assisted: true })
      } else if (s.peeking) {
        store.set({ peeking: false })
      }
    },
    onStance: (stance) => store.set({ stance }),
    onLevel: (lvl) => {
      const s = store.get()
      const nextSettings = { ...s.settings, level: lvl }
      saveSettings(nextSettings)
      store.set({ settings: nextSettings })
      nextShot(lvl)
    },
  })

  feedback.onNext = () => nextShot()
  feedback.onRetry = () => {
    const s = store.get()
    feedback.hide()
    store.set({ phase: 'aiming', result: null, assisted: true, theta: spawnTheta(s.shot) })
  }

  // reactive render + chip
  store.subscribe((state) => {
    view.render(state)
    const u = ghostAt(state.theta, state.shot.object, table.cfg.ballRadiusMm)
    const phi = cutAngle(state.shot.cue, u, state.shot.object)
    if (state.settings.contactChip) {
      updateChip(hud.chip, 1 - Math.sin(phi), radToDeg(phi))
    }
    const seedChip = document.getElementById('seed-chip')
    if (seedChip) seedChip.textContent = `#${state.shot.seed}`
  })

  resize()
  store.set({}) // trigger initial render + chip
}

// Deterministic per-seed fraction for the spawn jitter (not gameplay-critical randomness).
function seededFrac(seed: number): number {
  let a = seed >>> 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

boot()
