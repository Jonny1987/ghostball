import { COARSE_STEP, FINE_STEP, fullnessBand, radToDeg } from '../core'
import type { Store } from './store'

// HUD per PLAN.md §5: bottom bar ◀ SUBMIT ▶, contact chip, hold-to-peek, top bar.
// Nudge behaviour per §2.6: tap 0.25°, hold repeats 15/s after 350 ms, escalating to 1.0°
// after 1.2 s; release resets to fine. Every step gets a visual tick + optional haptic.

const HOLD_DELAY_MS = 350
const REPEAT_MS = 1000 / 15
const ESCALATE_MS = 1200

export interface HudCallbacks {
  onNudge: (arrow: 'left' | 'right', step: number) => boolean // returns atLimit
  onSubmit: () => void
  onNext: () => void
  onRetry: () => void
  onPeek: (active: boolean) => void
  onStance: (stance: 'standing' | 'down') => void
  onLevel: (level: 1 | 2 | 3) => void
}

export interface HudElements {
  root: HTMLElement
  chip: HTMLElement
  streak: HTMLElement
  levelPill: HTMLElement
  stanceControl: HTMLElement
  arrowLeft: HTMLButtonElement
  arrowRight: HTMLButtonElement
  submit: HTMLButtonElement
  peek: HTMLButtonElement
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  if (text) e.textContent = text
  return e
}

export function buildHud(container: HTMLElement, store: Store, cb: HudCallbacks): HudElements {
  const root = el('div', 'hud')

  // top bar
  const top = el('div', 'hud-top')
  const levelPill = el('button', 'pill level-pill', 'Club')
  levelPill.setAttribute('aria-label', 'difficulty level — tap to change')
  const streak = el('div', 'pill streak-chip', 'streak 0')
  const seedChip = el('div', 'pill seed-chip', '')
  seedChip.id = 'seed-chip'
  top.append(levelPill, streak, seedChip)

  // stance control
  const stanceControl = el('div', 'stance-control')
  const standingBtn = el('button', 'stance-btn active', 'Standing')
  const downBtn = el('button', 'stance-btn', 'Down')
  stanceControl.append(standingBtn, downBtn)
  standingBtn.addEventListener('click', () => cb.onStance('standing'))
  downBtn.addEventListener('click', () => cb.onStance('down'))

  // floating chip + peek
  const chipRow = el('div', 'chip-row')
  const chip = el('div', 'pill contact-chip', '')
  const peek = el('button', 'pill peek-btn', 'hold to peek')
  peek.setAttribute('aria-label', 'hold to reveal the true ghost ball (marks the attempt assisted)')
  chipRow.append(chip, peek)

  // bottom bar
  const bottom = el('div', 'hud-bottom')
  const arrowLeft = el('button', 'arrow-btn', '◀')
  arrowLeft.setAttribute('aria-label', 'nudge ghost ball left')
  const submit = el('button', 'submit-btn', 'SUBMIT')
  const arrowRight = el('button', 'arrow-btn', '▶')
  arrowRight.setAttribute('aria-label', 'nudge ghost ball right')
  bottom.append(arrowLeft, submit, arrowRight)

  root.append(top, stanceControl, chipRow, bottom)
  container.append(root)

  bindArrow(arrowLeft, 'left', store, cb)
  bindArrow(arrowRight, 'right', store, cb)
  submit.addEventListener('click', () => {
    const phase = store.get().phase
    if (phase === 'aiming') cb.onSubmit()
    else if (phase === 'result') cb.onNext()
  })

  const peekStart = (ev: Event): void => {
    ev.preventDefault()
    if (store.get().phase === 'aiming') cb.onPeek(true)
  }
  const peekEnd = (): void => cb.onPeek(false)
  peek.addEventListener('pointerdown', peekStart)
  peek.addEventListener('pointerup', peekEnd)
  peek.addEventListener('pointercancel', peekEnd)
  peek.addEventListener('pointerleave', peekEnd)
  peek.addEventListener('keydown', (ev) => {
    if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) peekStart(ev)
  })
  peek.addEventListener('keyup', (ev) => {
    if (ev.key === ' ' || ev.key === 'Enter') peekEnd()
  })
  peek.addEventListener('click', (ev) => ev.preventDefault())

  levelPill.addEventListener('click', () => {
    const cur = store.get().level
    const next = (cur === 3 ? 1 : cur + 1) as 1 | 2 | 3
    cb.onLevel(next)
  })

  // keyboard: ←/→ fine, Shift+←/→ coarse, Enter submit/next, S stance, N next, R retry (§5)
  window.addEventListener('keydown', (ev) => {
    const state = store.get()
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault()
      if (state.phase !== 'aiming') return
      const arrow = ev.key === 'ArrowLeft' ? 'left' : 'right'
      cb.onNudge(arrow, ev.shiftKey ? COARSE_STEP : FINE_STEP)
    } else if (ev.key === 'Enter') {
      if (ev.repeat) return // key auto-repeat must not chain next-shot → instant submit
      if (ev.target instanceof HTMLButtonElement) return // native click will handle it
      ev.preventDefault()
      if (state.phase === 'aiming') cb.onSubmit()
      else if (state.phase === 'result') cb.onNext()
    } else if (ev.key === 's' || ev.key === 'S') {
      cb.onStance(state.stance === 'standing' ? 'down' : 'standing')
    } else if (ev.key === 'n' || ev.key === 'N') {
      if (state.phase === 'result') cb.onNext()
    } else if (ev.key === 'r' || ev.key === 'R') {
      if (state.phase === 'result') cb.onRetry()
    }
  })

  // reactive updates
  let nextGuardUntil = 0
  store.subscribe((state, prev) => {
    if (state.phase === 'result' && prev.phase !== 'result') {
      nextGuardUntil = performance.now() + 350
      setTimeout(() => {
        submit.disabled = store.get().phase !== 'result' ? submit.disabled : false
      }, 360)
    }
    const fullness = state.result?.contactFullness
    void fullness
    streak.textContent = `streak ${currentStreak(store)}`
    levelPill.textContent = ['', 'Straight-ish', 'Club', 'Sharp'][state.level] ?? 'Club'
    standingBtn.classList.toggle('active', state.stance === 'standing')
    downBtn.classList.toggle('active', state.stance === 'down')
    submit.textContent = state.phase === 'result' ? 'NEXT' : 'SUBMIT'
    submit.disabled =
      state.phase === 'locked' ||
      state.phase === 'reveal' ||
      state.phase === 'animating' ||
      // brief guard on entering RESULT so a double-tap on SUBMIT can't instantly skip it
      (state.phase === 'result' && performance.now() < nextGuardUntil)
    const aiming = state.phase === 'aiming'
    arrowLeft.disabled = !aiming
    arrowRight.disabled = !aiming
    peek.style.visibility = aiming ? 'visible' : 'hidden'
  })

  return { root, chip, streak, levelPill, stanceControl, arrowLeft, arrowRight, submit, peek }
}

