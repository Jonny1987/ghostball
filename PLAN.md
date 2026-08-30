# Ghostball — Final v1 Development Plan

**Repo:** `Jonny1987/ghostball` (empty). Solo developer, AI-assisted, static hosting on GitHub Pages. This plan is the synthesis of a judged competition: the MVP-first backbone, with the realism-craft and training-rigour ideas grafted in, and every judge-identified weakness explicitly fixed. It is self-sufficient — all load-bearing formulas, constants, and golden test vectors are inline in §4, and the four research documents are vendored in `docs/research/` alongside this plan so no acceptance criterion dangles. After synthesis, the plan went through an adversarial review pass (a geometry skeptic working every formula with numeric counterexamples, plus a completeness critic); the fixes — including a corrected cushion/pocket event model in §4.8 that the original spec got wrong — are folded in below and logged in Appendix B.

Sequencing principle: the smallest usable training loop ships in week 2–3 (top-down), the full stated requirement set is met at M3, and every milestone leaves `main` green and deployed. Two things run **before** major investment: a day-one perceptual spike that tests whether the core product premise (judging ghost position to ~0.5–3° in a perspective view on a phone) is even achievable, and a calibration pass that stops the app from confidently grading against a slightly-wrong truth.

---

## 1. Product definition & core loop

**One sentence:** a mobile-first web app that generates pool shots, shows them from the shooter's first-person perspective (standing and down on the shot), and trains the user to judge the ghost-ball position by letting them place a constrained translucent ball, then scoring the guess against exact geometry — including whether the object ball would actually have dropped.

**The realism bar, defined (adopted from the realism draft as written acceptance language):** *pool-hall plausibility plus camera truthfulness — not photorealism.* Camera truthfulness means real eye heights, a normal-lens FOV, and down-view horizon/cushion stacking that a real shooter would recognise. The concrete test: a screenshot of the down view makes a pool player nod. This converts "realistic" from vibes into testable milestone criteria (§6, M3/M4).

**Offline is a product feature, not a checkbox:** pool halls and basements have no signal. The PWA milestone (M6) exists so the app works fully offline at the table, which is where it will actually be used.

**The core loop (the MVP is exactly this, nothing more):**

1. App generates a valid shot: cue ball (C), object ball (O), target pocket — highlighted.
2. Ghost ball spawns already on the constraint circle (radius 2r around O), at the straight-through angle jittered ±15–30°, so there is never a cold-start "where do I tap".
3. User drags it — every input is projected onto the reachable arc, so illegal positions are impossible by construction — and fine-tunes with two nudge arrows (plus a contact-zoom inset for sub-pixel precision, §2.6).
4. User toggles between standing view (place) and down-on-the-shot view (verify the overlap picture), adjusting in either.
5. Submit → the app reveals the true ghost, reports angular/mm error with direction ("1.8 mm too thin"), and simulates the object ball's departure against real pocket-mouth width to declare POTTED / MISSED (rattled, wrong pocket, cushion).
6. Next shot. Endless drill; streak and rolling error stats provide progression. No accounts, no backend, all state in `localStorage`.

**Rep-time budget (adopted feel gate):** submit → next-shot-aimable ≤ 4 s when skipping the animation. The loop's cadence is the product.

**Requirement coverage map:**

| Req | Satisfied by |
|---|---|
| 1. Mobile + desktop web | M0 scaffold, M2 touch input + feel tuning, M6 PWA/safe-areas |
| 2. Realistic first-person, two stances, table/CB/OB/pocket visible | M2 (standing, basic), M3 (down stance + camera A/B), M4A/M4B (realism passes). Pocket visibility, honestly: hard-guaranteed in the standing view on Level 1, generation-preferred on Level 2 (§4.10), chevron + distance label otherwise; the down view's sightline physically cannot contain the pocket on wide cuts, so the chevron stands in there — a recorded deviation from "pocket always on screen", not a silent drop |
| 3. Translucent ghost ball placement | M1 (logic), M2 (3D) |
| 4. Constrained to touching positions only | M1 (`constraint.ts`, θ parameterisation, 4r² reachability) |
| 5. Arrow fine-nudge for mobile precision | M1 (logic), M2 (DOM buttons + contact-zoom inset) |
| 6. Submit → closeness + real-pocket pot verdict | M1 (full scoring/simulation), M2 (UI), M5 (rich feedback + verdict calibration) |
| 7. Shot generation for practice | M1 (seeded generator + seed-in-URL), M5 (difficulty levels + level-up heuristic) |

---

## 2. Key design decisions & rationale

### 2.1 Rendering: Three.js, fully procedural, render-on-demand — ADOPTED

Only option satisfying "realistic" + generated layouts + a down-view camera that re-sights along the cue→ghost line as the guess changes. 2D canvas and CSS 3D can't reach the realism bar (worst exactly in the near-edge-on down view); pre-rendered images cannot serve a continuum of generated viewpoints. Three.js is also the best-supported 3D library in AI training data — a real velocity multiplier here. Sub-decisions adopted wholesale: procedural materials (zero downloaded textures), IBL via `RoomEnvironment` + one shadowed SpotLight + contact-shadow discs, MSAA + DPR ≤ 2, **no post-processing**, **no physics engine** (outcome is analytic; animation is kinematic theatre), dirty-flag render-on-demand (battery-critical for long phone sessions). Realism work is quarantined into two gated passes (M4A/M4B) *after* the loop is playable.

### 2.2 Stack: TypeScript strict + Vite + vanilla TS + one runtime dep (`three`) — ADOPTED

No React/Svelte (the HUD is ~12 elements; a framework fights the imperative scene layer), no physics/tween/state libraries, Biome for lint+format, Vitest for tests, GitHub Actions → GitHub Pages, `vite-plugin-pwa` (M6). Versions are resolved at M0, not asserted here: the first M0 task is `npm view` on each tool, pinning the latest stable (`three` ≥0.180, Vite, TypeScript — latest 5.x line unless the native 7.x line is stable, since the strict-flag set below is 5.x vocabulary — Vitest, Biome, `vite-plugin-pwa`, `@playwright/test`) and recording the exact resolved versions in `docs/decisions.md`; the fallback rule on any surprise is nearest stable of the same major. Hard rule: `src/core/` touches **nothing** outside itself — no `three`, no DOM imports, and no DOM *globals* either. Enforced three ways: CI grep on imports, Biome restricted-imports + `noRestrictedGlobals` (window, document, navigator, performance), and `src/core/tsconfig.json` with `"lib": ["ES2022"]` (no DOM lib) so any stray `document.*` is a type error, not a convention.

### 2.3 Units — mm in core, metres in scene

`src/core` works in mm and radians exactly as §4 is written (its test vectors are mm; transcribing invites errors). The scene layer converts at its boundary with `MM_TO_M = 0.001` and builds the Three scene in metres so eye heights, FOV, and light falloff are physically meaningful. Mapping: core `(x, y)` → world `(x·0.001, bedY + h, y·0.001)`, Y-up, `bedY = 0.80 m`, ball centres at `bedY + r`. This mapping lives in exactly one file (`scene/units.ts`).

### 2.4 Constraint & interaction model: single scalar θ — with the corrected reachability condition

The entire guess is one angle θ on the circle of radius 2r around O. Every input path (drag, swipe, nudge) resolves to θ; the constraint is unbreakable and the state trivially serialisable.

**The reachability condition is `dot(U − O, C − O) ≥ 4r²`** (half-width `Δ = arccos(2r/D)` about the O→C direction), **not** the naive facing-half-circle `dot > 0`. The 4r² threshold simultaneously excludes ≥90° cuts and guarantees the cue ball's straight path to U isn't blocked by the object ball (derivation in §4.6). Because this is exactly the condition the research documents disagreed on, dedicated boundary tests sit at ψ = Δ on both sides (§7).

**Per-stance drag model:** standing view uses absolute drag (raycast to ball-centre-height plane, radial projection to the arc, 80 px lift offset so the finger never covers the ball, 48 px grab radius); down view uses **relative horizontal aim-swipe** (0.08°/px provisional) because the camera is locked to the aim line there and absolute drag makes no sense. The down camera re-aims with ~150 ms critically-damped smoothing on every change — this dissolves the "camera moving under the finger" problem without freeze hacks. All these numbers (0.08°/px, 80 px, 48 px, 150 ms) are **doc-inherited guesses that have never touched hardware**; tuning them on both reference devices is part of M2's acceptance criteria, not deferred polish.

### 2.5 The core perceptual bet — validated in week one, not week five (NEW; fixes the biggest all-drafts weakness)

The whole product assumes a human can judge θ to the 0.5–3° the grade bands assume, from a monocular perspective render of a 57 mm sphere on a ~6-inch screen. No draft tested this before building the full 3D scene. **S1 (§6) is a 2–3 day throwaway spike**, run immediately after M0 and in parallel with M1a: three flat-shaded spheres, a plane, both camera rigs as config presets, drag + nudge on a hard-coded shot with hard-coded truth. Protocol: ~50 self-reps per stance, log placement error per rep. Gates:

