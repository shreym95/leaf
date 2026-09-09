# Design iteration 1 — library shelf + reader dock

Handed over 2026-09-09. Not yet built. Scoped for implementation in
[`../../REVISED_PLAN.md`](../../REVISED_PLAN.md) §9, sequenced as Phase 2 items 4 and 5.

| File | What it is |
|---|---|
| `FRONTEND_HANDOFF.md` | The spec, v2.1.0. Tokens, DOM, exact CSS, JS interactions, constraints. |
| `index.html` | Runnable library prototype — hero "currently reading" card + shelf grid. |
| `reader.html` | Runnable reader prototype — resting dock, expanded two-tier deck, ribbon bookmark. |

Open the two HTML files directly in a browser; they are self-contained and need no build.

Two things to know before implementing:

- The handoff cites prototypes at `/home/shrey/leaf-design/…`. That is the designer's
  machine. **The copies in this folder are canonical.**
- The prototypes render prose as ordinary DOM. Leaf's prose lives inside the epub.js
  iframe, so any prose rule here (drop cap, justification, hyphenation, indents) belongs
  in `src/design/content-theme.ts`, not the page stylesheet — see
  [`../../DESIGN.md`](../../DESIGN.md) §3. `REVISED_PLAN.md` §9D lists the rest of the
  conflicts, including the one structural fork: single column vs the current two-page spread.
