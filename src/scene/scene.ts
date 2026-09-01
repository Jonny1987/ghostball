import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { FullResult, Shot, Table, Vec2 } from '../core'
import type { AppState, Stance } from '../ui/store'
import { Aids } from './aids'
import { submitAnimation, type Task } from './animate'
import { assertCrossProjection } from './assertions'
import { Balls } from './balls'
import { buildScene } from './buildScene'
import {
  type CameraPose,
  DampedCamera,
  type DownRig,
  downPose,
  pickDownRig,
  screenDirsOnTable,
  standingPose,
} from './cameras'
import { PocketChevron } from './chevron'
import { bindInput } from './input'
import { ContactInset } from './inset'
import { toWorld } from './units'

// Scene orchestrator (PLAN.md §3): owns the renderer, the render-on-demand loop (§2.1 —
// zero idle rAF; the loop runs only while dirty or animating), cameras, and all scene
// objects. It is a projection of store state; it never owns game state.

export interface SceneCallbacks {
  onSwipe: (dxPx: number, dyPx: number) => void // relative swipe, both stances (v2.3)
}

const STANCE_TRANSITION_S = 0.4
const FOLLOW_TAU_S = 0.15 // damped ghost-follow, both stances

export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private balls: Balls
  private aids: Aids
  private cam: DampedCamera
  private inset = new ContactInset()
  private chevron: PocketChevron
  private downRig: DownRig
  private cueStick: THREE.Mesh
  private tasks = new Set<Task>()
  private dirty = true
  private running = false
  private lastTime = 0
  private cssW = 1
  private cssH = 1
  private state: AppState | null = null
  private activeAnim: { skip: () => void } | null = null
  private activeAnimTask: Task | null = null
  private lostContext = false
  private lastPose: CameraPose | null = null

  constructor(
    canvas: HTMLCanvasElement,
    chevronContainer: HTMLElement,
    private table: Table,
    cb: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.scene = buildScene(table)

    // IBL: PMREM'd RoomEnvironment gives the phenolic balls something to reflect (§2.1)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.2

    this.balls = new Balls(this.scene, table)
    this.aids = new Aids(this.scene, table)
    this.cam = new DampedCamera(1)
    // test hook: headless drive scripts read the live camera to await settlement
    ;(window as unknown as { __scene?: unknown }).__scene = this
    this.chevron = new PocketChevron(chevronContainer)
    this.downRig = pickDownRig()

    // simple tapered cue stick, shown while aiming in both stances (§5, toggleable)
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.013, 1.45, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 }),
    )
    stick.visible = false
    // after the ghost — stays correctly in front of a depth-test-skipping
    // perpendicular-mode ghost; harmless otherwise
    stick.renderOrder = 4
    this.cueStick = stick
    this.scene.add(stick)

    bindInput(canvas, {
      aiming: () => this.state?.phase === 'aiming',
      onSwipe: (dx, dy) => cb.onSwipe(dx, dy),
    })

    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault()
      this.lostContext = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lostContext = false
      this.invalidate()
    })
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW
    this.cssH = cssH
    this.renderer.setPixelRatio(Math.min(dpr, 2))
    this.renderer.setSize(cssW, cssH, true)
    this.cam.setAspect(cssW / cssH)
    if (this.state) this.applyCamera(this.state, true)
    this.invalidate()
  }

  // React to store changes; snap=true skips damping (first shot, resize, next shot).
  update(state: AppState, prev: AppState | null): void {
    const shotChanged = !prev || prev.shot !== state.shot
    const ghostChanged = !prev || prev.ghost !== state.ghost
    const stanceChanged = !prev || prev.stance !== state.stance
    this.state = state

    const showTruth =
      state.phase === 'reveal' ||
      state.phase === 'animating' ||
      state.phase === 'result' ||
      state.peeking
    const guessColored = state.phase !== 'aiming'
    // during ANIMATING/RESULT the submit animation owns the object ball's transform —
    // sync must not teleport it back to O or un-hide a potted ball (§2.12)
    const objectLive = state.phase === 'animating' || state.phase === 'result'
    // v2.6: per-stance ghost visibility while aiming (blind drill); from the reveal on,
    // the guess always shows — that feedback is the point of the exercise
    const preReveal = state.phase === 'aiming' || state.phase === 'locked'
    const showGhost =
      !preReveal ||
      (state.stance === 'standing' ? state.settings.ghostStanding : state.settings.ghostDown)
    // v2.8: semi-transparent ghost while aiming so an overlapping object ball stays
    // visible; opaque from the reveal on (readability of the amber guess vs the truth).
    // Opaque + perpendicular: the ghost interpenetrates O on its line, so it must WIN
    // the overlap explicitly (depth-test override) to read as "in front".
    const glassyGhost = preReveal && state.settings.ghostTransparent
    const ghostOverObject =
      preReveal && state.settings.placement === 'perpendicular' && !state.settings.ghostTransparent
    this.balls.sync(
      state.shot,
      state.ghost,
      showTruth,
      guessColored,
      !objectLive,
      showGhost,
      glassyGhost,
      ghostOverObject,
    )
    this.aids.setTargetPocket(state.shot.pocketId)

    if (state.phase === 'aiming' && (shotChanged || (prev && prev.phase !== 'aiming'))) {
      this.aids.hideResultLines()
      this.balls.object.visible = true
      this.balls.object.scale.setScalar(1)
    }

    if (shotChanged) {
      this.applyCamera(state, true)
    } else if (stanceChanged) {
      this.applyCamera(state, false, STANCE_TRANSITION_S)
    } else if (ghostChanged) {
      // both stances follow the ghost continuously: down re-sights along the aim,
      // standing yaws to keep the ghost at the horizontal screen centre (v2.3)
      this.applyCamera(state, false, FOLLOW_TAU_S)
    }

    // inset shows while aiming in the down stance (§2.6; settings can force on/off)
    const insetSetting = state.settings.inset
    this.inset.visible =
      state.phase === 'aiming' &&
      (insetSetting === 'on' || (insetSetting === 'auto' && state.stance === 'down'))

    // v2.4: the cue shows in BOTH stances while aiming — the standing view now frames
    // the cue ball, so the shooter sees their cue addressing it exactly as when down
    this.cueStick.visible = state.settings.cueStick && state.phase === 'aiming'
    if (this.cueStick.visible) this.placeCueStick(state)

    this.invalidate()
  }

  private placeCueStick(state: AppState): void {
    const r = this.table.cfg.ballRadiusMm
    const u = state.ghost
    const cueW = toWorld(state.shot.cue, r)
    const uW = toWorld(u, r)
    const dir = uW.clone().sub(cueW).setY(0).normalize()
    // Address the CUE ball like a real cue: TIP 5 cm behind the cue ball at ball-centre
    // height, BUTT raised toward the shooter — the stick slopes down to the ball, never
    // past it (a tilted-up tip used to float beyond the cue ball toward the ghost).
    const stickLen = 1.45
    const buttRise = 0.12
    const tip = cueW.clone().addScaledVector(dir, -0.05)
    const butt = tip
      .clone()
      .addScaledVector(dir, -stickLen)
      .add(new THREE.Vector3(0, buttRise, 0))
    const axis = tip.clone().sub(butt).normalize() // butt → tip (cylinder +Y is the tip end)
    this.cueStick.position.copy(tip.clone().add(butt).multiplyScalar(0.5))
    this.cueStick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)

    // A dollied-back down view can put the eye BEHIND the butt on the stick's own axis —
    // the stick then runs straight down the view centre and occludes the aim line. When
    // the shooter has stood that far back off the shot, the cue goes with them: hide it.
    if (state.stance === 'down' && this.lastPose) {
      const fwd = this.lastPose.target.clone().sub(this.lastPose.eye).normalize()
      if (butt.clone().sub(this.lastPose.eye).dot(fwd) > 0) this.cueStick.visible = false
    }
  }

  private applyCamera(state: AppState, snap: boolean, tau = STANCE_TRANSITION_S): void {
    const aspect = this.cssW / Math.max(1, this.cssH)
    const pose =
      state.stance === 'standing'
        ? standingPose(state.shot, this.table, aspect, state.ghost)
        : downPose(state.shot, state.ghost, this.table, this.downRig, aspect)
    this.lastPose = pose
    if (snap) this.cam.snapTo(pose)
    else this.cam.moveTo(pose, tau)
    this.invalidate()
  }

  // Table-space unit vectors for screen-right/up at the ghost — drives the 4-way nudges
  // and the down-view swipe mapping (v2).
  screenDirs(): { right: Vec2; up: Vec2 } {
    if (!this.state) return { right: { x: 1, y: 0 }, up: { x: 0, y: 1 } }
    return screenDirsOnTable(this.cam.camera, this.state.ghost, this.table)
  }

  // Kinematic submit playback (M5 flow). onDone fires when the roll (or skip) completes.
  runSubmit(result: FullResult, reducedMotion: boolean, onDone: () => void): void {
    const ev = result.sim.event
    if (!ev || reducedMotion) {
      if (this.state) this.aids.showResultLines(this.state.shot, this.state.ghost, result)
      onDone()
      return
    }
    const state = this.state as AppState
    this.aids.showResultLines(state.shot, state.ghost, result)
    const r = this.table.cfg.ballRadiusMm
    const from = toWorld(state.shot.object, r)
    const to = toWorld(ev.point, r)
    const anim = submitAnimation(this.balls.object, from, to, this.balls.radiusM, result, () => {
      this.activeAnim = null
      this.activeAnimTask = null
      onDone()
    })
    this.activeAnim = anim
    this.activeAnimTask = anim.task
    this.addTask(anim.task)
  }

  skipAnimation(): void {
    this.activeAnim?.skip()
  }

  // Remove an in-flight submit animation WITHOUT firing its onDone — used when the shot
  // is replaced mid-pipeline (next/retry). The next update() restores ball state.
  cancelAnimation(): void {
    if (this.activeAnimTask) {
      this.tasks.delete(this.activeAnimTask)
      this.activeAnimTask = null
    }
    this.activeAnim = null
  }

  addTask(task: Task): void {
    this.tasks.add(task)
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
    if (!this.running) {
      this.running = true
      this.lastTime = performance.now()
      requestAnimationFrame(this.loop)
    }
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now
    this.dirty = false // consumed by this frame; a mid-frame invalidate() re-arms it

    let animating = false
    for (const task of [...this.tasks]) {
      if (!task(dt)) this.tasks.delete(task)
      else animating = true
    }
    if (this.cam.update(dt)) animating = true

    if (!this.lostContext && this.state) {
      this.balls.syncObjectShadow()
      this.renderer.render(this.scene, this.cam.camera)
      this.inset.render(
        this.renderer,
        this.scene,
        this.cam.camera,
        this.state.shot,
        this.state.ghost,
        this.table,
      )
      this.chevron.update(this.cam.camera, this.state.shot, this.table, this.cssW, this.cssH)
      assertCrossProjection(this.balls.ghost, this.state.ghost, this.table)
    }

    if (animating || this.dirty) {
      requestAnimationFrame(this.loop)
    } else {
      this.running = false // zero idle rAF (§2.1)
    }
  }

  currentStance(): Stance {
    return this.state?.stance ?? 'standing'
  }

  shotForDebug(): Shot | null {
    return this.state?.shot ?? null
  }
}
