import type { Pocket, Table, TableConfig, TrackLine } from './types'
import { perp, vec } from './vec'

// WPA 9-ft defaults (PLAN.md §4.2). Origin at the bottom-left cushion-nose corner,
// +x along the long axis; playing surface [0, L] × [0, W] nose-to-nose.
export const DEFAULT_TABLE_CONFIG: TableConfig = {
  tableLengthMm: 2540.0,
  tableWidthMm: 1270.0,
  ballRadiusMm: 28.575,
  cornerMouthMm: 114.3,
  sideMouthMm: 127.0,
  pocketSlopMm: 5.0,
  alphaMaxRad: (60 * Math.PI) / 180,
  aimDepthMm: 0.0,
}

const R2 = Math.SQRT1_2 // √2/2

export function buildTable(cfg: TableConfig = DEFAULT_TABLE_CONFIG): Table {
  const L = cfg.tableLengthMm
  const W = cfg.tableWidthMm
  const r = cfg.ballRadiusMm
  const a = cfg.cornerMouthMm / Math.SQRT2 // jaw distance along boundary from corner (§4.3)
  const ms = cfg.sideMouthMm

  const mk = (
    id: number,
    type: Pocket['type'],
    j1: Pocket['j1'],
    j2: Pocket['j2'],
    m: Pocket['m'],
    n: Pocket['n'],
  ): Pocket => {
    const mouth = type === 'corner' ? cfg.cornerMouthMm : cfg.sideMouthMm
    const wEff = mouth / 2 - r + cfg.pocketSlopMm // §4.4
    const t = perp(n)
    return {
      id,
      type,
      j1,
      j2,
      m,
      n,
      t,
      wEff,
      e1: vec(m.x + wEff * t.x, m.y + wEff * t.y),
      e2: vec(m.x - wEff * t.x, m.y - wEff * t.y),
    }
  }

  // Pocket table exactly per PLAN.md §4.3 (t̂ = perp(n̂) points from M toward J1 in every row).
  const pockets: Pocket[] = [
    mk(0, 'corner', vec(a, 0), vec(0, a), vec(a / 2, a / 2), vec(-R2, -R2)),
    mk(1, 'side', vec(L / 2 + ms / 2, 0), vec(L / 2 - ms / 2, 0), vec(L / 2, 0), vec(0, -1)),
    mk(2, 'corner', vec(L, a), vec(L - a, 0), vec(L - a / 2, a / 2), vec(R2, -R2)),
    mk(3, 'corner', vec(L - a, W), vec(L, W - a), vec(L - a / 2, W - a / 2), vec(R2, R2)),
    mk(4, 'side', vec(L / 2 - ms / 2, W), vec(L / 2 + ms / 2, W), vec(L / 2, W), vec(0, 1)),
    mk(5, 'corner', vec(0, W - a), vec(a, W), vec(a / 2, W - a / 2), vec(-R2, R2)),
  ]

  // Ball-centre track lines, cushion spans jaw-bounded, mouth gaps mapped to pockets (§4.8).
  const INF = Number.POSITIVE_INFINITY
  const tracks: TrackLine[] = [
    {
      axis: 'y',
      value: r, // bottom rail
      spans: [
        [a, L / 2 - ms / 2],
        [L / 2 + ms / 2, L - a],
      ],
      gaps: [
        [-INF, a, 0],
        [L / 2 - ms / 2, L / 2 + ms / 2, 1],
        [L - a, INF, 2],
      ],
    },
    {
      axis: 'y',
      value: W - r, // top rail
      spans: [
        [a, L / 2 - ms / 2],
        [L / 2 + ms / 2, L - a],
      ],
      gaps: [
        [-INF, a, 5],
        [L / 2 - ms / 2, L / 2 + ms / 2, 4],
        [L - a, INF, 3],
      ],
    },
    {
      axis: 'x',
      value: r, // left rail
      spans: [[a, W - a]],
      gaps: [
        [-INF, a, 0],
        [W - a, INF, 5],
      ],
    },
    {
      axis: 'x',
      value: L - r, // right rail
      spans: [[a, W - a]],
      gaps: [
        [-INF, a, 2],
        [W - a, INF, 3],
      ],
    },
  ]

  return { cfg, pockets, tracks }
}

export const DEFAULT_TABLE: Table = buildTable()
