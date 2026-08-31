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

**v2.1 (same day):** the standing view's look direction is now forced so the placement
region (centred on the object ball, where the ghost lives) sits at the horizontal centre of
the screen; the FOV widens just enough to keep the pocket in frame off to one side. The
camera stays fixed per shot (yawing to follow the ghost live would slide the scene under
the finger mid-drag), and the ghost's ±114 mm wander keeps it within ~1–2° of centre.
GENERATOR_VERSION → 3.

**v2.2 (2026-08-31):** two follow-ups from on-device use. (1) The standing view now
horizontally centres the **ghost ball itself**, not the placement-region centre: after a
nudge or a drag-release the camera yaws onto the ghost (damped, ~0.3 s), but it stays
frozen **during** a drag (re-aiming mid-drag would slide the table under the finger —
`onDragState` wires the freeze). The FOV is measured from the object ball plus slack for
the ghost's maximum wander, so the zoom is **constant per shot**: following the ghost only
yaws the camera, and every legal placement keeps the pocket + region in frame at that
fixed zoom. (2) The down view now fits the **target pocket** too: the eye stays on the aim
line (in plan view eye/cue/ghost are collinear — the stance's identity), the look centres
the {ghost, object ball, pocket} bounding box, and the FOV widens from the rig's natural
value up to 66°; still not enough → the eye dollies straight back along the aim line (up
to 3 m — receding narrows the angular spread, so this always converges eventually); in
the rare degenerate remainder (ultra-wide spreads on narrow screens) it falls back to the
classic ghost-look pose and the edge chevron still points at the pocket. Since the fit
often lands the pocket near a top corner, the contact-zoom inset now dodges it: it flips
to the opposite top corner when its slot would cover the pocket (hysteresis — it only
moves when its own slot is violated). GENERATOR_VERSION → 4 (the standing FOV now
includes the wander slack, which changes frameability check 6).

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
