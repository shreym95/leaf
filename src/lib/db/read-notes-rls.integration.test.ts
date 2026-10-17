/**
 * Read notes (migration 0010) — RLS, the visible_notes spoiler gate, leave
 * cleanup and schedule checkpoints, against a live Supabase project.
 *
 * Runs ONLY when `.env.local` provides real Supabase keys (same skip rule as
 * `groups-rls.integration.test.ts`) and only after 0010 has been applied. It
 * creates temporary users, groups and reads and removes them all in `afterAll`.
 *
 * Run by the integrator, never by a task agent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const noKeys = !SERVICE_KEY || !SUPABASE_URL;

// Postgres error codes: 42501 = row-level security or privilege denial,
// 23514 = check constraint violation.
const DENIED = "42501";
const CHECK_FAILED = "23514";

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
}

describe.skipIf(noKeys)("Read notes: RLS, spoiler gate, leave cleanup and checkpoints (0010)", () => {
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  async function makeUser(label: string): Promise<TestUser> {
    userCounter += 1;
    const email = `leaf-notes-${label}-${userCounter}-${tag}@example.com`;
    const password = `Nn4!${tag}${tag}`;
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

  // 12 chapters. Front matter (index 0) has no Part. Part 1 starts at 1, Part 2
  // at 4, Part 3 at 8. Half is floor(12 / 2) = 6. End is index 11.
  const OUTLINE = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    label: `Chapter ${i}`,
    depth: 0,
    partIndex: i === 0 ? null : i < 4 ? 1 : i < 8 ? 2 : 3,
    href: `c${i}.xhtml`,
  }));

  // Checkpoints at chapter 3 and chapter 5.
  const SCHEDULE = [
    { chapter_index: 3, due_on: "2026-11-01" },
    { chapter_index: 5, due_on: "2026-11-15" },
  ];

  async function makeRead(gid: string, creator: string, schedule: unknown = null): Promise<string> {
    const r = await admin
      .from("group_reads")
      .insert({
        group_id: gid,
        title: `Read ${tag}`,
        author: "Author",
        source: "upload",
        outline: OUTLINE,
        schedule,
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

  /** Seeds a note through the service role (bypasses RLS, for fixtures). */
  async function seedNote(
    uid: string,
    rid: string,
    at: number,
    frac: number,
    kind: "mark" | "note",
    note: string | null = null,
  ): Promise<string> {
    const r = await admin
      .from("read_notes")
      .insert({
        read_id: rid,
        user_id: uid,
        chapter_index: at,
        chapter_fraction: frac,
        kind,
        note,
      })
      .select("id")
      .single();
    if (r.error) throw r.error;
    return r.data.id as string;
  }

  async function visible(u: TestUser, rid: string): Promise<VisibleNote[]> {
    const res = await u.client.rpc("visible_notes", { rid });
    expect(res.error).toBeNull();
    return (res.data ?? []) as VisibleNote[];
  }

  async function points(rid: string, uid: string): Promise<string[]> {
    const { data, error } = await admin
      .from("read_milestones")
      .select("point")
      .eq("read_id", rid)
      .eq("user_id", uid);
    if (error) throw error;
    return (data ?? []).map((r) => r.point as string).sort();
  }

  async function checkpoints(rid: string, uid: string): Promise<string[]> {
    return (await points(rid, uid)).filter((p) => p.startsWith("checkpoint:"));
  }

  async function count(rid: string, uid?: string): Promise<number> {
    let q = admin.from("read_notes").select("id").eq("read_id", rid);
    if (uid) q = q.eq("user_id", uid);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).length;
  }

  // Shared fixture: an owner and a member of one group, and an outsider who is
  // in no group.
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let sharedGroup: string;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, clientOptions);

    owner = await makeUser("owner");
    member = await makeUser("member");
    outsider = await makeUser("outsider");
    sharedGroup = await makeGroup(`NotesShared ${tag}`, [owner, member]);
  });

  afterAll(async () => {
    if (!admin) return;
    // Groups first (cascades reads, progress, milestones and notes), then users.
    if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  // --- Non-member denial ---------------------------------------------------

  it("a non-member cannot insert a note on a read they do not belong to", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const res = await outsider.client.from("read_notes").insert({
      read_id: rid,
      user_id: outsider.id,
      chapter_index: 1,
      chapter_fraction: 0.2,
      kind: "mark",
    });
    expect(res.error?.code).toBe(DENIED);
    expect(await count(rid)).toBe(0);
  });

  it("a non-member cannot select notes directly or through visible_notes", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await seedNote(owner.id, rid, 1, 0.2, "mark");

    const direct = await outsider.client.from("read_notes").select("*").eq("read_id", rid);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    const vis = await outsider.client.rpc("visible_notes", { rid });
    expect(vis.error).toBeNull();
    expect(vis.data).toEqual([]);
  });

  // --- Member writes -------------------------------------------------------

  it("a member inserts their own mark and their own note", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const mark = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: member.id,
      chapter_index: 1,
      chapter_fraction: 0.5,
      kind: "mark",
    });
    expect(mark.error).toBeNull();

    const note = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: member.id,
      chapter_index: 2,
      chapter_fraction: 0.1,
      kind: "note",
      note: "Watch the sea",
    });
    expect(note.error).toBeNull();
    expect(await count(rid, member.id)).toBe(2);
  });

  it("a member cannot insert a note as another user", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const res = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: owner.id,
      chapter_index: 1,
      chapter_fraction: 0.2,
      kind: "mark",
    });
    expect(res.error?.code).toBe(DENIED);
    expect(await count(rid, owner.id)).toBe(0);
  });

  it("a highlight, or any row carrying a quote, is refused by the insert policy", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const base = { read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2 };

    const highlight = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "highlight" });
    expect(highlight.error?.code).toBe(DENIED);

    const quotedMark = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "mark", quote_exact: "a quoted line" });
    expect(quotedMark.error?.code).toBe(DENIED);

    const quotedNote = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "note", note: "x", quote_prefix: "before" });
    expect(quotedNote.error?.code).toBe(DENIED);

    expect(await count(rid)).toBe(0);
  });

  it("a note of 500 characters is accepted and 501 is refused", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const base = { read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2 };

    const atLimit = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "note", note: "a".repeat(500) });
    expect(atLimit.error).toBeNull();

    const overLimit = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "note", note: "a".repeat(501) });
    expect(overLimit.error?.code).toBe(CHECK_FAILED);

    expect(await count(rid, member.id)).toBe(1);
  });

  it("a mark cannot carry text, and a note needs non-empty text", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const base = { read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2 };

    const markWithText = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "mark", note: "not allowed" });
    expect(markWithText.error?.code).toBe(CHECK_FAILED);

    const noteWithoutText = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "note", note: null });
    expect(noteWithoutText.error?.code).toBe(CHECK_FAILED);

    const noteEmpty = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "note", note: "" });
    expect(noteEmpty.error?.code).toBe(CHECK_FAILED);

    expect(await count(rid)).toBe(0);
  });

  it("a malformed content_sha256 or an over-long cfi is refused", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const base = { read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2 };

    const badHash = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "mark", content_sha256: "ABC" });
    expect(badHash.error?.code).toBe(CHECK_FAILED);

    const longCfi = await member.client
      .from("read_notes")
      .insert({ ...base, kind: "mark", cfi: "x".repeat(2001) });
    expect(longCfi.error?.code).toBe(CHECK_FAILED);

    expect(await count(rid)).toBe(0);
  });

  // --- Direct select is owner-only -----------------------------------------

  it("a member's direct select returns only their own rows, never another member's note", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await seedNote(owner.id, rid, 0, 0.5, "note", "owner's private words");
    const own = await member.client
      .from("read_notes")
      .insert({ read_id: rid, user_id: member.id, chapter_index: 0, chapter_fraction: 0, kind: "mark" })
      .select("id");
    expect(own.error).toBeNull();
    const ownId = own.data![0].id as string;

    const direct = await member.client.from("read_notes").select("id, user_id").eq("read_id", rid);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([{ id: ownId, user_id: member.id }]);
  });

  // --- Spoiler gate (visible_notes) ----------------------------------------

  it("a note ahead of the caller's progress is hidden; equal position and beyond show it", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await seedNote(owner.id, rid, 5, 0.4, "note", "late thought");

    await setProgress(member, rid, { chapter_index: 3, chapter_fraction: 0.2 });
    expect(await visible(member, rid)).toEqual([]);

    await setProgress(member, rid, { chapter_index: 5, chapter_fraction: 0.39 });
    expect(await visible(member, rid)).toEqual([]);

    // Equal position counts as visible.
    await setProgress(member, rid, { chapter_index: 5, chapter_fraction: 0.4 });
    let v = await visible(member, rid);
    expect(v).toHaveLength(1);
    expect(v[0].note).toBe("late thought");
    expect(v[0].user_id).toBe(owner.id);

    // Past the note: still visible.
    await setProgress(member, rid, { chapter_index: 6, chapter_fraction: 0 });
    v = await visible(member, rid);
    expect(v).toHaveLength(1);
  });

  it("visible notes are ordered by chapter, fraction, then created_at", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await seedNote(owner.id, rid, 2, 0.5, "mark");
    await seedNote(owner.id, rid, 1, 0.9, "mark");
    await seedNote(owner.id, rid, 2, 0.1, "mark");
    await setProgress(member, rid, { chapter_index: 9, chapter_fraction: 0 });

    const v = await visible(member, rid);
    expect(v.map((n) => [n.chapter_index, n.chapter_fraction])).toEqual([
      [1, 0.9],
      [2, 0.1],
      [2, 0.5],
    ]);
  });

  it("a finished reader sees every note, ahead of their position", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await seedNote(owner.id, rid, 9, 0.5, "note", "ending theory");
    await setProgress(member, rid, { chapter_index: 1, chapter_fraction: 0 });
    expect(await visible(member, rid)).toEqual([]);

    await setProgress(member, rid, {
      chapter_index: 1,
      chapter_fraction: 0,
      finished_at: new Date().toISOString(),
    });
    const v = await visible(member, rid);
    expect(v).toHaveLength(1);
    expect(v[0].note).toBe("ending theory");
  });

  it("a caller with no progress row sees only their own notes", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const ownMark = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: member.id,
      chapter_index: 0,
      chapter_fraction: 0,
      kind: "mark",
    });
    expect(ownMark.error).toBeNull();
    await seedNote(owner.id, rid, 0, 0.5, "note", "owner words");

    const memberView = await visible(member, rid);
    expect(memberView.map((n) => n.user_id)).toEqual([member.id]);

    // The owner has no progress row either: their own note only.
    const ownerView = await visible(owner, rid);
    expect(ownerView.map((n) => n.user_id)).toEqual([owner.id]);
  });

  // --- Delete --------------------------------------------------------------

  it("a member deletes their own note; deleting another member's note is a no-op", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const mine = await member.client
      .from("read_notes")
      .insert({ read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2, kind: "mark" })
      .select("id");
    expect(mine.error).toBeNull();
    const myId = mine.data![0].id as string;
    const theirId = await seedNote(owner.id, rid, 1, 0.2, "mark");

    const own = await member.client.from("read_notes").delete().eq("id", myId).select();
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const other = await member.client.from("read_notes").delete().eq("id", theirId).select();
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);

    expect(await count(rid, member.id)).toBe(0);
    expect(await count(rid, owner.id)).toBe(1);
  });

  it("notes cannot be updated by a client", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const mine = await member.client
      .from("read_notes")
      .insert({ read_id: rid, user_id: member.id, chapter_index: 1, chapter_fraction: 0.2, kind: "note", note: "first" })
      .select("id");
    expect(mine.error).toBeNull();
    const myId = mine.data![0].id as string;

    const res = await member.client.from("read_notes").update({ note: "edited" }).eq("id", myId);
    expect(res.error).not.toBeNull();

    const row = await admin.from("read_notes").select("note").eq("id", myId).single();
    expect(row.data?.note).toBe("first");
  });

  // --- Leaving -------------------------------------------------------------

  it("leaving the group deletes that member's notes and keeps everyone else's", async () => {
    const leaver = await makeUser("leaver");
    const lg = await makeGroup(`NotesLeave ${tag}`, [owner, leaver]);
    const rid = await makeRead(lg, owner.id);

    const leaverNote = await leaver.client.from("read_notes").insert({
      read_id: rid,
      user_id: leaver.id,
      chapter_index: 1,
      chapter_fraction: 0.2,
      kind: "note",
      note: "leaving soon",
    });
    expect(leaverNote.error).toBeNull();
    await seedNote(owner.id, rid, 1, 0.2, "mark");
    expect(await count(rid, leaver.id)).toBe(1);

    const del = await leaver.client
      .from("group_members")
      .delete()
      .eq("group_id", lg)
      .eq("user_id", leaver.id)
      .select();
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);

    expect(await count(rid, leaver.id)).toBe(0);
    expect(await count(rid, owner.id)).toBe(1);
  });

  // --- Schedule checkpoints (record_read_milestones) -----------------------

  it("a checkpoint is recorded at fraction 0.98 of its chapter, not at 0.97, and when passed", async () => {
    const rid = await makeRead(sharedGroup, owner.id, SCHEDULE);

    await setProgress(member, rid, { chapter_index: 3, chapter_fraction: 0.97 });
    expect(await checkpoints(rid, member.id)).toEqual([]);

    await setProgress(member, rid, { chapter_index: 3, chapter_fraction: 0.98 });
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3"]);

    // Chapter 5 at 0.5 is short of its checkpoint.
    await setProgress(member, rid, { chapter_index: 5, chapter_fraction: 0.5 });
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3"]);

    // Passing chapter 5 records it.
    await setProgress(member, rid, { chapter_index: 6, chapter_fraction: 0 });
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3", "checkpoint:5"]);
  });

  it("finishing the book records every checkpoint", async () => {
    const rid = await makeRead(sharedGroup, owner.id, SCHEDULE);
    await setProgress(member, rid, {
      chapter_index: 0,
      chapter_fraction: 0,
      finished_at: new Date().toISOString(),
    });
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3", "checkpoint:5"]);
  });

  it("a null schedule records no checkpoints and leaves the existing rules intact", async () => {
    const rid = await makeRead(sharedGroup, owner.id, null);
    await setProgress(member, rid, { chapter_index: 11, chapter_fraction: 0.99 });
    expect(await checkpoints(rid, member.id)).toEqual([]);
    expect(await points(rid, member.id)).toEqual([
      "end",
      "half",
      "part:1",
      "part:2",
      "part:3",
    ]);
  });

  it("a schedule that is not an array, or has a non-numeric chapter_index, records nothing", async () => {
    const notArray = await makeRead(sharedGroup, owner.id, { chapter_index: 3 });
    const badEntry = await makeRead(sharedGroup, owner.id, [
      { chapter_index: "3", due_on: "2026-11-01" },
      { due_on: "2026-11-15" },
    ]);

    await setProgress(member, notArray, { chapter_index: 9, chapter_fraction: 0.99 });
    await setProgress(member, badEntry, { chapter_index: 9, chapter_fraction: 0.99 });
    expect(await checkpoints(notArray, member.id)).toEqual([]);
    expect(await checkpoints(badEntry, member.id)).toEqual([]);
  });
});
