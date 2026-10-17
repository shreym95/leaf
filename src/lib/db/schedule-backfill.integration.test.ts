/**
 * Schedule backfill and the note chapter bound (migration 0011), against a live
 * Supabase project.
 *
 * Runs ONLY when `.env.local` provides real Supabase keys (same skip rule as
 * `read-notes-rls.integration.test.ts`) and only after 0011 has been applied. It
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

// Postgres error code 42501 = row-level security denial.
const DENIED = "42501";

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Position {
  chapter_index: number;
  chapter_fraction?: number;
  finished_at?: string | null;
}

describe.skipIf(noKeys)("Schedule backfill and note chapter bound (0011)", () => {
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  async function makeUser(label: string): Promise<TestUser> {
    userCounter += 1;
    const email = `leaf-backfill-${label}-${userCounter}-${tag}@example.com`;
    const password = `Bf4!${tag}${tag}`;
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

  // 12 chapters, as in read-notes-rls.integration.test.ts. Half is 6, end is 11.
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

  /** Creates a read with no schedule through the service role. */
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

  /** Sets or clears a read's schedule through the service role, as the PATCH route does. */
  async function setSchedule(rid: string, schedule: unknown) {
    const res = await admin
      .from("group_reads")
      .update({ schedule })
      .eq("id", rid)
      .select("id");
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
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

  // Shared fixture: an owner, a member and a reader, all in one group.
  let owner: TestUser;
  let member: TestUser;
  let reader: TestUser;
  let sharedGroup: string;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, clientOptions);

    owner = await makeUser("owner");
    member = await makeUser("member");
    reader = await makeUser("reader");
    sharedGroup = await makeGroup(`BackfillShared ${tag}`, [owner, member, reader]);
  });

  afterAll(async () => {
    if (!admin) return;
    // Groups first (cascades reads, progress, milestones and notes), then users.
    if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  // --- Backfill on schedule change (record_read_milestones is not involved) --

  it("a member already past chapter 2 gets checkpoint:2 when the schedule is set, with no further progress write", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 3, chapter_fraction: 0.1 });
    expect(await checkpoints(rid, member.id)).toEqual([]);

    await setSchedule(rid, [{ chapter_index: 2, due_on: "2026-11-01" }]);
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:2"]);
  });

  it("a backfilled checkpoint needs fraction 0.98 on its own chapter: 0.97 is not recorded, 0.98 is", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 2, chapter_fraction: 0.97 });
    await setProgress(owner, rid, { chapter_index: 2, chapter_fraction: 0.98 });

    await setSchedule(rid, [{ chapter_index: 2, due_on: "2026-11-01" }]);
    expect(await checkpoints(rid, member.id)).toEqual([]);
    expect(await checkpoints(rid, owner.id)).toEqual(["checkpoint:2"]);
  });

  it("a finished member gets every checkpoint on backfill", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(reader, rid, {
      chapter_index: 0,
      chapter_fraction: 0,
      finished_at: new Date().toISOString(),
    });
    expect(await checkpoints(rid, reader.id)).toEqual([]);

    await setSchedule(rid, SCHEDULE);
    expect(await checkpoints(rid, reader.id)).toEqual(["checkpoint:3", "checkpoint:5"]);
  });

  it("a backfilled milestone's reached_at equals that member's progress updated_at", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 4, chapter_fraction: 0.5 });

    const progress = await admin
      .from("read_progress")
      .select("updated_at")
      .eq("read_id", rid)
      .eq("user_id", member.id)
      .single();
    expect(progress.error).toBeNull();

    await setSchedule(rid, SCHEDULE);

    const milestone = await admin
      .from("read_milestones")
      .select("reached_at")
      .eq("read_id", rid)
      .eq("user_id", member.id)
      .eq("point", "checkpoint:3")
      .single();
    expect(milestone.error).toBeNull();
    expect(milestone.data?.reached_at).toBe(progress.data?.updated_at);
  });

  it("setting the same schedule again adds nothing", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 4, chapter_fraction: 0 });
    await setSchedule(rid, SCHEDULE);
    const before = await points(rid, member.id);
    expect(before).toEqual(["checkpoint:3", "part:1", "part:2"]);

    await setSchedule(rid, SCHEDULE);
    expect(await points(rid, member.id)).toEqual(before);
  });

  it("clearing the schedule deletes nothing", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 6, chapter_fraction: 0 });
    await setSchedule(rid, SCHEDULE);
    const before = await points(rid, member.id);
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3", "checkpoint:5"]);

    await setSchedule(rid, null);
    expect(await points(rid, member.id)).toEqual(before);
  });

  it("replacing the schedule with one that drops a checkpoint keeps that checkpoint's row", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    await setProgress(member, rid, { chapter_index: 6, chapter_fraction: 0 });
    await setSchedule(rid, SCHEDULE);
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3", "checkpoint:5"]);

    await setSchedule(rid, [{ chapter_index: 3, due_on: "2026-11-01" }]);
    expect(await checkpoints(rid, member.id)).toEqual(["checkpoint:3", "checkpoint:5"]);
  });

  // --- Note chapter bound (read_notes_insert_own) ---------------------------

  it("a note at chapter_index equal to the outline length is refused", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const res = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: member.id,
      chapter_index: OUTLINE.length,
      chapter_fraction: 0.2,
      kind: "mark",
    });
    expect(res.error?.code).toBe(DENIED);
    expect(await count(rid)).toBe(0);
  });

  it("a note at outline length minus one is accepted", async () => {
    const rid = await makeRead(sharedGroup, owner.id);
    const res = await member.client.from("read_notes").insert({
      read_id: rid,
      user_id: member.id,
      chapter_index: OUTLINE.length - 1,
      chapter_fraction: 0.2,
      kind: "mark",
    });
    expect(res.error).toBeNull();
    expect(await count(rid, member.id)).toBe(1);
  });
});
