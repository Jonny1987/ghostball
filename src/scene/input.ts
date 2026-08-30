import * as THREE from 'three'
import { degToRad, ghostAt, type Shot, type Table, type Vec2 } from '../core'
import { BED_Y, MM_TO_M, toCore, toWorld } from './units'

// Pointer input (PLAN.md §2.4/§5). Standing: absolute drag — raycast to the ball-centre
// plane with an 80 px lift offset (the finger never covers the ball) and a 48 px grab
// radius. Down: relative horizontal aim-swipe at 0.08°/px (the camera is locked to the aim
// line there, absolute drag makes no sense). All doc-inherited feel constants live here.

export const FEEL = {
  liftOffsetPx: 80,
  grabRadiusPx: 48,
  swipeDegPerPx: 0.08,
}

export interface InputContext {
  stance: () => 'standing' | 'down'
  aiming: () => boolean
  shot: () => Shot
  theta: () => number
  camera: () => THREE.PerspectiveCamera
  onDragPoint: (p: Vec2) => void // standing: table point to project onto the arc
  onSwipe: (deltaThetaRad: number, screenDxPx: number) => void // down: relative
}

export function bindInput(canvas: HTMLCanvasElement, table: Table, ctx: InputContext): void {
  const raycaster = new THREE.Raycaster()
  const planeHeight = BED_Y + table.cfg.ballRadiusMm * MM_TO_M
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight)
  const hit = new THREE.Vector3()

  let dragging = false
  let lastX = 0

  const ndcFromEvent = (ev: PointerEvent, liftPx: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    const y = -(((ev.clientY - rect.top - liftPx) / rect.height) * 2 - 1)
    return { x, y }
  }

  const ghostScreenPx = (): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect()
    const shot = ctx.shot()
    const u = ghostAt(ctx.theta(), shot.object, table.cfg.ballRadiusMm)
    const ndc = toWorld(u, table.cfg.ballRadiusMm).project(ctx.camera())
    if (ndc.z >= 1) return null
    return { x: ((ndc.x + 1) / 2) * rect.width, y: ((1 - ndc.y) / 2) * rect.height }
  }

  const castToTable = (ev: PointerEvent, lift: boolean): Vec2 | null => {
    const liftPx = lift && ev.pointerType === 'touch' ? FEEL.liftOffsetPx : 0
    const ndc = ndcFromEvent(ev, liftPx)
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), ctx.camera())
    const point = raycaster.ray.intersectPlane(plane, hit)
    return point ? toCore(point) : null
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ctx.aiming()) return
    canvas.setPointerCapture(ev.pointerId)
    lastX = ev.clientX
    if (ctx.stance() === 'standing') {
      const gp = ghostScreenPx()
      const rect = canvas.getBoundingClientRect()
      const px = ev.clientX - rect.left
      const py = ev.clientY - rect.top
      const near = gp !== null && Math.hypot(px - gp.x, py - gp.y) <= FEEL.grabRadiusPx * 1.0
      if (near) {
        dragging = true
        const p = castToTable(ev, true)
        if (p) ctx.onDragPoint(p)
      }
    } else {
      dragging = true // down stance: swipe from anywhere
    }
  })

  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging || !ctx.aiming()) return
    if (ctx.stance() === 'standing') {
      const p = castToTable(ev, true)
      if (p) ctx.onDragPoint(p)
    } else {
      const dx = ev.clientX - lastX
      lastX = ev.clientX
      if (dx !== 0) ctx.onSwipe(degToRad(FEEL.swipeDegPerPx) * dx, dx)
    }
  })

  const stop = (ev: PointerEvent): void => {
    dragging = false
    try {
      canvas.releasePointerCapture(ev.pointerId)
    } catch {
      // capture already released
    }
  }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
}
