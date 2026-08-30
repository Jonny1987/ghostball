import * as THREE from 'three'
import type { FullResult } from '../core'

// ~30-line tween helper + the kinematic submit animation (PLAN.md §3 animate.ts).
// The playback is DRIVEN BY the analytic result — the ball rolls to result.sim.event.point,
// so the animation can never contradict the verdict; §2.12's assertion checks it anyway.

export type Task = (dt: number) => boolean // return false when finished

export function tween(
  durationS: number,
  onUpdate: (t: number) => void,
  onDone?: () => void,
  ease: (t: number) => number = (t) => 1 - (1 - t) * (1 - t), // ease-out quad = decelerating roll
): Task {
  let elapsed = 0
  return (dt) => {
    elapsed += dt
    const t = Math.min(1, elapsed / durationS)
    onUpdate(ease(t))
    if (t >= 1) {
      onDone?.()
      return false
    }
    return true
  }
}

export interface SubmitAnimation {
  task: Task
  skip: () => void
}

const UP = new THREE.Vector3(0, 1, 0)

export function submitAnimation(
  objectMesh: THREE.Mesh,
  fromWorld: THREE.Vector3,
  toWorld_: THREE.Vector3,
  ballRadiusM: number,
  result: FullResult,
  onDone: () => void,
): SubmitAnimation {
  const dir = toWorld_.clone().sub(fromWorld)
  const distM = dir.length()
  dir.normalize()
  const rollAxis = new THREE.Vector3().crossVectors(UP, dir).normalize()
  const duration = Math.min(2.2, Math.max(0.55, distM * 1.1))
  let finished = false
  let phase2: Task | null = null

  const finish = (): void => {
    if (finished) return
    finished = true
    // Animation–verdict assertion (§2.12): the roll must end at the analytic event point.
    const err = objectMesh.position.clone().setY(fromWorld.y).distanceTo(toWorld_)
    if (err > 0.001 + 0.0001 && !result.potted) {
      console.warn(`animation-verdict assertion: endpoint off by ${(err * 1000).toFixed(2)} mm`)
    }
    onDone()
  }

  const startPhase2 = (): void => {
    if (result.potted || result.outcome === 'wrong_pocket') {
      // drop into the pocket: sink + shrink
      const startY = objectMesh.position.y
      phase2 = tween(
        0.22,
        (t) => {
          objectMesh.position.y = startY - 0.1 * t
          objectMesh.scale.setScalar(1 - 0.5 * t)
        },
        () => {
          objectMesh.visible = false
          finish()
        },
      )
    } else {
      // one damped cushion/jaw recoil — pure theatre, ends where it started (the event point)
      const recoil = 0.035
      phase2 = tween(
        0.3,
        (t) => {
          const k = Math.sin(t * Math.PI) * (1 - t)
          objectMesh.position.set(
            toWorld_.x - dir.x * recoil * k,
            toWorld_.y,
            toWorld_.z - dir.z * recoil * k,
          )
        },
        () => {
          objectMesh.position.copy(toWorld_)
          finish()
        },
      )
    }
  }

  const roll = tween(
    duration,
    (t) => {
      objectMesh.position.copy(fromWorld).addScaledVector(dir, distM * t)
      // rolling rotation: angle = arc length / radius about up × dir
      objectMesh.rotateOnWorldAxis(rollAxis, 0) // keep axis normalized reference
      objectMesh.quaternion.setFromAxisAngle(rollAxis, (distM * t) / ballRadiusM)
    },
    startPhase2,
  )

  const task: Task = (dt) => {
    if (finished) return false
    if (phase2) return phase2(dt)
    const alive = roll(dt)
    // the roll's completion starts phase 2 — keep the task alive for it
    return alive || phase2 !== null
  }

  return {
    task,
    skip: () => {
      objectMesh.position.copy(toWorld_)
      if (result.potted || result.outcome === 'wrong_pocket') objectMesh.visible = false
      finish()
    },
  }
}
