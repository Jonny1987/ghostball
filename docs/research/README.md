# Research documents

These four documents were produced during planning as background research for `PLAN.md`:

- `geometry.md` — geometry & scoring derivations
- `rendering.md` — rendering-approach evaluation (Three.js recommendation)
- `ux.md` — interaction & UX design
- `stack.md` — tech stack & repo architecture

They are extended background reading, **not** normative specs. `PLAN.md` §4 is the single
normative geometry/scoring source and supersedes these files wherever they disagree — notably
the submit-simulation event model: `geometry.md`'s cushion test validates crossings over full
rails, which misclassifies pocket-bound rays as cushion hits; `PLAN.md` §4.8 (jaw-bounded
cushion spans + the jaw-rattle rule) is the corrected model. See `PLAN.md` Appendix B for the
full adversarial-review log.
