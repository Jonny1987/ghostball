import { COARSE_STEP_MM, FINE_STEP_MM, fullnessBand, radToDeg } from '../core'
import type { PlacementMode, Settings } from './storage'
import type { Store } from './store'

// HUD per PLAN.md §5: bottom bar ◀ SUBMIT ▶, contact chip, hold-to-peek, top bar.
// Nudge behaviour per §2.6: tap 0.25°, hold repeats 15/s after 350 ms, escalating to 1.0°
// after 1.2 s; release resets to fine. Every step gets a visual tick + optional haptic.

const HOLD_DELAY_MS = 350
const REPEAT_MS = 1000 / 15
const ESCALATE_MS = 1200

export type NudgeDir = 'left' | 'right' | 'up' | 'down'

export interface HudCallbacks {
  onNudge: (dir: NudgeDir, stepMm: number) => boolean // returns atLimit
  onSubmit: () => void
  onNext: () => void
  onRetry: () => void
  onPeek: (active: boolean) => void
  onStance: (stance: 'standing' | 'down') => void
  onLevel: (level: 1 | 2 | 3) => void
  onSetting: (patch: Partial<Settings>) => void
}

export interface HudElements {
  root: HTMLElement
  chip: HTMLElement
  streak: HTMLElement
  levelPill: HTMLElement
  stanceControl: HTMLElement
  arrowLeft: HTMLButtonElement
  arrowRight: HTMLButtonElement
  arrowUp: HTMLButtonElement
  arrowDown: HTMLButtonElement
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
  const gear = el('button', 'pill settings-btn', '⚙')
  gear.setAttribute('aria-label', 'settings')
  top.append(levelPill, streak, seedChip, gear)

  // settings popup (v2.6): per-stance ghost-ball visibility
  const backdrop = el('div', 'settings-backdrop')
  backdrop.hidden = true
  const settingsPop = el('div', 'settings-popup')
  settingsPop.hidden = true
  settingsPop.setAttribute('role', 'dialog')
  settingsPop.setAttribute('aria-label', 'settings')
  const settingRow = (label: string): { row: HTMLLabelElement; input: HTMLInputElement } => {
    const row = el('label', 'settings-row')
    const input = document.createElement('input')
    input.type = 'checkbox'
    row.append(input, el('span', '', label))
    return { row, input }
  }
  const ghostStandingRow = settingRow('Show when standing')
  const ghostDownRow = settingRow('Show when down')
  const glassRow = settingRow('Semi-transparent')
  // Placement restriction: mutually exclusive drill geometries in one dropdown (v2.9)
  const placementRow = el('label', 'settings-row settings-select-row')
  const placementSelect = document.createElement('select')
  placementSelect.className = 'settings-select'
  for (const [value, label] of [
    ['anywhere', 'Anywhere'],
    ['perpendicular', 'Perpendicular'],
    ['touching', 'Touching'],
  ] as const) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = label
    placementSelect.append(opt)
  }
  placementRow.append(el('span', '', 'Placement restriction'), placementSelect)
  settingsPop.append(
    el('div', 'settings-title', 'Ghost ball'),
    ghostStandingRow.row,
    ghostDownRow.row,
    glassRow.row,
    el('div', 'settings-title', 'Drill'),
    placementRow,
  )
  ghostStandingRow.input.checked = store.get().settings.ghostStanding
  ghostDownRow.input.checked = store.get().settings.ghostDown
  glassRow.input.checked = store.get().settings.ghostTransparent
  placementSelect.value = store.get().settings.placement
  const closeSettings = (): void => {
    settingsPop.hidden = true
    backdrop.hidden = true
  }
  gear.addEventListener('click', () => {
    settingsPop.hidden = !settingsPop.hidden
    backdrop.hidden = settingsPop.hidden
  })
  backdrop.addEventListener('click', closeSettings)
  ghostStandingRow.input.addEventListener('change', () =>
    cb.onSetting({ ghostStanding: ghostStandingRow.input.checked }),
  )
  ghostDownRow.input.addEventListener('change', () =>
    cb.onSetting({ ghostDown: ghostDownRow.input.checked }),
  )
  glassRow.input.addEventListener('change', () =>
    cb.onSetting({ ghostTransparent: glassRow.input.checked }),
  )
  placementSelect.addEventListener('change', () =>
    cb.onSetting({ placement: placementSelect.value as PlacementMode }),
  )

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

  // vertical nudge pair (screen up/down), floating above the bottom bar's right side (v2)
  const vertical = el('div', 'nudge-vertical')
  const arrowUp = el('button', 'arrow-btn arrow-small', '▲')
  arrowUp.setAttribute('aria-label', 'nudge ghost ball up')
  const arrowDown = el('button', 'arrow-btn arrow-small', '▼')
  arrowDown.setAttribute('aria-label', 'nudge ghost ball down')
  vertical.append(arrowUp, arrowDown)
  vertical.hidden = store.get().settings.placement === 'perpendicular'

  // bottom bar
  const bottom = el('div', 'hud-bottom')
  const arrowLeft = el('button', 'arrow-btn', '◀')
  arrowLeft.setAttribute('aria-label', 'nudge ghost ball left')
  const submit = el('button', 'submit-btn', 'SUBMIT')
  const arrowRight = el('button', 'arrow-btn', '▶')
  arrowRight.setAttribute('aria-label', 'nudge ghost ball right')
  bottom.append(arrowLeft, submit, arrowRight)

  root.append(top, stanceControl, chipRow, vertical, bottom, backdrop, settingsPop)
  container.append(root)

  bindArrow(arrowLeft, 'left', store, cb)
  bindArrow(arrowRight, 'right', store, cb)
  bindArrow(arrowUp, 'up', store, cb)
  bindArrow(arrowDown, 'down', store, cb)
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
    const keyDirs: Record<string, NudgeDir> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    }
    const keyDir = keyDirs[ev.key]
    if (keyDir) {
      ev.preventDefault()
      if (state.phase !== 'aiming') return
      cb.onNudge(keyDir, ev.shiftKey ? COARSE_STEP_MM : FINE_STEP_MM)
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
    } else if (ev.key === 'Escape') {
      closeSettings()
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
    ghostStandingRow.input.checked = state.settings.ghostStanding
    ghostDownRow.input.checked = state.settings.ghostDown
    glassRow.input.checked = state.settings.ghostTransparent
    placementSelect.value = state.settings.placement
    // perpendicular: only along-the-line movement exists — the ▲▼ pair is meaningless
    vertical.hidden = state.settings.placement === 'perpendicular'
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
    arrowUp.disabled = !aiming
    arrowDown.disabled = !aiming
    vertical.style.visibility = aiming ? 'visible' : 'hidden'
    peek.style.visibility = aiming ? 'visible' : 'hidden'
  })

  return {
    root,
    chip,
    streak,
    levelPill,
    stanceControl,
    arrowLeft,
    arrowRight,
    arrowUp,
    arrowDown,
    submit,
    peek,
  }
}

