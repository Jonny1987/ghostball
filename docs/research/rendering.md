# Rendering Approach Evaluation: Ghost Ball Pool Trainer

## Verdict up front

**Recommendation: Option A — Three.js real-time 3D, fully procedural scene, render-on-demand (not a 60fps loop).** It is the only option that simultaneously satisfies (a) "realistic" first-person imagery, (b) arbitrary generated shot layouts, (c) two camera stances that must re-aim as the ghost ball moves, (d) precise touch interaction on a 3D table plane, and (e) a small, offline-friendly static deployment. Every other option either caps realism far below "realistic" (B, D) or collapses under the requirement that shots are *generated*, not fixed (C). Three.js is also the single best-supported 3D library for AI-assisted development — an enormous advantage for a solo dev building with AI.

---

## 1. Comparison of approaches

### Summary table

| Criterion | A. Three.js 3D | B. 2D canvas + hand-rolled perspective | C. Pre-rendered images + composited balls | D. CSS 3D / SVG hybrid |
|---|---|---|---|---|
| Realism ceiling | **High** (PBR, IBL, shadows; near-photoreal with baked lighting) | Low–medium (stylised at best; convincing spheres/cushions require artisanal painting) | **Highest for the table**, but only for *fixed* viewpoints; composited balls break realism | Low (flat planes + gradient circles) |
| Mid-range Android perf | Excellent with render-on-demand (~25 draw calls, scene mostly static) | Excellent | Excellent (it's images) | Poor–fragile (layer explosions, transform flattening bugs) |
| Effort for AI-assisted solo dev | **Moderate — best AI support of any option**; Three.js has the largest corpus of any 3D web library | High: every visual feature is bespoke math + art; no library help | Requires Blender skills + a render pipeline per layout; two toolchains | Moderate code, but endless cross-browser fights |
| Interaction (drag on table plane, constraint circle) | **Trivial**: built-in `Raycaster` vs. an invisible plane, project to circle in world space | Must hand-roll inverse projection; doable but all yours to debug | Must ship camera matrices alongside every image and hand-roll inverse projection anyway — you're doing 3D math without a 3D engine | Hit-testing 3D-transformed elements is unreliable across mobile browsers |
| Bundle size | ~150–170 KB gz (three core, tree-shaken); zero image assets (procedural) | Tiny (~10–30 KB) | Huge: many MB of images per layout/stance; unbounded if shots are generated | Tiny |
| Offline / PWA | **Excellent** — everything procedural, nothing to cache but the JS | Excellent | Bad — large asset cache, or online rendering service | Excellent |
| Two stances + camera that follows the ghost ball | Native: move one camera | Re-derive full projection per stance; view-follows-ghost doubles the math | Impossible without pre-rendering every camera angle | Impractical |

### A. Three.js — why it wins

The scene is tiny by 3D standards: one table, three balls, a few lights. Mid-range Android GPUs (Mali-G57, Adreno 6xx class) eat this at DPR 2 without effort. The decisive points:

- **Realism**: `MeshPhysicalMaterial` with clearcoat gives phenolic-resin balls their signature tight specular highlight; an IBL environment map (Three's built-in `RoomEnvironment` → `PMREMGenerator`) does 80% of the "this looks real" work for free; one shadow-mapped spot plus contact-shadow discs grounds everything. A dark surround sells "pool hall" and conveniently hides everything you didn't model.
- **Generated shots come free**: any cue/object/pocket layout, any camera, no new assets.
- **Interaction comes free**: raycast a touch to the table plane, project onto the constraint circle — 15 lines.
- **The down-view must sight along the cue-ball→ghost-ball line, which changes as the user adjusts**. Only a real camera does this without pain.
- **AI leverage**: Three.js is by far the most heavily represented 3D library in AI training data. An AI-assisted solo dev will get correct, idiomatic code for raycasting, materials, ExtrudeGeometry, camera math on the first ask far more often than with any alternative.

Risks and mitigations: WebGL context loss on Android (listen for `webglcontextlost/restored`, rebuild); battery drain (eliminated by render-on-demand); "programmer-art" table (mitigated below — geometry fidelity on cushion jaws + lighting matter far more than textures).

### B. 2D canvas + hand-rolled projection — rejected

You can project 3D points to 2D yourself and draw the table outline convincingly; that part is a weekend. What you cannot cheaply do is make it *realistic*: spheres need per-position shading consistent with a light rig; cushions need visible top-face/nose geometry that changes with view angle; the down-the-shot view is almost edge-on, where flat-painted geometry falls apart worst. You'd re-implement, by hand and per-feature, exactly the things Three.js gives you wholesale — plus the inverse projection for input. Strictly dominated by A for this requirement set.

### C. Pre-rendered (Blender) + composited balls — rejected

Highest realism *only if the viewpoint and table are fixed*. This app's core loop is: generated layouts × two stances × a camera that re-aims along cue→ghost as the user adjusts. That's a continuum of viewpoints — you cannot pre-render it. Even the degenerate version (one fixed table photo per stance, balls composited as sprites) requires shipping the exact camera matrices used at render time and doing full 3D math for placement, hit-testing, and the constraint circle — while balls composited onto a photo never match its lighting/shadows and read as stickers. It also bloats the PWA cache and forecloses future features (different tables, free camera). A legitimate *hybrid* — bake an AO/lightmap or an HDR environment offline and use it inside Three.js — is worth doing later, but that's an enhancement to A, not a separate approach.

### D. CSS 3D / SVG — rejected

CSS 3D renders transformed *planes*; there are no spheres, no lighting model, no shadows. Balls become billboarded radial-gradient circles that never look right near-edge-on (exactly the down-the-shot view). Z-sorting between transformed layers, `preserve-3d` flattening bugs, and hit-testing on 3D-transformed elements remain a swamp on Android WebView and iOS Safari. Realism ceiling is the lowest of the four.

---

## 2. Deep dive on the recommended approach (Three.js)

### 2.1 Stack and project shape

- **three** (pin a recent release), ES modules, tree-shaken via **Vite**. Import `Line2`/`LineMaterial` from `three/addons` for aiming lines. No other runtime deps — no physics engine, no tween library (a 30-line easing helper suffices), no React needed for a single-screen app (plain TS + a thin UI layer; React is fine if preferred but adds nothing here).
- Deploy: static build to GitHub Pages. PWA via `vite-plugin-pwa`; since the entire scene is procedural, precaching the JS/HTML makes the app fully offline.
- All dimensions in **metres, real-world scale** (critical: it makes eye heights, FOV, and error-in-mm reporting meaningful). Parameterise the table spec; default to a 9-ft American table (playing surface 2.54 × 1.27 m, ball radius r = 0.028575 m, bed height ~0.80 m from floor), with a config for UK 8-ball (7 ft, 2" balls) since "pool" may mean either — one constants object, everything derives from it.

### 2.2 Scene graph

```
Scene (background: very dark warm grey / gradient; fog optional)
├── env: PMREM(RoomEnvironment)  → scene.environment (IBL for speculars)
├── lights
│   ├── HemisphereLight (dim; cool sky, warm ground, intensity ~0.25)
│   └── SpotLight (main "table lamp", above table centre, castShadow,
│                  1024 shadow map, penumbra ~0.4)
├── table (Group, static — built once)
│   ├── bed (cloth material)
│   ├── cushions ×6 (extruded profile with jaw cuts, cloth material)
│   ├── rails (wood), diamond sights (small emissive-ish discs)
│   ├── pocketLiners ×6 (dark cylinders + black discs — read as holes)
│   └── legs/skirt (simple boxes; barely visible, cheap)
├── balls (Group)
│   ├── cueBall  + contactShadow disc
│   ├── objectBall + contactShadow disc
│   └── ghostBall (translucent; renderOrder last) + dashed footprint ring
├── aids (Group, hidden until submit)
│   ├── guessedLine (Line2, dashed)
│   ├── trueLine (Line2, solid)
│   └── trueGhostOutline (wireframe/ring at correct position)
└── (camera not parented; one PerspectiveCamera, repositioned per stance)
```

### 2.3 Procedural table construction

**Bed**: a box (not a plane — its edge shows at low camera angles) with the cloth material. Add cloth markings (head spot, foot spot) as tiny flat discs 0.2 mm above the bed with `polygonOffset` to avoid z-fighting.

**Cushions — the highest-value geometry in the scene.** The down-the-shot view stares straight at cushion noses and pocket jaws, so this is where realism is won or lost. Build each cushion from a 2D cross-section (an L/trapezoid: vertical back, angled nose face undercutting toward the cloth, nose apex at standard height ~0.635 × ball diameter ≈ 36 mm above the bed) swept along the rail with `ExtrudeGeometry`, then cut the ends at the pocket **jaw angles** (~142° for corners, ~104° for sides — just angle the end caps; exactness is not critical, the *presence* of angled jaws is). Six segments, gaps at the pockets sized to real mouths (corner ~11.7 cm, side ~13 cm between cushion noses). This is fiddly but a one-time function ~150 lines; AI writes shape-extrusion code well. Use the cloth material on cushions (cushions are cloth-covered), wood on the rail caps behind them.

**Pockets**: you never need real pocket geometry. A short dark cylinder (open-ended, `BackSide`) sunk below each mouth plus a pure-black disc at its bottom reads perfectly as a hole from any legal camera angle. Rounded rail corners around pockets are a nice-to-have via `Shape.absarc` on the rail outline.

**Materials** (all procedural — zero downloaded textures):
- **Cloth**: `MeshStandardMaterial`, deep tournament green or blue (e.g. `#1a5c2a` / `#2b5f8a`), `roughness 0.92, metalness 0`, plus a **runtime-generated tileable noise normal map**: draw 256×256 value noise into a canvas, derive a normal map from it (or just use it as a `bumpMap`, `bumpScale ~0.0004`), `RepeatWrapping`, repeat ~×24 across the bed. This subtle high-frequency response to the spot light is what makes cloth read as felt instead of green plastic.
- **Wood rails**: `MeshStandardMaterial`, dark walnut, `roughness 0.45`, faint procedural streak noise as a colour map (stretched 1D noise). Even a flat colour with correct roughness looks fine under IBL.
- **Pocket liners**: near-black, `roughness 1`.

**Baked AO substitute**: rather than a real bake, add a pre-darkened gradient strip along the bed edges where cushions meet cloth (a canvas texture on the bed, or vertex colours) — cheap, static, and grounds the cushions convincingly.

### 2.4 Ball rendering

- `SphereGeometry(r, 48, 32)` — silhouettes stay round even large on screen; 3 balls ≈ 9 k tris total.
- `MeshPhysicalMaterial`: `roughness 0.12, clearcoat 1.0, clearcoatRoughness 0.08, metalness 0`. With `scene.environment` set, this alone produces the glossy phenolic look. Object ball: saturated colour (make it configurable); optional number/stripe via a small canvas texture later — skip for v1.
- `castShadow = true` onto the bed (`receiveShadow`), from the single spot.
- **Contact shadows**: a 128×128 radial-gradient `CanvasTexture` on a small plane 0.5 mm above the cloth under each ball (`transparent`, `depthWrite:false`, `polygonOffset`). Shadow maps alone leave balls looking like they float; the tight dark contact disc fixes it for ~zero cost. Move it with the ball.

**Ghost ball**: same geometry; white `MeshPhysicalMaterial` with `transparent: true, opacity 0.38, depthWrite: false, roughness 0.3`, faint emissive (`#88bbff`, intensity ~0.15) so it reads as a hologram, not a dirty white ball. Add a **fresnel rim** for legibility against the cloth: simplest robust method is a second, back-side shell (radius ×1.02, `AdditiveBlending`, low-opacity `ShaderMaterial` or just a `MeshBasicMaterial` at opacity 0.15). Set `renderOrder` so it draws after opaque balls. Also draw a **dashed circle decal on the cloth at its footprint** — in the standing view this is often easier to judge than the translucent sphere itself. No contact shadow on the ghost (it's hypothetical); the dashed ring plays that role.

### 2.5 Lighting rig ("pool hall look")

1. `scene.environment = PMREM(RoomEnvironment)` — free IBL, drives all speculars. Later upgrade path: a small HDR of an actual pool hall.
2. One `SpotLight` ~1.2 m above table centre, warm white (~4500 K tint), intensity tuned so cloth under the lamp is bright and rails fall off; `angle` wide enough to cover the table, `penumbra 0.4`, shadow map 1024².
3. Dim `HemisphereLight` (~0.25) so shadowed areas aren't crushed to black.
4. Background: very dark gradient or flat `#0d0b09`. Darkness around a brightly lit table *is* the pool-hall aesthetic and hides the absent room.
5. `renderer.toneMapping = ACESFilmicToneMapping`, `toneMappingExposure ≈ 1.1`, `outputColorSpace = SRGBColorSpace`.

### 2.6 Cameras and stances

One `PerspectiveCamera`, repositioned; animate transitions (position lerp + quaternion slerp, ~400 ms, easeInOutCubic).

Let `C` = cue ball centre, `G` = ghost centre, `O` = object ball centre, `P` = pocket mouth centre; `aim = normalize(G − C)` on the horizontal plane. Bed surface ≈ y 0.80 m from floor; ball centres at bed + r.

**Standing stance** — the surveying/placement view:
- Eye at `C − aim × 1.3 m`, height **1.62 m** (floor-relative).
- `lookAt` a point blending object ball and pocket: `mix(O, P, 0.35)` — keeps cue ball, object ball, and pocket all in frame with the shot line running up-screen.
- Vertical FOV **60°**.
- Camera stays **fixed per shot** in this stance (do not follow the ghost) — it's the stable "editor" view where dragging happens.

**Down-on-the-shot stance** — the sighting view:
- Eye on the aim line: `C − aim × 1.0 m`, height **0.97 m** — i.e. ~0.14 m above the bed, chin-over-cue, so cushion noses and balls stack near the horizon exactly as they do for a real shooter.
- `lookAt(G)` — sighting **along the cue-ball→ghost-centre line**. This is the pedagogical heart of the app: when the guess is right, ghost and object ball form the correct overlap picture dead-centre, exactly like real aiming.
- Vertical FOV **52°**.

**Why ~50–65° vertical FOV**: it corresponds to a "normal" ~35–45 mm-equivalent lens — the range where perspective on screen best matches human attentional vision. Wider (>70°) visibly stretches spheres near the frame edges (balls render as eggs — fatal in an app about judging ball geometry) and exaggerates distances, making the pocket look further than it is; narrower (<45°) crops away table context, flattens depth cues the user needs to judge the cut, and shrinks the constraint circle's screen-space size, hurting touch precision. Down view slightly narrower than standing because it's about sighting one line, not surveying. On **portrait phones**, holding vertical FOV constant makes horizontal FOV very narrow; derive FOV from aspect instead: target a horizontal FOV (~55–60°) and compute `vfov = 2·atan(tan(hfov/2)/aspect)`, clamped to [50°, 70°]. Portrait actually flatters this app: the shot line runs up the screen in both stances.

**View updates as the ghost moves — recommended behaviour**: the down view **re-sights along cue→ghost continuously but damped**, using frame-rate-independent smoothing (`k = 1 − exp(−dt/τ)`, τ ≈ 0.15 s) on both eye position and look target. Two exceptions: (1) **during an active drag, freeze the camera** and only re-sight on `pointerup` — a camera moving under the finger changes the touch→world mapping mid-gesture and makes precise placement impossible; (2) nudge-arrow presses use the damped follow, which feels like the shooter micro-adjusting their alignment — this is exactly the intended use of the down view. The standing view never follows; it re-frames only when a new shot is generated.

### 2.7 Input: touch → table plane → constraint circle

- Maintain pointer NDC from `pointerdown/move` on the canvas (use Pointer Events; set `touch-action: none` on the canvas).
- `Raycaster.setFromCamera(ndc, camera)`, intersect an **invisible mathematical plane at ball-centre height** (`y = bedY + r`), not the cloth surface — the constraint circle lives at centre height, and using the centre plane makes the ghost track directly under the finger instead of lagging by a projection offset.
- Project to the constraint: `d = hit − O; d.y = 0;` if `|d| < ε` keep the previous angle; else `G = O + normalize(d) × 2r`. Store the state as a **single angle θ** around the object ball (`θ = atan2(d.z, d.x)`) — the entire guess is one scalar, which makes nudging, scoring, and persistence trivial.
- **Reachability clamp (recommended)**: only the half-circle facing the cue ball is physically reachable (the cue ball can't arrive behind the object ball). Clamp θ to the semicircle where `dot(normalize(G−O), normalize(C−O)) > 0`, minus a small margin near the tangent limits (a >88° cut is unpottable anyway). This prevents nonsense guesses and matches the user's "only positions where it touches" intent taken to its logical end. Make the clamp a flag in case they want the full circle.
- **Hit-testing the ghost ball for drag start**: do it in **screen space**, not by raycasting the sphere — project `G` with `camera`, and if `pointerdown` lands within **48 CSS px**, begin the drag (standard minimum touch-target size; the ghost's on-screen radius in the standing view can be well under that). During the drag, apply the raycast-and-project mapping every move. Also allow **tap-anywhere-on-the-circle** to jump the ghost there — cheap and useful.
- **Nudge arrows**: two on-screen buttons (⟲ ⟳ around the circle) change θ by a fine step — recommend **arc length ~1.5 mm** (Δθ = 0.0015/(2r) rad ≈ 1.5°... compute from arc: Δθ = s/(2r); at 2r = 57 mm, 1.5 mm ⇒ ~1.5°). Hold-to-repeat with acceleration (start 3 Hz, ramp to 15 Hz). Arrows are DOM overlay buttons, not in-scene — far better for accessibility and touch reliability.

### 2.8 Scoring and pot determination (drives the aids and animation)

- **True ghost position**: `G* = O − normalize(P − O) × 2r` (centre-to-pocket line; ignore throw/contact-induced-throw — correct choice for a geometry trainer, note it as a possible "advanced mode").
- **Error metric**: report arc-length error `|θ − θ*| × 2r` in **mm**, and equivalently the cut-angle error in degrees — both meaningful to players.
- **Pot check with real pocket width**: object ball departs along `u = normalize(O − G)`. Find where the ray `O + t·u` crosses the pocket mouth line; the ball pots if the crossing point is within `(mouthWidth/2 − r) × leniency` of the pocket centre (leniency ~0.85 to approximate jaws rejecting thin edge hits; corner mouth ~11.7 cm). Classify: **Perfect** (< 2 mm), **Potted**, **Rattled** (within mouth but outside leniency), **Missed** — tiered feedback is far more motivating than a binary.

### 2.9 Aiming aids after submit

Show, 1 mm above the cloth (`polygonOffset` or slight y-lift, `depthTest` on):
- **Guessed impact line**: `O` along `u_guess`, dashed, red/amber/green by outcome — drawn to the cushion/pocket intersection.
- **True line**: `O → P`, solid, subtle white.
- **True ghost ball**: dashed ring + faint outline sphere at `G*`, so the user sees positional error directly.
Use `Line2`/`LineMaterial` from addons with `worldUnits: false` and ~3 px width (plain `THREE.Line` is 1 px and unreadable on high-DPR mobile). Optionally also show the cue→ghost line in the standing view pre-submit as a toggleable trainer aid (off by default).

### 2.10 Submit animation — kinematic, not a physics engine

**Firm recommendation: no physics engine.** The outcome (pot/miss, line, distances) is already decided analytically; the animation is theatre. A physics engine (cannon-es, Rapier) adds 100 KB+, non-determinism, and weeks of tuning ball–cushion restitution and rolling friction to look right — and could *contradict* the analytic verdict, which would be a bug factory. Kinematic plan (~80 lines with a tiny tween helper):

1. **Cue ball**: ease from `C` to `G` (easeIn, duration ∝ distance, e.g. 3 m/s nominal). Stop dead at contact (a stun shot — physically legitimate and avoids simulating follow/draw).
2. **Object ball**: at contact, depart along `u_guess`. If **pot**: travel to pocket mouth with easeOutCubic (rolling deceleration feel), then a 250 ms "drop" (translate down 1.5 r + fade/scale-out) with a soft thock sound later. If **miss**: travel along the line to the first cushion intersection, then **one** reflected segment at ~45% speed, then decelerate to rest — a single damped bounce is enough polish to feel alive; hard-stop-at-cushion looks broken, full simulation is unnecessary.
3. **Rolling rotation**: for a ball moving distance s along unit vector v, rotate about axis `up × v` by angle `s / r` — one line per frame, and it's the difference between "sliding checkers" and "rolling balls".
4. Animation runs the render loop continuously only while active (see 2.11), then shows the score panel and aids.

### 2.11 Performance: budget and the render-on-demand core

Budget (comfortably met): ≤ 30 draw calls, ≤ 60 k triangles, one 512 PMREM env, one 1024 shadow map, three or four ≤ 256² canvas textures. This is trivially 60 fps on a mid-range Android — but the real win is **not rendering at all**:

- **Dirty-flag rendering**: keep a rAF loop that early-returns unless `invalidate()` was called. Invalidate on: drag move, nudge, camera transition/damped follow, submit animation, resize, visibility change, context restore. A user staring at the screen deciding costs **zero GPU/battery** — this matters enormously for a phone training app used in long sessions.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`. Because rendering is on-demand, DPR 2 is affordable and worth it (crisp ball edges are the content). Optional: drop to 1.5 during drags on low-end devices, snap back on release — usually unnecessary here.
- **Anti-aliasing**: `antialias: true` at renderer creation (WebGL2 MSAA on the default framebuffer — cheap on mobile tile GPUs). **Do not add post-processing/EffectComposer** — it forfeits default-framebuffer MSAA and buys nothing this app needs. High-contrast ball-edge-on-dark-cloth is the AA stress case; MSAA ×4 + DPR 2 handles it.
- Shadow map renders are cheap and only happen on invalidated frames; the scene's staticness means you could even freeze the shadow map (`spot.shadow.autoUpdate = false`, update on ball moves), but at this scale it's a micro-optimisation.
- Handle `webglcontextlost` (preventDefault, flag) / `webglcontextrestored` (rebuild renderer state) — Android Chrome sheds contexts under memory pressure.
- Size the canvas via `ResizeObserver` + `visualViewport` (mobile URL-bar collapse changes viewport height without a window resize).

### 2.12 Build order for the solo dev (suggested milestones)

1. Vite + three scaffold; bed + flat cushions + balls as spheres; standing camera; render-on-demand loop.
2. Raycast → constraint circle → drag + θ state + nudge buttons (the app is already *usable* here with placeholder visuals).
3. Scoring, pocket-width pot check, submit panel, aid lines.
4. Down-the-shot camera + stance toggle + damped follow + transition.
5. Realism pass: cushion jaws via ExtrudeGeometry, pocket liners, cloth bump, IBL + spot + contact shadows, tone mapping, ghost fresnel.
6. Submit animation (kinematic), tiers, shot generator (random O, C, P with solvability checks: cut angle < ~80°, min ball separation, ghost position not intersecting a cushion).
7. PWA manifest + service worker; deploy to GitHub Pages.

---

## Final recommendation (restated for the planner)

**Adopt Option A: Three.js, fully procedural scene, real-world metric scale, one PerspectiveCamera with two stance presets (standing: eye 1.62 m, vFOV 60°, fixed per shot; down: eye 0.97 m on the cue→ghost line, vFOV 52°, damped follow that freezes during drags), IBL via RoomEnvironment + one shadowed SpotLight + contact-shadow discs, ghost-ball state stored as a single angle θ on the 2r constraint circle, screen-space 48 px hit target + centre-height-plane raycast for dragging, DOM nudge buttons stepping ~1.5 mm of arc, analytic pot check against real pocket mouth width, kinematic eased submit animation with rolling rotation and a single damped cushion bounce (no physics engine), MSAA + DPR capped at 2, dirty-flag render-on-demand, Vite build to GitHub Pages with vite-plugin-pwa for offline.** Options B and D cannot reach the required realism, and Option C cannot serve generated layouts or a ghost-following camera; neither limitation is recoverable, so A is not merely preferred but the only viable path.