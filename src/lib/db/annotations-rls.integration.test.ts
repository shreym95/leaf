/**
 * Annotations (migration 0012) — RLS on `annotations`, the copy from the legacy
 * tables, the share link on `read_notes`, the note sync trigger, and the
 * `visible_notes` spoiler gate with quotes, against a live Supabase project.
 *
 * Runs ONLY when `.env.local` provides real Supabase keys (same skip rule as
 * `read-notes-rls.integration.test.ts`) and only after 0012 has been applied. It
 * creates temporary users, books, groups and reads and removes them all in
 * `afterAll`. The copy test calls `copy_legacy_annotations()` as the service role;
 * that copy is idempotent, so re-running it changes no existing row.
 *
 * Run by the integrator, never by a task agent.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const noKeys = !SERVICE_KEY || !SUPABASE_URL;

// Postgres error codes: 42501 = row-level security or privilege denial,
// 23514 = check constraint violation, 23505 = unique violation.
const DENIED = "42501";
const CHECK_FAILED = "23514";
const UNIQUE_VIOLATION = "23505";

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Position {
  chapter_index: number;
  chapter_fraction?: number;
  finished_at?: string | null;
}

interface VisibleNote {
  id: string;
  read_id: string;
  user_id: string;
  chapter_index: number;
  chapter_fraction: number;
  kind: string;
  note: string | null;
  cfi: string | null;
  content_sha256: string | null;
  created_at: string;
  quote_exact: string | null;
  quote_prefix: string | null;
  quote_suffix: string | null;
}

describe.skipIf(noKeys)("Annotations: RLS, copy, share link, note sync and quotes (0012)", () => {
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  async function makeUser(label: string): Promise<TestUser> {
    userCounter += 1;
    const email = `leaf-annot-${label}-${userCounter}-${tag}@example.com`;
    const password = `Aa4!${tag}${tag}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Name ${label} ${tag}` },
    });
    if (created.error) throw created.error;
    const id = created.data.user!.id;
    userIds.push(id);

    const client = createClient(SUPABASE_URL!, ANON_KEY!, clientOptions);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { id, client };
  }

  /** Seeds a book through the service role. */
  async function makeBook(u: TestUser): Promise<string> {
    const b = await admin
      .from("books")
      .insert({ user_id: u.id, title: `Book ${tag}`, author: "", source: "upload" })
      .select("id")
      .single();
    if (b.error) throw b.error;
    return b.data.id as string;
  }

  /** Seeds a group through the service role. `members[0]` is the owner. */
  async function makeGroup(name: string, members: TestUser[]): Promise<string> {
    const g = await admin.from("groups").insert({ name }).select("id").single();
    if (g.error) throw g.error;
    const gid = g.data.id as string;
    groupIds.push(gid);

    const base = Date.now() - 3_600_000;
    for (let i = 0; i < members.length; i++) {
      const m = await admin.from("group_members").insert({
        group_id: gid,
        user_id: members[i].id,
        role: i === 0 ? "owner" : "member",
        joined_at: new Date(base + i * 60_000).toISOString(),
      });
      if (m.error) throw m.error;
    }
    return gid;
  }

  // 12 chapters, as in read-notes-rls.integration.test.ts. Half is 6, end is 11.
  const OUTLINE = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    label: `Chapter ${i}`,
    depth: 0,
    partIndex: i === 0 ? null : i < 4 ? 1 : i < 8 ? 2 : 3,
    href: `c${i}.xhtml`,
  }));

  async function makeRead(gid: string, creator: string): Promise<string> {
    const r = await admin
      .from("group_reads")
      .insert({
        group_id: gid,
        title: `Read ${tag}`,
        author: "Author",
        source: "upload",
        outline: OUTLINE,
        schedule: null,
        created_by: creator,
      })
      .select("id")
      .single();
    if (r.error) throw r.error;
    return r.data.id as string;
  }

  /** Writes the caller's own progress row through their client (insert or update). */
  async function setProgress(u: TestUser, rid: string, pos: Position) {
    const res = await u.client.from("read_progress").upsert(
      {
        read_id: rid,
        user_id: u.id,
        chapter_fraction: 0,
        percent: 0,
        finished_at: null,
        manual: false,
        updated_at: new Date().toISOString(),
        ...pos,
      },
      { onConflict: "read_id,user_id" },
    );
    expect(res.error).toBeNull();
  }

  /** Creates a personal item through the caller's own client (RLS applies). */
  async function createItem(
    u: TestUser,
    bookId: string,
    row: Record<string, unknown>,
  ) {
    return u.client
      .from("annotations")
      .insert({ user_id: u.id, book_id: bookId, cfi: "epubcfi(/6/2)", ...row })
      .select("id")
      .single();
  }

  /** Creates a page item through the owner's client and returns its id. */
  async function makePage(u: TestUser, bookId: string, note: string | null = null): Promise<string> {
    const res = await createItem(u, bookId, { kind: "page", note });
    expect(res.error).toBeNull();
    return res.data!.id as string;
  }

  /** Creates a range item through the owner's client and returns its id. */
  async function makeRange(u: TestUser, bookId: string, quote: string): Promise<string> {
    const res = await createItem(u, bookId, {
      kind: "range",
      cfi: "epubcfi(/6/4,/1:0,/1:5)",
      quote,
    });
    expect(res.error).toBeNull();
    return res.data!.id as string;
  }

  /** Shares an item to a read through the caller's own client. Chapter 5 at 0.4 by default. */
  async function share(
    u: TestUser,
    rid: string,
    annotationId: string | null,
    row: Record<string, unknown>,
  ) {
    return u.client
      .from("read_notes")
      .insert({
        read_id: rid,
        user_id: u.id,
        chapter_index: 5,
        chapter_fraction: 0.4,
        annotation_id: annotationId,
        ...row,
      })
      .select("id");
  }

  /** The group copy of an item in one read, read through the service role. */
  async function groupCopy(annotationId: string, rid: string) {
    const { data, error } = await admin
      .from("read_notes")
      .select("id, kind, note, quote_exact, quote_prefix, quote_suffix")
      .eq("annotation_id", annotationId)
      .eq("read_id", rid);
    if (error) throw error;
    return data ?? [];
  }

  async function visible(u: TestUser, rid: string): Promise<VisibleNote[]> {
    const res = await u.client.rpc("visible_notes", { rid });
    expect(res.error).toBeNull();
    return (res.data ?? []) as VisibleNote[];
  }

  // Shared fixture: an owner and a member of one group, and an outsider who is
  // in no group. The owner owns the book the personal items sit in.
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let sharedGroup: string;
  let ownerBook: string;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, clientOptions);

    owner = await makeUser("owner");
    member = await makeUser("member");
    outsider = await makeUser("outsider");
    sharedGroup = await makeGroup(`AnnotShared ${tag}`, [owner, member]);
    ownerBook = await makeBook(owner);
  });

  afterAll(async () => {
    if (!admin) return;
    // Groups first (cascades reads and group copies), then users (cascades books
    // and personal items).
    if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  // --- Owner allow ---------------------------------------------------------

  it("the owner inserts, selects, updates and deletes their own page and range items", async () => {
    const page = await createItem(owner, ownerBook, { kind: "page" });
    expect(page.error).toBeNull();
    const range = await createItem(owner, ownerBook, { kind: "range", quote: "a quoted line" });
    expect(range.error).toBeNull();

    const own = await owner.client
      .from("annotations")
      .select("id")
      .eq("book_id", ownerBook);
    expect(own.error).toBeNull();
    expect(own.data?.length).toBeGreaterThanOrEqual(2);

    const upd = await owner.client
      .from("annotations")
      .update({ note: "Owner note" })
      .eq("id", page.data!.id)
      .select("id");
    expect(upd.error).toBeNull();
    expect(upd.data).toHaveLength(1);

    const del = await owner.client.from("annotations").delete().eq("id", range.data!.id).select("id");
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);
  });

  // --- Cross-user denial, each verb ----------------------------------------

  it("a non-owner cannot select another user's annotation", async () => {
    const id = await makePage(owner, ownerBook, "private words");
    const res = await outsider.client.from("annotations").select("id, note").eq("id", id);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
  });

  it("a non-owner cannot insert an annotation under another user's id", async () => {
    const res = await outsider.client.from("annotations").insert({
      user_id: owner.id,
      book_id: ownerBook,
      kind: "page",
      cfi: "epubcfi(/6/2)",
    });
    expect(res.error?.code).toBe(DENIED);
  });

  it("a non-owner's update and delete of another user's annotation change no row", async () => {
    const id = await makePage(owner, ownerBook, "keep me");

    const upd = await outsider.client
      .from("annotations")
      .update({ note: "hijacked" })
      .eq("id", id)
      .select("id");
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual([]);

    const del = await outsider.client.from("annotations").delete().eq("id", id).select("id");
    expect(del.error).toBeNull();
    expect(del.data).toEqual([]);

    const row = await admin.from("annotations").select("note").eq("id", id).single();
    expect(row.data?.note).toBe("keep me");
  });

  it("a member cannot insert an annotation under another user's id", async () => {
    const res = await member.client.from("annotations").insert({
      user_id: owner.id,
      book_id: ownerBook,
      kind: "page",
      cfi: "epubcfi(/6/2)",
    });
    expect(res.error?.code).toBe(DENIED);
  });

  // --- Constraints on the personal table -----------------------------------

  it("a range without a quote, and a page with one, are refused", async () => {
    const noQuote = await createItem(owner, ownerBook, { kind: "range", quote: null });
    expect(noQuote.error?.code).toBe(CHECK_FAILED);

    const pageQuote = await createItem(owner, ownerBook, { kind: "page", quote: "text" });
    expect(pageQuote.error?.code).toBe(CHECK_FAILED);
  });

  it("a personal note of 500 characters is accepted and 501 or empty is refused", async () => {
    const atLimit = await createItem(owner, ownerBook, { kind: "page", note: "a".repeat(500) });
    expect(atLimit.error).toBeNull();

    const overLimit = await createItem(owner, ownerBook, { kind: "page", note: "a".repeat(501) });
    expect(overLimit.error?.code).toBe(CHECK_FAILED);

    const empty = await createItem(owner, ownerBook, { kind: "page", note: "" });
    expect(empty.error?.code).toBe(CHECK_FAILED);
  });

  it("a range quote of 5000 characters is accepted: the personal table has no quote cap", async () => {
    const res = await createItem(owner, ownerBook, {
      kind: "range",
      quote: "q".repeat(5000),
    });
    expect(res.error).toBeNull();
  });

  // --- Copy from the legacy tables -----------------------------------------

  it("copy_legacy_annotations keeps ids, maps bookmarks to page and highlights to range", async () => {
    const bmId = randomUUID();
    const hlId = randomUUID();
    const bm = await admin.from("bookmarks").insert({
      id: bmId,
      book_id: ownerBook,
      user_id: owner.id,
      cfi: "epubcfi(/6/8!/4/2)",
      label: "Chapter 1",
      percent: 0.5,
      created_at: "2026-09-01T00:00:00Z",
    });
    expect(bm.error).toBeNull();
    const hl = await admin.from("highlights").insert({
      id: hlId,
      book_id: ownerBook,
      user_id: owner.id,
      cfi_range: "epubcfi(/6/8,/1:0,/1:9)",
      text: "a legacy quote",
      color: "copper",
      note: "legacy note",
      created_at: "2026-09-02T00:00:00Z",
    });
    expect(hl.error).toBeNull();

    const run = await admin.rpc("copy_legacy_annotations");
    expect(run.error).toBeNull();
    expect(run.data).toBeGreaterThanOrEqual(2);

    const { data, error } = await admin
      .from("annotations")
      .select("id, kind, cfi, quote, note, label, percent")
      .in("id", [bmId, hlId]);
    expect(error).toBeNull();
    const byId = new Map((data ?? []).map((r) => [r.id as string, r]));

    expect(byId.get(bmId)).toEqual({
      id: bmId,
      kind: "page",
      cfi: "epubcfi(/6/8!/4/2)",
      quote: null,
      note: null,
      label: "Chapter 1",
      percent: 0.5,
    });
    expect(byId.get(hlId)).toEqual({
      id: hlId,
      kind: "range",
      cfi: "epubcfi(/6/8,/1:0,/1:9)",
      quote: "a legacy quote",
      note: "legacy note",
      label: null,
      percent: null,
    });
  });

  it("copy_legacy_annotations is idempotent: a re-run keeps a row the user has since edited", async () => {
    const hlId = randomUUID();
    const hl = await admin.from("highlights").insert({
      id: hlId,
      book_id: ownerBook,
      user_id: owner.id,
      cfi_range: "epubcfi(/6/10,/1:0,/1:4)",
      text: "twice copied",
      color: "copper",
    });
    expect(hl.error).toBeNull();

    const first = await admin.rpc("copy_legacy_annotations");
    expect(first.error).toBeNull();

    const edit = await owner.client
      .from("annotations")
      .update({ note: "edited after the copy" })
      .eq("id", hlId)
      .select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);

    const second = await admin.rpc("copy_legacy_annotations");
    expect(second.error).toBeNull();

    const rows = await admin.from("annotations").select("id, note").eq("id", hlId);
    expect(rows.data).toEqual([{ id: hlId, note: "edited after the copy" }]);
  });

  it("copy_legacy_annotations is refused to signed-in users", async () => {
    const res = await owner.client.rpc("copy_legacy_annotations");
    expect(res.error?.code).toBe(DENIED);
  });

  // --- Share link (read_notes) ---------------------------------------------

  it("a member cannot share another user's annotation into a read", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);

    const res = await share(member, rid, id, { user_id: member.id, kind: "mark" });
    expect(res.error?.code).toBe(DENIED);
    expect(await groupCopy(id, rid)).toEqual([]);
  });

  it("a shared highlight without a quote is refused by the insert policy", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);

    const res = await share(owner, rid, id, { user_id: owner.id, kind: "highlight" });
    expect(res.error?.code).toBe(DENIED);
  });

  it("a shared mark with quote_exact is refused by the insert policy", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);

    const res = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "mark",
      quote_exact: "not allowed on a mark",
    });
    expect(res.error?.code).toBe(DENIED);
  });

  it("a shared mark with only a quote_prefix is refused by the table check", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);

    // quote_exact is null, so the policy's kind/quote agreement holds; the 0010
    // table check (quotes only on highlight) is what refuses it.
    const res = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "mark",
      quote_prefix: "not allowed on a mark",
    });
    expect(res.error?.code).toBe(CHECK_FAILED);
  });

  it("a shared quote over 300 characters is refused; 300 is accepted", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makeRange(owner, ownerBook, "q".repeat(400));

    const over = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "highlight",
      quote_exact: "q".repeat(301),
    });
    expect(over.error?.code).toBe(CHECK_FAILED);

    const atLimit = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "highlight",
      quote_exact: "q".repeat(300),
    });
    expect(atLimit.error).toBeNull();
  });

  it("an item has at most one group copy per read", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);

    const first = await share(owner, rid, id, { user_id: owner.id, kind: "mark" });
    expect(first.error).toBeNull();
    const second = await share(owner, rid, id, { user_id: owner.id, kind: "mark" });
    expect(second.error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("deleting a personal annotation removes its group copy", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);
    const shared = await share(owner, rid, id, { user_id: owner.id, kind: "mark" });
    expect(shared.error).toBeNull();
    expect(await groupCopy(id, rid)).toHaveLength(1);

    const del = await owner.client.from("annotations").delete().eq("id", id).select("id");
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);

    expect(await groupCopy(id, rid)).toEqual([]);
  });

  // --- Note sync trigger ---------------------------------------------------

  it("editing a shared page note flips the group copy between mark and note", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makePage(owner, ownerBook);
    const shared = await share(owner, rid, id, { user_id: owner.id, kind: "mark" });
    expect(shared.error).toBeNull();

    const add = await owner.client.from("annotations").update({ note: "Watch the sea" }).eq("id", id);
    expect(add.error).toBeNull();
    let copy = await groupCopy(id, rid);
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatchObject({ kind: "note", note: "Watch the sea" });

    const clear = await owner.client.from("annotations").update({ note: null }).eq("id", id);
    expect(clear.error).toBeNull();
    copy = await groupCopy(id, rid);
    expect(copy[0]).toMatchObject({ kind: "mark", note: null });
  });

  it("editing a shared range note updates the group copy and keeps kind highlight", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makeRange(owner, ownerBook, "a shared passage");
    const shared = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "highlight",
      quote_exact: "a shared passage",
      quote_prefix: "before ",
      quote_suffix: " after",
    });
    expect(shared.error).toBeNull();

    const edit = await owner.client
      .from("annotations")
      .update({ note: "the turn of the book" })
      .eq("id", id);
    expect(edit.error).toBeNull();

    const copy = await groupCopy(id, rid);
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatchObject({
      kind: "highlight",
      note: "the turn of the book",
      quote_exact: "a shared passage",
    });
  });

  // --- visible_notes: spoiler gate with quotes ------------------------------

  it("visible_notes returns the quote only at or behind the caller's position, and no annotation_id", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const id = await makeRange(owner, ownerBook, "a secret line");
    const shared = await share(owner, rid, id, {
      user_id: owner.id,
      kind: "highlight",
      chapter_index: 5,
      chapter_fraction: 0.4,
      quote_exact: "a secret line",
      quote_prefix: "before ",
      quote_suffix: " after",
    });
    expect(shared.error).toBeNull();

    // Behind the note: hidden, so no quote reaches the member.
    await setProgress(member, rid, { chapter_index: 3, chapter_fraction: 0.2 });
    expect(await visible(member, rid)).toEqual([]);

    // At the note: visible, with its quote anchors.
    await setProgress(member, rid, { chapter_index: 5, chapter_fraction: 0.4 });
    const v = await visible(member, rid);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      kind: "highlight",
      quote_exact: "a secret line",
      quote_prefix: "before ",
      quote_suffix: " after",
    });
    expect(Object.keys(v[0])).not.toContain("annotation_id");
  });
});