function currentStreak(store: Store): number {
  const s = store.get()
  return s.stats[String(s.level)]?.streakCurrent ?? 0
}

// Contact chip: fullness % · band · cut° (§4.9). Degrees carry thin-cut feedback (§2.6).
export function updateChip(chip: HTMLElement, fullness: number, cutDeg: number): void {
  const pct = (fullness * 100).toFixed(1)
  chip.textContent = `${pct} % · ${fullnessBand(fullness)} · ${cutDeg.toFixed(1)}°`
}

function bindArrow(
  btn: HTMLButtonElement,
  arrow: 'left' | 'right',
  store: Store,
  cb: HudCallbacks,
): void {
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let repeatTimer: ReturnType<typeof setInterval> | null = null
  let heldSince = 0

  const doStep = (): void => {
    if (store.get().phase !== 'aiming') {
      stop() // phase changed mid-hold (e.g. submit via keyboard) — kill the repeat
      return
    }
    const elapsed = heldSince > 0 ? performance.now() - heldSince : 0
    const step = elapsed >= ESCALATE_MS ? COARSE_STEP : FINE_STEP
    const atLimit = cb.onNudge(arrow, step)
    // per-step visual tick; limit bump gets a stronger flash (§2.6)
    btn.classList.remove('tick', 'bump')
    void btn.offsetWidth // restart the CSS animation
    btn.classList.add(atLimit ? 'bump' : 'tick')
    try {
      if (store.get().settings.haptics && 'vibrate' in navigator) {
        navigator.vibrate(atLimit ? [25, 30, 25] : 8)
      }
    } catch {
      // haptics unavailable — the visual tick carries the signal
    }
  }

  const stop = (): void => {
    if (holdTimer) clearTimeout(holdTimer)
    if (repeatTimer) clearInterval(repeatTimer)
    holdTimer = null
    repeatTimer = null
    heldSince = 0
  }

  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault()
    stop() // never orphan a previous press's timers
    btn.setPointerCapture(ev.pointerId)
    heldSince = performance.now()
    doStep()
    holdTimer = setTimeout(() => {
      repeatTimer = setInterval(doStep, REPEAT_MS)
    }, HOLD_DELAY_MS)
  })
  btn.addEventListener('pointerup', stop)
  btn.addEventListener('pointercancel', stop)
  btn.addEventListener('pointerleave', stop)
  window.addEventListener('blur', stop)
}

export function formatWindowLine(plusDeg: number, minusDeg: number, errDeg: number): string {
  const w = Math.min(plusDeg, minusDeg)
  return `the pocket forgave ±${w.toFixed(1)}° from here; you were ${errDeg.toFixed(1)}° off`
}

export function formatErrorLine(contactErrorMm: number, overcut: boolean): string {
  const dir = overcut ? 'too thin' : 'too full'
  return `${contactErrorMm.toFixed(1)} mm ${dir}`
}

export function degLabel(rad: number): string {
  return `${radToDeg(rad).toFixed(2)}°`
}
