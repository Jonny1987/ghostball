import {
  type FullResult,
  ghostAt,
  reachableArc,
  type Shot,
  type Table,
  trueGhost,
  unit,
  type Vec2,
} from '../core'
import type { AppState } from '../ui/store'

// Canvas-2D top-down renderer of core state (PLAN.md §3): the interim main view at M1b,
// the ?debug=1 oracle from M2, and the RESULT mini-map from M5. Renders purely from the
// store's state — an independent projection of the same θ the 3D scene shows (§2.12).

const RAIL = 110 // drawn wood border, mm
const COLORS = {
  felt: '#1e6b40',
  feltEdge: '#175232',
  rail: '#4a2f1b',
  pocket: '#0c0c0e',
  cushion: '#1a5c38',
  cue: '#f5f2e9',
  object: '#c33127',
  ghost: 'rgba(245, 242, 233, 0.55)',
  ghostTrue: '#4FC3F7',
  ghostUser: '#FFB74D',
  arc: 'rgba(245, 242, 233, 0.35)',
  target: '#ffd54f',
  aimLine: 'rgba(255, 213, 79, 0.8)',
  cushionHit: '#ef5350',
}

export interface TopDownOptions {
  interactive: boolean
  onDrag?: (tablePoint: Vec2) => void
}

