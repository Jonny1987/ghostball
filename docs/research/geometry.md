# Ghost Ball Trainer — Geometry & Scoring Specification (v1)

Definitive maths spec for the pool ghost-ball training web app. All game logic is **pure 2D geometry on the table plane**; rendering (perspective, two stances) is a view layer on top. Every function below is a pure function of its arguments and unit-testable. Test vectors are in §9.

---

## 0. Conventions & notation

- **Units:** millimetres (mm) and radians internally. Degrees only at the UI boundary. All constants below are mm unless stated.
- **Vectors:** lowercase bold semantics, written `V = (x, y)`. `|V|` = Euclidean norm. `normalize(V) = V / |V|` (caller guarantees `|V| > EPS`). `dot(A,B) = A.x*B.x + A.y*B.y`. `cross(A,B) = A.x*B.y − A.y*B.x` (scalar 2D cross). `perp(V) = (−V.y, V.x)` (90° CCW rotation).
- **Angles:** measured CCW from the +x axis. Helper `wrapToPi(a) = atan2(sin a, cos a)` → (−π, π]. `angleBetween(A,B) = atan2(|cross(A,B)|, dot(A,B))` ∈ [0, π] (numerically stable; do **not** use `acos(dot/…)` near 0/π).
- **Epsilons:** `EPS = 1e−6` mm for coincidence tests; `ARC_EPS = 0.5° = 0.008727 rad` for arc clamping.
- **Symbols:** `C` cue-ball centre, `O` object-ball centre, `G` true ghost-ball centre, `U` user-placed ghost-ball centre, `r` ball radius, `M` pocket-mouth midpoint, `P_target` aim point in pocket.

---

## 1. World model & constants

### 1.1 Coordinate system

Origin at the bottom-left **cushion-nose corner** of the playing surface. +x along the table's long axis, +y along the short axis. The playing surface is the rectangle `[0, L] × [0, W]` **measured nose-to-nose** (standard convention: quoted playing dimensions are between cushion noses). A ball centre is legal in `[r, L−r] × [r, W−r]`. z is implicit; ball centres live at height `r` above the bed (relevant only to the view layer, §8).

### 1.2 Default table: 9-ft American (WPA)

```json
{
  "tableLengthMm": 2540.0,        // L, playing surface 100 in
  "tableWidthMm":  1270.0,        // W, playing surface 50 in  (2:1)
  "ballRadiusMm":  28.575,        // r, 2.25 in diameter (57.15 mm)
  "cornerMouthMm": 114.3,         // WPA spec range 114.3–117.5 (4.5–4.625 in); tight-spec default
  "sideMouthMm":   127.0,         // WPA spec range 127.0–130.2 (5.0–5.125 in)
  "pocketSlopMm":  5.0,           // jaw forgiveness, §1.4
  "alphaMaxRad":   1.047198       // 60° max approach angle off mouth normal, §1.4
}
```

Derived: `2r = 57.15`, `4r² = 3266.12 mm²`.

**Alternative config (UK 8-ball, note only — same maths, different constants):** playing surface ≈ 1830 × 915 mm (7-ft table), ball diameter 50.8 mm (2 in; UK cue ball sometimes 47.6 mm — v1 assumes equal-sized balls), corner mouths ≈ 85 mm, side ≈ 95 mm, rounded jaws. Ship the US 9-ft config as the only v1 preset; keep every formula parameterised on the config object so UK support is a data change.

### 1.3 Pockets

Six pockets. Each is modelled by: two **jaw points** `J1, J2` on the playing-surface boundary (the cushion-nose tips), the **mouth midpoint** `M = (J1+J2)/2`, unit **mouth tangent** `t̂ = normalize(J1 − J2)`, and unit **inward-pocket normal** `n̂` (points off the table, into the pocket throat).

Corner mouths run diagonally across the corner. With corner mouth width `m_c`, place the jaws on the two boundary lines at distance `a = m_c / √2` from the corner (then `|J1−J2| = a√2 = m_c` ✓). With `m_c = 114.3`: `a = 80.822`.

