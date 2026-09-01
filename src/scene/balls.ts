import * as THREE from 'three'
import { type Shot, type Table, trueGhost, type Vec2 } from '../core'
import { ballMaterial, contactShadowTexture, ghostMaterial } from './materials'
import { BED_Y, MM_TO_M, toWorld } from './units'

// Ball meshes + contact-shadow discs + ghost footprint rings (PLAN.md §3 balls.ts).

const COLOR = {
  cue: 0xf5f1e6,
  object: 0xc0392b,
  ghost: 0xf5f1e6,
  truth: 0x4fc3f7,
  user: 0xffb74d,
}

function marbleTexture(base: string): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    // faint speckle so rolling rotation is visible during the submit animation
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.05})`
      ctx.beginPath()
      ctx.arc(Math.random() * size, Math.random() * size, 0.6 + Math.random() * 1.4, 0, 7)
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

function dashedRing(radiusM: number, color: number): THREE.Line {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * radiusM, 0, Math.sin(a) * radiusM))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.012,
    gapSize: 0.009,
    transparent: true,
    opacity: 0.85,
  })
  const line = new THREE.Line(geo, mat)
  line.computeLineDistances()
  return line
}

export class Balls {
  readonly cue: THREE.Mesh
  readonly object: THREE.Mesh
  readonly ghost: THREE.Mesh
  readonly truth: THREE.Mesh
  readonly ghostRing: THREE.Line
  readonly truthRing: THREE.Line
  private shadows: THREE.Mesh[] = []
  private shadowFor = new Map<THREE.Object3D, THREE.Mesh>()
  private rM: number

  constructor(
    scene: THREE.Scene,
    private table: Table,
  ) {
    this.rM = table.cfg.ballRadiusMm * MM_TO_M
    const sphere = new THREE.SphereGeometry(this.rM, 36, 24)

    const cueMat = ballMaterial(COLOR.cue)
    this.cue = new THREE.Mesh(sphere, cueMat)
    // drawn after the ghost so it re-claims its pixels by depth even when the ghost
    // ignores the depth test (perpendicular-mode obscure override) — harmless otherwise
    this.cue.renderOrder = 4

    const objMat = ballMaterial(COLOR.object)
    objMat.map = marbleTexture('#c0392b')
    this.object = new THREE.Mesh(sphere, objMat)

    // v2: the ghost is FULLY OPAQUE — it reads as the real cue ball at the imagined
    // contact; the dashed footprint ring is what marks it as hypothetical.
    this.ghost = new THREE.Mesh(sphere, ballMaterial(COLOR.ghost))

    this.truth = new THREE.Mesh(sphere, ghostMaterial(COLOR.truth, 0.4))
    this.truth.renderOrder = 2
    this.truth.visible = false

    this.ghostRing = dashedRing(this.rM * 1.25, 0xf5f1e6)
    this.truthRing = dashedRing(this.rM * 1.45, 0x4fc3f7)
    this.truthRing.visible = false

    const shadowTex = contactShadowTexture()
    for (const target of [this.cue, this.object, this.ghost, this.truth]) {
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(this.rM * 3.2, this.rM * 3.2),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
        }),
      )
      disc.rotation.x = -Math.PI / 2
      disc.renderOrder = 1
      this.shadows.push(disc)
      this.shadowFor.set(target, disc)
      scene.add(disc)
    }
    const ghostShadow = this.shadowFor.get(this.ghost)
    if (ghostShadow) {
      const mat = ghostShadow.material as THREE.MeshBasicMaterial
      mat.opacity = 0.5
    }

    scene.add(this.cue, this.object, this.ghost, this.truth, this.ghostRing, this.truthRing)
  }

  private place(mesh: THREE.Object3D, p: Vec2): void {
    toWorld(p, this.table.cfg.ballRadiusMm, mesh.position as THREE.Vector3)
    const shadow = this.shadowFor.get(mesh)
    if (shadow) {
      shadow.position.set(mesh.position.x, BED_Y + 0.0006, mesh.position.z)
      shadow.visible = mesh.visible
    }
  }

  sync(
    shot: Shot,
    ghostPos: Vec2,
    showTruth: boolean,
    userAsGuessColor: boolean,
    touchObject = true,
    showGhost = true,
    glassyGhost = false,
    ghostOverObject = false,
  ): void {
    this.place(this.cue, shot.cue)
    if (touchObject) {
      this.object.visible = true
      this.place(this.object, shot.object)
      this.object.scale.setScalar(1)
      this.object.quaternion.identity()
    }

    // v2.6: the ghost can be hidden per stance while aiming (blind drill) — the mesh,
    // its dashed footprint ring, and its contact shadow all go; the position keeps
    // syncing so nudges/chip/camera behave identically and the reveal shows the guess.
    const u = ghostPos
    this.ghost.visible = showGhost
    this.ghostRing.visible = showGhost
    this.place(this.ghost, u)
    this.ghostRing.position.set(this.ghost.position.x, BED_Y + 0.001, this.ghost.position.z)

    const mat = this.ghost.material as THREE.MeshPhysicalMaterial
    mat.color.setHex(userAsGuessColor ? COLOR.user : COLOR.ghost)
    // v2.8 semi-transparent option: with it on, an overlapped object ball shows through
    // the ghost (no depth write, drawn late). Opaque in PERPENDICULAR mode, the ghost
    // interpenetrates O (its line runs through it) — ghostOverObject skips the depth
    // test so the ghost paints fully over the object ball, writing true depth so the
    // cue ball and stick (renderOrder 4) still resolve correctly in front.
    mat.transparent = glassyGhost
    mat.opacity = glassyGhost ? 0.55 : 1
    mat.depthWrite = !glassyGhost
    mat.depthTest = !ghostOverObject
    this.ghost.renderOrder = glassyGhost ? 3 : ghostOverObject ? 2 : 0

    if (showTruth) {
      const pk = this.table.pockets[shot.pocketId]
      if (pk) {
        const truthPos = trueGhost(shot.object, pk, this.table.cfg)
        // Near-overlap treatment (§5): when the guess nearly coincides with the truth, a
        // filled cyan sphere and the amber guess read as one mushy blob — render the truth
        // as an outline ring only, and let the result panel carry the exact gap number.
        const gapMm = Math.hypot(truthPos.x - u.x, truthPos.y - u.y)
        const nearOverlap = gapMm < 2 * this.table.cfg.ballRadiusMm * 0.055 // ≈ β < 1.5°
        this.truth.visible = !nearOverlap
        this.truthRing.visible = true
        this.place(this.truth, truthPos)
        this.truthRing.position.set(truthPos.x * MM_TO_M, BED_Y + 0.0012, truthPos.y * MM_TO_M)
        if (nearOverlap) {
          const shadow = this.shadowFor.get(this.truth)
          if (shadow) shadow.visible = false
        }
      }
    } else {
      this.truth.visible = false
      this.truthRing.visible = false
      const shadow = this.shadowFor.get(this.truth)
      if (shadow) shadow.visible = false
    }
  }

  // Keep the object ball's contact shadow under it while the submit animation moves it.
  syncObjectShadow(): void {
    const shadow = this.shadowFor.get(this.object)
    if (shadow) {
      shadow.position.set(this.object.position.x, BED_Y + 0.0006, this.object.position.z)
      shadow.visible = this.object.visible
    }
  }

  get radiusM(): number {
    return this.rM
  }
}
