import * as THREE from 'three'
import type { FullResult, Shot, Table, Vec2 } from '../core'
import { BED_Y, MM_TO_M, toWorld } from './units'

// Post-submit aiming aids (PLAN.md §3 aids.ts): cue path C→U, object path O→event,
// and the target-pocket highlight ring shown while aiming.

export class Aids {
  private cueLine: THREE.Line
  private objectLine: THREE.Line
  private pocketRing: THREE.Mesh

  constructor(
    scene: THREE.Scene,
    private table: Table,
  ) {
    const cueMat = new THREE.LineBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.9,
    })
    const objMat = new THREE.LineBasicMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.9,
    })
    this.cueLine = new THREE.Line(new THREE.BufferGeometry(), cueMat)
    this.objectLine = new THREE.Line(new THREE.BufferGeometry(), objMat)
    this.cueLine.visible = false
    this.objectLine.visible = false

    this.pocketRing = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.09, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd54f,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    this.pocketRing.rotation.x = -Math.PI / 2
    this.pocketRing.renderOrder = 1

    scene.add(this.cueLine, this.objectLine, this.pocketRing)
  }

  setTargetPocket(pocketId: number): void {
    const pk = this.table.pockets[pocketId]
    if (!pk) return
    this.pocketRing.position.set(pk.m.x * MM_TO_M, BED_Y + 0.0015, pk.m.y * MM_TO_M)
  }

  showResultLines(shot: Shot, u: Vec2, result: FullResult): void {
    const r = this.table.cfg.ballRadiusMm
    if (result.outcome === 'whiff') {
      // show the aim ray sailing past the object ball
      const dx = u.x - shot.cue.x
      const dy = u.y - shot.cue.y
      const len = Math.hypot(dx, dy) || 1
      const past = { x: u.x + (dx / len) * 500, y: u.y + (dy / len) * 500 }
      const mat = this.cueLine.material as THREE.LineBasicMaterial
      mat.color.setHex(0xef5350)
      this.cueLine.geometry.setFromPoints([toWorld(shot.cue, r), toWorld(past, r)])
      this.cueLine.visible = true
      this.objectLine.visible = false
      return
    }
    const cueMat = this.cueLine.material as THREE.LineBasicMaterial
    cueMat.color.setHex(0xffb74d)
    this.cueLine.geometry.setFromPoints([toWorld(shot.cue, r), toWorld(u, r)])
    this.cueLine.visible = true
    const ev = result.sim.event
    if (ev) {
      const mat = this.objectLine.material as THREE.LineBasicMaterial
      mat.color.setHex(result.potted ? 0xffd54f : 0xef5350)
      this.objectLine.geometry.setFromPoints([toWorld(shot.object, r), toWorld(ev.point, r)])
      this.objectLine.visible = true
    }
  }

  hideResultLines(): void {
    this.cueLine.visible = false
    this.objectLine.visible = false
  }
}
