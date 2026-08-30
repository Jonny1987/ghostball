# Ghost Ball Trainer — UX & Interaction Specification

**Version:** 1.0 (design spec for empty repo `Jonny1987/ghostball`)
**Target:** mobile-first PWA, static hosting (GitHub Pages), no backend, all state in `localStorage`.
**Physics model scope (v1):** frictionless straight-line geometry. No throw, spin, or swerve — state this simplification in the app's help text.

---

## 0. Design principles

1. **One thing on screen at a time.** The 3D view owns the screen; controls are a single bottom bar in the thumb zone.
2. **Never let the user do something illegal.** The ghost ball cannot leave the constraint circle; the app projects, clamps, and snaps rather than erroring.
3. **Coarse by drag, perfect by arrows.** Dragging gets you to ±2°; the arrows are the precision instrument. Both must feel first-class.
4. **The two stances have distinct jobs.** Standing = *place* (stable geometric view). Down = *verify* (aim-locked view, judge fullness of hit). The UI should make this division obvious.
5. **Feedback teaches, it doesn't just score.** Every result says *what* was wrong ("2.1 mm too thin"), not just *how* wrong.

### Key geometry constants (drive everything below)

| Quantity | US (default) | UK |
|---|---|---|
| Ball diameter (2r) | 57.15 mm | 50.8 mm |
| Constraint circle radius (ghost centre around OB centre) | 57.15 mm | 50.8 mm |
| Contact-point movement per 1° of ghost angle | ~1.0 mm | ~0.89 mm |
| Corner-pocket slop each side of centre line (effective) | ~30 mm | ~20 mm |
| Pot acceptance half-angle at OB→pocket distance D | atan(slop / D) → ±3.4° @ 0.5 m, ±1.7° @ 1 m, ±0.86° @ 2 m | proportionally tighter |

A 1° angular error on the constraint circle equals a 1° error in the object ball's departure line (in the frictionless model), so **degrees are the canonical internal unit**; mm is a display conversion. This makes grading bands table-agnostic.

---

## 1. Core loop — states and transitions

### State machine

```
BOOT ──assets loaded──▶ (first launch? ONBOARDING : AIMING)

ONBOARDING ──finish/skip──▶ AIMING (guided shots 1–3, see §7)

AIMING  {substate: stance = STANDING | DOWN}
  │  drag / nudge / stance-toggle / peek-hold  (all stay in AIMING)
  │
  └─tap SUBMIT──▶ LOCKED ──(150 ms, controls disabled, guess frozen)──▶ REVEAL

REVEAL  (true ghost fades in, guess recoloured, numbers count up 400 ms)
  └─auto after 700 ms──▶ ANIMATING

ANIMATING  (CB rolls to guessed ghost, OB departs, pots or misses; ~1.2 s)
  │  tap anywhere = skip to end state of animation
  └─done──▶ RESULT

RESULT  (result panel + overhead mini-map; canvas shows final positions)
  ├─tap NEXT──▶ TRANSITION (300 ms cross-fade, new shot generated) ──▶ AIMING
  ├─tap RETRY──▶ AIMING (same shot, attempt marked "retry", excluded from stats)
  └─tap mini-map──▶ expands full-screen overhead review; tap again to collapse

Overlays reachable from AIMING and RESULT (pause the loop, never lose the guess):
  SETTINGS (sheet), STATS (sheet), HELP (re-runs onboarding cards)
```

There is no session-end state: the drill is endless (see §5). Backgrounding the tab persists nothing mid-shot except stats already committed; on return, regenerate a fresh shot in AIMING.

### Per-state rules

| State | 3D view | Controls active | Notes |
|---|---|---|---|
| AIMING | Live, ghost draggable | drag, ◀ ▶, stance, peek, submit, menu | Ghost spawns pre-placed (see §2.1) |
| LOCKED | Frozen | none | Prevents double-submit; brief |
| REVEAL | True ghost (blue outline) + guess (amber) | none | Numbers chip counts up |
| ANIMATING | Physics playback | tap-to-skip | Reduced-motion: replaced by static dashed trajectory lines drawn over 300 ms |
| RESULT | Final ball positions, both ghosts, trajectory lines | NEXT, RETRY, mini-map, menu | Camera auto-pulls back slightly to frame outcome |