| id | type | J1 | J2 | M | n̂ |
|----|------|----|----|---|----|
| 0 | corner | `(a, 0)` | `(0, a)` | `(a/2, a/2)` | `(−√2/2, −√2/2)` |
| 1 | side | `(L/2 + m_s/2, 0)` | `(L/2 − m_s/2, 0)` | `(L/2, 0)` | `(0, −1)` |
| 2 | corner | `(L, a)` | `(L−a, 0)` | `(L−a/2, a/2)` | `(√2/2, −√2/2)` |
| 3 | corner | `(L−a, W)` | `(L, W−a)` | `(L−a/2, W−a/2)` | `(√2/2, √2/2)` |
| 4 | side | `(L/2 − m_s/2, W)` | `(L/2 + m_s/2, W)` | `(L/2, W)` | `(0, 1)` |
| 5 | corner | `(0, W−a)` | `(a, W)` | `(a/2, W−a/2)` | `(−√2/2, √2/2)` |

`t̂ = perp(n̂)` up to sign; the sign convention only matters for consistent signed-offset reporting — fix `t̂ = perp(n̂)`.

### 1.4 Pocket capture model ("does it drop?")

The object ball (radius `r`) is treated as a point centre travelling along a ray; the ball's extent is folded into an **effective mouth half-width**:

```
w_eff = mouth/2 − r + pocketSlopMm
```

Rationale: the centre must pass at least `r` from each jaw tip to clear it geometrically; real jaws are faced/angled so a ball that brushes a jaw by a few mm still drops — `pocketSlopMm = 5` models that. Defaults: `w_eff,corner = 114.3/2 − 28.575 + 5 = 33.575 mm`, `w_eff,side = 127/2 − 28.575 + 5 = 39.925 mm`.

**Capture rule.** The ball is potted in pocket `pk` iff the centre ray from `O` in unit direction `d̂`:

1. intersects the **effective mouth segment** `[E2, E1]` where `E1 = M + w_eff·t̂`, `E2 = M − w_eff·t̂`, at some `t > 0`; and
2. the **approach angle** off the mouth normal satisfies `α = angleBetween(d̂, n̂) ≤ alphaMax` (default 60° for both pocket types — a ball rolled along a cushion into a corner arrives at α = 45° and must pass; a ball sliding nearly parallel to a side rail must fail); and
3. no cushion event occurs at smaller `t` (§4.2 event ordering).

This is deliberately angle-of-approach-crude (real effective width shrinks further with obliquity); listed in §7.

### 1.5 Aim point

```
P_target(pk) = M(pk) + AIM_DEPTH · n̂(pk),   AIM_DEPTH = 0 (default, both pocket types)
```

v1 aims at the mouth midpoint for corner and side pockets alike. `AIM_DEPTH` exists as a tuning knob (e.g. 15–25 mm for corners aims slightly into the throat); changing it changes only `G`, nothing else.

---

## 2. True ghost ball & cut angle

The ghost ball is where the cue-ball centre must be at contact so the object ball departs toward `P_target`. Balls contact when centres are `2r` apart, and the object ball departs along the line of centres (frictionless impact — throw ignored, §7):

```
aim = P_target − O                      // require |aim| > EPS (generation guarantees)
G   = O − 2r · normalize(aim)           // equivalently O + 2r·normalize(O − P_target)
```

`|G − O| = 2r` by construction. True object-ball direction: `d̂_true = normalize(O − G) = normalize(aim)`.

**Cut angle** (angle between cue-ball travel and object-ball departure):

```
v̂_true  = normalize(G − C)              // cue-ball pre-impact direction
φ_true  = angleBetween(v̂_true, d̂_true)  ∈ [0, π/2) for any physically reachable G
```

φ = 0 is dead straight; φ → 90° is an infinitely thin graze (transmits no momentum; excluded).

---

## 3. Constraint circle, drag projection, reachable arc, nudging

### 3.1 Parameterisation

User placement is a single scalar **θ** on the constraint circle of radius `2r` centred on `O`:

```
ê(θ) = (cos θ, sin θ)
U(θ) = O + 2r · ê(θ)
θ_true = atan2(G.y − O.y, G.x − O.x)
```

