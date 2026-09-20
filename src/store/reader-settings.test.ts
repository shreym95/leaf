// Persistence round-trip for `useReaderSettings` (SPEC §8) — did not exist
// before this change. Covers: hydrate seeds without writing, a setter
// schedules a debounced upsert, `flush()` writes immediately, rapid changes
// collapse into one write, and a failed write is queued for replay (§8a)
// unless it's a non-network rejection. The Supabase client + outbox module
// are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
  isSupabaseConfigured: true,
}));

vi.mock("@/lib/offline/outbox", () => ({
  classifyWriteFailure: vi.fn(() => "transport"),
  enqueueReaderSettings: vi.fn(async () => {}),
}));

vi.mock("@/lib/demo/flag", () => ({ IS_DEMO: false }));
vi.mock("@/lib/demo/local", () => ({
  DEMO_SETTINGS_KEY: "leaf:demo:reader-settings",
  readDemoJSON: vi.fn(() => null),
  writeDemoJSON: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { classifyWriteFailure, enqueueReaderSettings } from "@/lib/offline/outbox";
import { useReaderSettings, READER_SETTINGS_DEFAULTS } from "./reader-settings";

/** Wire `createClient()` to a fresh `.from("reader_settings").upsert(...)`
 *  mock resolving/rejecting with `result`. Returns the `upsert` spy. */
function mockUpsert(result: { error: unknown } | Error) {
  const upsert =
    result instanceof Error
      ? vi.fn(async () => {
          throw result;
        })
      : vi.fn(async () => result);
  const from = vi.fn(() => ({ upsert }));
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<
    typeof createClient
  >);
  return { upsert, from };
}

/** Drain the microtask queue so a fire-and-forget `writeNow()` settles. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(classifyWriteFailure).mockReturnValue("transport");
  useReaderSettings.getState().reset();
});

describe("hydrate", () => {
  it("seeds the store from the initial row and does not write anything", async () => {
    mockUpsert({ error: null });
    useReaderSettings.getState().hydrate({ fontSize: 1.3, theme: "day" }, "u1");
    await tick();

    expect(useReaderSettings.getState().fontSize).toBe(1.3);
    expect(useReaderSettings.getState().theme).toBe("day");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("falls back to defaults for fields the row didn't have", () => {
    useReaderSettings.getState().hydrate({ fontSize: 1.3 }, "u1");
    expect(useReaderSettings.getState().fontFamily).toBe(
      READER_SETTINGS_DEFAULTS.fontFamily,
    );
  });
});

describe("persistence", () => {
  it("a setter debounces the write and upserts the full row after 600ms", async () => {
    vi.useFakeTimers();
    const { upsert } = mockUpsert({ error: null });
    useReaderSettings.getState().hydrate({}, "u1");

    useReaderSettings.getState().setFontSize(1.4);
    expect(upsert).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", font_size: 1.4 }),
      { onConflict: "user_id" },
    );
    vi.useRealTimers();
  });

  it("collapses rapid changes into a single write with the latest values", async () => {
    vi.useFakeTimers();
    const { upsert } = mockUpsert({ error: null });
    useReaderSettings.getState().hydrate({}, "u1");

    useReaderSettings.getState().setFontSize(1.1);
    await vi.advanceTimersByTimeAsync(200);
    useReaderSettings.getState().setFontSize(1.2);
    await vi.advanceTimersByTimeAsync(200);
    useReaderSettings.getState().setFontSize(1.3);
    await vi.advanceTimersByTimeAsync(600);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ font_size: 1.3 }),
      { onConflict: "user_id" },
    );
    vi.useRealTimers();
  });

  it("flush() writes immediately without waiting for the debounce", async () => {
    const { upsert } = mockUpsert({ error: null });
    useReaderSettings.getState().hydrate({}, "u1");

    useReaderSettings.getState().setMargins("wide");
    expect(upsert).not.toHaveBeenCalled();

    useReaderSettings.getState().flush();
    await tick();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ margins: "wide" }),
      { onConflict: "user_id" },
    );
  });

  it("does not write while un-hydrated (still waiting on the server-loaded row)", async () => {
    const { upsert } = mockUpsert({ error: null });
    // No hydrate() call — `userId`/`hydrated` are both unset after reset().
    useReaderSettings.getState().setTheme("day");
    await tick();

    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("offline queuing (§8a)", () => {
  it("queues the row when the write fails with a transport error", async () => {
    mockUpsert(new TypeError("Failed to fetch"));
    vi.mocked(classifyWriteFailure).mockReturnValue("transport");
    useReaderSettings.getState().hydrate({}, "u1");

    useReaderSettings.getState().setLineSpacing(1.8);
    useReaderSettings.getState().flush();
    await tick();

    expect(enqueueReaderSettings).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", line_spacing: 1.8 }),
    );
  });

  it("does NOT queue when the failure is a rejection (RLS / bad data)", async () => {
    mockUpsert({ error: { code: "42501" } });
    vi.mocked(classifyWriteFailure).mockReturnValue("rejected");
    useReaderSettings.getState().hydrate({}, "u1");

    useReaderSettings.getState().setLineSpacing(1.9);
    useReaderSettings.getState().flush();
    await tick();

    expect(enqueueReaderSettings).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("returns to defaults and un-seeds, without writing", async () => {
    const { upsert } = mockUpsert({ error: null });
    useReaderSettings.getState().hydrate({ fontSize: 1.5 }, "u1");

    useReaderSettings.getState().reset();
    await tick();

    expect(useReaderSettings.getState().fontSize).toBe(READER_SETTINGS_DEFAULTS.fontSize);
    expect(upsert).not.toHaveBeenCalled();
  });
});
