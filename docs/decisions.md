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

**v2.3 (2026-08-31, user decision):** the standing view keeps the ghost centred
*continuously* — the v2.2 drag-freeze is gone. That freeze was only needed because the
standing drag was absolute (finger→table through the camera: yawing mid-drag fed back
into the mapping). Per the owner, the standing drag is now the SAME relative swipe as
the down view: dragging anywhere on the screen moves the ghost by screen-space deltas
(0.15 mm/px through the current camera's screen axes), so a continuously following
camera is stable by construction. Both stances now share one input path and one
ghost-follow tau (0.15 s). Retired with the absolute drag: the 48 px grab radius, the
80 px finger lift + 250 ms ramp, and the `onDragPoint`/`onDragState` callbacks. The M2
feel-constants tuning gate below shrinks accordingly (only hold-repeat timings and the
follow tau remain to be hand-tuned).

**v2.4 (2026-08-31, user decision):** the standing view must also show the CUE BALL and
the cue. The cue ball (full extents) joins the standing fit's required points, so the
composition reads like standing at the real table: your ball and cue at the bottom,
ghost mid-frame, pocket up top. Because the eye looks steeply down at the cue ball, the
vertical span grows — the required points now occupy the middle 76 % of the screen
height (`vPadFrac` 0.12 top and bottom, so the pocket clears the stance pill and the cue
ball clears the submit bar) and `maxVFovDeg` rises 70 → 74. Close shots still zoom
right in (the fit is unchanged in spirit — this only adds required content); long shots
settle around 50–60° vertical FOV. The cue stick now renders while aiming in BOTH
stances. GENERATOR_VERSION → 5 (frameability check 6 got stricter).

**v2.5 (2026-08-31, user decision):** the DOWN view now horizontally centres the ghost
too, matching the standing view. The down fit's look yaws onto the ghost (instead of
centring the ghost/object/pocket bounding box) and the horizontal FOV is measured from
the ghost's screen position — exactly what keeps the pocket in frame off to one side
with the ghost dead-centre. The widen (≤66°) → dolly (≤3 m) → chevron ladder is
unchanged; centring the ghost roughly doubles the horizontal need vs box-centring, so
sharp cuts on narrow screens hit the chevron fallback somewhat more often (which is
itself ghost-centred — a near-perpendicular pocket physically cannot share a ~33°
portrait frame with a centred ghost). Two composition fixes that came out of it: a
dollied-back eye can end up BEHIND the cue's butt on the stick's own axis (the stick
then runs down the view centre and occludes the aim line) — the stick hides once the
shooter has stood that far back; and when the final FOV leaves excess vertical room the
look pitches down so content tops out ~68% up the frame instead of hanging centred
under empty space. No generator change — down framing is not a generation check.
Headless-verify note: drive scripts must wait for `__scene.cam.targetPose === null`
(camera settled) before screenshotting — SwiftShader's low FPS plus the render loop's
50 ms dt clamp stretches transitions ~10×, which mimics a broken pose.

**v2.6 (2026-08-31, user decision):** first slice of the settings sheet — a ⚙ button in
the top bar opens a popup with two toggles: show the ghost ball when standing / when
down (both default on, persisted in `gb.settings.v1`). Turning one off makes that
stance a *blind drill*: the ghost mesh, its dashed footprint ring and its contact
shadow all disappear while aiming, but everything else is unchanged — the swipe/nudges
still move the (invisible) placement, the contact chip stays live, the camera still
centres on it, and the cue still points at it. From the reveal on, the guess always
shows (that feedback is the point). The M5 "settings sheet UI" item is now partially
closed; the remaining settings (sound, haptics, cue stick, chip, inset) still have no
UI.

**v2.7 (2026-08-31, user decision):** the standing view now keeps the CUE BALL at the
horizontal centre too, like the down view does. Same construction as the down rig, from
standing height: the eye sits on the CUE→GHOST line (1.3 m behind the cue ball, 1.62 m
up) and the look's azimuth is locked to that line — eye, cue ball and ghost share one
vertical plane, so both project to centre-x *exactly*, for any placement; moving the
ghost orbits the camera around the cue ball. The fit therefore lost its two-pass
ghost-slack structure (only the pitch and FOV are fitted now) and the v2.2
"zoom never breathes" guarantee is relaxed to the down view's behaviour: the FOV
re-fits per placement (damped, 0.15 s). Frameability check 6 is hardened to match: the
canonical aim AND eight extreme ghost placements must all fit within the FOV cap at the
reference aspect, so every legal placement keeps the pocket + cue ball in frame — now
generation-guaranteed rather than slack-approximated. GENERATOR_VERSION → 6.

**v2.8 (2026-08-31, user decision):** two more settings. (1) **Lateral mode** ("Drill"
section): the ghost only slides along the line PERPENDICULAR to the cue→object line,
through the full-ball touching point G0 — the classic fractional-aiming drill (only the
side-to-side cut judgement is exercised; the line supplies the depth). Swipes and ◀▶
project onto the line, ▲▼ hide, spawns/toggles snap onto it. Grading is made fair in
1D: the true ghost is off the axis for every cut, so "perfect" is graded against the
point where the TRUE AIM LINE crosses the axis (same aim line ⇒ same effective contact
⇒ pots dead centre; physics already forgives depth error along the aim line). Free-mode
grading unchanged. (2) **Semi-transparent ghost**: opacity 0.55, no depth write, drawn
late — an overlapped object ball stays visible; applies while aiming, opaque from the
reveal (amber-vs-truth readability). With it off, the ghost obscures the object ball
naturally — on the lateral line the ghost centre is always 2r nearer the shooter, so
the nearer sphere wins the depth test everywhere they overlap on screen.

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
- **M2 feel constants**: hold-repeat timings, 0.15 mm/px swipe sensitivity, 150 ms
  camera-follow damping — implemented at the doc-inherited values; hands-on tuning on both
  reference devices is M2 acceptance, values to be recorded here. (The 80 px lift offset
  and 48 px grab radius were retired with the absolute drag in v2.3.)
- **M3 camera A/B**: D1/D2/D3 presets are implemented and switchable (`?rig=d1|d2|d3`);
  the blind 6-shot battery on both devices decides the default. D3 is the provisional default.
- **M5 verdict calibration**: pocketSlopMm / alphaMax / aimDepth knobs are config; the
  30-borderline-shot session with an outside player tunes them.
- **§2.9 subjective gates**: outside pool players to be recruited; screenshot gates judged
  per the plan's checklist protocol.