The user never manipulates free 2D coordinates; every input path (drag, nudge) resolves to a θ, then U is derived. This makes the constraint unbreakable and the state trivially serialisable.

### 3.2 Reachable arc — derivation (do this exactly; the obvious half-circle condition is wrong)

`U` is reachable iff the cue ball travelling in a straight line from `C` first contacts the object ball exactly when its centre reaches `U`. Parameterise the path `P(t) = C + t(U − C)`, `t ∈ [0,1]`, and let `f(t) = |P(t) − O|²`. By construction `f(1) = 4r²`. `U` is the *first* contact iff `f(t) > 4r²` for all `t < 1`, which (f is a convex parabola in t) holds iff f is non-increasing at `t = 1`:

```
f′(1) = 2·dot(U − O, U − C) ≤ 0
```

Substituting `U = O + 2r·ê` and `c = C − O` (`D = |c|`, generation guarantees `D > 2r`):

```
dot(U − O, U − C) = dot(2r·ê, 2r·ê − c) = 4r² − 2r·dot(ê, c) ≤ 0
⟺  dot(ê, c) ≥ 2r
⟺  dot(U − O, C − O) ≥ 4r²          ← the reachability condition
```

Note this is **not** `dot(U − O, C − O) < 0` (that sign is backwards — the ghost centre must lie on the *cue-ball side* of O) and not merely `> 0` (a half-circle): the threshold is `4r²`. Geometrically, with ψ = angle between `ê` and `c`:

```
reachable ⟺ ψ < Δ,   Δ = arccos(2r / D)
```

The reachable arc is centred on the direction from O toward C, with half-width Δ. As `D → ∞`, Δ → 90° (the intuitive half-circle, equivalent to cut < 90°); as `D → 2r⁺`, Δ → 0 (a nearly frozen cue ball can only shoot dead straight). The boundary ψ = Δ is exactly the 90° graze — the same condition also excludes cut angles ≥ 90°, and it simultaneously guarantees the C→U path is not blocked by the object ball (one condition covers both, as derived above). Useful cross-check identity: `cos φ = (D·cos ψ − 2r) / √(D² + 4r² − 4rD·cos ψ)`.

### 3.3 Clamp and drag projection

```
function clampToReachable(theta, O, C, cfg) -> theta':
  c      = C − O;  D = |c|                      // invariant: D > 2r (generation)
  Delta  = arccos(clamp(2r/D, −1, 1)) − ARC_EPS // shrink so a placed U is strictly reachable
  thetaC = atan2(c.y, c.x)
  delta  = clamp(wrapToPi(theta − thetaC), −Delta, +Delta)
  theta' = wrapToPi(thetaC + delta)
  // table-bounds guard: U must be a legal cue position
  while not inside(O + 2r·ê(theta'), [r, L−r] × [r, W−r]) and |delta| > 0:
      delta  -= sign(delta) · min(|delta|, 0.25°)   // slide toward thetaC
      theta'  = wrapToPi(thetaC + delta)
  return theta'
```

Always compare angles via `wrapToPi` of a difference — never raw subtraction (wraparound at ±π).

```
function placeFromDrag(Q, O, C, prevTheta, cfg) -> theta:
  // Q = drag point already unprojected to table coordinates (§8.2)
  v = Q − O
  if |v| < EPS: return prevTheta          // degenerate: finger over O
  return clampToReachable(atan2(v.y, v.x), O, C, cfg)
```

This is radial projection: the nearest point on the constraint circle to Q is `O + 2r·normalize(Q − O)`, so `atan2` of `Q − O` is the exact closest-point projection.

### 3.4 Nudge arrows

Step is defined in **arc millimetres** so it is physically meaningful: `dθ_step = STEP_MM / (2r)`. With `STEP_MM = 1.0`: `dθ = 1/57.15 rad = 1.0026°` (handy: on US balls, 1 mm of arc ≈ 1° of θ ≈ 1° of object-ball direction, see §5.1). Recommended: single tap = 1.0 mm; press-and-hold auto-repeats at ~12 Hz; optional fine mode 0.25 mm.

Arrow direction must match the **screen**, not world CCW/CW:

