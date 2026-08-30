# Ghostball — Tech Stack & Repo Architecture Recommendation

Target repo: `Jonny1987/ghostball` (empty, greenfield). Solo developer, AI-assisted, static hosting, mobile-first touch UX. All package versions verified against the npm registry on 2026-08-30.

---

## 1. Language / build / framework

**Decision: TypeScript (strict) + Vite 8, vanilla TS + a small hand-rolled DOM/HUD layer. No React, no Svelte.**

- **TypeScript + Vite** is not seriously contestable here: strict types are the single best guardrail for AI-assisted development of geometry code (radians vs degrees, world vs screen coordinates, metres vs table-fraction units all become type errors instead of visual bugs), and Vite gives instant dev server, first-class Vitest integration, trivial GitHub Pages `base` config, and a mature PWA plugin. Versions: `typescript@7.0.2` (the native-compiler line; drop to `5.9.x` only if some editor tooling misbehaves — the source is compatible), `vite@8.2.2`.
- **Framework comparison for THIS app.** The DOM surface is roughly: stance toggle, 2–4 nudge arrows, Submit, New Shot, a results panel, maybe a settings sheet. Call it 10–15 elements with a handful of state transitions (`aiming → submitted → reviewing`). Everything else lives inside one WebGL canvas driven imperatively.
  - **React**: ~45 kB min+gzip plus a programming model that actively fights an imperative Three.js scene — you end up in `useRef`/`useEffect` escape hatches for every scene mutation, or you pull in react-three-fiber + drei and triple the dependency surface for zero product benefit. Not warranted.
  - **Svelte**: much lighter output, but still a compiler layer, component toolchain, and second mental model, to manage a HUD that is a dozen buttons. The reactivity buys almost nothing because ~90% of state (ghost position, constraint arc, camera pose) is consumed by the scene layer, not the DOM.
  - **Vanilla TS + tiny store**: a ~60-line typed pub/sub store and direct DOM updates in one `hud.ts`. Fewer concepts for AI-generated code to get subtly wrong, zero framework bytes, no hydration/lifecycle questions, and the HUD is small enough that "manual DOM sync" never becomes the maintenance hazard it would be in a form-heavy app.
- **Escape hatch**: if the HUD ever grows real screens (accounts, drills library, stats history), bolt Preact or Svelte onto the UI layer only — the layering below makes that a leaf-level change.

## 2. Dependency policy

**Runtime dependencies: exactly one — `three@0.185.1` (pin with `~`; three does breaking changes per minor, so do not use `^` casually).**

- **Three.js usage**: import from the ESM entry (`import { Scene, PerspectiveCamera, ... } from "three"`); Rollup tree-shaking in Vite trims a meaningful amount. Avoid `three/examples/jsm/*` entirely — no OrbitControls (cameras are scripted rigs, the user never free-orbits), no loaders beyond `TextureLoader` if a texture is used at all.
- **No physics engine** (no cannon-es, no Rapier). The entire simulation is kinematic 2D trig on the table plane: ghost position is a closed-form expression, the pocket test is a ray-vs-pocket-mouth angular check, and nothing rolls in real time. A physics engine would add ~100–500 kB, nondeterminism, and tuning burden to compute what three lines of vector math compute exactly. (If a later version animates the object ball rolling to the pocket, that is still hand-rolled constant-deceleration kinematics, not a physics engine.)
- **Animation**: hand-rolled. One `ease(t)` (cubic in/out), one `animate(from, to, duration, onFrame)` helper (~30 lines) covers the only animations that exist: standing↔down camera transition and result reveal. No GSAP, no tween.js — a tween lib's payload exceeds the code it would replace by an order of magnitude.
- **State**: plain TS module (`ui/store.ts`) holding an app-state object + typed `subscribe/emit`. No Zustand/Redux/signals library.
- **Explicitly avoid**: react-three-fiber/drei, any physics engine, any UI/component kit, Tailwind (one small hand-written CSS file suffices), lodash (write the 3 helpers), moment/date libs, any analytics SDK in v1.
- **Dev dependencies**: `vite@8.2.2`, `vitest@4.1.11`, `typescript@7.0.2`, `@biomejs/biome@2.5.11`, `vite-plugin-pwa@1.3.0`, optionally `@playwright/test@1.62.1` (see §4).

