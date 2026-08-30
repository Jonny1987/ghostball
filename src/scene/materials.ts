import * as THREE from 'three'

// Procedural materials (PLAN.md §2.1): zero downloaded assets. Cloth noise, ball gloss,
// wood rails, translucent ghost shell — all generated at runtime.

function noiseCanvas(size: number, base: [number, number, number], amp: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * 2 * amp
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n))
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n))
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n))
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export function clothMaterial(): THREE.MeshStandardMaterial {
  const canvas = noiseCanvas(256, [26, 96, 54], 9)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace // canvas pixels are sRGB — without this the cloth washes out
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(24, 12)
  const bump = new THREE.CanvasTexture(noiseCanvas(256, [128, 128, 128], 60))
  bump.wrapS = THREE.RepeatWrapping
  bump.wrapT = THREE.RepeatWrapping
  bump.repeat.set(24, 12)
  return new THREE.MeshStandardMaterial({
    map: tex,
    bumpMap: bump,
    bumpScale: 0.4,
    roughness: 0.95,
    metalness: 0,
  })
}

export function cushionMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x17492c, roughness: 0.9, metalness: 0 })
}

export function railMaterial(): THREE.MeshStandardMaterial {
  const tex = new THREE.CanvasTexture(noiseCanvas(128, [86, 52, 28], 14))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(8, 2)
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 })
}

export function pocketMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 1, metalness: 0 })
}

// Glossy phenolic-resin ball look (§M4A brought forward — cheap and load-bearing for realism).
export function ballMaterial(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  })
}

// Ghost ball: translucent shell that reads as hypothetical, never solid (§5).
export function ghostMaterial(color: number, opacity: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    clearcoat: 0.6,
  })
}

// Radial-gradient contact-shadow disc texture (fake AO under each ball, no shadow maps).
export function contactShadowTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(0,0,0,0.45)')
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  return new THREE.CanvasTexture(c)
}
