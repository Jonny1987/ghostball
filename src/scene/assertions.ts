import type * as THREE from 'three'
import type { Table, Vec2 } from '../core'
import { toWorld } from './units'

// Runtime tripwires (PLAN.md §2.12), active in dev and ?debug=1 builds: on every rendered
// frame, recompute the ghost position from core θ, map through units.ts, and assert the
// mesh matches within 0.01 mm — any scene-layer drift is caught instantly.

const TOLERANCE_M = 0.00001 // 0.01 mm

export const assertionsEnabled: boolean =
  import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1'

let fired = false

export function assertCrossProjection(
  ghostMesh: THREE.Object3D,
  ghostPos: Vec2,
  table: Table,
): void {
  if (!assertionsEnabled || fired) return
  const expected = toWorld(ghostPos, table.cfg.ballRadiusMm)
  const err = expected.distanceTo(ghostMesh.position as THREE.Vector3)
  if (err > TOLERANCE_M) {
    fired = true // report once, loudly, without spamming every frame
    console.error(
      `CROSS-PROJECTION ASSERTION FAILED: ghost mesh is ${(err * 1000).toFixed(3)} mm from ` +
        `the store's ghost position — scene-layer drift (PLAN.md §2.12)`,
    )
  }
}
