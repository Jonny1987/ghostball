import * as THREE from 'three'
import type { Shot, Table, Vec2 } from '../core'
import { toWorld } from './units'

// Contact-zoom inset (PLAN.md §2.6): a picture-in-picture second render pass at narrow FOV
// aimed at the ghost/object contact region — the designed carrier of fine-step feedback.
// One 0.25° step ≈ 0.74 device px here (§2.6's stated convention).

const INSET_FOV = 5
const INSET_FRACTION = 0.4 // of canvas width

export class ContactInset {
  private camera = new THREE.PerspectiveCamera(INSET_FOV, 1, 0.05, 30)
  private side: 'left' | 'right' = 'right'
  visible = false

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    mainCamera: THREE.PerspectiveCamera,
    shot: Shot,
    ghostPos: Vec2,
    table: Table,
  ): void {
    if (!this.visible) return
    const size = renderer.getSize(new THREE.Vector2())
    const px = Math.round(size.x * INSET_FRACTION)
    const margin = Math.round(size.x * 0.03)

    // contact region = midpoint of ghost and object centres
    const r = table.cfg.ballRadiusMm
    const contact = toWorld(
      { x: (ghostPos.x + shot.object.x) / 2, y: (ghostPos.y + shot.object.y) / 2 },
      r,
    )

    this.camera.position.copy(mainCamera.position)
    this.camera.fov = INSET_FOV
    this.camera.aspect = 1
    this.camera.lookAt(contact)
    this.camera.updateProjectionMatrix()

    // top-right by default, below the top bar — clear of the chip (bottom-left) and the
    // nudge arrows. v2.2: the down fit keeps the TARGET POCKET in frame, often near a top
    // corner — if the current slot would cover it, flip to the opposite top corner. The
    // switch only fires when the occupied slot is violated (hysteresis, no flip-flapping).
    const topBarPx = Math.round(size.y * 0.08)
    const pk = table.pockets[shot.pocketId]
    if (pk) {
      const ndc = toWorld(pk.m, 0).project(mainCamera)
      if (ndc.z < 1) {
        const pad = 0.06
        const yBottom = 1 - (2 * (topBarPx + margin + px)) / size.y
        const inY = ndc.y > yBottom - pad
        const overRight = inY && ndc.x > 1 - (2 * (margin + px)) / size.x - pad
        const overLeft = inY && ndc.x < -1 + (2 * (margin + px)) / size.x + pad
        if (this.side === 'right' && overRight && !overLeft) this.side = 'left'
        else if (this.side === 'left' && overLeft && !overRight) this.side = 'right'
      }
    }
    const vx = this.side === 'right' ? size.x - px - margin : margin
    const vy = size.y - px - topBarPx - margin
    renderer.setScissorTest(true)
    renderer.setViewport(vx, vy, px, px)
    renderer.setScissor(vx, vy, px, px)
    renderer.render(scene, this.camera)
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, size.x, size.y)
  }
}
