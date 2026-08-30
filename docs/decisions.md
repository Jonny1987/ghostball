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

## Implementation state (2026-08-30)

Milestones M0, M1a, M1b, M2, M3 and most of M5 are implemented and verified headlessly
(51 core tests green; full loop driven in Chromium in both stances with no console
errors; app 149 kB gz, well under the 220 kB target). Notable in-flight decisions:

- **sRGB canvas textures**: procedural CanvasTextures must set
  `colorSpace = THREE.SRGBColorSpace` or the cloth washes out under ACES — found and
  fixed during the M2 visual pass.
- **Ball gloss + contact shadows pulled forward from M4A** (cheap, large realism gain);
  the full M4A/M4B passes (cushion jaw extrusion, cloth bump tuning, screenshot gates)
  remain open.
- **M5 items implemented**: full state machine with locked/reveal/animating phases,
  kinematic playback with skip + reduced-motion fallback, near-overlap reveal (truth as
  outline ring + exact gap row at β ≤ 1.5°), result mini-map, streak/stats/level-up
  heuristic, hold-to-peek with assisted flagging.
- **M5/M6 items still open**: stats sheet UI (data already collected), settings sheet,
  tap-to-explain popovers + glossary, onboarding cards, sounds, PWA (vite-plugin-pwa),
  Playwright smoke test in CI.

## Open gates that need a human / hardware (cannot be closed by the implementing agent)

- **S1 perceptual spike protocol**: the deployed app itself now serves as the spike build
  (both stances, drag + nudge, `?seed=` for a fixed battery) — no separate throwaway
  needed. The ~50-rep per-stance error measurement and the go/retune/no-go verdict need
  the developer on both reference devices. Record results here.
- **M2 feel constants**: 80 px lift offset, 48 px grab radius, hold-repeat timings, 150 ms
  camera damping — implemented at the doc-inherited values; hands-on tuning on both reference
  devices is M2 acceptance, values to be recorded here.
- **M3 camera A/B**: D1/D2/D3 presets are implemented and switchable (`?rig=d1|d2|d3`);
  the blind 6-shot battery on both devices decides the default. D3 is the provisional default.
- **M5 verdict calibration**: pocketSlopMm / alphaMax / aimDepth knobs are config; the
  30-borderline-shot session with an outside player tunes them.
- **§2.9 subjective gates**: outside pool players to be recruited; screenshot gates judged
  per the plan's checklist protocol.