```
function nudge(thetaUser, arrowScreenDir, O, C, cfg, camera) -> theta:
  // arrowScreenDir = +1 for the right-arrow, −1 for the left-arrow
  tangentWorld = perp(ê(thetaUser))                    // world direction of +θ motion at U
  sx = screenDeltaX(project(camera, U + tangentWorld) − project(camera, U))
  s  = (sign(sx) == sign(arrowScreenDir)) ? +1 : −1
  return clampToReachable(thetaUser + s · arrowScreenDir_agnostic… 
```

Concretely: compute the on-screen x-displacement of a small +θ move; if its sign matches the pressed arrow, apply `+dθ_step`, else `−dθ_step`; then `clampToReachable`. When a nudge is fully absorbed by the clamp (θ unchanged), signal "at limit" to the UI.

---

## 4. Submit-time outcome simulation

On submit, the object ball departs along the line of centres from the user's ghost:

```
d̂ = normalize(O − U)        // = −ê(θ_user); |O − U| = 2r exactly, so d̂ = −ê(θ_user)
```

### 4.1 Ray–segment intersection primitive

```
function raySegment(P, d, A, B) -> {t, s, X} | null:
  v = B − A
  den = cross(d, v)
  if |den| < EPS: return null                 // parallel
  w = A − P
  t = cross(w, v) / den                       // distance along ray (d unit ⇒ t in mm)
  s = cross(w, d) / den                       // 0..1 along segment
  if t > EPS and 0 ≤ s ≤ 1: return {t, s, X: P + t·d}
  return null
```

### 4.2 Event ordering (pockets vs cushions)

The centre travels from `O` along `d̂` until the **earliest** event:

- **Pocket event** per pocket pk: `hit = raySegment(O, d̂, E2(pk), E1(pk))` on the effective segment (§1.4); valid iff `hit ≠ null` and `dot(d̂, n̂(pk)) ≥ cos(alphaMax)`. Event time `t = hit.t`. Signed mouth offset `u = (hit.s − 0.5) · 2·w_eff` (mm from M along t̂; margin inside jaws = `w_eff − |u|`).
- **Cushion event** per wall: centre hits a cushion when it reaches the inset lines `x = r`, `x = L−r`, `y = r`, `y = W−r` while moving toward that wall. E.g. right wall: if `d̂.x > EPS`, `t = (L − r − O.x)/d̂.x`, hit point `H = O + t·d̂`, valid iff `r ≤ H.y ≤ W−r` (analogous for the other three). 

Take the minimum-`t` valid event. Pocket events use the true mouth line (on the boundary) while cushion lines are inset by `r`, so near a pocket the pocket event naturally wins for balls that fit the jaws; no special-casing needed. Outcomes:

- earliest event is the **target pocket** → `potted = true`.
- earliest event is **another pocket** → `potted = false`, `outcome = "wrong_pocket"` (report which).
- earliest event is a **cushion** → `outcome = "cushion"`, report `H` (v1 does not simulate the rebound — one bounce ends the sim, §7).

### 4.3 Miss quantification against the target pocket

Regardless of outcome, intersect the **infinite** object-ball line with the **infinite** mouth line of the target pocket (line–line, drop the `t>0, s∈[0,1]` checks; parallel ⇒ report null):

```
u* = signed offset (mm) along t̂ of the crossing point from M
missMm = |u*| − w_eff        // > 0: missed by this much outside the effective jaw
                             // ≤ 0: inside the jaws (margin = −missMm)
```

If the crossing has `t < 0` (ball heading away from the pocket entirely), report `missMm = null` with `outcome_detail = "wrong_direction"` and rely on the angular error. Also report the side: `u*` and `sign(u*)` (positive = toward the `E1`/`t̂` jaw).

---

## 5. Error metrics & margin-of-error framing

### 5.1 Core identity (state it in the UI copy — it's the whole lesson)

Since `d̂ = −ê(θ)`, the object-ball **direction error equals the ghost-ball angular error**:

```
β = |wrapToPi(θ_user − θ_true)|          // radians; report in degrees
directionErrorDeg ≡ thetaErrorDeg = deg(β)
```

Derived distances:

