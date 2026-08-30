import type { FullResult, LevelId, Shot, Vec2 } from '../core'
import type { Settings, StatsByLevel } from './storage'

// Typed pub/sub app state (PLAN.md §3). The store is the single source of truth; the
// scene, HUD, and debug views are projections of it.

export type Phase = 'aiming' | 'locked' | 'reveal' | 'animating' | 'result'
export type Stance = 'standing' | 'down'

export interface AppState {
  phase: Phase
  stance: Stance
  shot: Shot
  ghost: Vec2 // v2: the guess is a full 2D position (docs/decisions.md)
  result: FullResult | null
  level: LevelId
  assisted: boolean // peeked or retried — excluded from streak/averages (§5)
  peeking: boolean // hold-to-peek currently active
  stats: StatsByLevel
  settings: Settings
}

export type Listener = (state: AppState, prev: AppState) => void

export class Store {
  private state: AppState
  private listeners = new Set<Listener>()

  constructor(initial: AppState) {
    this.state = initial
  }

  get(): AppState {
    return this.state
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state
    this.state = { ...prev, ...patch }
    for (const l of this.listeners) l(this.state, prev)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
