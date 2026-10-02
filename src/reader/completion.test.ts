// The finished-book rule is pure, so these tests drive it with plain
// relocation objects — no engine, no DOM. Each case reads as a short story of a
// reader's session; the ones that must NOT fire matter as much as the ones
// that do (wrongly marking a book finished is the visible failure).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompletionTracker,
  MIN_FINISH_PERCENT,
  RETURN_MARGIN,
  SKIP_AHEAD_MARGIN,
  type CompletionTracker,
} from "./completion";
import type { ReaderLocation, ReaderLocationCause } from "./engine";

function loc(
  cause: ReaderLocationCause,
  percent: number,
  atEnd = false,
): ReaderLocation {
  return { cfi: `epubcfi(/6/${Math.round(percent * 100)})`, percent, cause, atEnd };
}

let onFinished: ReturnType<typeof vi.fn<() => void>>;
function make(alreadyFinished = false): CompletionTracker {
  onFinished = vi.fn<() => void>();
  return createCompletionTracker({ alreadyFinished, onFinished });
}

/** Page forward through `percents`, the last one landing at the end. */
function readTo(t: CompletionTracker, percents: number[], endAtLast = true) {
  percents.forEach((p, i) =>
    t.observe(loc("next", p, endAtLast && i === percents.length - 1)),
  );
}

beforeEach(() => {
  onFinished = vi.fn<() => void>();
});