## 3. Repo structure

Hard rule enforced by review + CI: **`src/core/` imports nothing** — not `three`, not the DOM, not other layers. Everything in it is pure functions over plain data (table-plane 2D coordinates in metres). The scene and UI layers depend on core; never the reverse. A one-line CI guard (`grep -rE "from ['\"](three|\.\./scene|\.\./ui)" src/core && exit 1`) keeps AI-generated edits honest.

```
ghostball/
├── index.html
├── vite.config.ts            # base: '/ghostball/', vite-plugin-pwa config
├── tsconfig.json             # strict everything (see §5)
├── biome.json
├── package.json
├── .github/workflows/ci.yml  # typecheck + test + build + deploy to Pages
├── public/                   # PWA icons only (textures imported via src for hashing)
└── src/
    ├── core/                 # PURE GEOMETRY & GAME LOGIC — zero imports, fully unit-tested
    │   ├── types.ts          # Vec2, Shot, Guess, Result, TableSpec — plain data, no classes
    │   ├── vec.ts            # 2D vector ops: add, sub, scale, norm, dot, angleBetween, rotate
    │   ├── table.ts          # table constants (9-ft WPA dims, ball r=0.028575 m), 6 pocket mouths as jaw-point segments
    │   ├── ghost.ts          # trueGhostPosition(ob, pocket): ob + 2r·unit(ob − pocketTarget); cut angle; contact normal
    │   ├── constraint.ts     # projectToContactCircle(dragPoint, ob), reachableArc(cue, ob) half-circle clamp, nudgeAlongArc(pos, ±step)
    │   ├── pocket.ts         # departure ray from guessed ghost through ob; doesPot(ray, pocket) with real mouth width; angular acceptance = f(mouth, distance)
    │   ├── shot.ts           # seeded random shot generation: valid layouts, cut-angle caps per difficulty, invariant "true ghost always pots"
    │   └── score.ts          # angular error, arc-distance error, pot/no-pot, grade mapping; monotonic
    ├── scene/                # THREE.JS LAYER — depends on core + three, no DOM logic beyond canvas events
    │   ├── buildScene.ts     # table, cushions, cloth, balls, lights; materials mostly procedural
    │   ├── cameras.ts        # standing rig (eye ~1.65 m, pitched down) & down rig (eye ~0.35 m above rail, sighting cue line); tweened transition
    │   ├── ghostInteraction.ts # pointer events → raycast onto table plane → core/constraint projection → move mesh
    │   ├── ballViews.ts      # cue/object/ghost meshes; ghost = translucent + outline shader-free trick (opacity + depthWrite off)
    │   └── render.ts         # on-demand rendering: invalidate() flag + rAF only while dirty/animating
    ├── ui/                   # THIN DOM HUD — depends on core types + store
    │   ├── store.ts          # app state (phase, shot, guess, stance) + typed pub/sub (~60 lines)
    │   ├── hud.ts            # nudge arrows (press-and-hold repeat), submit, stance toggle, new shot
    │   └── feedback.ts       # results panel: error mm/degrees, potted?, visual grade
    ├── debug/
    │   └── topdown.ts        # canvas-2D top-down renderer of core state; behind ?debug=1; later: user-facing minimap
    ├── main.ts               # wiring: store ⇄ scene ⇄ hud
    └── style.css
```

Key property: `core/` is the product. `scene/` is a projection of it; `debug/topdown.ts` is a second, cheaper projection of the same state, which is what makes milestone-first development work (§7).

## 4. Testing