```
arcErrorMm     = 2r · β                  // ghost-centre arc distance along the constraint circle (headline metric)
chordErrorMm   = 4r · sin(β/2)           // straight-line centre-to-centre |U − G|
contactErrMm   = r · β                   // error of the contact point on the object ball's surface
```

Cut angles for pedagogy: `φ_user = angleBetween(U − C, O − U)`, `φ_true` from §2; `overcut = (φ_user > φ_true)` ("you hit it thinner than needed"), else undercut.

### 5.2 Allowed angular window ("the pocket forgives ±X° from here")

Exact, asymmetric window — the angles subtended at `O` by the effective jaw points:

```
β_plus  = angleBetween(E1 − O, M − O)    // toward +t̂ jaw
β_minus = angleBetween(E2 − O, M − O)
allowedWindowDeg = deg(min(β_plus, β_minus))     // headline; keep both for signed feedback
```

Small-angle closed form for explanatory copy (dimensionally: mm/mm = rad):

```
β_allow ≈ (w_eff / d_OP) · cos α        d_OP = |M − O|,  α = angleBetween(M − O, n̂)
```

i.e. the window shrinks linearly with object-ball-to-pocket distance and with obliquity of approach. UI framing: "Potted — the pocket allows ±2.8° from this distance; you were 2.3° (2.3 mm) off." / "Missed by 4.1 mm at the jaws — you needed within ±1.3° and were 2.9° thin."

Consistency guarantee: `β ≤ min(β_plus, β_minus)` ⟹ the §4 capture test passes (same `w_eff`, same geometry), modulo the `t>0` and α checks.

### 5.3 Result payload (submit returns this object)

```json
{
  "potted": true,
  "outcome": "target_pocket | wrong_pocket | cushion",
  "thetaErrorDeg": 2.27, "arcErrorMm": 2.26, "contactErrorMm": 1.13, "chordErrorMm": 2.26,
  "directionErrorDeg": 2.27,
  "cutAngleTrueDeg": 34.80, "cutAngleUserDeg": 37.20, "overcut": true,
  "allowedWindowDeg": 2.80, "windowPlusDeg": 2.85, "windowMinusDeg": 2.80,
  "mouthOffsetMm": 26.82, "marginMm": 6.75, "missMm": null,
  "cushionHit": null, "wrongPocketId": null,
  "verdict": "pot"
}
```

Verdict tiers: `perfect` (arcErrorMm ≤ 1.0) → `pot_great` (potted, ≤ 3.0) → `pot` (potted) → `near_miss` (missMm ≤ 10) → `miss`; `wrong_pocket` overrides with its own copy.

Optional 0–100 score: `score = round(100 · clamp(1 − β / (2·β_allow), 0, 1))` — 100 at perfect, ~50 at the jaw, 0 at twice the window.

---

## 6. Shot generation & difficulty

### 6.1 Validity constraints (all must hold)

```
GEN = {
  O_CUSHION_CLEAR: 80,      // mm, O centre to every cushion-nose line (also keeps O out of corner throats)
  D_OP_MIN: 250, D_OP_MAX: 2200,     // |M_target − O|
  D_CO_MIN: 250,                     // |C − O|  (view separation; ≫ 2r so never touching)
  D_CG_MIN: 200,                     // |C − G|  (room to visualise the cue line)
  CUT_MAX_DEG: 80,                   // φ_true cap (physically possible < 90; playable ≤ 80)
  ALPHA_GEN_CORNER_DEG: 50, ALPHA_GEN_SIDE_DEG: 55   // approach-angle caps (< capture's 60 for margin)
}
```

Checks, in order (cheap first):
1. `O ∈ [GEN.O_CUSHION_CLEAR, L − …] × [same for W]`, `d_OP ∈ [D_OP_MIN, D_OP_MAX]`, `α ≤ α_gen_cap(pocketType)`.
2. Compute `G` (§2); require `G ∈ [r, L−r] × [r, W−r]` (legal cue position).
3. `C ∈ [r, L−r] × [r, W−r]`, `|C−O| ≥ D_CO_MIN`, `|C−G| ≥ D_CG_MIN`.
4. Reachability of the truth: `dot(G − O, C − O) > 4r²` (§3.2) — this also guarantees the C→G path is not blocked by the object ball (only two balls exist in v1, so no other obstruction test).
5. `φ_true ≤ CUT_MAX_DEG`.

