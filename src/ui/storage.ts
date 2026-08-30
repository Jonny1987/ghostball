import type { Band, LevelId } from '../core'

// localStorage schema per PLAN.md §5 — every access try/catch wrapped; the app runs
// session-only when storage is unavailable.

export interface Settings {
  level: LevelId
  sound: boolean
  haptics: boolean
  cueStick: boolean
  contactChip: boolean
  inset: 'auto' | 'on' | 'off'
}

export interface AttemptRecord {
  errDeg: number
  band: Band
  potted: boolean
  assisted: boolean
  difficultyRaw: number
}

export interface LevelStats {
  attempts: number
  potted: number
  assisted: number
  streakCurrent: number
  streakBest: number
  bestErrorDeg: number | null
  recent: AttemptRecord[]
}

export type StatsByLevel = Record<string, LevelStats>

const SETTINGS_KEY = 'gb.settings.v1'
const STATS_KEY = 'gb.stats.v2'
const RECENT_CAP = 100

export const DEFAULT_SETTINGS: Settings = {
  level: 2, // new users land on Club (§2.10)
  sound: true,
  haptics: true,
  cueStick: true,
  contactChip: true,
  inset: 'auto',
}

export const emptyLevelStats = (): LevelStats => ({
  attempts: 0,
  potted: 0,
  assisted: 0,
  streakCurrent: 0,
  streakBest: 0,
  bestErrorDeg: null,
  recent: [],
})

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable — session-only mode
  }
}

export function loadSettings(): Settings {
  const stored = read<Partial<Settings>>(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s)
}

export function loadStats(): StatsByLevel {
  return read<StatsByLevel>(STATS_KEY) ?? {}
}

export function saveStats(stats: StatsByLevel): void {
  write(STATS_KEY, stats)
}

export function statsFor(stats: StatsByLevel, level: LevelId): LevelStats {
  return stats[String(level)] ?? emptyLevelStats()
}

// Streak = consecutive pots (§2.7); peeked/retried attempts are excluded from
// streaks, averages, and bests but still counted as attempts.
export function recordAttempt(
  stats: StatsByLevel,
  level: LevelId,
  rec: AttemptRecord,
): StatsByLevel {
  const cur = { ...statsFor(stats, level) }
  cur.attempts += 1
  if (rec.assisted) {
    cur.assisted += 1
  } else {
    if (rec.potted) {
      cur.potted += 1
      cur.streakCurrent += 1
      cur.streakBest = Math.max(cur.streakBest, cur.streakCurrent)
    } else {
      cur.streakCurrent = 0
    }
    cur.bestErrorDeg =
      cur.bestErrorDeg === null ? rec.errDeg : Math.min(cur.bestErrorDeg, rec.errDeg)
  }
  cur.recent = [...cur.recent, rec].slice(-RECENT_CAP)
  const next = { ...stats, [String(level)]: cur }
  saveStats(next)
  return next
}

// Zero-cost level-up heuristic (§2.10): 8 consecutive unassisted pots, or pot % ≥ 80
// over the last 20 unassisted attempts.
export function suggestLevelUp(stats: StatsByLevel, level: LevelId): boolean {
  if (level >= 3) return false
  const cur = statsFor(stats, level)
  if (cur.streakCurrent >= 8) return true
  const unassisted = cur.recent.filter((r) => !r.assisted).slice(-20)
  if (unassisted.length >= 20) {
    const pots = unassisted.filter((r) => r.potted).length
    return pots / unassisted.length >= 0.8
  }
  return false
}