**Vitest 4 (`vitest@4.1.11`), colocated `*.test.ts` inside `src/core/`. Target: near-100% coverage of `core/`, zero unit tests of `scene/`/`ui/`.**

The 15 most valuable geometry test cases:

1. **Straight-in shot**: cue, OB, pocket collinear → true ghost centre lies exactly `2r` behind the OB on the OB–pocket line, on the cue side.
2. **Contact invariant**: for any generated shot, `|trueGhost − ob| === 2r` to 1e-12.
3. **Cut-angle correctness**: with the true ghost position, departure direction `unit(ob − ghost)` equals `unit(pocketTarget − ob)`; verify a hand-computed 30° cut fixture numerically.
4. **Projection lands on circle**: arbitrary drag points (inside the circle, far outside, on cushions) project to a point exactly `2r` from OB, and it is the *nearest* such point.
5. **Projection idempotence**: a point already on the contact circle projects to itself (ε-equal).
6. **Projection degenerate case**: drag point exactly at OB centre returns a defined, finite result (e.g. retains previous ghost position) — no NaN.
7. **Reachable-arc clamp**: positions on the far half-circle (contact point not facing the cue ball, i.e. `dot(ghost − ob, cue − ob) ≤ 0`) are rejected/clamped to the arc limit; boundary at exactly 90° is handled consistently.
8. **Nudge stays on circle**: `nudgeAlongArc` moves by the configured arc length, result stays `2r` from OB; left-then-right nudges return to start within ε.
9. **Nudge clamping**: nudging past the reachable-arc limit pins at the limit rather than wrapping into the unreachable half.
10. **Perfect guess pots**: for every generated shot, submitting the true ghost position → `potted === true` and zero error (generator/pocket-test consistency).
11. **Pocket acceptance window**: an angular error just inside the pocket's half-width acceptance still pots; just outside does not — test both sides, and assert the window *narrows* as OB→pocket distance grows.
12. **Corner-pocket geometry edge cases**: shot rolled along the cushion line into a corner pocket pots; a ray hitting the cushion point one ball-width outside the jaw does not.
13. **Scoring monotonicity + bounds**: score strictly non-increasing in angular error; zero error → max score; "potted but imperfect" scores between miss and perfect.
14. **Generator validity (property test)**: 1000 seeded shots — all balls on the playing surface with cushion clearance, cue/OB not overlapping, cut angle ≤ difficulty cap, true ghost reachable and not intersecting a cushion.
15. **Determinism**: same seed → identical shot (enables shareable/replayable drills and stable tests).

**Rendering/E2E for v1**: skip visual-regression and scene unit tests entirely (high cost, low signal for a solo project). **Do** add one Playwright smoke test (`@playwright/test@1.62.1`, chromium-only, ~30 lines): page loads under `vite preview`, a WebGL canvas exists, no console errors, tapping Submit produces a feedback panel. This is cheap insurance against the classic "geometry tests green, deployed page blank" failure. If CI minutes or flakiness annoy, it is the first thing to cut — geometry tests are the ones that matter.

## 5. Tooling

- **Lint/format: Biome 2 (`@biomejs/biome@2.5.11`)** instead of ESLint + Prettier. One dev dependency, one config file, milliseconds-fast, and with no framework there is no need for the ESLint plugin ecosystem (the usual reason to stay on ESLint). `biome check --write` covers both lint and format; add `noRestrictedImports` scoped to `src/core/**` banning `three` as a second layer-purity guard.
- **tsconfig (strict)**: `"strict": true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: "bundler"`, `target: "ES2022"`, `types: ["vite/client"]`.
- **npm scripts**:
  ```json
  {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome check --write .",
    "e2e": "playwright test",
    "ci": "npm run typecheck && npm run lint && npm run test && vite build"
  }
  ```
