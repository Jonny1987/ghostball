# Ghostball — ghost-ball trainer

A mobile-first web app that trains your ghost-ball visualisation: it generates pool shots,
shows them from the shooter's first-person perspective (standing and down on the shot),
lets you place a translucent ghost ball where you think the cue ball must strike, and on
submit tells you exactly how close you were — and whether the object ball would actually
have dropped, against real pocket-mouth geometry.

**Plan:** [`PLAN.md`](./PLAN.md) is the normative development plan; its §4 is the single
source of truth for all geometry. `docs/research/` holds extended background docs
(superseded by §4 where they disagree).

## Try it

```
npm ci
npm run dev        # local dev server
npm run ci         # typecheck + lint + tests + purity guard + build (what CI runs)
```

Deployed via GitHub Actions → GitHub Pages on pushes to `main` (enable Pages with source
"GitHub Actions" in repo settings on first deploy).

Useful URLs:

- `?seed=<n>&level=<1|2|3>&gv=1` — deterministic, shareable shots (same seed = same shot
  on every device). A `gv` mismatch after a generator change regenerates rather than
  silently reproducing a different shot.
- `?debug=1` — top-down oracle overlay rendering the same core state as the 3D scene.
- `?rig=d1|d2|d3` — down-stance camera candidates for the on-device A/B (PLAN.md §2.11).

## How it works

- The entire guess is **one angle θ** on the circle of radius 2r around the object ball —
  every drag, swipe and nudge projects onto it, so the ghost can only ever sit where it
  touches the object ball, on the arc the cue ball can actually reach (the 4r² condition,
  PLAN.md §4.6).
- Submit runs an exact event simulation (jaw-bounded cushions, jaw-rattle rule,
  approach-angle cap) and reports angular/mm error with direction ("too thin"), the grade
  band, and the pocket's real forgiveness window at that distance — clipped against the
  simulator so the copy is never false.
- `src/core/` is pure, dependency-free geometry in mm/radians, enforced by CI (import
  grep + a no-DOM tsconfig) and covered by golden-vector, property, and boundary tests.
  The 3D scene and the top-down debug view are two independent projections of the same
  state, cross-checked at runtime by an assertion.

## v1 physics simplifications (deliberate — PLAN.md §10)

Pure line-of-centres model: no throw, spin, squirt, swerve, or speed effects; pocket
forgiveness via effective mouth width + slop and an approach-angle cap; first cushion ends
the simulation (the bounce in the animation is theatre, asserted to end at the analytic
event point). All knobs live in `TableConfig` for the M5 calibration session.

## Repo layout

```
src/core/    pure geometry + tests (the product)
src/scene/   Three.js first-person layer
src/ui/      store, HUD, result panel, localStorage stats
src/debug/   top-down canvas oracle (?debug=1, result mini-map)
docs/        decisions log, vendored research, (screenshots per milestone)
```