export class TopDownView {
  readonly ctx: CanvasRenderingContext2D
  private scale = 1
  private ox = 0
  private oy = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private table: Table,
    private opts: TopDownOptions,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    this.ctx = ctx
    if (opts.interactive) this.bindPointer()
  }

  private bindPointer(): void {
    let dragging = false
    const toTable = (ev: PointerEvent): Vec2 => {
      const rect = this.canvas.getBoundingClientRect()
      const px = (ev.clientX - rect.left) * (this.canvas.width / rect.width)
      const py = (ev.clientY - rect.top) * (this.canvas.height / rect.height)
      return this.screenToWorld(px, py)
    }
    this.canvas.addEventListener('pointerdown', (ev) => {
      dragging = true
      this.canvas.setPointerCapture(ev.pointerId)
      this.opts.onDrag?.(toTable(ev))
    })
    this.canvas.addEventListener('pointermove', (ev) => {
      if (dragging) this.opts.onDrag?.(toTable(ev))
    })
    const stop = (ev: PointerEvent): void => {
      dragging = false
      this.canvas.releasePointerCapture(ev.pointerId)
    }
    this.canvas.addEventListener('pointerup', stop)
    this.canvas.addEventListener('pointercancel', stop)
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    const { cfg } = this.table
    const fullW = cfg.tableLengthMm + 2 * RAIL
    const fullH = cfg.tableWidthMm + 2 * RAIL
    this.scale = Math.min(this.canvas.width / fullW, this.canvas.height / fullH)
    this.ox = (this.canvas.width - cfg.tableLengthMm * this.scale) / 2
    this.oy = (this.canvas.height - cfg.tableWidthMm * this.scale) / 2
  }

  private sx(x: number): number {
    return this.ox + x * this.scale
  }
  private sy(y: number): number {
    return this.oy + (this.table.cfg.tableWidthMm - y) * this.scale
  }
  private toScreen(p: Vec2): [number, number] {
    return [this.sx(p.x), this.sy(p.y)]
  }
  screenToWorld(px: number, py: number): Vec2 {
    return {
      x: (px - this.ox) / this.scale,
      y: this.table.cfg.tableWidthMm - (py - this.oy) / this.scale,
    }
  }

  // Screen-space arrow resolution (§4.7): screen-x of a small +θ tangent move at the ghost.
  nudgeTangentScreenX(theta: number): number {
    // tangent of +θ motion is perp(ê(θ)) = (−sin θ, cos θ); canvas y is flipped (x unaffected).
    return -Math.sin(theta) * this.scale
  }

  render(state: AppState): void {
    const { ctx, table } = this
    const { cfg } = table
    const r = cfg.ballRadiusMm
    const s = this.scale
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // rails + bed
    ctx.fillStyle = COLORS.rail
    ctx.fillRect(
      this.sx(0) - RAIL * s,
      this.sy(cfg.tableWidthMm) - RAIL * s,
      (cfg.tableLengthMm + 2 * RAIL) * s,
      (cfg.tableWidthMm + 2 * RAIL) * s,
    )
    ctx.fillStyle = COLORS.felt
    ctx.fillRect(this.sx(0), this.sy(cfg.tableWidthMm), cfg.tableLengthMm * s, cfg.tableWidthMm * s)

    // cushion spans (drawn slightly darker along each rail, jaw-bounded)
    ctx.strokeStyle = COLORS.cushion
    ctx.lineWidth = Math.max(2, 22 * s)
    for (const track of table.tracks) {
      for (const [lo, hi] of track.spans) {
        ctx.beginPath()
        if (track.axis === 'y') {
          const y = track.value < cfg.tableWidthMm / 2 ? 8 : cfg.tableWidthMm - 8
          ctx.moveTo(this.sx(lo), this.sy(y))
          ctx.lineTo(this.sx(hi), this.sy(y))
        } else {
          const x = track.value < cfg.tableLengthMm / 2 ? 8 : cfg.tableLengthMm - 8
          ctx.moveTo(this.sx(x), this.sy(lo))
          ctx.lineTo(this.sx(x), this.sy(hi))
        }
        ctx.stroke()
      }
    }

    // pockets
    for (const pk of table.pockets) {
      const [mx, my] = this.toScreen(pk.m)
      ctx.beginPath()
      ctx.fillStyle = COLORS.pocket
      const mouth = pk.type === 'corner' ? cfg.cornerMouthMm : cfg.sideMouthMm
      ctx.arc(mx, my, (mouth / 2) * s, 0, Math.PI * 2)
      ctx.fill()
      if (pk.id === state.shot.pocketId) {
        ctx.beginPath()
        ctx.strokeStyle = COLORS.target
        ctx.lineWidth = Math.max(2, 6 * s)
        ctx.arc(mx, my, (mouth / 2 + 14) * s, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const shot = state.shot
    const showTruth = state.phase === 'reveal' || state.phase === 'result' || state.peeking

    // reachable arc on the constraint circle
    if (state.phase === 'aiming') {
      const arc = reachableArc(shot.object, shot.cue, table)
      const [ox2, oy2] = this.toScreen(shot.object)
      ctx.beginPath()
      ctx.strokeStyle = COLORS.arc
      ctx.lineWidth = Math.max(1.5, 4 * s)
      ctx.setLineDash([6, 6])
      // canvas arcs run clockwise in screen space = decreasing table angle; flip signs
      ctx.arc(
        ox2,
        oy2,
        2 * r * s,
        -(arc.thetaC - arc.halfWidth),
        -(arc.thetaC + arc.halfWidth),
        true,
      )
      ctx.stroke()
      ctx.setLineDash([])
    }

    // trajectory on result
    if (state.result && (state.phase === 'result' || state.phase === 'animating')) {
      const ev = state.result.sim.event
      if (ev) {
        ctx.beginPath()
        ctx.strokeStyle = state.result.potted ? COLORS.aimLine : COLORS.cushionHit
        ctx.lineWidth = Math.max(1.5, 5 * s)
        ctx.setLineDash([10, 8])
        ctx.moveTo(...this.toScreen(shot.object))
        ctx.lineTo(...this.toScreen(ev.point))
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // balls
    this.ball(shot.cue, r, COLORS.cue, false)
    this.ball(shot.object, r, COLORS.object, false)

    // ghosts: user guess (amber on reveal, translucent while aiming), truth (cyan outline)
    const userPos = ghostAt(state.theta, shot.object, r)
    if (showTruth) {
      const pk = table.pockets[shot.pocketId]
      if (pk) {
        const truth = trueGhost(shot.object, pk, cfg)
        this.ball(truth, r, COLORS.ghostTrue, true)
      }
      this.ball(userPos, r, COLORS.ghostUser, true)
    } else {
      this.ball(userPos, r, COLORS.ghost, true)
      // direction hint: departure line from O opposite the ghost
      const d = unit(state.theta)
      const [ox3, oy3] = this.toScreen(shot.object)
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(245,242,233,0.25)'
      ctx.lineWidth = Math.max(1, 3 * s)
      ctx.moveTo(ox3, oy3)
      ctx.lineTo(ox3 - d.x * 260 * s, oy3 + d.y * 260 * s)
      ctx.stroke()
    }
  }

  private ball(p: Vec2, r: number, color: string, outline: boolean): void {
    const { ctx } = this
    const [x, y] = this.toScreen(p)
    ctx.beginPath()
    ctx.arc(x, y, r * this.scale, 0, Math.PI * 2)
    if (outline) {
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, 6 * this.scale)
      ctx.stroke()
      ctx.fillStyle = color.startsWith('rgba') ? color : `${color}33`
      ctx.fill()
    } else {
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

// Convenience type for main.ts wiring.
export type { FullResult, Shot }