### 6.2 Difficulty

In this trainer the *task* is judging the ghost position, and the tolerance is exactly the angular window `β_allow` (§5.2) — which already folds in pocket size, distance and approach obliquity. Cut angle and cue distance don't change the tolerance; they change *perceptual* difficulty (foreshortening, the ghost sits further off the cue–object line). So:

```
Bd  = deg(min(β_plus, β_minus))                       // allowed window, degrees
difficulty_raw = (2.0 / Bd) · (1 + φ_true/90°) · (1 + |C − G| / L)   // dimensionless
stars: 1 if raw < 0.8; 2 if < 1.6; 3 if < 3.0; 4 if < 5.5; 5 otherwise
```

Initial calibration (tune with playtesting): a 0.67 m corner shot at 35° cut with the cue 0.85 m away gives raw ≈ 1.32 → 2★; a 1.5 m thin (70°) shot with a long cue distance gives raw ≈ 4.1 → 4★.

### 6.3 Generator (rejection sampling)

```
function generateShot(targetStars, cfg, rng) -> {C, O, pocketId} :
  for attempt in 1..500:
    pk = rng.choice(pockets)                              // or user-locked pocket
    O  = rng.uniformRect(inset by GEN.O_CUSHION_CLEAR)
    if not checks 1–2: continue
    C  = rng.uniformRect(inset by r)
    if not checks 3–5: continue
    if stars(difficulty_raw(C, O, pk)) == targetStars: return shot
  // fallback: widen to targetStars ± 1 for another 500 attempts; then return any valid shot
```

Deterministic replays: seed `rng` and store the seed with the shot. Acceptance rates are high enough (constraints are mild) that 500 attempts effectively never exhausts for stars 2–4; the fallback covers 1★/5★ tails.

---

## 7. Explicitly out of scope for v1 (list honestly in docs/UI)

- **Throw** — cut-induced and english-induced (real contact friction bends the object ball a few degrees off the line of centres; peak ~3–5° at soft speed and near-half-ball hits). v1 uses the pure line-of-centres model.
- **Squirt/deflection and swerve** from sidespin; cueing is not modelled at all — the cue ball teleports conceptually to `U`.
- **Speed effects**: pocket plays smaller at pace, cheat-the-pocket margins, roll vs stun trajectories after contact.
- **Cushion physics**: no rebound simulation (first cushion contact ends the sim), no cushion compression, no rattle/jaw dynamics beyond the `pocketSlopMm` and `alphaMax` constants; effective pocket width's full dependence on approach angle is approximated (§1.4).
- **Obstruction by other balls** (only cue + object exist), kicks, banks, jumps, table roll-off, ball–cloth friction.

None of these change the *ghost-ball position* being trained — they change whether marginal shots drop, which the `pocketSlopMm` knob crudely absorbs.

---

## 8. View-layer geometry helpers (informative but required for input handling)

### 8.1 Cameras (table plane at z = 0; ball centres at z = r; all mm; tune freely)

- **Standing:** eye = `C3 − 700·f̂ + (0,0,850)`, look-at = `(O.x, O.y, r)`, vertical FOV 60°, where `C3 = (C.x, C.y, r)` and `f̂` = horizontal unit vector from C toward O. 
- **Down on the shot:** eye = `C3 − 900·f̂ + (0,0,220)`, look-at = `(O.x, O.y, r)`, FOV 55°.

Fix look-at to `O` (not the moving `U`) so the view doesn't rotate while dragging; up vector `(0,0,1)`. Both stances render table, cushions, pockets, cue ball, object ball, target-pocket highlight, and the translucent ghost at `U`.

### 8.2 Screen → table unprojection (needed by §3.3)

Cast the camera ray through the touch pixel and intersect the plane `z = r` (ball-centre plane — so the finger maps to *centre* positions, matching the θ parameterisation):

