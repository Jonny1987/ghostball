import * as THREE from 'three'
import type { Table } from '../core'
import { clothMaterial, cushionMaterial, pocketMaterial, railMaterial } from './materials'
import { BED_Y, MM_TO_M } from './units'

// Procedural table (PLAN.md §2.1, M2 scope with M4B's jaw-bounded cushion layout from the
// start): bed, jaw-bounded cushions built from the SAME core track spans the simulator uses
// (the picture cannot lie about the geometry being trained), wood rails with pocket gaps,
// dark pocket liners, pool-hall lighting.

const CUSHION_H = 0.04 // nose height above bed, m
const CUSHION_DEPTH = 0.055
const RAIL_W = 0.14
const RAIL_H = 0.05
const APRON_DROP = 0.25

export function buildScene(table: Table): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0d10) // dark pool-hall surround

  const L = table.cfg.tableLengthMm * MM_TO_M
  const W = table.cfg.tableWidthMm * MM_TO_M

  // bed (top surface at BED_Y)
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L + 0.02, 0.04, W + 0.02), clothMaterial())
  bed.position.set(L / 2, BED_Y - 0.02, W / 2)
  scene.add(bed)

  // cushions: one box per jaw-bounded span, taken from core's track lines (§4.8).
  const cushMat = cushionMaterial()
  for (const track of table.tracks) {
    for (const [lo, hi] of track.spans) {
      const lenM = (hi - lo) * MM_TO_M
      const mid = ((lo + hi) / 2) * MM_TO_M
      const geo =
        track.axis === 'y'
          ? new THREE.BoxGeometry(lenM, CUSHION_H, CUSHION_DEPTH)
          : new THREE.BoxGeometry(CUSHION_DEPTH, CUSHION_H, lenM)
      const mesh = new THREE.Mesh(geo, cushMat)
      if (track.axis === 'y') {
        // track value r means bottom rail (boundary y=0), W−r means top (boundary y=W)
        const boundary = track.value < table.cfg.tableWidthMm / 2 ? 0 : W
        const off = boundary === 0 ? -CUSHION_DEPTH / 2 : CUSHION_DEPTH / 2
        mesh.position.set(mid, BED_Y + CUSHION_H / 2, boundary + off)
      } else {
        const boundary = track.value < table.cfg.tableLengthMm / 2 ? 0 : L
        const off = boundary === 0 ? -CUSHION_DEPTH / 2 : CUSHION_DEPTH / 2
        mesh.position.set(boundary + off, BED_Y + CUSHION_H / 2, mid)
      }
      scene.add(mesh)
    }
  }

  // wood rails with pocket gaps: reuse the same spans, pushed outward past the cushions.
  const railMat = railMaterial()
  for (const track of table.tracks) {
    for (const [lo, hi] of track.spans) {
      const lenM = (hi - lo) * MM_TO_M + 0.04
      const mid = ((lo + hi) / 2) * MM_TO_M
      const geo =
        track.axis === 'y'
          ? new THREE.BoxGeometry(lenM, RAIL_H, RAIL_W)
          : new THREE.BoxGeometry(RAIL_W, RAIL_H, lenM)
      const mesh = new THREE.Mesh(geo, railMat)
      const railOff = CUSHION_DEPTH + RAIL_W / 2 - 0.01
      if (track.axis === 'y') {
        const boundary = track.value < table.cfg.tableWidthMm / 2 ? 0 : W
        const off = boundary === 0 ? -railOff : railOff
        mesh.position.set(mid, BED_Y + RAIL_H / 2 - 0.005, boundary + off)
      } else {
        const boundary = track.value < table.cfg.tableLengthMm / 2 ? 0 : L
        const off = boundary === 0 ? -railOff : railOff
        mesh.position.set(boundary + off, BED_Y + RAIL_H / 2 - 0.005, mid)
      }
      scene.add(mesh)
    }
  }

  // pocket liners: dark cylinders sunk at each mouth midpoint, pushed slightly outward.
  const pocketMat = pocketMaterial()
  for (const pk of table.pockets) {
    const mouthM =
      (pk.type === 'corner' ? table.cfg.cornerMouthMm : table.cfg.sideMouthMm) * MM_TO_M
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(mouthM * 0.62, mouthM * 0.5, 0.12, 24),
      pocketMat,
    )
    const px = pk.m.x * MM_TO_M + pk.n.x * mouthM * 0.28
    const pz = pk.m.y * MM_TO_M + pk.n.y * mouthM * 0.28
    cyl.position.set(px, BED_Y - 0.045, pz)
    scene.add(cyl)
  }

  // apron under the rails, so the table reads as furniture, not a floating slab
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(
      L + 2 * (CUSHION_DEPTH + RAIL_W),
      APRON_DROP,
      W + 2 * (CUSHION_DEPTH + RAIL_W),
    ),
    railMat,
  )
  apron.position.set(L / 2, BED_Y - 0.02 - APRON_DROP / 2, W / 2)
  scene.add(apron)

  // floor far below, barely lit
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 1 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(L / 2, 0, W / 2)
  scene.add(floor)

  // lighting: one warm spot over the table + hemisphere fill (no shadow maps — contact
  // shadow discs carry grounding, §2.1)
  const spot = new THREE.SpotLight(0xfff2dd, 38, 0, Math.PI / 3.2, 0.45, 1.4)
  spot.position.set(L / 2, BED_Y + 1.7, W / 2)
  spot.target.position.set(L / 2, BED_Y, W / 2)
  scene.add(spot)
  scene.add(spot.target)
  const hemi = new THREE.HemisphereLight(0x3a4046, 0x14100c, 0.35)
  scene.add(hemi)

  return scene
}
