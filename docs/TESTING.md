# Testing strategy

The suite is the regression net for "nothing else broke". It is not a ritual.
Running all 431 tests four times for one feature proves nothing the first run
didn't — it just burns minutes and tokens. What follows scopes each run to the
blast radius of the change that triggered it.

## The unit of work is a **workstream**, not a change

A workstream is one goal on one branch: "offline reading" on `feat/offline`,
however many agents and stages it contains. Test scope is decided per
workstream, not per commit and not per agent.

Two workstreams that touch disjoint code are independent and each carry their
own gate. Two agents inside one workstream do **not** each need the whole suite.

## Three tiers

### Tier 1 — Agent-local. Every change, no exceptions.

What an agent runs before it commits its own bounded piece:

```bash
npx vitest related --run <every src file you changed>   # dependents included
npm run typecheck
npm run lint
```

`vitest related` is the important one: it resolves the **import graph** and runs
every test that transitively depends on what you touched. That is most of the
value of a full run for a fraction of the cost, and it is what makes Tier 2
safe to defer.

`typecheck` and `lint` are always full-project and always run — they are seconds,
and they are what actually catches a cross-file break that no test imports.

### Tier 2 — Workstream gate. Once, by the integrator, at the end.

The full suite runs **once per workstream**, after the last branch merges and
before the PR:

```bash
npx vitest run
npm run build
```

Not per agent. Not per merge. The integrator owns this, because the integrator
is the only one who has seen every branch together — and merge conflicts
(especially resolved ones) are precisely what Tier 1 cannot see.

### Tier 3 — Reality. For anything jsdom cannot honestly model.

Required, not optional, when the change touches:

- **a service worker** — jsdom cannot execute one. Any test claiming to cover
  service worker behaviour is lying. Use the Playwright harness at
  `~/.cache/leaf-harness` against a real `next build && next start`.
- **rendered visuals** — colour, layout, spacing, contrast. Measure in a browser.
  `color-mix()` serialises as `oklab()` and cannot be read as text; rasterise to
  canvas and read pixels.
- **the epub.js iframe** — the two-documents problem (`DESIGN.md` §3). Host CSS
  custom properties do not cross into book prose.
- **mobile lifecycle** — `visibilitychange`/`pagehide` flush behaviour (D8).
  Backgrounding a phone is not closing a desktop tab. Real device.

## When Tier 1 is not enough — escalate to the full suite immediately

An agent runs the full suite despite the above if its change:

- touches a **shared module** — `src/lib/*`, `src/store/*`, `src/reader/*`,
  `src/design/tokens.css`;
- **adds, removes or upgrades a dependency** (`package.json`);
- is a **cross-cutting rename or refactor** spanning more than its own feature;
- **modifies an existing test file** it did not author.

That last one is a stop signal, not a checklist item — see below.

## Non-negotiables, at every tier

- **A regression test must be proven to fail without the fix.** Revert the fix,
  watch it fail, restore it. A test that passes both ways is worse than no test:
  it is a false guarantee. This has caught worthless tests here twice — jsdom
  does not enforce `inert` or `pointer-events`, and React had not re-rendered
  between a synthetic `pointerdown` and `click`.
- **Never edit an existing test to make it pass.** If a change forces an existing
  assertion to move, that is the suite reporting a behaviour change. Stop and
  re-examine the change. Edit the test only once you can say, in the commit, why
  the old assertion was wrong.
- **Test counts are reported as deltas** (`411 → 431`), never as bare totals — a
  total hides a deleted test.
- **Never claim a test result you did not run.** Paste the tail of the run.

## Cost, concretely

Full suite ≈ 14s locally but ≈ 80s of environment setup across 51 files, and it
is the *agent turns* spent waiting and re-reporting that actually cost. Tier 1
on a typical change is 2–4s. For a four-agent workstream this replaces four full
runs plus an integrator run with four targeted runs plus one full run.