- **Vite config essentials**: `base: "/ghostball/"` (project Pages path — without this every asset 404s), `build.target: "es2022"`.
- **PWA**: `vite-plugin-pwa@1.3.0`, `registerType: "autoUpdate"`, precache everything (`globPatterns: ["**/*.{js,css,html,png,webp,ktx2,woff2}"]` — the whole app is small enough to precache, giving full offline), manifest with `display: "standalone"`, `orientation: "any"`, 192/512 px icons + maskable. This makes it install to a phone home screen and work in a basement pool hall with no signal — genuinely valuable for this product.
- **GitHub Actions** (`.github/workflows/ci.yml`), CI + Pages deploy in one workflow:
  ```yaml
  name: ci
  on:
    push: { branches: [main] }
    pull_request:
  permissions: { contents: read, pages: write, id-token: write }
  jobs:
    ci:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npm run typecheck
        - run: npm run lint
        - run: npm run test
        - run: npx vite build
        - run: "! grep -rE \"from ['\\\"](three|\\.\\./scene|\\.\\./ui)\" src/core"
        - uses: actions/upload-pages-artifact@v3
          if: github.ref == 'refs/heads/main'
          with: { path: dist }
    deploy:
      needs: ci
      if: github.ref == 'refs/heads/main'
      runs-on: ubuntu-latest
      environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
      steps:
        - id: deployment
          uses: actions/deploy-pages@v4
  ```
  (Repo setting: Pages → Source → GitHub Actions. Add the Playwright smoke as a separate optional job when adopted.)

## 6. Performance / size budget