```
function unprojectToTable(px, camera) -> (x, y) | null:
  {orig, dir} = cameraRay(px, camera)          // world-space ray, dir unit
  if |dir.z| < 1e−9: return null
  t = (r − orig.z) / dir.z
  if t ≤ 0: return null                        // pointing at sky
  return (orig.x + t·dir.x, orig.y + t·dir.y)
```

`null` ⇒ keep `prevTheta`. If v1 renders pseudo-3D via a fixed homography instead of a true camera, replace this with the inverse homography — the rest of the spec is unchanged.

---

## 9. Test vectors (config of §1.2, `pocketSlopMm = 5`; tolerance ±0.02 mm / ±0.02° unless noted)

Setup: target pocket id 0 (corner at origin): `J1=(80.822, 0)`, `J2=(0, 80.822)`, `M=(40.411, 40.411)`, `n̂=(−0.70711, −0.70711)`, `w_eff = 33.575`. `O = (600, 400)`, `C = (1500, 400)`.

1. **True ghost:** `|O − M| = 665.17`; `G = (648.079, 430.896)`; `θ_true = 32.73°`; `d̂_true = (−0.84128, −0.54061)`.
2. **Reachability/arc:** `D = |C−O| = 900`; `dot(G−O, C−O) = 43 271 > 4r² = 3266.12` ⇒ reachable. Arc half-width `Δ = arccos(57.15/900) = 86.36°` about `θ_C = 0°`; clamp range `θ ∈ [−85.86°, +85.86°]` after `ARC_EPS`.
3. **Cut angle:** `φ_true = 34.80°` (cross-check via `cos φ = (D cos ψ − 2r)/√(D² + 4r² − 4rD cos ψ)` with `ψ = 32.73°`: `= 700.00/852.48 = 0.82113` ✓).
4. **Window:** `α = 12.27°`; exact `β_plus = 2.85°`, `β_minus = 2.80°`; small-angle formula gives `2.83°` ✓.
5. **Submit at θ_user = 35.0°:** `U = (646.815, 432.780)`; `β = 2.27°`; `arcErrorMm = 2.26`; `contactErrorMm = 1.13`; mouth crossing at `t = 660.0` mm with signed offset `u = +26.82` mm ⇒ potted, `marginMm = 6.75`; `φ_user = 37.20°` ⇒ overcut. Verdict `pot`.
6. **Nudge:** `STEP_MM = 1.0` ⇒ `dθ = 1.0026°`.
7. **Degeneracies to unit-test:** drag point exactly at O (returns prevTheta); θ requested beyond ±Δ (clamps to boundary, "at limit" flag); `D ≤ 2r + ε` rejected by generation; ray parallel to mouth line (raySegment → null); ball aimed away from target pocket (`missMm = null`, wrong_direction); wrong-pocket capture; along-rail corner approach at α = 45° captures, side-rail graze at α = 75° does not.

## 10. Pure-function inventory (unit-test surface)

`trueGhost(O, P_target, r) → G` · `cutAngle(C, U_or_G, O) → φ` · `reachableArc(O, C, r) → {thetaC, Delta}` · `clampToReachable(θ, O, C, cfg) → θ'` · `placeFromDrag(Q, O, C, prevθ, cfg) → θ` · `nudge(θ, dir, cfg, camera) → θ` · `raySegment(P, d, A, B)` · `simulateShot(O, d̂, pockets, cfg) → event` · `missMetrics(O, d̂, targetPk, cfg)` · `allowedWindow(O, targetPk, cfg) → {βplus, βminus}` · `errorMetrics(θ_user, θ_true, C, O, cfg)` · `difficulty(C, O, pk, cfg) → {raw, stars}` · `generateShot(stars, cfg, rng)` · `unprojectToTable(px, camera)` · helpers `wrapToPi`, `angleBetween`, `cross`, `perp`.

Invariants to property-test: `|U(θ) − O| ≡ 2r`; clamped θ always satisfies `dot(U−O, C−O) ≥ 4r²·(1−1e−9)` and table bounds; `directionErrorDeg == thetaErrorDeg`; `β ≤ min(β_plus, β_minus) ⇒ potted` (given `t>0` and α pass); generator output always passes all §6.1 checks; every formula consumes and returns mm/radians only.