import * as THREE from 'three'
import type { Shot, Table, Vec2 } from '../core'
import { BED_Y, MM_TO_M, toCore, toWorld } from './units'

// Pointer input (PLAN.md §2.4/§5). Standing: absolute drag — the grab captures the
// finger→ghost screen offset so the ghost never jumps, then a lift of up to 80 px ramps in
// on touch so the finger ends below the ball instead of covering it; drags start only
// within the 48 px grab radius. Down: relative horizontal aim-swipe at 0.08°/px (the
// camera is locked to the aim line there — absolute drag makes no sense). Exactly one
// pointer (the first primary-button one) owns a gesture; other pointers are ignored.

export const FEEL = {
  liftOffsetPx: 80,
  grabRadiusPx: 48,
  liftRampMs: 250,
}

export interface InputContext {
  stance: () => 'standing' | 'down'
  aiming: () => boolean
  shot: () => Shot
  ghost: () => Vec2
  camera: () => THREE.PerspectiveCamera
  onDragPoint: (p: Vec2) => void // standing: absolute table point (clamped by the app)
  onSwipe: (dxPx: number, dyPx: number) => void // down: relative 2D swipe
  onDragState: (active: boolean) => void // standing grab start/end (freezes camera re-aim)
}

export function bindInput(canvas: HTMLCanvasElement, table: Table, ctx: InputContext): void {
  const raycaster = new THREE.Raycaster()
  const planeHeight = BED_Y + table.cfg.ballRadiusMm * MM_TO_M
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight)
  const hit = new THREE.Vector3()

  let activePointer: number | null = null
  let dragging = false
  let standingGrab = false
  let lastX = 0
  let lastY = 0
  let grabOffsetX = 0
  let grabOffsetY = 0
  let liftTarget = 0
  let grabTime = 0

  const ghostScreenPx = (): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect()
    const ndc = toWorld(ctx.ghost(), table.cfg.ballRadiusMm).project(ctx.camera())
    if (ndc.z >= 1) return null
    return { x: ((ndc.x + 1) / 2) * rect.width, y: ((1 - ndc.y) / 2) * rect.height }
  }

  // Cast a canvas-relative pixel position to the ball-centre plane in table mm.
  const castToTable = (px: number, py: number): Vec2 | null => {
    const rect = canvas.getBoundingClientRect()
    const x = (px / rect.width) * 2 - 1
    const y = -((py / rect.height) * 2 - 1)
    raycaster.setFromCamera(new THREE.Vector2(x, y), ctx.camera())
    const point = raycaster.ray.intersectPlane(plane, hit)
    return point ? toCore(point) : null
  }

  const dragTargetPx = (ev: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    // lift ramps in smoothly after the grab, on touch only (§2.4 feel constants)
    const ramp = Math.min(1, (performance.now() - grabTime) / FEEL.liftRampMs)
    return {
      x: ev.clientX - rect.left + grabOffsetX,
      y: ev.clientY - rect.top + grabOffsetY - liftTarget * ramp,
    }
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ctx.aiming()) return
    if (ev.button !== 0 || ev.isPrimary === false) return
    if (activePointer !== null) return // one pointer owns the gesture
    activePointer = ev.pointerId
    canvas.setPointerCapture(ev.pointerId)
    lastX = ev.clientX
    lastY = ev.clientY

    if (ctx.stance() === 'standing') {
      const gp = ghostScreenPx()
      const rect = canvas.getBoundingClientRect()
      const px = ev.clientX - rect.left
      const py = ev.clientY - rect.top
      if (gp !== null && Math.hypot(px - gp.x, py - gp.y) <= FEEL.grabRadiusPx) {
        dragging = true
        standingGrab = true
        ctx.onDragState(true)
        grabTime = performance.now()
        // capture the finger→ghost offset so the grab itself never moves the ghost
        grabOffsetX = gp.x - px
        grabOffsetY = gp.y - py
        liftTarget = ev.pointerType === 'touch' ? FEEL.liftOffsetPx : 0
      }
    } else {
      dragging = true // down stance: swipe from anywhere
    }
  })

  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== activePointer || !dragging || !ctx.aiming()) return
    if (ctx.stance() === 'standing') {
      const t = dragTargetPx(ev)
      const p = castToTable(t.x, t.y)
      if (p) ctx.onDragPoint(p)
    } else {
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      if (dx !== 0 || dy !== 0) ctx.onSwipe(dx, dy)
    }
  })

  const stop = (ev: PointerEvent): void => {
    if (ev.pointerId !== activePointer) return
    activePointer = null
    dragging = false
    if (standingGrab) {
      standingGrab = false
      ctx.onDragState(false)
    }
    try {
      canvas.releasePointerCapture(ev.pointerId)
    } catch {
      // capture already released
    }
  }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
}