- **JS budget**: three's tree-shaken core for a scene like this lands around 150–170 kB min+gzip; app code should stay under 30 kB. **Target ≤ 220 kB gzip total initial JS, hard ceiling 300 kB.** Everything ships in one chunk (no route splitting — there are no routes); PWA precache makes second load instant regardless.
- **Texture/asset budget**: prefer procedural materials — flat-colour cloth with a subtle roughness, `MeshStandardMaterial` balls, simple wood-tone rails. If photographic wood/cloth is wanted, at most two 1024² textures, compressed (WebP for colour maps): **≤ 1.5 MB total assets, ≤ 3 MB total precache** so the PWA installs in seconds on mobile data.
- **Render on demand, not a continuous loop.** The scene is a still life: nothing moves except (a) the ghost ball while dragging/nudging, (b) the camera during stance transitions, (c) the result reveal. Use the invalidate pattern — every mutation calls `invalidate()`; a rAF loop runs only while dirty or while an animation is active, then stops. On mobile this is the difference between a warm phone at 100%/hour drain and effectively zero cost while the player studies the shot (which is most of the session). It also means expensive-but-static niceties (soft shadows, 2× DPR) are affordable because they are paid per interaction, not per frame. Clamp `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
- **If plain canvas 2D were chosen instead**: `core/`, `ui/`, tests, tooling, CI — all identical; only `scene/` swaps for a hand-rolled pinhole-projection renderer (project table-plane points to screen, draw balls as shaded ellipses/radial gradients). You save ~170 kB and all WebGL risk, and the top-down debug renderer already proves the pattern. The cost is "realistic": convincing cushions, cloth, lighting and the down-on-shot depth cue become hand-painted artwork, and camera transitions get harder. Given the requirement explicitly says *realistic first-person view*, Three.js is the right call — but the architecture makes the 2D fallback a contained, single-directory decision if WebGL performance on the user's phone disappoints.

## 7. Milestone-friendly architecture

The core/scene/ui split is chosen precisely so the hard, testable part is finished and trusted before any 3D exists:

- **M0 — scaffold (day 1)**: Vite + TS + Biome + Vitest + CI + Pages deploy of a hello-world page. Deployment works before features exist.
- **M1 — core + top-down debug (fully playable, zero 3D)**: implement all of `src/core/` with the §4 test suite, plus `debug/topdown.ts` — a ~150-line canvas-2D renderer drawing the table rectangle, pockets, balls, constraint arc, and true-ghost marker, with click/nudge wired through the real `constraint.ts` and `pocket.ts`. At the end of M1 the *game* is playable and correct, just ugly. Every geometry bug found here costs minutes instead of hours of "is it the maths or the raycast or the camera?".
- **M2 — Three.js scene**: `buildScene`, camera rigs, drag raycast → same `projectToContactCircle`, on-demand rendering. Because the scene layer only *displays* core state, any visual/behavioural divergence from the top-down view localises the bug to `scene/` immediately.
- **M3 — product polish**: stance transition animation, feedback panel, difficulty tiers, PWA, Playwright smoke.
- **Keep the top-down renderer permanently — yes, emphatically.** It is dependency-free, reads the same store, and pays for itself three times: (1) forever-useful debug view behind `?debug=1` for diagnosing "the pocket test disagrees with what I see"; (2) the perfect verification surface for AI-generated geometry changes; (3) a straight promotion path to a **user-facing minimap** in the standing view — a top-down inset genuinely helps players connect the perspective view to table geometry, so the debug tool likely becomes a feature. Cost of keeping it: ~0 (it has no dependencies to rot).

---

## Decision table

| # | Concern | Decision | Notes / version |
|---|---|---|---|
| 1 | Language | TypeScript, strict | `typescript@7.0.2` (fallback 5.9.x if tooling lags) |
| 2 | Build tool | Vite | `vite@8.2.2`, `base: "/ghostball/"` |
| 3 | UI framework | None — vanilla TS + tiny DOM HUD | React/Svelte rejected: HUD is ~12 elements; imperative 3D scene dominates |
| 4 | 3D rendering | Three.js, ESM imports, no `examples/jsm` | `three@0.185.1`, pin with `~` (breaking changes per minor) |
| 5 | Physics | None — hand-rolled closed-form kinematics | Ghost pos, pocket test, scoring are pure trig |
| 6 | Animation | Hand-rolled easing + rAF tween helper (~30 lines) | No GSAP/tween.js |
| 7 | State | Plain module + typed pub/sub store | No Zustand/Redux |
| 8 | Forbidden deps | r3f/drei, physics engines, UI kits, Tailwind, lodash, tween libs | Keep runtime deps = 1 (`three`) |
| 9 | Repo layout | `src/core` (pure, dep-free) / `src/scene` (three) / `src/ui` (DOM) / `src/debug` | Core imports nothing; CI grep + Biome rule enforce it |
| 10 | Unit tests | Vitest on `core/` only, 15 cases incl. seeded property test of generator | `vitest@4.1.11`, colocated `*.test.ts` |
| 11 | E2E | One Playwright chromium smoke test | `@playwright/test@1.62.1`; first thing to cut if flaky |
| 12 | Lint/format | Biome (replaces ESLint + Prettier) | `@biomejs/biome@2.5.11` |
| 13 | CI | GitHub Actions: typecheck → lint → test → build → core-purity grep | Single workflow, Node 22 |
| 14 | Hosting | GitHub Pages via `actions/deploy-pages@v4` | Pages source = GitHub Actions |
| 15 | PWA | vite-plugin-pwa, autoUpdate, precache all, standalone | `vite-plugin-pwa@1.3.0`; full offline |
| 16 | JS budget | ≤ 220 kB gzip initial (ceiling 300 kB) | three core ~150–170 kB of that |
| 17 | Asset budget | ≤ 1.5 MB textures, ≤ 3 MB precache; prefer procedural materials | DPR clamped to 2 |
| 18 | Render loop | On-demand (invalidate pattern), rAF only during drag/tween | Battery-critical on mobile |
| 19 | Debug view | Top-down canvas-2D renderer, kept permanently (`?debug=1`) | Promote to user-facing minimap in standing view |
| 20 | Milestones | M0 scaffold+deploy → M1 core+tests+top-down (playable) → M2 3D scene → M3 polish/PWA | Geometry verified before any 3D exists |
| 21 | Canvas-2D fallback | Not chosen, but contained: only `src/scene/` would swap | Core/tests/CI unchanged |