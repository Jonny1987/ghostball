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

## Design change: v2 free placement (2026-08-30, user decision)

The v1 constraint circle (ghost restricted to touching positions) made the drill too easy —
only the angle was being judged. v2, per the owner's direction:

- **Free 2D placement**: the ghost moves anywhere within a bounded disc around the object
  ball (`maxCenterDistMm` = 2×2r, i.e. up to one ball diameter of gap; overlap allowed all
  the way to centre). Judging the touching distance is now part of the skill.
- **Effective-contact physics**: the placed ghost expresses an AIM — the cue ball is driven
  from C along the ray through the placement and physics resolves where it first touches O
  (`effectiveContact`). Overlap/short placements contact at a slightly different angle than
  placed; an aim line passing > 2r from O is a **whiff** (new outcome). On-circle reachable
  placements reproduce v1 behaviour exactly, so the golden vectors carry over.
- **Scoring**: grade bands now on `positionErrorMm` = |U − G| (same numeric thresholds — 1°
  of arc at 2r ≈ 1 mm); plus signed `radialErrorMm` (gap/overlap) in the result panel and
  live in the contact chip.
- **Zoom framing**: the standing camera zooms in as far as possible while keeping the target
  pocket AND the whole placement region (plus ball + 15 mm margin) visible — implemented
  once in core (`fitStandingZoom`) and shared verbatim by the generator's frameability check
  (reference viewport) and the runtime camera (actual aspect). The cue ball may leave frame;
  the camera sits on the cue line so the perspective still carries the shot direction.
  Pocket frameability is now HARD for all levels. GENERATOR_VERSION bumped to 2 (old ?seed=
  links regenerate).
- **Opaque ghost**: fully opaque white ball (the dashed footprint ring marks it as
  hypothetical); reveal recolours it amber as before.
- **4-way nudges**: screen-space ◀▶▲▼ at 0.25 mm fine / 1 mm coarse (hold-accelerate),
  replacing the 1D arc arrows; down-view swipe is now 2D at 0.15 mm/px.
- Stats storage bumped to `gb.stats.v3` (mm-based records).

PLAN.md §2.4/§2.6/§4 describe the v1 model and are superseded on these points by this entry.

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
