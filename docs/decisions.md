# Decisions & tuning log

Running log of resolved decisions, tuning values, gate outcomes, and calibration results,
as required by PLAN.md.

## M0 — dependency versions (resolved 2026-08-30)

Per PLAN.md §2.2, versions resolved against the npm registry at M0. Every pin the research
docs guessed turned out to exist and be the latest stable — no fallbacks needed:

| package | resolved | notes |
|---|---|---|
| three | 0.185.1 | runtime dep (the only one) |
| @types/three | 0.185.4 | types matching three 0.185 |
| typescript | 7.0.2 | native (tsgo) line is stable and latest; 5.x-vocabulary strict flags verified working at M0 |
| vite | 8.2.2 | |
| vitest | 4.1.11 | |
| @biomejs/biome | 2.5.11 | |
| vite-plugin-pwa | 1.3.0 | deferred to M6 — added when the PWA milestone starts |
| @playwright/test | 1.62.1 | deferred to M6 (smoke test) |

Node 22 in CI (matches local dev container).

## Open gates that need a human / hardware (cannot be closed by the implementing agent)

- **S1 perceptual spike protocol**: the spike *build* can be served from the deployed app, but
  the ~50-rep per-stance error measurement and the go/retune/no-go verdict need the developer
  on both reference devices. Record results here.
- **M2 feel constants**: 80 px lift offset, 48 px grab radius, hold-repeat timings, 150 ms
  camera damping — implemented at the doc-inherited values; hands-on tuning on both reference
  devices is M2 acceptance, values to be recorded here.
- **M3 camera A/B**: D1/D2/D3 presets are implemented and switchable (`?rig=d1|d2|d3`);
  the blind 6-shot battery on both devices decides the default. D3 is the provisional default.
- **M5 verdict calibration**: pocketSlopMm / alphaMax / aimDepth knobs are config; the
  30-borderline-shot session with an outside player tunes them.
- **§2.9 subjective gates**: outside pool players to be recruited; screenshot gates judged
  per the plan's checklist protocol.
