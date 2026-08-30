import type * as THREE from 'three'
import { dist, type Shot, type Table } from '../core'
import { toWorld } from './units'

// Off-frame pocket chevron + distance label, shared by both stances (PLAN.md §5):
// when the target pocket doesn't project inside the frame, an edge arrow points at it.

export class PocketChevron {
  private el: HTMLElement
  private label: HTMLElement

  constructor(container: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'chevron'
    this.el.hidden = true
    const arrow = document.createElement('div')
    arrow.className = 'chevron-arrow'
    arrow.textContent = '➤'
    this.label = document.createElement('div')
    this.label.className = 'chevron-label'
    this.el.append(arrow, this.label)
    container.append(this.el)
  }

  update(camera: THREE.PerspectiveCamera, shot: Shot, table: Table, w: number, h: number): void {
    const pk = table.pockets[shot.pocketId]
    if (!pk) return
    const p = toWorld(pk.m, 0)
    const ndc = p.project(camera)
    const onScreen = ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1
    if (onScreen) {
      this.el.hidden = true
      return
    }
    // clamp direction to the screen edge; behind-camera flips the direction
    let x = ndc.x
    let y = ndc.y
    if (ndc.z >= 1) {
      x = -x
      y = -y
    }
    const angle = Math.atan2(y, x)
    const edgeX = Math.max(-0.88, Math.min(0.88, x))
    const edgeY = Math.max(-0.82, Math.min(0.82, y))
    const sx = ((edgeX + 1) / 2) * w
    const sy = ((1 - edgeY) / 2) * h
    this.el.hidden = false
    this.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`
    const arrow = this.el.firstElementChild as HTMLElement | null
    if (arrow) arrow.style.transform = `rotate(${-angle}rad)`
    const dm = dist(shot.object, pk.m) / 1000
    this.label.textContent = `pocket ${dm.toFixed(1)} m`
  }

  hide(): void {
    this.el.hidden = true
  }
}