- **Go:** median achievable error ≤ 3° in the down view → build order proceeds unchanged.
- **Retune:** 3–6° → camera height/FOV/distance iteration inside the spike (it's throwaway code — iterate freely) plus mandatory contact-zoom inset (§2.6) before M2 is accepted.
- **No-go (>6° after retuning):** the perceptual design changes before further investment — named fallback depth cues, in escalation order: stronger footprint ring, contact-shadow emphasis, always-on contact-zoom inset, a subtle 0.5° camera parallax wiggle on request (structure-from-motion depth), and as last resort re-scoping the standing view toward a higher, more diagrammatic camera. Camera retuning at any later point is treated as a **product bug, not polish**.

The spike also measures the just-noticeable Δθ per stance on both reference devices, which sets the final nudge-visibility acceptance numbers (§2.6), and produces the first archived screenshot pair.

### 2.6 Nudge design — numerate this time (fixes the innumerate acceptance criteria)

Tap = 0.25°. Any step ≤1.0° makes the ±0.5° "Perfect" band reachable in principle (the nearest tap-lattice point is ≤ step/2 away); 0.25° is a margin choice, not a necessity — it puts ~4 lattice points inside the Perfect band so it is comfortably hittable under real motor/timing error. Hold repeats at 15/s after 350 ms, escalating to 1.0° steps after 1.2 s; release resets to fine. Two arrows only (left/right), resolved in screen space with hysteresis — never labelled thicker/thinner (the mapping flips per cut side). 64 px DOM overlays, bottom corners.

**The visibility math, stated honestly.** On a ~390 CSS-px-wide portrait phone at ~55° horizontal FOV, world scale at the ghost is ≈ 2·d·tan(27.5°)/390 px:

| Stance | eye→ghost distance | scale at ghost | one 0.25° step (0.25 mm) |
|---|---|---|---|
| Standing | ~1.6–2.2 m | ~4.5–6 mm/px | **0.04–0.06 px — invisible** |
| Down | ~1.1–1.5 m+ | ~3–4 mm/px | **0.06–0.08 px — still sub-pixel** |

So "nudges visibly move the ghost" is unachievable as raw pixels in *either* stance, and the plan stops pretending otherwise. Design consequences:

1. **Standing drag is coarse placement only, by design.** Its acceptance criterion is drag fidelity, not nudge visibility.
2. **The contact-zoom inset is the designed carrier of fine-step feedback**: a picture-in-picture second render pass (`scene/inset.ts`) aimed at the ghost/OB contact region. One pixel convention, stated once: inset = 40 % of the 390 CSS-px reference screen = 156 CSS px = **312 device px at DPR 2**. At FOV 5° and eye→contact ≈ 1.2 m, visible width = 2·1200·tan(2.5°) ≈ 104.8 mm → **0.34 mm/device-px**, so one 0.25° step (0.249 mm of arc) ≈ **0.74 device px ≈ 0.37 CSS px** — a discernible antialiased shift at device resolution. S1 verifies discernibility on hardware and may narrow the FOV to 3–4° if it isn't. Shown while arrows are active in the down stance (and optionally always-on via settings; the spike decides the default).
3. **Every nudge also gets guaranteed non-spatial feedback**: the contact chip (fullness formula and bands defined in §4.9) updates at 0.1 % resolution, plus a visual tick on the arrow button (§5). Sensitivity, honestly: Δfullness per 0.25° step ≈ cos(φ)·0.44 %, i.e. ~0.3–0.4 % on small-to-mid cuts but only ~0.08 % at φ = 80°, so on thin cuts (φ > 70°) the chip's cut-angle readout (0.1° resolution, moves ~0.25° per step at any cut) is the guaranteed carrier instead — the chip always shows both.
4. **Restated acceptance criteria (M2/M3):** a single 0.25° nudge produces a discernible change in the contact-zoom inset and updates the contact chip; an accumulated 1.0° change is verifiable in the naked down-view overlap picture or, failing that, the inset; the spike's measured JND per stance replaces these provisional numbers if it disagrees.

Nudge past the arc limit hard-stops with a visual bump + haptic. **Every haptic is paired with a visual/audio equivalent** because `navigator.vibrate` silently no-ops on iOS: per-step `vibrate(8)` + 60 ms arrow-button flash + optional tick sound; limit bump `vibrate([25,30,25])` + 5 % ghost squash + edge flash + thud sound. iOS users lose only the vibration, never the signal.

### 2.7 Scoring model — geometry simulation + UX grade bands

- **Outcome** from the full event simulation (§4.8): object ball departs along the line of centres; earliest event among six pockets (effective mouth segments, approach-angle cap) and four cushion lines decides `target_pocket | wrong_pocket | cushion`. Exact, and handles wrong-pocket/cushion outcomes for free.
- **Error** canonical in degrees: `β = |wrapToPi(θ_user − θ_true)|`, with the pedagogically central identity **ghost angular error = object-ball direction error** stated in the UI. Displayed conversions: arc mm (2r·β), contact-point mm (r·β), signed direction (thin/full).
- **Grade bands** (canonical degrees, table-agnostic): Perfect ≤0.5°, Excellent ≤1.5°, Good ≤3°, Close ≤6°, Miss. Band and pot outcome shown together and allowed to disagree ("Excellent placement, but this 2 m pot needed Perfect") — that disagreement is the key lesson about distance sensitivity; surface it with a one-liner. The mm-based verdict tiers are dropped (two grading systems is one too many).
- **The allowed window** reported with every result — "the pocket forgave ±2.8° from here; you were 2.3° off." The jaw-subtended angles β₊/β₋ are only upper bounds: near a rail, part of the window is shadowed by the cushion (the ball clips the rail before reaching the mouth), so the reported window is **clipped against the actual simulator** (§4.9) and is never a promise the table won't keep.
- **Streak = consecutive pots**, not consecutive Perfects — potting is the goal a learner *feels*; Perfect-streaks punish exactly the people the tool is for. Stated here as a deliberate pedagogical choice.

### 2.8 The graded truth is a model, and gets calibrated (NEW; fixes unvalidated-constants weakness)

θ_true aims at the pocket-mouth midpoint (AIM_DEPTH = 0) under a frictionless, no-throw model, and the pot verdict depends on the `pocketSlopMm = 5` and `alphaMax = 60°` knobs — all inherited guesses. A trainer that confidently grades against a slightly-wrong truth mis-trains. Two fixes:

1. **Sensitivity test (automated, M1a):** over 1000 generated shots per level, compute `|θ_true(AIM_DEPTH=20 mm) − θ_true(AIM_DEPTH=0)|`. Assert the 95th percentile ≤ 1.5° (half a "Good" band). Where near-rail oblique cuts exceed it, tighten the generator (approach-angle caps / min pocket distance) rather than grade against an uncertain truth. Help copy states the model: "graded against centre-pocket aim under a frictionless model."
2. **Verdict calibration session (M5, timeboxed):** a script generates ~30 borderline shots (|margin| ≤ 6 mm or miss ≤ 6 mm), replayable via `?seed=`. The developer plus one outside pool player rate each verdict "believable on a real table?". Tune `pocketSlopMm ∈ [3,8]`, `alphaMax ∈ [55°,65°]`, corner `AIM_DEPTH ∈ [0,20]` from that; record final values and rationale in `docs/decisions.md` and the in-app help. Golden fixtures are parameterised on the config so retuning doesn't orphan them.

### 2.9 Subjective gates: named judge, timebox, decision rule (NEW; applies everywhere)

Every subjective gate in this plan ("a pool player nods", "satisfying pot moment", "reads like being on the shot") uses one protocol: **Judges** = the developer + at least one named outside pool player (recruit 1–2 pool-playing friends at M0; they test the *deployed* build). **Timebox** = max two tuning sessions (≤ 4 h each) per gate. **Decision rule** = each gate has a written checklist; ≥ 80 % of items passing with no "fails the premise" item = good enough, ship; remaining items are logged to v2 in `docs/decisions.md`. This bounds what would otherwise be unbounded solo iteration loops, and gets outside eyes on the two milestones where the developer's own eye is least trustworthy: the down stance (M3) and feedback (M5).

### 2.10 Difficulty — three levels + a zero-cost progression heuristic

Three parameter-range levels (Straight-ish / Club / Sharp) fed to the generator; the star *UI* is cut from v1. But **`difficulty_raw` (§4.10) is computed and stored on every shot as metadata anyway** — it costs nothing, lets the stats sheet plot the user's error against true shot difficulty now, and is the data foundation for v2 adaptive drilling with no schema change. **Level-up heuristic (fixes the flat-curve weakness):** after 8 consecutive unassisted pots at a level (or pot % ≥ 80 over the last 20) and level < 3, show a one-time-per-session toast — "You're potting everything — try Sharp?" [Switch] [Stay]. Never auto-switch. New users land on Level 2 (Club) with a first-run hint that Level 1 exists.

### 2.11 Camera rigs: config, A/B'd on device, then locked

All camera constants live in one tuning config (`scene/cameras.ts` preset objects). The research docs disagree on the down rig, so M3 runs a **structured on-device A/B** rather than vague tuning: candidates D1 (eye ~0.17 m above bed, 1.0 m behind C, from the rendering doc), D2 (0.28 m above bed, 0.35 m behind C, FOV ~45°, from the UX doc), D3 (midpoint 0.22 m / 0.9 m). Same seeded 6-shot battery, both reference devices, blind order, judged per §2.9 on: horizon/cushion stacking truthfulness, overlap-picture legibility, pocket visibility. One session, choice recorded in `docs/decisions.md`. Standing rig starts at eye 1.62 m / 1.3 m behind C, portrait-first FOV: target horizontal ~55–60°, derive vertical from aspect, clamp [50°, 70°] (wider renders balls as eggs — fatal in a ball-geometry app).

### 2.12 Scene-layer tripwires instead of scene-layer tests (NEW)

The scene layer gets no unit tests, but "parity by construction" is upgraded from a claim to two permanent self-checks (`scene/assertions.ts`, active in dev and `?debug=1` builds):

1. **Cross-projection assertion:** on every invalidated frame, recompute `U = O + 2r·ê(θ)` in core, map through `units.ts`, and assert the ghost mesh's world position matches within 0.01 mm; the top-down debug view renders from the same θ. Any scene-layer drift (a stray mesh mutation, a broken unit conversion — the classic AI-generated-Three.js failure) is caught instantly.
2. **Animation–verdict assertion:** the kinematic playback's object-ball path endpoint must equal the analytic event point within 1 mm, including jaw-margin cases (assert in dev, log-only in prod). The animation is *driven by* the analytic result, so this should never fire — which is exactly what makes it a cheap tripwire.

Plus a standing manual diff: **archived before/after screenshot pairs per stance** in `docs/screenshots/<milestone>/` and in the PR description of every visual milestone (M2, M3, M4A, M4B) — the cheapest substitute for visual regression testing.

### 2.13 Other adopted decisions (brief)

Ghost spawns pre-placed at jittered straight-through angle (no cold start, no answer leak). Standing camera fixed per shot; down camera follows the guess, damped. Down-view *and standing-view* pocket-off-frame handled honestly with a shared edge-chevron + distance-label component — never fisheye (the standing extension fixes the unproven-framing weakness; see also generator check §4.11). Kinematic submit animation with rolling rotation and one damped cushion bounce; tap to skip; reduced-motion replaces it with drawn trajectory lines. Endless drill, no gating; retry and peeked attempts excluded from stats. Seed-in-URL (`?seed=`) from the top-down milestone onward — free deterministic bug reports and shareable shots from week one.

---

## 3. Architecture & module breakdown

Layering rule (CI-enforced): `core` imports nothing → `scene`/`ui`/`debug` import `core` → `main.ts` wires them. `core` is the product; the 3D scene and the top-down debug renderer are two independent projections of the same state, cross-checked at runtime (§2.12).

```
ghostball/
├── index.html
├── vite.config.ts              # base: '/ghostball/', vite-plugin-pwa (from M6)
├── tsconfig.json               # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
│                               # verbatimModuleSyntax, isolatedModules, moduleResolution "bundler", ES2022
├── biome.json                  # lint+format; restricted imports ban 'three'/DOM in src/core
├── package.json
├── .github/workflows/ci.yml    # typecheck → lint → test → build → purity grep → Pages deploy
├── public/                     # PWA icons only
├── docs/
│   ├── research/               # geometry.md, rendering.md, ux.md, stack.md — vendored, committed with this plan.
│   │                           # Extended background text; §4 of this plan is NORMATIVE and supersedes them
│   │                           # (notably the corrected §4.8 event model — see docs/research/README.md).
│   ├── screenshots/            # m2/ m3/ m4a/ m4b/ — before/after pairs per stance, archived per milestone
│   └── decisions.md            # tuning log: spike results, camera A/B outcome, calibration values, gate checklists
├── spike/                      # S1 throwaway perception spike — excluded from CI, deleted after S1 concludes
└── src/
    ├── core/                   # PURE geometry & game logic — mm/radians, zero imports
    │   ├── tsconfig.json       # "lib": ["ES2022"], no DOM — stray document/window globals = type error
    │   ├── types.ts            # Vec2, TableConfig, Pocket, Shot (incl. seed + difficultyRaw), Result
    │   ├── vec.ts              # add/sub/scale/norm/dot/cross/perp/normalize/wrapToPi/angleBetween
    │   ├── table.ts            # WPA 9-ft constants (§4.2), derived pocket jaws/mouths/normals
    │   ├── ghost.ts            # trueGhost, cutAngle, thetaTrue
    │   ├── constraint.ts       # reachableArc, clampToReachable, placeFromDrag, nudge (θ domain)
    │   ├── simulate.ts         # raySegment, event ordering (pockets vs cushions), doesPot, missMetrics
    │   ├── score.ts            # errorMetrics (β, arc/contact/chord mm), allowedWindow, grade bands
    │   ├── generate.ts         # seeded RNG, rejection-sampled shots, 3 level parameter sets,
    │   │                       # difficulty_raw metadata, standing-frameability check
    │   └── *.test.ts           # colocated Vitest suites incl. sensitivity.test.ts (§7)
    ├── scene/                  # Three.js layer — imports core + three only
    │   ├── units.ts            # MM_TO_M, core(x,y)→world mapping, bedY — the ONLY conversion site
    │   ├── buildScene.ts       # bed, cushions, rails, pocket liners, lights, environment
    │   ├── materials.ts        # procedural cloth/wood/ball/ghost materials, canvas noise textures
    │   ├── balls.ts            # cue/object/ghost meshes, contact-shadow discs, ghost footprint ring
    │   ├── cameras.ts          # standing/down rig PRESET CONFIGS (A/B candidates D1/D2/D3),
    │   │                       # aspect-derived FOV, damped follow, tweened transition
    │   ├── input.ts            # pointer → raycast to centre-height plane → core.placeFromDrag;
    │   │                       # down-view relative swipe; screen-space arrow resolution w/ hysteresis
    │   ├── inset.ts            # contact-zoom PiP render pass (narrow-FOV second viewport);
    │   │                       # reused for the near-overlap reveal callout
    │   ├── chevron.ts          # off-frame pocket edge chevron + distance label (BOTH stances)
    │   ├── aids.ts             # post-submit lines (Line2), true-ghost outline, trajectory playback
    │   ├── animate.ts          # ~30-line tween helper + kinematic submit animation, rolling rotation
    │   ├── assertions.ts       # cross-projection + animation-verdict tripwires (dev/?debug=1)
    │   └── render.ts           # invalidate()/rAF-while-dirty loop, DPR clamp, context-loss handling
    ├── ui/
    │   ├── store.ts            # typed pub/sub app state (~60 lines): phase, shot, θ, stance, stats
    │   ├── hud.ts              # arrows (tap/hold/accelerate + visual tick), submit, stance control,
    │   │                       # top bar (level pill, streak), contact chip, peek button
    │   ├── feedback.ts         # result panel, count-ups, band copy, tap-to-explain popovers,
    │   │                       # near-overlap treatment, mini-map mount, level-up toast
    │   ├── sheets.ts           # settings / stats (incl. error-vs-difficulty plot) / help+glossary
    │   └── storage.ts          # localStorage schema (gb.settings.v1, gb.stats.v2), try/catch wrapped
    ├── debug/
    │   └── topdown.ts          # canvas-2D top-down renderer of core state (?debug=1);
    │                           # promoted to the RESULT mini-map in M5
    ├── main.ts                 # wiring: store ⇄ scene ⇄ hud; state machine; ?seed= parsing
    └── style.css               # one hand-written file; safe-area insets; pill-chip HUD styles
```

App state machine (owned by `main.ts`/`store.ts`): `AIMING (standing|down)` → submit → `LOCKED` (150 ms, input frozen) → `REVEAL` (true ghost fades in, numbers count up) → `ANIMATING` (kinematic playback, tap skips) → `RESULT` (panel + mini-map; NEXT → new shot, RETRY → same shot flagged assisted). Overlays (settings/stats/help) pause without losing the guess.

---

## 4. Geometry & scoring spec (normative, self-contained)

`src/core` implements this section verbatim, in mm and radians, as pure functions. The vendored `docs/research/geometry.md` carries extended derivations; nothing there contradicts this section, and where the other research docs disagreed (reachability threshold, nudge step), **this section wins**.

### 4.1 Conventions

Units mm and radians internally; degrees only at the UI boundary. Vectors `V = (x, y)`; `dot(A,B) = A.x·B.x + A.y·B.y`; `cross(A,B) = A.x·B.y − A.y·B.x`; `perp(V) = (−V.y, V.x)`; `normalize(V) = V/|V|` (caller guarantees `|V| > EPS`). Angles CCW from +x. `wrapToPi(a) = atan2(sin a, cos a)`. `angleBetween(A,B) = atan2(|cross(A,B)|, dot(A,B))` ∈ [0, π] — never `acos(dot/…)` near 0/π. `EPS = 1e−6` mm; `ARC_EPS = 0.5° = 0.008727 rad`. Symbols: `C` cue ball, `O` object ball, `G` true ghost, `U` user ghost, `r` ball radius, `M` mouth midpoint, `P_target` aim point. All angle comparisons go through `wrapToPi` of a difference — never raw subtraction.

### 4.2 Coordinate system & table constants (WPA 9-ft default, all in `TableConfig`)

Origin at the bottom-left cushion-nose corner; +x along the long axis. Playing surface `[0, L] × [0, W]` nose-to-nose; ball centres legal in `[r, L−r] × [r, W−r]`; centres at height r above the bed (view layer only).

```json
{
  "tableLengthMm": 2540.0,   "tableWidthMm": 1270.0,
  "ballRadiusMm": 28.575,
  "cornerMouthMm": 114.3,    "sideMouthMm": 127.0,
  "pocketSlopMm": 5.0,       "alphaMaxRad": 1.047198,   // 60°; both tunable via §2.8 calibration
  "aimDepthMm": 0.0                                      // tunable knob, changes only G
}
```

Derived: `2r = 57.15`, `4r² = 3266.12 mm²`. (UK 8-ball is a data-only change; v1 ships this config only.)

### 4.3 Pockets

Each pocket: jaw points `J1, J2` on the boundary, `M = (J1+J2)/2`, tangent `t̂ = perp(n̂)`, inward-pocket normal `n̂`. Corner jaws sit at distance `a = cornerMouth/√2 = 80.822` along each boundary line from the corner (so `|J1−J2| = m_c` ✓).

| id | type | J1 | J2 | M | n̂ |
|---|---|---|---|---|---|
| 0 | corner | `(a, 0)` | `(0, a)` | `(a/2, a/2)` | `(−√2/2, −√2/2)` |
| 1 | side | `(L/2 + m_s/2, 0)` | `(L/2 − m_s/2, 0)` | `(L/2, 0)` | `(0, −1)` |
| 2 | corner | `(L, a)` | `(L−a, 0)` | `(L−a/2, a/2)` | `(√2/2, −√2/2)` |
| 3 | corner | `(L−a, W)` | `(L, W−a)` | `(L−a/2, W−a/2)` | `(√2/2, √2/2)` |
| 4 | side | `(L/2 − m_s/2, W)` | `(L/2 + m_s/2, W)` | `(L/2, W)` | `(0, 1)` |
| 5 | corner | `(0, W−a)` | `(a, W)` | `(a/2, W−a/2)` | `(−√2/2, √2/2)` |

### 4.4 Pocket capture model

Effective mouth half-width folds the ball's extent and jaw forgiveness into the segment: `w_eff = mouth/2 − r + pocketSlopMm` → **33.575 mm corner / 39.925 mm side** (defaults). Effective segment endpoints `E1 = M + w_eff·t̂`, `E2 = M − w_eff·t̂`. The ball pots in pocket pk iff the centre ray from O in unit direction `d̂` (i) hits `[E2, E1]` at `t > 0`, (ii) approach angle `α = angleBetween(d̂, n̂) ≤ alphaMax` (a ball rolled along a cushion into a corner arrives at α = 45° and must pass; a near-parallel side-rail graze must fail), and (iii) no cushion or jaw-rattle event occurs at smaller t (§4.8). Deliberately crude in α (listed in §10); calibrated in M5.

### 4.5 Aim point, true ghost, cut angle

```
P_target = M + aimDepthMm · n̂            // default aimDepth 0
G = O − 2r · normalize(P_target − O)      // |G−O| = 2r by construction
θ_true = atan2(G.y − O.y, G.x − O.x)
d̂_true = normalize(O − G)
φ_true = angleBetween(G − C, O − G)       // cut angle; 0 = straight, →90° = graze
```

### 4.6 Constraint circle & reachable arc (the load-bearing derivation)

`ê(θ) = (cos θ, sin θ)`, `U(θ) = O + 2r·ê(θ)`. U is reachable iff the cue ball's straight path from C first contacts O exactly when its centre reaches U. With `f(t) = |C + t(U−C) − O|²` (convex parabola, `f(1) = 4r²`), first-contact ⟺ `f′(1) = 2·dot(U−O, U−C) ≤ 0`. Substituting `c = C − O`, `D = |c|` (generation guarantees `D > 2r`):

```
dot(U−O, U−C) = 4r² − 2r·dot(ê, c) ≤ 0   ⟺   dot(ê, c) ≥ 2r   ⟺   dot(U−O, C−O) ≥ 4r²
```

Equivalently, with ψ = angle between ê and c: **reachable ⟺ ψ < Δ = arccos(2r/D)**. As D → ∞, Δ → 90° (the intuitive half-circle); as D → 2r⁺, Δ → 0. The boundary ψ = Δ is exactly the 90° graze; the same condition also guarantees the C→U path isn't blocked by the object ball. It is **not** `dot > 0` (half-circle — wrong) and not `dot < 0` (backwards). Cross-check identity: `cos φ = (D·cos ψ − 2r)/√(D² + 4r² − 4rD·cos ψ)`.

### 4.7 Clamp, drag projection, nudge

```
clampToReachable(θ, O, C, cfg) -> θ':
  c = C − O; D = |c|                                       // domain: caller guarantees D > 2r
  Δ = max(0, arccos(clamp(2r/D, −1, 1)) − ARC_EPS)         // max(0,·): for D within ~2 µm of 2r the raw
                                                           // value goes negative; Δ = 0 ⇒ θ' = θC
  θC = atan2(c.y, c.x)
  δ = clamp(wrapToPi(θ − θC), −Δ, +Δ)
  θ' = wrapToPi(θC + δ)
  while U(θ') outside [r, L−r]×[r, W−r] and |δ| > 0:      // table-bounds guard
      δ −= sign(δ)·min(|δ|, 0.25°);  θ' = wrapToPi(θC + δ)
  return θ'

placeFromDrag(Q, O, C, prevθ, cfg) -> θ:
  v = Q − O
  if |v| < EPS: return prevθ                               // finger over O
  return clampToReachable(atan2(v.y, v.x), O, C, cfg)      // exact radial projection
```

**Nudge:** fine step `dθ = 0.25°`, coarse `1.0°` (hold-escalation per §2.6). Screen-space direction: project a small +θ tangent move (`perp(ê(θ))`) through the active camera; if its screen-x sign matches the pressed arrow, apply +step, else −step; then `clampToReachable`. Hysteresis on the sign resolution so it never flip-flops near degenerate projections. A nudge fully absorbed by the clamp signals "at limit".

### 4.8 Submit simulation

Departure `d̂ = normalize(O − U) = −ê(θ_user)`.

```
raySegment(P, d, A, B) -> {t, s, X} | null:
  v = B − A; den = cross(d, v)
  if |den| < EPS: return null
  w = A − P; t = cross(w, v)/den; s = cross(w, d)/den
  if t > EPS and 0 ≤ s ≤ 1: return {t, s, X: P + t·d}
  return null
```

**Pot events:** per pocket, `raySegment(O, d̂, E2, E1)` valid iff hit ≠ null and `dot(d̂, n̂) ≥ cos(alphaMax)`; signed mouth offset `u = (s − 0.5)·2·w_eff`, margin `w_eff − |u|`.

**Cushion events — jaw-bounded spans, not full rails.** The ball-centre track line for each rail is inset by r (`y = r`, `y = W−r`, `x = r`, `x = L−r`), but a crossing only counts as a cushion hit where cushion actually exists between the jaws. Validity spans for the crossing's other coordinate (`a = cornerMouth/√2 = 80.822`, `m_s = sideMouth`):

- bottom (`y = r`) and top (`y = W−r`) track lines: `x ∈ [a, L/2 − m_s/2] ∪ [L/2 + m_s/2, L−a]`
- left (`x = r`) and right (`x = L−r`) track lines: `y ∈ [a, W−a]`

A crossing whose other coordinate falls inside a pocket's **mouth gap** (the complement spans — e.g. `x ∈ [0, a)` for pocket 0 on the bottom rail) is *not* a cushion event: the ball is entering the mouth region. It becomes a **jaw-rattle event** at that crossing point iff that pocket has no valid pot event on this ray; if the pot event is valid, the gap crossing is ignored (the ball is on its way in). Why this matters (regression-tested, §4.11): the inset track line is crossed *before* the boundary on every pocket-bound ray, so under a naive full-rail `[r, ·−r]` validity check the cushion would always win at min-t and **every pot — including a dead-centre side-pocket shot — would be misclassified as a cushion hit**.

**Minimum-t valid event wins** across all pot, cushion, and rattle events. Outcomes: target pocket → potted; other pocket → `wrong_pocket`; cushion → `cushion` with hit point (no rebound simulated); rattle → `cushion` with `outcome_detail = "rattled pocket k"` and the crossing point. The rattle rule is also what correctly kills a shot that grazes a side-pocket jaw en route to a far corner — the min-t rattle preempts the downstream pot.

**Miss quantification:** intersect the infinite ball line with the infinite target-mouth line; `missMm = |u*| − w_eff` (>0 missed by that much; ≤0 inside jaws, margin = −missMm). If the crossing has t < 0: `missMm = null`, `outcome_detail = "wrong_direction"`.

### 4.9 Error metrics, window, grade bands, payload

```
β = |wrapToPi(θ_user − θ_true)|          // directionErrorDeg ≡ thetaErrorDeg — state this identity in the UI
arcErrorMm = 2r·β;  contactErrorMm = r·β;  chordErrorMm = 4r·sin(β/2)
φ_user = angleBetween(U − C, O − U);  overcut = φ_user > φ_true    // overcut = "too thin"
contactFullness = 1 − sin(φ_user)        // fraction of the object ball the cue ball covers at contact
β₊ = angleBetween(E1 − O, M − O);  β₋ = angleBetween(E2 − O, M − O)   // jaw-subtended UPPER BOUNDS
                                         // small-angle: min(β₊,β₋) ≈ (w_eff/|M−O|)·cos α
allowedWindow — clip each side against the simulator:
  clipped_s = β_s               if simulate(θ_true rotated by ±(β_s − ε)) pots
            = bisect δ ∈ (0, β_s) on "simulate(θ_true ± δ) pots", to 0.01°   otherwise
allowedWindowDeg = deg(min(clipped₊, clipped₋));  windowClipped = (clipped_s < β_s on either side)
```

Why clipping: near a rail, part of the jaw-subtended window is shadowed — the edge ray legitimately strikes a cushion span before the mouth (worked shadowed-window fixture, §4.11 item 9) — so `β ≤ min(β₊,β₋) ⟹ potted` is FALSE as a theorem. The true, property-tested guarantees are: **(a)** `simulate(θ_true)` pots on every generated shot (enforced at generation, §4.10 check 7); **(b)** `β ≤ allowedWindowDeg (clipped) ⟹ potted` — true by construction of the bisection *given* the potting set on each side of θ_true is an interval; **(c)** that interval assumption itself, checked by a dense 0.02° sweep over seeded shots (no pot→miss→pot alternation per side; if the sweep ever falsifies it, the window computation falls back to the sweep). The UI's "the pocket forgave ±X°" always uses the clipped value, so the copy is never false.

**Contact-fullness bands** (chip copy): ≥ 0.85 "nearly full ball" · 0.60–0.85 "about ¾ ball" · 0.40–0.60 "about ½ ball" · 0.15–0.40 "about ¼ ball" · < 0.15 "very thin". The chip shows `fullness % · band · cut°` (e.g. `68.3 % · about ¾ ball · 18.5°`).

Grade bands: Perfect ≤0.5°, Excellent ≤1.5°, Good ≤3°, Close ≤6°, Miss (§2.7). Result payload:

```json
{ "potted": true, "outcome": "target_pocket|wrong_pocket|cushion",
  "thetaErrorDeg": 2.27, "arcErrorMm": 2.26, "contactErrorMm": 1.13, "chordErrorMm": 2.26,
  "directionErrorDeg": 2.27, "cutAngleTrueDeg": 34.80, "cutAngleUserDeg": 37.20, "overcut": true,
  "contactFullness": 0.395,
  "allowedWindowDeg": 2.80, "windowPlusDeg": 2.85, "windowMinusDeg": 2.80, "windowClipped": false,
  "mouthOffsetMm": 26.82, "marginMm": 6.75, "missMm": null,
  "cushionHit": null, "wrongPocketId": null, "band": "good" }
```

### 4.10 Shot generation & difficulty

Validity constants: `O_CUSHION_CLEAR = 80`; `|M−O| ∈ [250, 2200]`; `|C−O| ≥ 250`; `|C−G| ≥ 200`; `CUT_MAX = 80°` (level caps below); approach-angle generation caps 50° corner / 55° side (inside the 60° capture cap for margin).

**PRNG, pinned:** `mulberry32` (32-bit state; the reference implementation is committed verbatim in `generate.ts`). A shot is fully determined by `(seed, level, generatorVersion)`; the URL format is **`?seed=<uint32>&level=<1|2|3>&gv=<int>`**. `gv` starts at 1 and bumps on ANY change to the generator or its constants (calibration retuning included); a `gv` mismatch on load shows "shot link from an older version" and generates fresh rather than silently reproducing a different shot.

**Canonical standing-check rig (pure numbers, device-independent — what check 6 uses):** eye at `C − 1300·normalize(O − C)` horizontally (1.3 m directly behind C on the cue line), eye height 1620 mm above the bed; look-at O at ball-centre height; zero roll; reference viewport **390×844 portrait**; horizontal FOV fixed at 55°, vertical derived from the reference aspect. *Framed with ≥5 % margin* means each required point projects to `|ndc.x| ≤ 0.90 ∧ |ndc.y| ≤ 0.90`. Required points: C, O, and `U(θ)` sampled every ≤5° across the reachable arc; plus `J1, J2, M` of the target pocket where pocket-frameability applies. Generation never consults the runtime viewport — `?seed=` reproduces identically on every device; runtime camera adaptation lives in §5.

Checks in order: (1) O clearance, d_OP range, α cap; (2) G legal in `[r, L−r]×[r, W−r]`; (3) C legal, distance minima; (4) truth reachable: `dot(G−O, C−O) > 4r²`; (5) `φ_true` ≤ level cap; (6) standing-frameability per the canonical rig — pocket included on Level 1 (hard) and Level 2 (preferred; see ladder); (7) **truth pots: `simulate(θ_true)` returns potted-in-target** — closes the near-rail loophole where the mouth-midpoint aim itself would clip a cushion.

**Rejection sampling with a deterministic widening ladder:** 500 attempts at rung 0, then 200 per rung in fixed order — rung 1: drop the Level-2 pocket-frameability preference and relax the frame margin 0.90 → 1.00; rung 2: relax the `|M−O|` and `|C−O|` minima by 20 %; rung 3: `O_CUSHION_CLEAR` 80 → 60. **Never widened:** the level's cut-angle range, and the hard invariants (D > 2r, truth reachable, truth pots, balls in bounds, Level-1 pocket-frameability — if Level 1 somehow exhausts the ladder, fail loudly rather than serve an invalid shot). Same seed → same rung path → same shot; a property test asserts widened shots still pass every hard invariant.

Levels: **1 Straight-ish** (cut 0–20°, C→O 400–900, O→pocket 300–800, corners only, pocket frameable), **2 Club, default** (0–55°, 400–1400, 300–1400, all pockets), **3 Sharp** (25–80°, 500–2000, 400–2000, all, biased to sides/thin). 

**Metadata (always computed, no UI in v1):** `difficulty_raw = (2.0/Bd)·(1 + φ_true/90°)·(1 + |C−G|/L)` where `Bd = deg(min(β₊,β₋))` — the cheap *unclipped* jaw-subtended bound, fine for a relative difficulty score; only the user-facing window uses the clipped value. Stored on every Shot and every stats record.

### 4.11 Golden test vectors (fixtures; tolerance ±0.02 mm/°; parameterised on config)

Pocket 0: `J1=(80.822, 0)`, `J2=(0, 80.822)`, `M=(40.411, 40.411)`, `w_eff = 33.575`. `O=(600,400)`, `C=(1500,400)`:

1. `|O−M| = 665.17`; **`G = (648.079, 430.896)`**; `θ_true = 32.73°`; `d̂_true = (−0.84128, −0.54061)`.
2. `D = 900`; `dot(G−O, C−O) = 43 271 > 3266.12` ⇒ reachable; **`Δ = arccos(57.15/900) = 86.36°`** about `θ_C = 0°`; clamp range ±85.86° after ARC_EPS.
3. **`φ_true = 34.80°`** (cross-check via the §4.6 identity at ψ = 32.73°: cos φ = 700.00/852.48 = 0.82113 ✓).
4. Window: α = 12.27°; **`β₊ = 2.85°`, `β₋ = 2.80°`**; small-angle formula 2.83° ✓.
5. Submit θ_user = 35.0°: `U = (646.815, 432.780)`; **β = 2.27°**, arc 2.26 mm, contact 1.13 mm; mouth crossing t = 660.0 mm, `u = +26.82`, **potted, margin 6.75 mm**; `φ_user = 37.20°` ⇒ overcut; `contactFullness = 0.395` ("about ¼ ball"). Band: Good. **Named regression `potNearJawIsNotCushion`:** this ray crosses `y = r` at t ≈ 647.6 with x ≈ 69.55 — inside pocket 0's bottom mouth gap `[0, 80.822)`, so NOT a cushion event (the naive full-rail rule would grade this pot "cushion" at min-t). Window fields get tolerance ±0.05° on this fixture: the E1 edge ray clears the bottom cushion span by only ~0.05 mm — a deliberate near-boundary regression; `windowClipped = false`.
6. Nudge steps: 0.25° fine = 0.249 mm of arc; 1.0° coarse = 0.998 mm.
7. Degeneracies: drag at O → prevθ; θ beyond ±Δ clamps + "at limit" (incl. `D = 2r + 0.001 mm` ⇒ Δ = 0 ⇒ θ' = θC); ray parallel to mouth → null (note an along-cushion roll never crosses its own inset track line — parallel); heading away → missMm null/wrong_direction; wrong-pocket capture; α = 45° along-cushion corner pots, α = 75° side-rail graze fails the cap and rattles.
8. **`straightSidePotIsNotCushion`:** `O = (1270, 400)`, `C = (1270, 700)`, θ_user = 90° ⇒ `d̂ = (0, −1)`, dead-centre at side pocket 1. The `y = r` crossing at x = 1270 is inside the side mouth gap `[1206.5, 1333.5]` → not a cushion event; mouth hit t = 400, s = 0.5, α = 0 → **potted, margin 39.925 mm**. (Under the naive full-rail rule every straight side-pocket pot would grade "cushion".)
9. **Shadowed window** (`windowClipped = true`): `O = (2000, 100)`, target pocket 0 (`G ≈ (2057.12, 101.74)`; C behind G, e.g. `(2300, 120)`). Jaw-subtended β₊ ≈ 0.723°, β₋ ≈ 0.706°, and `simulate(θ_true)` pots (its `y = r` crossing falls beyond the mouth) — but the ray at mouth offset u = +30 mm (β ≈ 0.645°, *inside* the naive window) crosses `y = r` at x ≈ 286.6, squarely inside the bottom cushion span `[80.822, 1206.5]` → **cushion**, not potted. Fixture asserts: E1-side `clipped₊ < 0.65°`, `allowedWindowDeg < min(β₊, β₋)`, and the reported window matches a dense 0.02° sweep.
10. **Jaw rattle:** a ray crossing `y = r` at x = 1215 (inside the side gap `[1206.5, 1333.5]` but outside the capture segment `[1230.1, 1309.9]`) with no valid pot event → outcome `cushion`, `outcome_detail = "rattled pocket 1"`, at min-t — preempting any downstream event.

### 4.12 View-layer helpers (informative)

Screen→table unprojection: cast the camera ray through the touch pixel, intersect the plane at **ball-centre height** (z = r in table coords / `bedY + r` in world) — the constraint circle lives at centre height, so the finger maps to centre positions. `null` (parallel/sky) ⇒ keep prevθ.

---

## 5. UX spec

**Layout (portrait phone, primary).** Top bar (level pill, streak chip, menu) → 3D canvas (~70 % height, `touch-action: none`, Pointer Events with capture) → stance segmented control `[Standing | Down]` → bottom bar: `◀` (64 px) · SUBMIT (fills middle) · `▶` (64 px), all in thumb reach with safe-area insets. Contact chip (`68.3 % · about ¾ ball · 18.5°` — fullness, band, cut angle per §4.9; live, 0.1 %/0.1° resolution) and hold-to-peek button float over the canvas bottom edge. Landscape/desktop: canvas left ~75 %, controls stacked right; one breakpoint (~700 px); keyboard `←/→` 0.25°, `Shift+←/→` 1°, `Enter`, `S`, `N`, `R`.

**Stances.** Standing = *place*: fixed-per-shot camera starting from the §4.10 canonical rig (eye 1.62 m, 1.3 m behind C on the cue line, looking at O); generation guarantees that rig frames everything required on the reference viewport, and at runtime, if the actual viewport's aspect leaves any required point outside `|ndc| ≤ 0.95`, the camera dollies straight back in 100 mm steps (max 800 mm) until framed — deterministic per (shot, viewport), never affecting generation. Absolute drag with 80 px lift offset and 48 px grab radius, projected to the arc; **coarse placement only by design** (§2.6). Down = *verify*: camera on the C→U line (rig chosen by the M3 A/B), looking at the ghost, following every adjustment with 150 ms damping; relative horizontal swipe 0.08°/px; faint cue stick from the bottom edge (toggle); **contact-zoom inset** during nudge activity (§2.6). **Pocket off frame in either stance** → shared edge chevron + distance label; never fisheye. Stance switch animates 400 ms (instant under reduced motion); switching mid-adjustment never loses θ. Placement allowed in both stances.

**Nudge feedback bundle (per §2.6):** 0.25° tap / hold-accelerate to 1.0°; haptic + arrow flash + optional tick per step; clamp bump = haptic pattern + 5 % ghost squash + edge flash; chip updates every step; inset shows the spatial shift.

**Feedback.** REVEAL recolours the guess amber (#FFB74D) and fades in the true ghost cyan (#4FC3F7) — colour-blind-safe, survives green felt, never red/green semantics. Result panel: outcome headline with cause and margin, contact error with direction, cut angles, grade band + streak, allowed-window line ("the pocket forgave ±2.8°; you were 2.3° off"), band-vs-outcome disagreement one-liner; count-ups; overhead mini-map (promoted top-down renderer), tap-to-expand.

**Near-overlap reveal treatment (NEW; fixes the mushy-blob weakness):** when β < 1.5° the amber and cyan spheres substantially coincide. Treatment: the true ghost renders as **outline-only ring** (no filled sphere), and a leader-line callout opens the **contact-patch inset** (reusing `scene/inset.ts` at ~6° FOV) showing both outlines clearly separated at that magnification with a labelled gap arrow ("0.6 mm thin"). The result headline always carries the exact number. The mini-map stays true-scale and is *not* the fine-detail carrier.

**Vocabulary progressive disclosure (NEW):** every jargon term on the result panel ("too thin", cut angle, contact %, "forgave ±2.8°") is dotted-underlined; tap opens a one-sentence explainer popover. The contact-error explainer auto-shows on the first three results. Help sheet gains a six-term mini-glossary. Onboarding teaches mechanics; the result panel teaches its own reading.

**Progression.** Endless drill; streak = consecutive pots, breaks quietly; rolling last-20 error, per-band histogram, pot %, bests in the stats sheet — plus an **error-vs-difficulty_raw scatter/sparkline** (the metadata earning its keep). Level-up toast per §2.10. Peek (hold-to-reveal) and retry mark attempts `assisted`, excluded from streak/averages/PBs.

**Storage** (`try/catch` everywhere; app fully functional session-only if storage unavailable):

```json
{ "gb.settings.v1": { "units": "mm", "sound": true, "haptics": true, "cueStick": true,
                      "contactChip": true, "inset": "auto", "reducedMotion": "system", "difficulty": "club" },
  "gb.stats.v2":    { "club": { "attempts": 0, "potted": 0, "assisted": 0, "streakCurrent": 0,
                      "streakBest": 0, "bestErrorDeg": null,
                      "recent": [ { "errDeg": 1.2, "band": "excellent", "potted": true, "difficultyRaw": 1.4 } ] } },
  "gb.onboarded.v1": true }
```

**Onboarding (M6):** three skippable cards (what's a ghost ball / drag-then-arrows / two stances) + permanent hold-to-peek. Guided scaffold shots stay cut to v2 (pre-placed spawn + cards + peek cover discoverability at a fraction of the cost).

**Accessibility & hygiene.** Controls ≥44 px; HUD text on dark pill chips ≥4.5:1; `prefers-reduced-motion` honoured + in-app override; aria-labels everywhere; result announced via live region ("Potted. Excellent. 1.8 millimetres too thin."); `viewport-fit=cover`, `overscroll-behavior: none`, no `user-scalable=no`. Honest scope: placement is inherently visual; arrows + announced contact % are the non-visual fallback.

---

## 6. Milestones, week budget, and gates

Sizes: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 5–8 days of part-time solo AI-assisted work. Weeks below are **part-time calendar weeks** with honest padding; the backbone's 5–7-week total was optimistic, and this plan says so. Every milestone ends with `main` green and deployed. **Stop-anywhere property:** M1b is already a usable trainer; M3 meets the full stated requirement set *functionally* — but with M2's deliberately basic look, which has never passed the §1 realism bar (M3's gate covers camera truthfulness only). Shipping at M3 (C1 option d) is a legitimate call that knowingly accepts a camera-true but visually plain app; the realism bar itself is met at M4B.

| # | Milestone | Size | Weeks (cum.) |
|---|---|---|---|
| M0 | Scaffold + deploy + vendor docs | S | wk 1 |
| S1 | Perceptual spike (throwaway) — **gate** | S | wk 1 (parallel) |
| M1a | Geometry core green | M | wk 2 |
| M1b | Playable top-down trainer + `?seed=` | S | wk 2–3 |
| M2 | Standing 3D loop + feel tuning + tripwires | L | wk 3–5 |
| M3 | Down stance + camera A/B + pedagogy playtest — **gate** | M | wk 5–6 |
| C1 | Mid-point descope checkpoint | — | end wk 6 |
| M4A | Realism pass A: light & material | M | wk 7 |
| M4B | Realism pass B: table geometry & pocket read | M | wk 8 |
| M5 | Feedback depth + verdict calibration + playtest #2 | M | wk 9 |
| M6 | Polish, onboarding, PWA, hardening | M | wk 10 |
| — | Buffer (~20 %, absorbs camera/realism/device iteration) | — | wks 11–12 |

**Total: ~10 weeks nominal, 12 with buffer, part-time.** Slippage is visible per-week; C1 is where it gets acted on.

### M0 — Scaffold + deploy pipeline (S)
First task: resolve and pin dependency versions per §2.2 (`npm view` each tool; record resolved versions and any fallbacks taken in `docs/decisions.md`). Then Vite + strict TS + Biome + Vitest + CI workflow (§8) + GitHub Pages deploy of hello-world with `base: '/ghostball/'`. Empty `core/scene/ui/debug` dirs with the purity guards active (import grep + core tsconfig without DOM lib + `noRestrictedGlobals`). `PLAN.md` and `docs/research/` are already committed alongside this plan — every §-reference resolves inside the repo from day one. Create `docs/decisions.md` and `docs/screenshots/`. Recruit the 1–2 outside pool players (§2.9) now.
**Done when:** push to `main` auto-deploys; `npm run ci` green locally and in Actions; a deliberate `import * as THREE` in `src/core` fails CI **and** a deliberate `document.title` reference in `src/core` fails typecheck; resolved versions logged.

### S1 — Perceptual spike (S, throwaway, parallel with M1a) — GATE
Per §2.5: crude spheres + both camera rigs (all three down-rig candidates as config), drag + nudge, hard-coded shot. ~50 self-reps per stance on both reference devices (one mid-range Android/Chrome, one iPhone/Safari); log errors; measure per-stance nudge JND; try the contact-zoom inset if needed.
**Done when:** `docs/decisions.md` records median achievable error per stance, the go/retune/no-go verdict, the measured JND (which finalises M2/M3 nudge acceptance numbers), whether the inset is mandatory/auto/off by default, and a first screenshot pair. **No M2 work begins before this gate is recorded.** `spike/` is deleted afterwards.

### M1a — Geometry core green (M)
All of `src/core` per §4, including generator with all three level parameter sets, `difficulty_raw` metadata, standing-frameability check, and the **sensitivity test** (§2.8). Full test suite (§7) including golden vectors and ψ = Δ boundary tests.
**Done when:** all §4.11 vectors pass; property tests green over 1000 seeded shots per level; same seed → identical shot; sensitivity 95th percentile ≤ 1.5° (or generator tightened until it is, with the change logged).

### M1b — Playable top-down trainer (S) — *first usable training loop*
`debug/topdown.ts` (~150-line canvas-2D view) wired to the real core functions: pointer drag, two nudge buttons, submit, textual result readout. **`?seed=` in the URL from this milestone onward** — deterministic bug reports and shareable shots from week one. Served as the interim main page.
**Done when:** the complete loop (generate → place → nudge → submit → error + pot verdict → next) is playable top-down on a phone from the deployed URL; loading a `?seed=` URL reproduces a shot exactly.

### M2 — Minimum first-person 3D loop, standing view (L)
`scene/units.ts`; basic `buildScene` (cloth-coloured bed box, plain box cushions with pocket gaps, dark pocket cylinders+discs, three spheres, ghost at 38 % opacity + dashed footprint ring, spotlight + hemisphere); standing camera with aspect-derived FOV; render-on-demand loop with DPR clamp and context-loss handling; `input.ts` (raycast to centre-height plane → `placeFromDrag`, lift offset, grab radius); DOM HUD (arrows with full tap/hold/accelerate + visual tick, submit, next); result panel v1; reveal of true ghost + lines via `Line2`; **`scene/assertions.ts` cross-projection tripwire live**; **contact-zoom inset v0 unconditionally** (S1 only decides its default visibility — M2's nudge acceptance depends on it, and M5's near-overlap reveal reuses it anyway); standing chevron. Top-down moves behind `?debug=1`.
**Done when, on both reference devices:** full first-person loop works; ghost tracks the finger without perceptible lag; **the doc-inherited feel constants (80 px lift, 48 px grab, hold-repeat timings, damping) have been hands-on tuned and their final values logged in `docs/decisions.md`** — implementing the spec numbers alone does not pass; nudge acceptance per the S1-calibrated criteria (§2.6: one fine step discernible in inset + chip); submitting the peeked truth always pots (parity with core, plus the runtime assertion never fires in a 20-shot session); idle GPU cost zero (no rAF while untouched); JS ≤ 300 kB gz; screenshot pair archived in `docs/screenshots/m2/`.

### M3 — Down-on-the-shot stance (M) — completes the required two-view experience — GATE
Down camera rig with damped follow; stance segmented control + 400 ms transition; relative aim-swipe; shared pocket chevron in down view; optional cue-stick mesh; **structured camera A/B per §2.11** (candidates D1/D2/D3, seeded 6-shot battery, both devices, judged per §2.9, one session, result logged). **Pedagogy playtest:** self-recorded 10-rep protocol — place standing-only, then re-judge with the down view — verifying the down view *meaningfully changes the judgment*; plus outside player #1 runs 10 reps on the deployed build, think-aloud. **Rule: if the down view doesn't change the judgment versus standing, the cameras are wrong — that is a product bug and M3 is not done**, budget comes out of buffer, fallbacks per §2.5 apply.
**Done when:** both stances usable for placement and adjustment; a 1.0° change is verifiable in the down-view overlap or inset per the S1 numbers; a correct guess produces the correct sighting picture dead-centre; stance switch never loses θ; camera constants locked with A/B rationale recorded; the down-view screenshot passes the "pool player nods" gate (§2.9 protocol — this is M3/M4 acceptance language, judged on *camera truthfulness*: eye height, lens, horizon/cushion stacking); playtest results logged; screenshots archived.

### C1 — Mid-point descope checkpoint (end of week 6)
A written 30-minute decision recorded in `docs/decisions.md`: schedule vs plan, buffer remaining, and an explicit choice among (a) proceed as planned, (b) merge M4A+M4B into one timeboxed pass, (c) cut sounds/onboarding-cards from M6 now, (d) declare M3 the ship line — explicitly accepting the camera-true-but-plain look per §6's stop-anywhere note — and move M4–M6 to a v1.1. The endless-drill product shape means every option yields a complete, useful app.

### M4A — Realism pass A: light & material (M)
`RoomEnvironment` PMREM IBL; `MeshPhysicalMaterial` balls (clearcoat 1.0, roughness ~0.12); cloth bump from runtime-generated noise (bumpScale ~0.0004, repeat ~×24); edge-darkening AO substitute; contact-shadow discs; ghost fresnel rim shell; ACES tone mapping; dark pool-hall surround. Strictly no new features.
**Done when:** **frame time < 8 ms during drag on the reference Android at DPR 2** (the hard gate); screenshot checklist passes on both devices per §2.9 (checklist: balls read as glossy phenolic not plastic; cloth reads as felt under the lamp; balls sit grounded, not floating; surround reads as a dark room, not a void); draw calls ≤ 30 (inset frames ≤ 60); idle cost still zero; before/after pairs per stance archived in `docs/screenshots/m4a/` and the PR description.

### M4B — Realism pass B: table geometry & the pocket-jaw read (M)
Cushion cross-section via `ExtrudeGeometry` (nose height ~36 mm) with angled jaw end-caps (~142° corner / ~104° side); wood rails + diamond sights; pocket liner refinement. This is the sightline the app lives on, so it gets its own pass.
**Done when:** **the down-view jaw gap widths are cross-checked against the core pocket constants** (measure the rendered mouth in a debug overlay against `cornerMouthMm`/`sideMouthMm` — the picture must not lie about the geometry being trained); the down view at the jaws passes the screenshot checklist + "pool player nods" gate per §2.9; performance gates from M4A still hold; before/after pairs archived in `docs/screenshots/m4b/`.

### M5 — Feedback depth, calibration & training features (M)
Full state machine (LOCKED/REVEAL/ANIMATING/RESULT) with count-ups; kinematic submit animation (rolling rotation `s/r` about `up × v`, pot drop, one damped bounce, tap-skip, reduced-motion line fallback) **with the animation–verdict assertion live, including jaw-margin cases**; allowed-window copy; band-vs-outcome one-liner; **near-overlap reveal treatment (§5)**; tap-to-explain popovers + glossary; mini-map on RESULT (promoted `topdown.ts`); contact chip final; hold-to-peek with `assisted` flagging; streak, retry, stats sheet incl. error-vs-difficulty plot; level pill + **level-up heuristic**; `localStorage` persistence. **Verdict calibration session per §2.8** (developer + outside player, 30 borderline seeded shots, knobs tuned, values documented in help + `docs/decisions.md`). **Outside playtest #2:** player runs 15 reps on the deployed build; feedback comprehension is the focus (can they say what "1.8 mm too thin" told them to do differently?).
**Done when:** per-state rules implemented; stats survive reload; assisted attempts excluded from streak/averages; storage-unavailable mode runs session-only without errors; a near-perfect guess (β < 0.5°) produces an unambiguous reveal (inset callout, labelled gap); calibration values committed; **feel gate:** rep time submit → next-shot-aimable ≤ 4 s when skipping, and the pot moment passes the "you want to hit NEXT" checklist per §2.9.

### M6 — Polish, onboarding, PWA, hardening (M)
Three onboarding cards; settings sheet (units, sound, haptics, cue stick, chip, inset, reduced motion); minimal sounds (contact click, pocket drop — first cut under pressure); `vite-plugin-pwa` full precache + standalone manifest + icons; install-hint toast; safe-area/viewport final pass; a11y pass (labels, live region, focus order); Playwright chromium smoke in CI; README with architecture notes and the v1 simplifications list.
**Done when:** installs to an Android home screen and **runs fully offline (airplane-mode test at, ideally, an actual pool table)**; Playwright smoke green; onboarding shows once; all §5 accessibility items verified.

---

## 7. Testing strategy

**Principle: near-100 % coverage of `src/core`; zero unit tests of `scene`/`ui` — but the scene layer gets runtime tripwires and archived screenshots instead of nothing.**

1. **Golden vectors** — §4.11 as fixtures (±0.02 mm/°), parameterised on `TableConfig` so calibration retuning updates rather than orphans them.
2. **The 15 stack-doc cases, with case 7 corrected** to the 4r² threshold: straight-in collinearity; `|G−O| ≡ 2r` to 1e-12; hand-computed cut fixture; projection lands-on-circle/nearest/idempotent/degenerate-at-O; nudge invertibility and limit-pinning; perfect-guess-always-pots; acceptance-window both sides + narrowing with distance; along-cushion corner capture at α = 45° passes, 75° side graze fails; wrong-pocket and cushion outcomes; monotonicity; **the §4.8 event-model regressions** (`potNearJawIsNotCushion`, `straightSidePotIsNotCushion`, jaw-rattle classification, shadowed-window fixture); generator validity property test (1000 seeded shots per level pass every §4.10 check incl. frameability and truth-pots); seed determinism incl. identical rung path under widening.
3. **Boundary tests at ψ = Δ (NEW, mandatory):** θ at Δ − ε reachable, Δ + ε clamped, exactly Δ handled consistently — on both arc ends, at near (D = 2r + 10 mm), degenerate (D = 2r + 0.001 mm ⇒ Δ = 0 ⇒ θ' = θC), and far (D = 2000 mm) cue distances. This is precisely the condition the research docs disagreed on; it gets its own named suite.
4. **Sensitivity test (NEW):** §2.8 — θ_true shift under AIM_DEPTH 0→20 mm across the generated shot space; 95th percentile ≤ 1.5° asserted.
5. **Property invariants:** `|U(θ)−O| ≡ 2r`; clamped θ satisfies reachability and bounds; `directionErrorDeg == thetaErrorDeg`; `simulate(θ_true)` pots on every generated shot; `β ≤ allowedWindowDeg (clipped) ⇒ potted`, with the clipped window cross-checked against a dense 0.02° sweep (interval assumption, §4.9); widened-ladder shots still pass every hard invariant; fullness formula unit-checked at φ = 0°, 14.5°, 37.2°, 90°.
6. **Runtime tripwires (NEW, permanent):** cross-projection assertion and animation–verdict assertion (§2.12) in dev/`?debug=1`; "parity by construction" is now self-checking.
7. **Screenshot archive:** before/after pairs per stance per visual milestone in `docs/screenshots/` + PR descriptions — the standing manual diff.
8. **Human protocols:** S1 spike (50 reps/stance, go/no-go); M3 self 10-rep + outside player think-aloud; M5 calibration battery + outside playtest #2. All results logged in `docs/decisions.md`; all subjective judgments run under the §2.9 judge/timebox/decision-rule protocol.
9. **One Playwright chromium smoke** (~30 lines, M6): page loads under `vite preview`, WebGL canvas present, no console errors, Submit produces a result panel. First cut if flaky.
10. **Manual device checklist per milestone** (both reference devices): drag latency, nudge feedback bundle, stance transition, battery-idle check, URL-bar viewport collapse.

---

## 8. Deployment & CI

GitHub Pages (project page), source = GitHub Actions. Single workflow on push to `main` + PRs:

```
jobs.ci:   checkout → setup-node 22 (npm cache) → npm ci
           → typecheck (tsc --noEmit) → lint (biome check) → test (vitest run)
           → vite build
           → purity guard: ! grep -rE "from ['\"](three|\.\./scene|\.\./ui|\.\./debug)" src/core
             (plus src/core/tsconfig.json carries no DOM lib — DOM globals in core fail the typecheck step)
           → upload-pages-artifact (main only)
jobs.deploy (main only): actions/deploy-pages@v4
```

Vite `base: '/ghostball/'` (set in M0, verified by the deploy itself). PWA (M6): `registerType: "autoUpdate"`, precache everything (well under 3 MB — all materials procedural), standalone manifest, 192/512 maskable icons. Budgets enforced by eyeball at each milestone: ≤ 220 kB gz initial JS target, 300 kB hard ceiling; ≤ 30 draw calls (≤ 60 with inset active); < 8 ms drag frame on the reference Android from M4A; zero idle rAF always. `spike/` excluded from CI. Playwright smoke as a separate optional job in M6.

---

## 9. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Depth ambiguity — the product-killer:** judging a 57 mm sphere's position on the constraint circle from a monocular perspective render on a phone (~7 px per degree of visual angle vs the eye's far finer acuity) may be too ambiguous to train | Named #1 deliberately. S1 week-one spike with go/retune/no-go gate *before* the 3D build order is committed (§2.5); designed depth cues (footprint ring, contact shadows, contact chip, contact-zoom inset, down-view verification); escalation ladder of fallbacks; camera retuning treated as a product bug at any milestone, funded from buffer |
| 2 | Geometry bugs from AI-generated math (sign flips, deg/rad, wraparound) | Pure dependency-free core in mm/radians; golden vectors pinned before any 3D; ψ = Δ boundary suite; property tests; `wrapToPi` mandated; strict TS; top-down oracle always available |
| 3 | Scene-layer drift with no test net (AI-generated Three.js) | Runtime cross-projection + animation–verdict assertions (§2.12); archived screenshot pairs per milestone; `units.ts` as the single conversion site |
| 4 | Grading against a slightly-wrong truth mis-trains | Sensitivity test bounds θ_true model uncertainty inside half a grade band; M5 calibration of slop/α/AIM_DEPTH with an outside player; model stated in help copy |
| 5 | Screen→world input feels wrong; doc-inherited feel constants never touched hardware | Centre-height-plane raycast, lift offset, grab radius — all tuned on both devices as M2 *acceptance*, values logged; down view avoids absolute drag entirely |
| 6 | Fine nudges invisible (sub-pixel) | Acknowledged numerically (§2.6); contact-zoom inset + 0.1 % chip + per-step visual tick as designed carriers; acceptance criteria restated in achievable terms; S1 measures the real JND |
| 7 | Realism rabbit hole consumes the schedule | Two gated, timeboxed passes (M4A/M4B) with checklists and the §2.9 decision rule; procedural-only assets; cushion-jaw extrusion prioritised; C1 checkpoint can merge or defer them |
| 8 | Solo developer's adapted eye passes bad subjective gates | Outside pool players at M3 and M5 on the deployed build; every subjective gate has judge/timebox/decision rule (§2.9) |
| 9 | Mid-range Android performance/battery | Render-on-demand (zero idle), DPR ≤ 2, MSAA only, ≤ 30 draw calls, static scene, < 8 ms gate from M4A |
| 10 | WebGL context loss on Android | `webglcontextlost/restored` handlers from M2; rebuild is cheap (all procedural) |
| 11 | Standing view can't frame long diagonal shots | Generator frameability check (C, O, arc always; pocket on L1) + standing chevron fallback (L2/3) |
| 12 | Haptics absent on iOS | Every haptic paired with a visual/audio equivalent (§2.6) |
| 13 | Pages base-path / PWA staleness footguns | `base` set and exercised from M0; `autoUpdate` SW |
| 14 | Schedule slip invisible until too late | Per-milestone week budget, ~20 % explicit buffer, C1 written descope checkpoint, stop-anywhere cut-lines |
| 15 | Animation contradicts verdict | Impossible by construction (kinematic playback of the analytic event) *and* asserted anyway (§2.12) |

---

## 10. v1 cut-lines and v2+ ideas

**Explicitly NOT in v1** (documented in README + in-app help):

- Throw, spin, squirt, swerve, speed effects — pure line-of-centres model; pocket forgiveness via calibrated `w_eff` slop + approach cap only.
- Cushion rebound simulation (first cushion ends the sim; the single damped bounce is animation theatre — and asserted to end where the analytic event says).
- UK/other table presets (all formulas parameterised on `TableConfig`; shipping WPA 9-ft only is a settings-surface cut, not a capability cut).
- Custom shot editor, guided onboarding scaffold shots, magnifier loupe during standing drag, walk-around camera, RESULT-view stance switching, star-based *UI* (the metadata ships), ball numbers/stripes, photographic textures/HDR environments, analytics, accounts/backend.
- Sounds are a stretch item inside M6 (contact click + pocket drop only) — first candidate to cut; cutting them is a non-event.

**v2+ shortlist, in leverage order:**

1. **Adaptive drilling (highest value, designed now, built later):** bucket attempts by cut-angle × distance (e.g. 4×4 grid), track per-bucket rolling error using the already-stored `difficulty_raw` + shot metadata, and over-sample the user's weak buckets in generation. Zero schema change needed — that's why the metadata ships in v1.
2. UK 8-ball / snooker presets (data change) · shareable seeded drills via the existing `?seed=` · custom layout editor (drag balls on the already-built top-down renderer) · throw-model "advanced mode" · guided drill packs (progressive cut angles) · loupe during standing drag · richer soundscape · baked HDR pool-hall environment · stance switching in RESULT · contact-patch zoom replay of the impact.

---

## Appendix A — Graft dispositions & rejected ideas

All judge-demanded grafts were incorporated (many were duplicates across the three lists; each is implemented once): realism-bar definition and screenshot gates (§1, M3/M4), two-pass realism split with the <8 ms gate and jaw-width cross-check (M4A/M4B), down-camera A/B protocol (§2.11), feel gates incl. ≤ 4 s rep time and animation-verdict agreement (M5, §2.12), screenshot archiving (§2.12), offline-as-feature (§1, M6), cross-projection assertion (§2.12), depth-ambiguity risk + early spike gate (§2.5, Risk 1), `difficulty_raw` metadata (§2.10), adaptive-drilling design (§10), seed-in-URL at M1b, ψ = Δ boundary tests (§7), 10-rep pedagogy protocol (M3), M1 split into M1a/M1b, streak-=-pots rationale (§2.7).

Rejected or modified, with reasons:

1. **Mini-map as the near-overlap fine-detail carrier — rejected.** At true scale, 0.5 mm on a 120 px mini-map is as invisible as it is in the main view; carrying it there would require lying about scale. The contact-patch inset (one of the judges' own suggested options) shows the real gap at honest magnification instead; the mini-map stays a true-scale overview.
2. **"0.14 m vs 0.28 m" two-way camera A/B — modified to three candidates.** The backbone's 0.22 m midpoint is a legitimate third hypothesis; excluding it from a one-session blind battery costs nothing and the docs' two numbers may both be wrong in the same direction.
3. **"Nudges visibly move the ghost ~0.25 mm" in the standing view — rejected permanently, not deferred.** The math (§2.6) shows one fine step is ~0.05 px there at any plausible rig; the standing view is coarse-placement-only by design, and no amount of tuning is asked to fix an impossibility.
4. **Guided scaffold shots (from the UX doc's onboarding) — remain cut**, per the backbone's original reasoning: pre-placed spawn + three cards + hold-to-peek cover discoverability at a fraction of the cost. The judges did not contest this cut; noted here because the tap-to-explain graft (§5) absorbs the *comprehension* half of what scaffold shots would have taught.

---

## Appendix B — Adversarial review log (what changed after synthesis)

The synthesized plan was put through an independent completeness critic and a geometry skeptic instructed to refute every formula with numeric counterexamples. Confirmed findings, all folded into the sections above:

1. **BLOCKER — the event model misclassified every pot as a cushion hit.** The original §4.8 validated cushion crossings over full rails (`[r, ·−r]`); since the inset centre-track line is crossed *before* the boundary on every pocket-bound ray, min-t always picked the cushion — the plan's own golden vector 5, and any dead-centre side-pocket pot, both graded "cushion" under the spec's own rule. Fixed with jaw-bounded cushion spans + the jaw-rattle rule (§4.8) and named regressions (§4.11 items 5, 8, 10).
2. **The `β ≤ min(β₊,β₋) ⟹ potted` guarantee was false near rails** — a worked counterexample at `O = (2000, 100)` has a legal ray inside the jaw-subtended window clipping the cushion before the mouth. The reported window is now clipped against the simulator, the property is restated in its true form, and generator check 7 guarantees the truth itself always pots (§4.9, §4.10, §4.11 item 9).
3. **The standing-frameability check was circular and device-dependent** — no camera pose was actually defined, and aspect-dependent FOV would have broken `?seed=` determinism across devices. Now: a canonical check rig in pure numbers with a fixed reference viewport (§4.10); runtime dolly-back adaptation (§5); `?seed=&level=&gv=` URL format with a pinned PRNG (mulberry32) and a generator version.
4. **The contact chip's fullness formula existed only by name.** Defined (`1 − sin φ`), banded, sensitivity stated honestly — it falls to ~0.08 %/step on thin cuts, where the chip's cut-angle readout carries the feedback instead — and a golden value added (§2.6, §4.9, §4.11).
5. **Smaller confirmed fixes:** `clampToReachable` produced a negative arc half-width for D within ~2 µm of 2r (now `max(0, ·)` + domain note + boundary test); the inset's mm/px math mixed FOV and pixel conventions and was ~2.4× optimistic (restated in device px; S1 verifies on hardware); the "step must be ≤0.25°" necessity claim was mathematically false (restated as a margin choice); exact dependency pins were unverifiable (now resolved at M0 with a fallback rule); core purity enforcement missed DOM *globals* (now also a no-DOM-lib tsconfig); the rejection-sampling widening path was underspecified and nondeterministic (now a fixed ladder); default-level pocket visibility and the M3 ship-line realism caveat are now recorded decisions rather than silent drops (§1 coverage map, §6, C1); M2's nudge acceptance depended on an inset that was only conditionally built (the inset is now unconditional in M2).

The vendored `docs/research/` files predate this pass — where they disagree with §4 (notably the event model), **§4 wins**.