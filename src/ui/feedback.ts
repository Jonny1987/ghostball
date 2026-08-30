import type { FullResult } from '../core'
import { formatErrorLine, formatWindowLine } from './hud'

// Result panel (PLAN.md §5). M1b ships the textual core; M5 layers count-ups, the
// near-overlap inset callout, and tap-to-explain popovers on top of the same structure.

const BAND_LABEL: Record<string, string> = {
  perfect: 'Perfect',
  excellent: 'Excellent',
  good: 'Good',
  close: 'Close',
  miss: 'Miss',
}

export interface FeedbackPanel {
  root: HTMLElement
  show: (result: FullResult, miniMap: HTMLElement | null) => void
  hide: () => void
  onNext: (() => void) | null
  onRetry: (() => void) | null
}

export function buildFeedback(container: HTMLElement): FeedbackPanel {
  const root = document.createElement('div')
  root.className = 'result-panel'
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'shot result')
  container.append(root)

  const panel: FeedbackPanel = {
    root,
    onNext: null,
    onRetry: null,
    show(result, miniMap) {
      root.innerHTML = ''
      root.hidden = false

      const headline = document.createElement('div')
      headline.className = `result-headline ${result.potted ? 'potted' : 'missed'}`
      headline.textContent = headlineText(result)
      root.append(headline)

      const band = document.createElement('div')
      band.className = `result-band band-${result.band}`
      band.textContent = `${BAND_LABEL[result.band] ?? result.band} — ${formatErrorLine(
        result.positionErrorMm,
        result.overcut,
      )}`
      root.append(band)

      const rows = document.createElement('div')
      rows.className = 'result-rows'
      const row = (label: string, value: string): void => {
        const div = document.createElement('div')
        div.className = 'result-row'
        const l = document.createElement('span')
        l.textContent = label
        const v = document.createElement('span')
        v.textContent = value
        div.append(l, v)
        rows.append(div)
      }
      row('ghost position', `${result.positionErrorMm.toFixed(1)} mm from perfect`)
      row('direction', `${result.thetaErrorDeg.toFixed(2)}° off the pot line`)
      // v2: judging the touching distance is part of the skill
      const rad = result.radialErrorMm
      if (Math.abs(rad) < 0.3) {
        row('touch', 'touching the object ball ✓')
      } else if (rad > 0) {
        row('touch', `${rad.toFixed(1)} mm short — not touching`)
      } else {
        row('touch', `${(-rad).toFixed(1)} mm overlapping the object ball`)
      }
      row(
        'cut angle',
        `${result.cutAngleUserDeg.toFixed(1)}° (true ${result.cutAngleTrueDeg.toFixed(1)}°)`,
      )
      if (result.potted && result.marginMm !== null) {
        row('margin', `${result.marginMm.toFixed(1)} mm inside the jaws`)
      } else if (result.missMm !== null && result.missMm > 0) {
        row('missed by', `${result.missMm.toFixed(1)} mm`)
      }
      if (result.positionErrorMm <= 1.5) {
        // near-overlap: the truth renders as an outline ring; the exact gap lives here (§5)
        row('gap to perfect', `${result.positionErrorMm.toFixed(2)} mm (truth = cyan ring)`)
      }
      root.append(rows)

      const windowLine = document.createElement('div')
      windowLine.className = 'result-window'
      windowLine.textContent = formatWindowLine(
        result.windowPlusDeg,
        result.windowMinusDeg,
        result.thetaErrorDeg,
      )
      root.append(windowLine)

      // band-vs-outcome disagreement one-liner (§2.7) — the key distance-sensitivity lesson
      const goodBands =
        result.band === 'perfect' || result.band === 'excellent' || result.band === 'good'
      if (goodBands && !result.potted) {
        const note = document.createElement('div')
        note.className = 'result-note'
        note.textContent = `${BAND_LABEL[result.band]} placement — but this shot needed better: the pocket only forgave ±${Math.min(result.windowPlusDeg, result.windowMinusDeg).toFixed(1)}° at this distance.`
        root.append(note)
      } else if (!goodBands && result.potted) {
        const note = document.createElement('div')
        note.className = 'result-note'
        note.textContent = 'A forgiving pocket bailed that one out — the contact was well off.'
        root.append(note)
      }

      if (miniMap) {
        miniMap.classList.add('mini-map')
        root.append(miniMap)
      }

      const buttons = document.createElement('div')
      buttons.className = 'result-buttons'
      const retry = document.createElement('button')
      retry.className = 'pill retry-btn'
      retry.textContent = 'RETRY (assisted)'
      retry.addEventListener('click', () => panel.onRetry?.())
      const next = document.createElement('button')
      next.className = 'submit-btn next-btn'
      next.textContent = 'NEXT SHOT'
      next.addEventListener('click', () => panel.onNext?.())
      buttons.append(retry, next)
      root.append(buttons)

      // screen-reader announcement (§5)
      root.setAttribute('aria-live', 'polite')
    },
    hide() {
      root.hidden = true
    },
  }
  return panel
}

function headlineText(result: FullResult): string {
  if (result.potted) return '● POTTED'
  switch (result.outcome) {
    case 'wrong_pocket':
      return `○ WRONG POCKET — it dropped in pocket ${result.wrongPocketId}`
    case 'cushion':
      return result.sim.detail === 'rattled'
        ? '○ RATTLED THE JAWS — no drop'
        : '○ MISSED — hit the cushion'
    case 'whiff':
      return '○ WHIFF — the cue ball misses the object ball entirely'
    default:
      return '○ MISSED'
  }
}
