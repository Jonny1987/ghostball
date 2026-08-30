import * as THREE from 'three'
import type { Vec2 } from '../core'

// THE single core↔world conversion site (PLAN.md §2.3): core works in mm with table
// coordinates (x along the long axis, y across), the scene works in metres, Y-up.
// core (x, y) at height h mm → world (x·0.001, BED_Y + h·0.001, y·0.001).

export const MM_TO_M = 0.001
export const BED_Y = 0.8 // bed surface height above the floor, metres

export function toWorld(p: Vec2, heightMm: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p.x * MM_TO_M, BED_Y + heightMm * MM_TO_M, p.y * MM_TO_M)
}

export function toCore(v: THREE.Vector3): Vec2 {
  return { x: v.x / MM_TO_M, y: v.z / MM_TO_M }
}
