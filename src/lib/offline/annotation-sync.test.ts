// Annotation sync end to end, minus the browser: the real outbox (over fake-indexeddb)
// and the real annotation writer, with the real `annotations.ts` helpers, talking to a
// stateful fake of the Supabase `annotations` table. The fake answers with Postgres
// error codes (23505 duplicate key) and can lose a response after the row commits,
// which is the ambiguous case a real network produces.
//
// Each test gets a fresh module graph and a fresh IndexedDB, so a flush left hanging
// by one test cannot block the next.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/lib/types";

const h = vi.hoisted(() => {
  interface Row {
    id: string;
    note: string | null;
  }
  const server = {
    rows: new Map<string, Row>(),
    inserts: 0,
    updateCalls: 0,
    updates: [] as Array<{ id: string; note: string | null }>,
    deletes: [] as string[],
    /** The next N inserts commit the row, then throw a transport error (response lost). */
    loseResponses: 0,
    /** While set, an insert or update waits here before it reaches the server. */
    insertGate: null as Promise<void> | null,
    updateGate: null as Promise<void> | null,
    reset() {
      this.rows.clear();
      this.inserts = 0;
      this.updateCalls = 0;
      this.updates = [];
      this.deletes = [];
      this.loseResponses = 0;
      this.insertGate = null;
      this.updateGate = null;
    },
  };
  const client = {
    from(_table: string) {
      return {
        insert(row: { id: string; note: string | null }) {
          return {
            select() {
              return {
                async single() {
                  server.inserts += 1;
                  if (server.insertGate) await server.insertGate;
                  if (server.rows.has(row.id)) {
                    return {
                      data: null,
                      error: {
                        code: "23505",
                        message: "duplicate key value violates unique constraint \"annotations_pkey\"",
                      },
                    };
                  }
                  server.rows.set(row.id, { id: row.id, note: row.note });
                  if (server.loseResponses > 0) {
                    server.loseResponses -= 1;
                    throw new TypeError("Failed to fetch");
                  }
                  return { data: { ...row }, error: null };
                },
              };
            },
          };
        },
        update(patch: { note: string | null }) {
          return {
            async eq(_column: string, id: string) {
              server.updateCalls += 1;
              if (server.updateGate) await server.updateGate;
              server.updates.push({ id, note: patch.note });
              const row = server.rows.get(id);
              if (row) row.note = patch.note;
              return { error: null };
            },
          };
        },
        delete() {
          return {
            async eq(_column: string, id: string) {
              server.deletes.push(id);
              server.rows.delete(id);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { server, client };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => h.client,
}));

type Outbox = typeof import("./outbox");
type WriterModule = typeof import("@/lib/db/annotation-writer");

let outbox: Outbox;
let writerModule: WriterModule;
let online = true;
let writer: ReturnType<WriterModule["createAnnotationWriter"]>;

const ANN: Annotation = {
  id: "a1",
  user_id: "u1",
  book_id: "book-1",
  kind: "page",
  cfi: "epubcfi(/6/4!/4/2)",
  quote: null,
  note: null,
  label: "Chapter One",
  percent: 0.25,
  created_at: "2026-10-17T10:00:00.000Z",
  updated_at: "2026-10-17T10:00:00.000Z",
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Read the queue through a fresh store handle over the same IndexedDB. */
async function queued() {
  return outbox.createIndexedDbStore().list();
}

beforeEach(async () => {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  h.server.reset();
  online = true;
  outbox = await import("./outbox");
  writerModule = await import("@/lib/db/annotation-writer");
  writer = writerModule.createAnnotationWriter({ userId: "u1", isOnline: () => online });
});

describe("durability: outbox before network", () => {
  it("the create is in the outbox, marked attempted, while its request is still in flight", async () => {
    const gate = deferred();
    h.server.insertGate = gate.promise;

    await writer.create(ANN);
    await vi.waitFor(() => expect(h.server.inserts).toBe(1));

    const during = await queued();
    expect(during.map((e) => e.kind)).toEqual(["annotation-create"]);
    expect(during[0].attempted).toBe(true);
    expect(h.server.rows.size).toBe(0);

    h.server.insertGate = null;
    gate.resolve();
    await outbox.flushIdle();

    expect(h.server.rows.get("a1")).toEqual({ id: "a1", note: null });
    expect(await queued()).toHaveLength(0);
  });

  it("a write in flight at reload is still queued in a fresh outbox instance", async () => {
    // The request never returns: the tab is closed mid-request.
    h.server.insertGate = new Promise<void>(() => {});

    await writer.create(ANN);
    await vi.waitFor(() => expect(h.server.inserts).toBe(1));

    // Reload: a new module instance over the same IndexedDB.
    vi.resetModules();
    const fresh: Outbox = await import("./outbox");
    // The fresh instance's own startup flush must also reach the gate, so no
    // flush from this test is still running when the next test resets the server.
    await vi.waitFor(() => expect(h.server.inserts).toBe(2));
    const pending = await fresh.pendingAnnotationEntries("u1");

    expect(pending.map((e) => e.kind)).toEqual(["annotation-create"]);
    expect((pending[0].payload as { id: string }).id).toBe("a1");
    expect(pending[0].attempted).toBe(true);
  });
});

describe("B2: an edit during apply is not lost", () => {
  it("a note set while the create is applying is re-applied with the latest note", async () => {
    const gate = deferred();
    h.server.insertGate = gate.promise;

    await writer.create(ANN);
    await vi.waitFor(() => expect(h.server.inserts).toBe(1));
    await writer.setNote("a1", "edited while applying");

    h.server.insertGate = null;
    gate.resolve();
    await outbox.flushIdle();

    expect(h.server.rows.get("a1")?.note).toBe("edited while applying");
    expect(h.server.inserts).toBe(2); // the create, then its idempotent re-apply
    expect(await queued()).toHaveLength(0);
  });
});

describe("B3: one ordered queue, the latest note wins", () => {
  it("a create then two notes, all queued offline, end with the last note on the server", async () => {
    online = false;
    await writer.create(ANN);
    await writer.setNote("a1", "first");
    await writer.setNote("a1", "second");
    expect((await queued()).map((e) => e.kind)).toEqual(["annotation-create"]);

    online = true;
    await writer.setNote("a1", "third");
    await outbox.flushIdle();

    expect(h.server.inserts).toBe(1);
    expect(h.server.rows.get("a1")?.note).toBe("third");
    expect(await queued()).toHaveLength(0);
  });

  it("a note issued while an older note is in flight is never overwritten by that older note", async () => {
    await writer.create(ANN);
    await outbox.flushIdle();

    const gate = deferred();
    h.server.updateGate = gate.promise;
    await writer.setNote("a1", "n1");
    await vi.waitFor(() => expect(h.server.updateCalls).toBe(1));
    await writer.setNote("a1", "n2");

    h.server.updateGate = null;
    gate.resolve();
    await outbox.flushIdle();

    expect(h.server.updates.map((u) => u.note)).toEqual(["n1", "n2"]);
    expect(h.server.rows.get("a1")?.note).toBe("n2");
  });
});

describe("M1: validation is permanent and never queued", () => {
  it("an over-long note throws RangeError to the caller and nothing is queued", async () => {
    expect(() => writer.setNote("a1", "x".repeat(501))).toThrow(RangeError);
    expect(await queued()).toHaveLength(0);
  });

  it("a legacy invalid create is dropped on replay, not retried, and the item is not pending", async () => {
    await outbox.createIndexedDbStore().enqueue({
      kind: "annotation-create",
      key: "u1:a1",
      payload: {
        userId: "u1",
        id: "a1",
        bookId: "book-1",
        kind: "page",
        cfi: "epubcfi(/6/4!/4/2)",
        quote: null,
        note: "x".repeat(501),
        label: null,
        percent: null,
      },
      ts: 1,
    });

    await outbox.flushOutbox();
    await outbox.flushIdle();

    expect(await queued()).toHaveLength(0);
    expect(h.server.inserts).toBe(0);
    expect(await writer.isPending("a1")).toBe(false);
  });
});

describe("M2: an ambiguous create cannot leave a row behind", () => {
  it("create that landed with a lost response, then delete: the row is removed", async () => {
    h.server.loseResponses = 1;

    await writer.create(ANN);
    await vi.waitFor(() => expect(h.server.inserts).toBe(1));
    await outbox.flushIdle();

    expect(h.server.rows.has("a1")).toBe(true);
    expect((await queued()).map((e) => e.kind)).toEqual(["annotation-create"]);

    await writer.remove("a1");
    await outbox.flushIdle();

    expect(h.server.deletes).toEqual(["a1"]);
    expect(h.server.rows.has("a1")).toBe(false);
    expect(await queued()).toHaveLength(0);
  });

  it("a note merged into the attempted create survives the duplicate-key replay", async () => {
    h.server.loseResponses = 1;

    await writer.create(ANN);
    await vi.waitFor(() => expect(h.server.inserts).toBe(1));
    await outbox.flushIdle();

    await writer.setNote("a1", "kept");
    await outbox.flushIdle();

    expect(h.server.rows.get("a1")?.note).toBe("kept");
    expect(await queued()).toHaveLength(0);
  });
});
