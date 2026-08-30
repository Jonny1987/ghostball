// Pure 2D vector helpers. Units: mm and radians throughout src/core (PLAN.md §4.1).

export interface Vec2 {
  x: number
  y: number
}

export const EPS = 1e-6 // mm
export const ARC_EPS = (0.5 * Math.PI) / 180 // 0.5° in radians

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

// Caller guarantees |a| > EPS (PLAN.md §4.1).
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a)
  return { x: a.x / l, y: a.y / l }
}

export const wrapToPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

// Angle between two vectors in [0, π] — atan2 form, never acos(dot/…) near 0/π (§4.1).
export const angleBetween = (a: Vec2, b: Vec2): number =>
  Math.atan2(Math.abs(cross(a, b)), dot(a, b))

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export const degToRad = (d: number): number => (d * Math.PI) / 180
export const radToDeg = (r: number): number => (r * 180) / Math.PI

// Unit vector at angle θ (CCW from +x).
export const unit = (theta: number): Vec2 => ({ x: Math.cos(theta), y: Math.sin(theta) })

export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}
