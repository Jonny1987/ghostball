import {
  clamp,
  clampToReachable,
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
import { Scene3D } from './scene/scene'
import { buildFeedback } from './ui/feedback'
import { buildHud, updateChip } from './ui/hud'
import { loadSettings, loadStats, recordAttempt, saveSettings, suggestLevelUp } from './ui/storage'
import { Store } from './ui/store'

// App wiring (PLAN.md §3): store ⇄ scene ⇄ hud; the submit state machine
// AIMING → LOCKED (150 ms) → REVEAL → ANIMATING (tap skips) → RESULT; ?seed= parsing.
// The 3D scene is the main view; the top-down oracle renders behind ?debug=1 and as the
// RESULT mini-map (§2.12 — two independent projections of the same θ).

const table = DEFAULT_TABLE
const LOCKED_MS = 150
const REVEAL_MS = 650

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

// Deterministic per-seed fraction for the spawn jitter.
function seededFrac(seed: number): number {
  let a = seed >>> 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Ghost spawns pre-placed at the straight-through angle jittered ±15–30° (§1):
// no cold start, no answer leak.
function spawnTheta(s: Shot): number {
  const jitter = ((15 + 15 * seededFrac(s.seed)) * Math.PI) / 180
  const sign = seededFrac(s.seed ^ 0x5bd1e995) < 0.5 ? -1 : 1
  return clampToReachable(s.thetaTrue + sign * jitter, s.object, s.cue, table)
}

function boot(): void {
  const app = document.getElementById('app')
  if (!app) throw new Error('no #app')
  app.innerHTML = ''

  const params = parseUrl()
  const settings = loadSettings()
  const level = params.level ?? settings.level
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let shot: Shot
  if (params.seed !== null && params.gv !== null && params.gv !== GENERATOR_VERSION) {
    toast('That shot link is from an older version — generated a fresh shot instead.')
    shot = generateShot(randomSeed(), level, table)
  } else {
    shot = generateShot(params.seed ?? randomSeed(), level, table)
  }

  const store = new Store({
    phase: 'aiming',
    stance: 'standing',
    shot,
    theta: spawnTheta(shot),
    result: null,
    level,
    assisted: false,
    peeking: false,
    stats: loadStats(),
    settings,
  })
  updateUrl(shot)

  // layout: 3D canvas fills the viewport behind the HUD
  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'canvas-wrap'
  const canvas = document.createElement('canvas')
  canvas.className = 'main-canvas'
  canvasWrap.append(canvas)
  app.append(canvasWrap)

  let lastNudgeSign = 1
  const resolveTangentSign = (): number => {
    const tangentX = scene.nudgeTangentScreenX(store.get().theta)
    let sign: number
    if (Math.abs(tangentX) < 1.5) {
      sign = lastNudgeSign // degenerate projection — hysteresis holds the last mapping (§4.7)
    } else {
      sign = tangentX > 0 ? 1 : -1
    }
    lastNudgeSign = sign
    return sign
  }

  const scene = new Scene3D(canvas, canvasWrap, table, {
    onDragPoint: (p) => {
      const s = store.get()
      if (s.phase !== 'aiming') return
      store.set({ theta: placeFromDrag(p, s.shot.object, s.shot.cue, s.theta, table) })
    },
    onSwipe: (dTheta) => {
      const s = store.get()
      if (s.phase !== 'aiming') return
      // swipe sign follows the on-screen tangent, like the arrows (§4.7)
      const sign = resolveTangentSign()
      store.set({
        theta: clampToReachable(s.theta + sign * dTheta, s.shot.object, s.shot.cue, table),
      })
    },
  })

  // tap during playback skips the animation
  canvas.addEventListener('pointerdown', () => {
    if (store.get().phase === 'animating') scene.skipAnimation()
  })

  // ?debug=1: top-down oracle overlay; the same renderer class serves the result mini-map
  const debugCanvas = document.createElement('canvas')
  const miniMapCanvas = document.createElement('canvas')
  const miniMap = new TopDownView(miniMapCanvas, table, { interactive: false })
  let debugView: TopDownView | null = null
  if (params.debug) {
    debugCanvas.className = 'debug-topdown'
    app.append(debugCanvas)
    debugView = new TopDownView(debugCanvas, table, { interactive: false })
  }

  const feedback = buildFeedback(app)

  // submit state machine: AIMING → LOCKED → REVEAL → ANIMATING → RESULT (§3)
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
    store.set({ phase: 'locked', result, stats })
    setTimeout(() => {
      store.set({ phase: 'reveal' })
      setTimeout(
        () => {
          store.set({ phase: 'animating' })
          scene.runSubmit(result, reducedMotion, () => {
            store.set({ phase: 'result' })
            showResult(result)
          })
        },
        reducedMotion ? 0 : REVEAL_MS,
      )
    }, LOCKED_MS)
  }

  const showResult = (result: FullResult): void => {
    miniMap.resize(352, 186, clamp(window.devicePixelRatio || 1, 1, 2))
    feedback.show(result, miniMapCanvas)
    miniMap.render(store.get())
    maybeSuggestLevelUp()
  }

  const nextShot = (lvl = store.get().level, seed = randomSeed()): void => {
    const s2 = generateShot(seed, lvl, table)
    feedback.hide()
    store.set({
      phase: 'aiming',
      shot: s2,
      theta: spawnTheta(s2),
      result: null,
      assisted: false,
      peeking: false,
      level: lvl,
    })
    updateUrl(s2)
  }

  const retry = (): void => {
    const s = store.get()
    feedback.hide()
    // same shot, flagged assisted — excluded from streaks/averages (§5)
    store.set({ phase: 'aiming', result: null, assisted: true, theta: spawnTheta(s.shot) })
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
      const arrowSign = arrow === 'right' ? resolveTangentSign() : -resolveTangentSign()
      const res = nudge(s.theta, arrowSign * step, s.shot.object, s.shot.cue, table)
      store.set({ theta: res.theta })
      return res.atLimit
    },
    onSubmit: submit,
    onNext: () => nextShot(),
    onRetry: retry,
    onPeek: (active) => {
      const s = store.get()
      if (active && s.phase === 'aiming') store.set({ peeking: true, assisted: true })
      else if (s.peeking) store.set({ peeking: false })
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
  feedback.onRetry = retry

  store.subscribe((state, prev) => {
    scene.update(state, prev)
    debugView?.render(state)
    const u = ghostAt(state.theta, state.shot.object, table.cfg.ballRadiusMm)
    const phi = cutAngle(state.shot.cue, u, state.shot.object)
    if (state.settings.contactChip) updateChip(hud.chip, 1 - Math.sin(phi), radToDeg(phi))
    const seedChip = document.getElementById('seed-chip')
    if (seedChip) seedChip.textContent = `#${state.shot.seed}`
  })

  const resize = (): void => {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    scene.resize(canvasWrap.clientWidth, canvasWrap.clientHeight, dpr)
    if (debugView) {
      debugView.resize(
        Math.round(window.innerWidth * 0.4),
        Math.round(window.innerWidth * 0.22),
        dpr,
      )
      debugView.render(store.get())
    }
  }
  window.addEventListener('resize', resize)
  resize()
  scene.update(store.get(), null)
  store.set({}) // initial chip + renders
}

boot()