function currentStreak(store: Store): number {
  const s = store.get()
  return s.stats[String(s.level)]?.streakCurrent ?? 0
}

// Contact chip (v2): fullness % · band · cut° from the EFFECTIVE contact, plus a
// gap/overlap segment when the placed ghost isn't touching the object ball. A null
// fullness means the aim line misses the ball entirely.
export function updateChip(
  chip: HTMLElement,
  fullness: number | null,
  cutDeg: number | null,
  radialMm: number,
): void {
  const touch =
    Math.abs(radialMm) < 0.3
      ? ''
      : radialMm > 0
        ? ` · gap ${radialMm.toFixed(1)} mm`
        : ` · overlap ${(-radialMm).toFixed(1)} mm`
  if (fullness === null || cutDeg === null) {
    chip.textContent = `no contact — aim misses the ball${touch}`
    return
  }
  const pct = (fullness * 100).toFixed(1)
  chip.textContent = `${pct} % · ${fullnessBand(fullness)} · ${cutDeg.toFixed(1)}°${touch}`
}

function bindArrow(btn: HTMLButtonElement, dir: NudgeDir, store: Store, cb: HudCallbacks): void {
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let repeatTimer: ReturnType<typeof setInterval> | null = null
  let heldSince = 0

  const doStep = (): void => {
    if (store.get().phase !== 'aiming') {
      stop() // phase changed mid-hold (e.g. submit via keyboard) — kill the repeat
      return
    }
    const elapsed = heldSince > 0 ? performance.now() - heldSince : 0
    const step = elapsed >= ESCALATE_MS ? COARSE_STEP_MM : FINE_STEP_MM
    const atLimit = cb.onNudge(dir, step)
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

export function formatErrorLine(positionErrorMm: number, overcut: boolean): string {
  const dir = overcut ? 'aimed too thin' : 'aimed too full'
  return `${positionErrorMm.toFixed(1)} mm from perfect — ${dir}`
}

export function degLabel(rad: number): string {
  return `${radToDeg(rad).toFixed(2)}°`
}
