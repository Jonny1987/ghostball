import {
  clamp,
  computeResult,
  cutAngle,
  DEFAULT_TABLE,
  effectiveContact,
  type FullResult,
  GENERATOR_VERSION,
  generateShot,
  ghostAt,
  type LevelId,
  nudgePos,
  radToDeg,
  type Shot,
  spawnTheta,
  type Vec2,
} from './core'
import { TopDownView } from './debug/topdown'
import { Scene3D } from './scene/scene'
import { buildFeedback } from './ui/feedback'
import { buildHud, type NudgeDir, updateChip } from './ui/hud'
import { loadSettings, loadStats, recordAttempt, saveSettings, suggestLevelUp } from './ui/storage'
import { Store } from './ui/store'

// App wiring (PLAN.md §3, v2 placement per docs/decisions.md): store ⇄ scene ⇄ hud; the
// submit state machine AIMING → LOCKED (150 ms) → REVEAL → ANIMATING (tap skips) →
// RESULT; ?seed= parsing. The guess is a free 2D ghost position — overlap and gaps
// allowed — and the verdict comes from the physically-resolved effective contact.

const table = DEFAULT_TABLE
const LOCKED_MS = 150
const REVEAL_MS = 650
const SWIPE_MM_PER_PX = 0.15 // relative swipe sensitivity, both stances (v2.3)

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

// Ghost spawns touching at the jittered straight-through angle (§1): a neutral full-ball
// starting guess that leaks nothing about the answer; the user moves it freely from there.
function spawnPos(s: Shot): Vec2 {
  return ghostAt(spawnTheta(s, table), s.object, table.cfg.ballRadiusMm)
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
    ghost: spawnPos(shot),
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

  const scene = new Scene3D(canvas, canvasWrap, table, {
    onSwipe: (dxPx, dyPx) => {
      const s = store.get()
      if (s.phase !== 'aiming') return
      const dirs = scene.screenDirs()
      const delta = {
        x: (dirs.right.x * dxPx - dirs.up.x * dyPx) * SWIPE_MM_PER_PX,
        y: (dirs.right.y * dxPx - dirs.up.y * dyPx) * SWIPE_MM_PER_PX,
      }
      store.set({ ghost: nudgePos(s.ghost, delta, s.shot.object, table).pos })
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
  let submitTimers: Array<ReturnType<typeof setTimeout>> = []
  const cancelSubmitPipeline = (): void => {
    for (const t of submitTimers) clearTimeout(t)
    submitTimers = []
    scene.cancelAnimation()
  }
  const submit = (): void => {
    const s = store.get()
    if (s.phase !== 'aiming') return
    const result: FullResult = computeResult(
      {
        ghostPos: s.ghost,
        cue: s.shot.cue,
        object: s.shot.object,
        targetPocketId: s.shot.pocketId,
      },
      table,
    )
    const stats = recordAttempt(s.stats, s.level, {
      errMm: result.positionErrorMm,
      band: result.band,
      potted: result.potted,
      assisted: s.assisted,
      difficultyRaw: s.shot.difficultyRaw,
    })
    store.set({ phase: 'locked', result, stats })
    submitTimers.push(
      setTimeout(() => {
        store.set({ phase: 'reveal' })
        submitTimers.push(
          setTimeout(
            () => {
              store.set({ phase: 'animating' })
              scene.runSubmit(result, reducedMotion, () => {
                store.set({ phase: 'result' })
                showResult(result)
              })
            },
            reducedMotion ? 0 : REVEAL_MS,
          ),
        )
      }, LOCKED_MS),
    )
  }

  const showResult = (result: FullResult): void => {
    miniMap.resize(352, 186, clamp(window.devicePixelRatio || 1, 1, 2))
    feedback.show(result, miniMapCanvas)
    miniMap.render(store.get())
    maybeSuggestLevelUp()
  }

  const nextShot = (lvl = store.get().level, seed = randomSeed()): void => {
    cancelSubmitPipeline() // a stale LOCKED/REVEAL/ANIMATING pipeline must never replay (§3)
    const s2 = generateShot(seed, lvl, table)
    feedback.hide()
    store.set({
      phase: 'aiming',
      shot: s2,
      ghost: spawnPos(s2),
      result: null,
      assisted: false,
      peeking: false,
      level: lvl,
    })
    updateUrl(s2)
  }

  const retry = (): void => {
    cancelSubmitPipeline()
    const s = store.get()
    feedback.hide()
    // same shot, flagged assisted — excluded from streaks/averages (§5)
    store.set({ phase: 'aiming', result: null, assisted: true, ghost: spawnPos(s.shot) })
  }

  let levelToastShown = false
  const maybeSuggestLevelUp = (): void => {
    const s = store.get()
    if (levelToastShown || !suggestLevelUp(s.stats, s.level)) return
    levelToastShown = true
    const nextLevel = (s.level + 1) as LevelId
    toast("You're potting everything — try the next level?", [
      {
        label: 'Switch',
        onClick: () => {
          const phase = store.get().phase
          if (phase === 'aiming' || phase === 'result') nextShot(nextLevel)
        },
      },
      { label: 'Stay', onClick: () => undefined },
    ])
  }

  const nudgeDelta = (dir: NudgeDir, stepMm: number): Vec2 => {
    const dirs = scene.screenDirs()
    switch (dir) {
      case 'left':
        return { x: -dirs.right.x * stepMm, y: -dirs.right.y * stepMm }
      case 'right':
        return { x: dirs.right.x * stepMm, y: dirs.right.y * stepMm }
      case 'up':
        return { x: dirs.up.x * stepMm, y: dirs.up.y * stepMm }
      case 'down':
        return { x: -dirs.up.x * stepMm, y: -dirs.up.y * stepMm }
      default:
        return { x: 0, y: 0 }
    }
  }

  const hud = buildHud(app, store, {
    onNudge: (dir, stepMm) => {
      const s = store.get()
      if (s.phase !== 'aiming') return false
      const res = nudgePos(s.ghost, nudgeDelta(dir, stepMm), s.shot.object, table)
      store.set({ ghost: res.pos })
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
      if (s.phase !== 'aiming' && s.phase !== 'result') return // no level change mid-submit
      const nextSettings = { ...s.settings, level: lvl }
      saveSettings(nextSettings)
      store.set({ settings: nextSettings })
      nextShot(lvl)
    },
    onSetting: (patch) => {
      const s = store.get()
      const nextSettings = { ...s.settings, ...patch }
      saveSettings(nextSettings)
      store.set({ settings: nextSettings })
    },
  })

  feedback.onNext = () => nextShot()
  feedback.onRetry = retry

  store.subscribe((state, prev) => {
    scene.update(state, prev)
    debugView?.render(state)
    if (state.settings.contactChip) {
      const r = table.cfg.ballRadiusMm
      const eff = effectiveContact(state.shot.cue, state.ghost, state.shot.object, r)
      const centerDist = Math.hypot(
        state.ghost.x - state.shot.object.x,
        state.ghost.y - state.shot.object.y,
      )
      const radialMm = centerDist - 2 * r
      if (eff) {
        const phi = cutAngle(
          state.shot.cue,
          ghostAt(eff.theta, state.shot.object, r),
          state.shot.object,
        )
        updateChip(hud.chip, 1 - Math.sin(phi), radToDeg(phi), radialMm)
      } else {
        updateChip(hud.chip, null, null, radialMm)
      }
    }
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