---

## 2. Ghost-ball manipulation

### 2.1 Spawn position (no cold start)

The ghost **spawns already on the constraint circle** at the "straight-through" angle (directly opposite the cue ball, i.e. a full-ball hit) jittered by a random ±15–30° to a random side. Rationale: the user never faces an empty "where do I tap?" scene, the constraint is demonstrated instantly, the spawn never accidentally equals the answer, and no information about the answer leaks (the jitter is relative to the CB line, not the truth).

*Alt considered:* tap-to-place from scratch — rejected; the first tap would be a throwaway action on every shot.

### 2.2 Legal arc (stronger than "touching")

The centre must lie on the circle of radius 2r around the OB centre, **and** the straight line from the CB centre to the ghost centre must not intersect the OB sphere (you cannot deliver the cue ball to a contact point behind the object ball). This clamps the circle to an arc of slightly less than 180° facing the cue ball. Dragging or nudging past a limit hard-stops with a visual "bump" (ghost squashes 5% for 100 ms) and a double haptic pulse.

### 2.3 Drag — different model per stance (recommended)

**Standing view — absolute drag with lift offset.**
- Touch anywhere within 48 px of the ghost's screen position (generous hit area) to grab it; `setPointerCapture` on the canvas.
- The control point is **80 px above the finger** (offset applied at grab time so the ball doesn't jump). The finger therefore never covers the ball.
- Each move: raycast the offset screen point onto the table plane, then project that table point **radially onto the legal arc** around the OB (nearest point on arc). Every drag position is legal by construction.
- Touching the canvas away from the ghost does nothing in v1 (no accidental relocation).

**Down view — relative aim-swipe.**
- The camera is locked to the aim line (§3), so the ghost sits centre-frame; absolute dragging makes no sense here.
- Drag anywhere on the canvas, horizontal component only. Gain: **0.08° per px** (a full screen swipe ≈ 30°, enough to traverse most of the arc; precision comes from arrows). Drag right = aim moves right, matching the standing view's direct manipulation.
- Camera re-aims with 150 ms critically-damped smoothing so the world doesn't snap.

*Alt considered:* magnifier loupe callout showing a zoomed contact region during standing drag. Rejected for v1 — the down view *is* the magnified verification view, and a loupe doubles render cost. Noted as a v2 nicety.

### 2.4 Nudge arrows — the precision instrument

- **Two arrows only: ◀ and ▶.** They move the ghost along the 1D arc; direction is resolved in **screen space**: pressing ▶ always moves the ghost (standing) or the aim (down) to the *right as the shooter sees it*. Implementation: project the two arc tangent directions at the current position into screen space; assign ▶ to the one with positive x-component; apply hysteresis (only re-resolve when the projected tangent x-component exceeds a small threshold) so the mapping never flip-flops near degenerate projections.
- **Do not label the arrows "thicker/thinner"** — which arrow thickens the contact depends on the cut side and flips mid-arc; left/right is stance-stable and matches how players talk ("aim a touch further left"). Instead, thickness vocabulary lives in the **contact chip** (always visible in AIMING): `Contact: 68% · about ¾ ball`, updating live. This teaches fractional-aiming language without leaking the answer. Chip togglable in settings, default ON.
- **Step size and auto-repeat:**
  - Single tap: **0.25°** (~0.25 mm of contact point US) — fine enough that the "Perfect" band (±0.5°) is always reachable.
  - Press-and-hold: first repeat after 350 ms, then 15 steps/s at 0.25°; after 1.2 s of continuous hold, step escalates to **1.0°** (coarse). Release resets to fine.
  - No explicit coarse/fine toggle — acceleration replaces it (fewer controls). *Alt:* a fine/coarse segmented toggle; keep in reserve if playtesting shows the acceleration is hard to discover.
- **Haptics:** `navigator.vibrate(8)` per step, `vibrate([25,30,25])` on arc-limit bump and on pot (Android/Chrome only; silently no-op on iOS Safari — degrade gracefully, never feature-detect in UI copy). Toggle in settings, default ON.
- Arrow buttons are **64×64 px minimum**, anchored bottom-left and bottom-right corners (thumb-natural for either hand; no handedness setting needed because the pair is symmetric).
- Desktop keyboard: `←/→` = 0.25°, `Shift+←/→` = 1°, `Enter` = submit, `S` = stance, `N` = next, `R` = retry.

---

## 3. Stance toggle

- **Control:** a segmented control `[ Standing | Down ]` sitting directly above the bottom control bar — full thumb reach, always visible in AIMING. Switch animates the camera over 400 ms along a swooping path (eases the mental map); reduced-motion: instant cut.
- **Placement is allowed in both stances** (recommended — forcing a "place standing, verify down" order would fight how real players iterate). The drag model differs per §2.3; arrows and submit behave identically in both.
- **Standing camera (the *placing* view):** eye height 1.6 m, positioned behind the cue ball along the CB→OB line, auto-framed (position/FOV solved) so **CB, OB, ghost arc, and the target pocket** are all in frame with margin. Crucially, this camera is **fixed per shot** — it does not follow the guess, so the world stays stable while you place.
- **Down camera (the *verifying* view):** on the line from the guessed ghost centre through the CB, 0.35 m behind the CB, 0.28 m above the bed, FOV ~45°, looking at the ghost centre. It **follows the guess**: every nudge re-aims it, so the user judges the changing overlap of ghost on object ball — exactly how real aiming feels. A faint cue stick is rendered from the bottom edge along the aim line (settings toggle, default ON).
- **Pocket visibility in the down view:** for cuts beyond ~55° the pocket naturally leaves frame (as in real life). Satisfy the "must show the pocket" requirement honestly with an **edge chevron**: a small arrow at the screen edge pointing toward the pocket, with distance label. Never fisheye the FOV to force it in.
- The stance toggle disappears during LOCKED/REVEAL/ANIMATING and returns in RESULT (letting the user review the outcome from either stance is a nice touch but v2; v1 RESULT uses a slightly pulled-back standing camera).

---

## 4. Submit & feedback

### 4.1 Metrics shown (in this order)

1. **Outcome** — the headline: `POTTED` with margin (`with 11 mm to spare at the pocket`) or `MISSED` with cause (`missed thin side by 34 mm` / `rattled the left jaw`). Computed from real shot geometry: OB departure line vs pocket acceptance window (±atan(slop/D); corner slop 30 mm, side slop 25 mm for v1; angle-of-approach refinement for side pockets is v2).
2. **Contact error with direction** — `1.8 mm too thin` (or `too full`). Direction: guessed cut angle greater than true → too thin. One-line tooltip explains the terms on first three results.
3. **Angle** — `Your cut: 34.2° · True: 32.1°`.
4. **Grade band + streak** — see below.

Units: mm by default, inches optional (settings); degrees always shown alongside.

### 4.2 Grade bands (canonical in degrees; mm shown for the active ball size)

| Band | Threshold | Meaning (tie to potting, US 9ft) |
|---|---|---|
| **Perfect** | ≤ 0.5° (≤ ~0.5 mm) | Pots dead-centre from anywhere on the table (full-table acceptance ≈ ±0.75°) |
| **Excellent** | ≤ 1.5° (≤ ~1.5 mm) | Pots any shot up to ~1.1 m object-ball travel |
| **Good** | ≤ 3° (≤ ~3 mm) | Pots short-range shots (≤ ~0.6 m) |
| **Close** | ≤ 6° (≤ ~6 mm) | Rattle territory |
| **Miss** | > 6° | Clear miss |

Show **both** band and actual pot outcome — they can disagree ("Excellent placement, but this 2 m pot needed Perfect"), which is itself the key lesson about distance sensitivity. When they disagree, add the one-liner: `Longer pots need tighter contact.`

### 4.3 Reveal visuals

- **Guess ghost:** during AIMING, white at 45% opacity with a thin dashed white outline and a soft contact shadow (shadows are the critical depth cue — never omit). On REVEAL it recolours to **amber outline** (#FFB74D).
- **True ghost:** fades in with a solid **cyan-blue outline** (#4FC3F7). Blue/amber is colour-blind-safe and both survive over green felt (see §8).
- **Overhead mini-map** (bottom-left of RESULT, ~120 px, tap to expand): top-down diagram with CB, OB, pocket, true line (blue), your resulting OB line (amber), and where the OB finished. This is the single most instructive artifact and only appears post-submit, so it spoils nothing.

### 4.4 Animation

CB glides to the guessed ghost position (0.5 s), contact click, OB departs along the resulting line, drops with a pocket rattle-and-thud or bounces off the jaw/rail (0.7 s). Tap anywhere skips. `prefers-reduced-motion` (or the in-app setting): replaced by dashed trajectory lines drawing over 300 ms. Sounds (roll, click, pocket drop) default ON, mute in settings.

### 4.5 Encouraging framing

- **Streak** = consecutive pots (not consecutive Perfects — potting is the goal a learner feels). Shown as a flame-free counter chip in the top bar (`Streak 4`); breaks quietly (no shaming animation).
- **Rolling average error** (last 20 unassisted attempts) shown in the STATS sheet with a simple trend sparkline, plus per-band histogram, pot %, best-ever error, best streak — all per difficulty.
- **Personal-best toast** (`New best: 0.3 mm`) — small, top of screen, 2 s.
- Assisted attempts (peek used, or retry) still give full feedback but are excluded from streak/averages/PBs and marked with a small `assisted` tag on the result panel.

---

## 5. Session & progression

**Recommended structure: endless drill with three difficulty levels.** No lives, no shot counters, no level-gating — this is a practice tool, and friction between reps is the enemy. App opens straight into AIMING at the last-used difficulty.

| Level | Cut angle | CB→OB | OB→pocket | Pockets |
|---|---|---|---|---|
| **1 · Straight-ish** | 0–20° | 0.4–0.9 m | 0.3–0.8 m | corners only |
| **2 · Club** (default) | 0–55° | 0.4–1.4 m | 0.3–1.4 m | all |
| **3 · Sharp** | 25–80° | 0.5–2.0 m | 0.4–2.0 m | all, biased to sides & thin cuts |

Shot generator rejects layouts where the ghost arc is unreachable, any ball overlaps a rail/pocket, or the standing camera cannot frame CB+OB+pocket. Difficulty lives in a small pill in the top bar (`Lvl 2 ▾`) opening a 3-option sheet with per-level stats preview. **Custom shot setup** (drag balls on an overhead editor) is explicitly **v2** — noted in the plan, not built first.

### Settings sheet

Units (mm/in) · Table & balls (US 9ft–57.15 mm / UK 7ft–50.8 mm; changes constants and displayed mm) · Sound · Haptics · Cue stick in down view · Contact % chip · Reduced motion (System/On/Off) · Replay onboarding.
No handedness setting (symmetric controls make it unnecessary).

### `localStorage` schema

```json
{
  "gb.settings.v1": { "units": "mm", "table": "us9", "sound": true, "haptics": true,
                      "cueStick": true, "contactChip": true, "reducedMotion": "system",
                      "difficulty": "club" },
  "gb.stats.v1": {
    "club": { "attempts": 128, "potted": 74, "assisted": 3,
              "streakCurrent": 2, "streakBest": 9, "bestErrorDeg": 0.21,
              "recentErrorsDeg": [1.2, 0.4, "... last 50"],
              "bands": { "perfect": 11, "excellent": 30, "good": 41, "close": 28, "miss": 15 } }
  },
  "gb.onboarded.v1": true
}
```

Wrap all reads/writes in try/catch; the app must run fully with storage unavailable (stats simply session-only).

---

## 6. Layout

### Portrait phone (primary)

Structure top-to-bottom: top bar (safe-area-top) → 3D canvas (all remaining height, ~70%) → stance segmented control → bottom control bar (safe-area-bottom). Contact chip and peek button float over the canvas bottom edge.

**AIMING — standing:**
```
┌───────────────────────────────┐
│ ≡   Lvl 2 ▾        Streak 4   │  top bar (44px + safe area)
│                               │
│        ___________            │
│       /   [pkt]   \           │
│      |     ○ OB    |          │  3D canvas
│      |    ◌ ghost  |          │  (touch-action: none)
│      |             |          │
│      |   ● CB      |          │
│       \___________/           │
│                               │
│  [Contact: 68% · ~¾ ball] [◉] │  chip + peek (hold)
│ ┌───────────────────────────┐ │
│ │ ▣ Standing   |   Down ▢   │ │  stance segmented (48px)
│ └───────────────────────────┘ │
│ ┌────┐  ┌─────────────┐ ┌───┐ │
│ │ ◀  │  │   SUBMIT    │ │ ▶ │ │  bottom bar (72px + safe area)
│ └────┘  └─────────────┘ └───┘ │  arrows 64px, submit fills middle
└───────────────────────────────┘
```

**AIMING — down:** (camera locked to aim; ghost centred, overlapping OB; drag = aim-swipe)
```
┌───────────────────────────────┐
│ ≡   Lvl 2 ▾        Streak 4   │
│                        [pkt→] │  edge chevron if pocket off-frame
│      ─────rail──────          │
│                               │
│           ,-○-.               │  OB with ghost ◌ overlapping
│          ( ◌OB )              │  (fullness of overlap = the read)
│           `---'               │
│      ════════════╗            │
│        cue stick ║ ● CB       │
│  [Contact: 68% · ~¾ ball] [◉] │
│ ┌───────────────────────────┐ │
│ │ ▢ Standing   |   Down ▣   │ │
│ └───────────────────────────┘ │
│ ┌────┐  ┌─────────────┐ ┌───┐ │
│ │ ◀  │  │   SUBMIT    │ │ ▶ │ │
│ └────┘  └─────────────┘ └───┘ │
└───────────────────────────────┘
```

**RESULT:**
```
┌───────────────────────────────┐
│ ≡   Lvl 2 ▾        Streak 5   │
│        ___________            │
│       / ○ dropped \           │  canvas: final positions,
│      |  ◌true ◌you |          │  blue true ghost, amber guess,
│      |             |          │  trajectory lines
│      |   ● CB      |          │
│ ┌────┐ \_________/            │
│ │mini│                        │  mini-map (tap = expand)
│ │map │                        │
│ └────┘                        │
│ ┌───────────────────────────┐ │
│ │  POTTED  ·  Excellent     │ │
│ │  1.8 mm too thin (1.8°)   │ │  result panel slides up
│ │  Your cut 34.2° · true    │ │
│ │  32.1° · 11 mm to spare   │ │
│ │ ┌────────┐  ┌───────────┐ │ │
│ │ │ RETRY  │  │  NEXT  ▶  │ │ │  NEXT is primary, right-thumb
│ │ └────────┘  └───────────┘ │ │
│ └───────────────────────────┘ │
└───────────────────────────────┘
```

### Landscape / desktop

Canvas fills the left ~75%; a right-hand column stacks stance toggle, contact chip, ◀ ▶ (side by side), SUBMIT, peek. Result panel replaces the column content. Keyboard shortcuts per §2.4. No separate desktop design — same components, one breakpoint (~700 px width).

### Gesture & viewport hygiene

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; safe-area insets via `env()` on top/bottom bars.
- Canvas: `touch-action: none`, Pointer Events with capture, `contextmenu` suppressed (long-press is auto-repeat territory), `overscroll-behavior: none` on body. Do **not** set `user-scalable=no` — `touch-action` on the canvas is sufficient and keeps sheet text zoomable.
- **PWA:** manifest (`display: standalone`, any orientation, dark theme colour), service worker precaching all assets (fully offline), install hint toast after the 3rd session ("Add to home screen for full-screen practice").

---

## 7. Onboarding (first launch, ≤30 s, skippable)

Three cards, each one illustration + one sentence:

1. **What's a ghost ball?** Overhead diagram: line drawn pocket → object ball, extended one ball-width beyond; ghost ball sits touching the OB on that line. Copy: *"To pot a ball, the cue ball must arrive exactly here — the 'ghost ball'. Your job: guess where it is."*
2. **How to place it.** Animated finger drags the ghost along the arc; arrows tap. *"Drag roughly, then tap the arrows to fine-tune. The ghost only moves where it touches the object ball."*
3. **Two views.** Split image standing/down. *"Place it standing. Get down to check your aim, like a real shot."*

Then three **guided shots** with a decaying scaffold:
- Shot 1: dashed pocket→OB line extended, plus the true ghost outline faintly visible — user just moves onto it and submits (guaranteed win, teaches the loop).
- Shot 2: dashed line only, fading out after 3 s.
- Shot 3: no help.
Guided shots don't count toward stats.

**Peek button** (`◉`, floating right of the contact chip, all shots forever): **press-and-hold** reveals the true ghost in blue while held; any use marks the attempt `assisted`. This is the "show solution" affordance — hold-to-peek (rather than a toggle) keeps it a glance, not a crutch.

Help (`≡` menu → How to play) replays the cards.

---

## 8. Accessibility & polish

- **Touch targets:** every control ≥ 44 px; arrows 64 px; ghost grab radius 48 px.
- **Reduced motion:** honour `prefers-reduced-motion` and offer an in-app override; affects camera swoops (cut instead), roll-out animation (static trajectory lines), count-ups (instant), PB toasts (no slide).
- **Colour:** felt is mid-green; the working ghost is translucent white + dashed outline + contact shadow (reads on any felt); reveal pair is blue `#4FC3F7` (true) vs amber `#FFB74D` (guess) — distinguishable under deuteranopia/protanopia and neither collides with felt green, cue-ball white, or common object-ball colours. Never use plain red/green for wrong/right; bands use text labels plus the blue/amber system.
- **Text over 3D:** all HUD text sits on pill chips with `rgba(0,0,0,0.55)` backgrounds, white text, ≥ 4.5:1 contrast; never raw text on felt.
- **Screen-reader baseline (v1, honest scope):** buttons properly labelled (`aria-label="Nudge aim left"`), result panel is live-region announced (`Potted. Excellent. 1.8 millimetres too thin.`). The 3D placement task itself is inherently visual; arrows + announced contact % (`Contact 68 percent`) give a usable non-visual fallback without overpromising.
- **Polish list:** ball shadows and pocket-drop sound are the two highest-value realism items; subtle nudge tick sound; count-up numbers; streak chip pulse on increment (motion-safe).

---

## 9. Decision summary (recommended vs alternatives)

| Decision | Recommended | Alternative (noted, not chosen) |
|---|---|---|
| Occluded-finger drag | 80 px lift offset + arc projection | Magnifier loupe (v2) |
| Down-view manipulation | Relative aim-swipe, 0.08°/px | Absolute drag (breaks with aim-locked camera) |
| Arrow semantics | Screen-space left/right with hysteresis | "Thicker/thinner" labels (flip per cut side — rejected) |
| Fine/coarse | Hold-to-accelerate (0.25° → 1° after 1.2 s) | Explicit toggle (fallback if discoverability fails) |
| Ghost spawn | Pre-placed at jittered straight-through angle | Tap-to-place (cold-start friction) |
| Placement in down view | Allowed | Standing-only placement (fights real aiming workflow) |
| Streak definition | Consecutive pots | Consecutive Perfect bands (too punishing for learners) |
| Session model | Endless drill, 3 levels, instant start | Level progression/gating; custom setup editor (both v2) |
| Solution reveal | Hold-to-peek, marks attempt assisted | Toggle button (invites over-reliance) |
| Post-shot review | Overhead mini-map on RESULT only | Live overhead view during aiming (defeats training) |

**Known v1 simplifications to document in-app:** no throw/spin/swerve (real contact throw shifts thick hits by ~1–3°), simplified pocket acceptance (slop model, no approach-angle penalty on side pockets), fixed standing camera (no walk-around).