describe("completion — firing", () => {
  it("fires once when the reader pages to the end", () => {
    const t = make();
    t.arm(0);
    readTo(t, [0.2, 0.5, 0.8, 0.95, 0.99]);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not need percent to reach 1.0 (back matter keeps it lower)", () => {
    const t = make();
    t.arm(0.9);
    t.observe(loc("next", 0.93, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("fires only once even if the end is reached again", () => {
    const t = make();
    t.arm(0);
    readTo(t, [0.5, 0.97]);
    t.observe(loc("prev", 0.96));
    t.observe(loc("next", 0.98, true));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("never fires for a book that is already finished", () => {
    const t = make(true);
    t.arm(0);
    readTo(t, [0.5, 0.99]);
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe("completion — must not fire", () => {
  it("ignores everything before arm()", () => {
    const t = make();
    readTo(t, [0.95, 0.99]); // atEnd, by turning pages — but not armed
    expect(onFinished).not.toHaveBeenCalled();
    // ...and those observations are not remembered: arming later starts clean.
    t.arm(0.5);
    t.observe(loc("next", 0.6));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not fire when atEnd is reached by a jump", () => {
    const t = make();
    t.arm(0.95);
    t.observe(loc("jump", 0.99, true));
    t.observe(loc("other", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not fire on atEnd reported at 50% (a misreported end)", () => {
    const t = make();
    t.arm(0.45);
    t.observe(loc("next", 0.5, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("fires at exactly the percent floor, not just below it", () => {
    const below = make();
    below.arm(0.8);
    below.observe(loc("next", MIN_FINISH_PERCENT - 0.001, true));
    expect(onFinished).not.toHaveBeenCalled();

    const at = make();
    at.arm(0.8);
    at.observe(loc("next", MIN_FINISH_PERCENT, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not fire without atEnd, however far along", () => {
    const t = make();
    t.arm(0);
    readTo(t, [0.5, 0.9, 0.99], false);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not treat an unattributed relocation as a page turn", () => {
    const t = make();
    t.arm(0.95);
    t.observe(loc("other", 0.99, true));
    t.observe({ cfi: "x", percent: 0.99, atEnd: true }); // no cause at all
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not fire for contents jump 30% -> last chapter, then paging to the end", () => {
    const t = make();
    t.arm(0.3);
    t.observe(loc("jump", 0.93)); // skip ahead from 30%
    t.observe(loc("next", 0.97));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("an 'other' relocation neither unblocks nor counts as reading", () => {
    const t = make();
    t.arm(0.3);
    t.observe(loc("jump", 0.93)); // skip
    t.observe(loc("other", 0.3)); // a re-flow back at 30% — not a return
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe("completion — skips and returns", () => {
  it("fires after a jump ahead from 92% (they had read nearly all of it)", () => {
    const t = make();
    t.arm(0.92);
    t.observe(loc("jump", 0.99)); // skipped from 0.92, which is >= the floor
    t.observe(loc("next", 0.995, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("fires after skipping ahead, jumping back to where they were, and reading to the end", () => {
    const t = make();
    t.arm(0.3);
    t.observe(loc("jump", 0.93)); // skip from 0.3
    t.observe(loc("jump", 0.3)); // back where they were
    readTo(t, [0.5, 0.8, 0.95, 0.99]);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("a return within the margin counts, just past it does not", () => {
    const near = make();
    near.arm(0.3);
    near.observe(loc("jump", 0.93));
    near.observe(loc("jump", 0.3 + RETURN_MARGIN));
    near.observe(loc("next", 0.99, true));
    expect(onFinished).toHaveBeenCalledTimes(1);

    const far = make();
    far.arm(0.3);
    far.observe(loc("jump", 0.93));
    far.observe(loc("jump", 0.3 + RETURN_MARGIN + 0.02));
    far.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("a jump within the skip margin is not a skip", () => {
    const t = make();
    t.arm(0.9);
    t.observe(loc("jump", 0.9 + SKIP_AHEAD_MARGIN - 0.01));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).toHaveBeenCalledTimes(1);

    const early = make();
    early.arm(0.5);
    early.observe(loc("jump", 0.5 + SKIP_AHEAD_MARGIN - 0.01)); // not a skip
    early.observe(loc("jump", 0.9));  // 0.9 > furthest + margin: skip from 0.5
    early.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("a backwards jump is never a skip", () => {
    const t = make();
    t.arm(0.95);
    t.observe(loc("jump", 0.2)); // back to the start of the book
    readTo(t, [0.5, 0.97, 0.99]);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});

describe("completion — trusted jumps", () => {
  it("a trusted sync jump 50% -> 95%, then paging to the end, fires", () => {
    const t = make();
    t.arm(0.5);
    t.markTrusted();
    t.observe(loc("jump", 0.95));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("the restore landing, trusted, with an estimate far from the armed percent, then paging to the end, fires", () => {
    // First open on a new device: nothing seen yet, armed at 0; restore lands
    // on a spine-estimate percent far above it.
    const t = make();
    t.arm(0);
    t.markTrusted();
    t.observe(loc("jump", 0.94));
    t.observe(loc("next", 0.97));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("the same landing WITHOUT trust reads as a skip and blocks the finish", () => {
    const t = make();
    t.arm(0);
    t.observe(loc("jump", 0.5));
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("trust is consumed by the jump it vouched for", () => {
    const t = make();
    t.arm(0.3);
    t.markTrusted();
    t.observe(loc("jump", 0.32)); // the vouched landing
    t.observe(loc("jump", 0.93)); // a later contents jump — a skip
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("a page turn clears trust, so a failed landing cannot vouch for a later contents jump", () => {
    const t = make();
    t.arm(0.3);
    t.markTrusted(); // ...but the landing never relocated
    t.observe(loc("next", 0.31)); // reader just turns a page
    t.observe(loc("jump", 0.93)); // then jumps from the contents
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("a trusted return clears an earlier skip", () => {
    const t = make();
    t.arm(0.3);
    t.observe(loc("jump", 0.93)); // skip from 0.3
    t.markTrusted();
    t.observe(loc("jump", 0.3)); // return chip
    readTo(t, [0.6, 0.95, 0.99]);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("markTrusted before arm() is ignored", () => {
    const t = make();
    t.markTrusted();
    t.arm(0.3);
    t.observe(loc("jump", 0.93)); // would be trusted if the early call stuck
    t.observe(loc("next", 0.99, true));
    expect(onFinished).not.toHaveBeenCalled();
  });
});
