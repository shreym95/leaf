/**
 * Groups core (migration 0008) — RLS, membership functions, size cap and
 * owner transfer, against a live Supabase project.
 *
 * Runs ONLY when `.env.local` provides real Supabase keys (same skip rule as
 * `rls.integration.test.ts`) and only after 0008 has been applied. It creates
 * temporary users and groups and removes them all in `afterAll`.
 *
 * Run by the integrator (GROUPS_V1_BUILD wave 5), never by a task agent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const noKeys = !SERVICE_KEY || !SUPABASE_URL;

interface TestUser {
  id: string;
  client: SupabaseClient;
}

describe.skipIf(noKeys)("Groups core: RLS, cap and owner transfer (0008)", () => {
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  async function makeUser(label: string): Promise<TestUser> {
    userCounter += 1;
    const email = `leaf-grp-${label}-${userCounter}-${tag}@example.com`;
    const password = `Gg3!${tag}${tag}`;
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

  /** Seeds a group through the service role. `members[0]` is the owner. Join
   *  times are strictly increasing in array order. */
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

  async function rolesOf(gid: string): Promise<Record<string, string>> {
    const { data, error } = await admin
      .from("group_members")
      .select("user_id, role")
      .eq("group_id", gid);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.user_id as string, r.role as string]));
  }

  async function groupExists(gid: string): Promise<boolean> {
    const { data, error } = await admin.from("groups").select("id").eq("id", gid);
    if (error) throw error;
    return (data ?? []).length === 1;
  }

  // Shared fixture: one group with an owner and a member, an outsider, and an
  // invite on the group.
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let sharedGroup: string;
  let inviteToken: string;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, clientOptions);

    owner = await makeUser("owner");
    member = await makeUser("member");
    outsider = await makeUser("outsider");
    sharedGroup = await makeGroup(`Shared ${tag}`, [owner, member]);

    inviteToken = `inv-${tag}-`.padEnd(43, "x");
    const inv = await admin.from("group_invites").insert({
      token: inviteToken,
      group_id: sharedGroup,
      created_by: owner.id,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_uses: 3,
    });
    if (inv.error) throw inv.error;
  });

  afterAll(async () => {
    if (!admin) return;
    // Groups first (cascades members and invites), then the auth users.
    if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  // --- Non-member denial ---------------------------------------------------

  it("a non-member cannot select groups", async () => {
    const { data, error } = await outsider.client.from("groups").select("*").eq("id", sharedGroup);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a non-member cannot select group_members", async () => {
    const { data, error } = await outsider.client
      .from("group_members")
      .select("*")
      .eq("group_id", sharedGroup);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a non-member cannot select group_invites", async () => {
    const { data, error } = await outsider.client
      .from("group_invites")
      .select("*")
      .eq("group_id", sharedGroup);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("is_member is false and group_member_names is empty for a non-member", async () => {
    const isMember = await outsider.client.rpc("is_member", { gid: sharedGroup });
    expect(isMember.error).toBeNull();
    expect(isMember.data).toBe(false);

    const names = await outsider.client.rpc("group_member_names", { gid: sharedGroup });
    expect(names.error).toBeNull();
    expect(names.data).toEqual([]);
  });

  // --- Member access -------------------------------------------------------

  it("a member can select their group and its members", async () => {
    const g = await member.client.from("groups").select("*").eq("id", sharedGroup);
    expect(g.error).toBeNull();
    expect(g.data).toHaveLength(1);

    const m = await member.client.from("group_members").select("*").eq("group_id", sharedGroup);
    expect(m.error).toBeNull();
    expect(m.data).toHaveLength(2);
  });

  it("is_member is true and group_member_names lists display names for a member", async () => {
    const isMember = await member.client.rpc("is_member", { gid: sharedGroup });
    expect(isMember.error).toBeNull();
    expect(isMember.data).toBe(true);

    const names = await member.client.rpc("group_member_names", { gid: sharedGroup });
    expect(names.error).toBeNull();
    const rows = names.data as {
      user_id: string;
      display_name: string | null;
      role: string;
    }[];
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(byId[owner.id].role).toBe("owner");
    expect(byId[owner.id].display_name).toBe(`Name owner ${tag}`);
    expect(byId[member.id].role).toBe("member");
  });

  it("an unauthenticated client cannot call the membership functions", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, clientOptions);
    const isMember = await anon.rpc("is_member", { gid: sharedGroup });
    expect(isMember.error).not.toBeNull();
    const names = await anon.rpc("group_member_names", { gid: sharedGroup });
    expect(names.error).not.toBeNull();
  });

  it("a member cannot see group_invites", async () => {
    const { data, error } = await member.client
      .from("group_invites")
      .select("*")
      .eq("group_id", sharedGroup);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a member cannot insert group_members rows", async () => {
    // Add someone else.
    const other = await member.client
      .from("group_members")
      .insert({ group_id: sharedGroup, user_id: outsider.id, role: "member" });
    expect(other.error).not.toBeNull();

    // Join a group they do not belong to.
    const foreign = await makeGroup(`Foreign ${tag}`, [outsider]);
    const self = await member.client
      .from("group_members")
      .insert({ group_id: foreign, user_id: member.id, role: "member" });
    expect(self.error).not.toBeNull();

    const roles = await rolesOf(foreign);
    expect(roles[member.id]).toBeUndefined();
    expect((await rolesOf(sharedGroup))[outsider.id]).toBeUndefined();
  });

  it("a member cannot update roles", async () => {
    const { data, error } = await member.client
      .from("group_members")
      .update({ role: "owner" })
      .eq("group_id", sharedGroup)
      .eq("user_id", member.id)
      .select();
    // No update policy: either an error or zero affected rows.
    if (!error) expect(data).toEqual([]);

    const roles = await rolesOf(sharedGroup);
    expect(roles[member.id]).toBe("member");
    expect(roles[owner.id]).toBe("owner");
  });

  it("a member cannot insert, update or delete groups", async () => {
    const ins = await member.client.from("groups").insert({ name: "client made" });
    expect(ins.error).not.toBeNull();

    const upd = await member.client
      .from("groups")
      .update({ name: "renamed" })
      .eq("id", sharedGroup)
      .select();
    if (!upd.error) expect(upd.data).toEqual([]);

    const del = await member.client.from("groups").delete().eq("id", sharedGroup).select();
    if (!del.error) expect(del.data).toEqual([]);

    const { data } = await admin.from("groups").select("name").eq("id", sharedGroup).single();
    expect(data?.name).toBe(`Shared ${tag}`);
  });

  it("a member cannot delete another member's row", async () => {
    const { data, error } = await member.client
      .from("group_members")
      .delete()
      .eq("group_id", sharedGroup)
      .eq("user_id", owner.id)
      .select();
    if (!error) expect(data).toEqual([]);
    expect((await rolesOf(sharedGroup))[owner.id]).toBe("owner");
  });

  it("a member can delete their own membership", async () => {
    const leaver = await makeUser("leaver");
    const gid = await makeGroup(`Leave ${tag}`, [owner, leaver]);

    const { data, error } = await leaver.client
      .from("group_members")
      .delete()
      .eq("group_id", gid)
      .eq("user_id", leaver.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const roles = await rolesOf(gid);
    expect(roles[leaver.id]).toBeUndefined();
    expect(roles[owner.id]).toBe("owner");
  });

  it("profiles of other users are still not selectable directly", async () => {
    const { data, error } = await member.client.from("profiles").select("*").eq("id", owner.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // --- Size cap ------------------------------------------------------------

  it("rejects a 6th member", async () => {
    const five = [
      await makeUser("cap1"),
      await makeUser("cap2"),
      await makeUser("cap3"),
      await makeUser("cap4"),
      await makeUser("cap5"),
    ];
    const sixth = await makeUser("cap6");
    const gid = await makeGroup(`Cap ${tag}`, five);

    const { error } = await admin
      .from("group_members")
      .insert({ group_id: gid, user_id: sixth.id, role: "member" });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/full/i);
    expect(Object.keys(await rolesOf(gid))).toHaveLength(5);
  });

  it("two simultaneous joins cannot both pass the cap", async () => {
    const four = [
      await makeUser("race1"),
      await makeUser("race2"),
      await makeUser("race3"),
      await makeUser("race4"),
    ];
    const joiners = [await makeUser("race5"), await makeUser("race6")];
    const gid = await makeGroup(`Race ${tag}`, four);

    const results = await Promise.all(
      joiners.map((u) =>
        admin.from("group_members").insert({ group_id: gid, user_id: u.id, role: "member" }),
      ),
    );
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(Object.keys(await rolesOf(gid))).toHaveLength(5);
  });

  // --- Owner transfer ------------------------------------------------------

  it("the owner leaving promotes the earliest-joined member", async () => {
    const o = await makeUser("xfer-o");
    const second = await makeUser("xfer-2");
    const third = await makeUser("xfer-3");
    const gid = await makeGroup(`Transfer ${tag}`, [o, second, third]);

    const { error } = await o.client
      .from("group_members")
      .delete()
      .eq("group_id", gid)
      .eq("user_id", o.id);
    expect(error).toBeNull();

    const roles = await rolesOf(gid);
    expect(roles[o.id]).toBeUndefined();
    expect(roles[second.id]).toBe("owner");
    expect(roles[third.id]).toBe("member");
    expect(await groupExists(gid)).toBe(true);
  });

  it("deleting the owner's auth user transfers ownership without error", async () => {
    const o = await makeUser("del-o");
    const second = await makeUser("del-2");
    const third = await makeUser("del-3");
    const gid = await makeGroup(`DeleteOwner ${tag}`, [o, second, third]);

    const del = await admin.auth.admin.deleteUser(o.id);
    expect(del.error).toBeNull();

    const roles = await rolesOf(gid);
    expect(roles[o.id]).toBeUndefined();
    expect(roles[second.id]).toBe("owner");
    expect(roles[third.id]).toBe("member");
  });

  it("deleting a plain member's auth user leaves the owner in place", async () => {
    const o = await makeUser("delm-o");
    const m = await makeUser("delm-m");
    const gid = await makeGroup(`DeleteMember ${tag}`, [o, m]);

    const del = await admin.auth.admin.deleteUser(m.id);
    expect(del.error).toBeNull();

    expect(await rolesOf(gid)).toEqual({ [o.id]: "owner" });
  });

  it("the last member leaving deletes the group and its invites", async () => {
    const solo = await makeUser("solo");
    const gid = await makeGroup(`Solo ${tag}`, [solo]);
    const token = `solo-${tag}-`.padEnd(43, "x");
    const inv = await admin.from("group_invites").insert({
      token,
      group_id: gid,
      created_by: solo.id,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_uses: 1,
    });
    expect(inv.error).toBeNull();

    const { error } = await solo.client
      .from("group_members")
      .delete()
      .eq("group_id", gid)
      .eq("user_id", solo.id);
    expect(error).toBeNull();

    expect(await groupExists(gid)).toBe(false);
    const left = await admin.from("group_invites").select("token").eq("token", token);
    expect(left.data).toEqual([]);
  });

  it("deleting the last member's auth user deletes the group", async () => {
    const solo = await makeUser("solo-del");
    const gid = await makeGroup(`SoloDelete ${tag}`, [solo]);

    const del = await admin.auth.admin.deleteUser(solo.id);
    expect(del.error).toBeNull();
    expect(await groupExists(gid)).toBe(false);
  });

  it("deleting a group cascades its members without error", async () => {
    const o = await makeUser("gdel-o");
    const m = await makeUser("gdel-m");
    const gid = await makeGroup(`GroupDelete ${tag}`, [o, m]);

    const del = await admin.from("groups").delete().eq("id", gid);
    expect(del.error).toBeNull();
    expect(await groupExists(gid)).toBe(false);
    expect(await rolesOf(gid)).toEqual({});
  });
});

/**
 * Group reads (migration 0009) — RLS on the four read tables, the milestone
 * trigger, and cleanup on leave and on group deletion. Needs 0008 and 0009
 * applied. Same skip rule and temp-data cleanup as the block above.
 */
describe.skipIf(noKeys)("Group reads: RLS, milestones and cleanup (0009)", () => {
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

  async function makeUser(label: string): Promise<TestUser> {
    userCounter += 1;
    const email = `leaf-rd-${label}-${userCounter}-${tag}@example.com`;
    const password = `Gg3!${tag}${tag}`;
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

  /** `members[0]` is the owner; join times strictly increase in array order. */
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
  // at 4, Part 3 at 8. Half is floor((12 - 1) / 2) = 5. End is index 11.
  const OUTLINE = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    label: `Chapter ${i}`,
    depth: 0,
    partIndex: i === 0 ? null : i < 4 ? 1 : i < 8 ? 2 : 3,
    href: `c${i}.xhtml`,
  }));

  async function makeRead(gid: string, creator: string, title = `Read ${tag}`): Promise<string> {
    const r = await admin
      .from("group_reads")
      .insert({
        group_id: gid,
        title,
        author: "Author",
        source: "upload",
        outline: OUTLINE,
        created_by: creator,
      })
      .select("id")
      .single();
    if (r.error) throw r.error;
    return r.data.id as string;
  }

  async function makeBook(userId: string): Promise<string> {
    const b = await admin
      .from("books")
      .insert({ user_id: userId, title: `Book ${tag}`, source: "upload" })
      .select("id")
      .single();
    if (b.error) throw b.error;
    return b.data.id as string;
  }

  interface Position {
    chapter_index: number;
    chapter_fraction?: number;
    percent?: number;
    finished_at?: string | null;
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

  async function count(table: string, rid: string, uid?: string): Promise<number> {
    let q = admin.from(table).select("read_id").eq("read_id", rid);
    if (uid) q = q.eq("user_id", uid);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).length;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let sharedGroup: string;
  let sharedRead: string;
  let ownerBook: string;
  let memberBook: string;
  let outsiderBook: string;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, clientOptions);

    owner = await makeUser("owner");
    member = await makeUser("member");
    outsider = await makeUser("outsider");
    sharedGroup = await makeGroup(`ReadShared ${tag}`, [owner, member]);
    sharedRead = await makeRead(sharedGroup, owner.id);
    ownerBook = await makeBook(owner.id);
    memberBook = await makeBook(member.id);
    outsiderBook = await makeBook(outsider.id);

    // Seed one row in each table for the read-side checks.
    const copy = await admin
      .from("read_copies")
      .insert({ read_id: sharedRead, user_id: owner.id, book_id: ownerBook });
    if (copy.error) throw copy.error;
    const prog = await admin.from("read_progress").insert({
      read_id: sharedRead,
      user_id: owner.id,
      chapter_index: 4,
      chapter_fraction: 0.2,
      percent: 0.3,
    });
    if (prog.error) throw prog.error;
  });

  afterAll(async () => {
    if (!admin) return;
    // Groups first (cascades reads, progress, milestones, copies), then users
    // (cascades their books).
    if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  // --- Non-member denial ---------------------------------------------------

  it("seed: the trigger recorded milestones for the seeded progress", async () => {
    expect(await points(sharedRead, owner.id)).toEqual(["part:1", "part:2"]);
  });

  it("a non-member cannot read any of the four tables", async () => {
    for (const table of ["group_reads", "read_copies", "read_progress", "read_milestones"]) {
      const col = table === "group_reads" ? "id" : "read_id";
      const { data, error } = await outsider.client.from(table).select("*").eq(col, sharedRead);
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it("is_read_member is false for a non-member and true for a member", async () => {
    const no = await outsider.client.rpc("is_read_member", { rid: sharedRead });
    expect(no.error).toBeNull();
    expect(no.data).toBe(false);

    const yes = await member.client.rpc("is_read_member", { rid: sharedRead });
    expect(yes.error).toBeNull();
    expect(yes.data).toBe(true);
  });

  it("an unauthenticated client cannot call is_read_member", async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, clientOptions);
    const res = await anon.rpc("is_read_member", { rid: sharedRead });
    expect(res.error).not.toBeNull();
  });

  it("a non-member cannot write progress, even for themselves", async () => {
    const res = await outsider.client
      .from("read_progress")
      .insert({ read_id: sharedRead, user_id: outsider.id, chapter_index: 1 });
    expect(res.error).not.toBeNull();
    expect(await count("read_progress", sharedRead, outsider.id)).toBe(0);
  });

  it("a non-member cannot link a copy of their own book", async () => {
    const res = await outsider.client
      .from("read_copies")
      .insert({ read_id: sharedRead, user_id: outsider.id, book_id: outsiderBook });
    expect(res.error).not.toBeNull();
    expect(await count("read_copies", sharedRead, outsider.id)).toBe(0);
  });

  // --- Member access -------------------------------------------------------

  it("a member reads the group read, others' progress and milestones", async () => {
    const r = await member.client.from("group_reads").select("*").eq("id", sharedRead);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(1);
    expect(r.data![0].outline).toHaveLength(12);
    expect(r.data![0].schedule).toBeNull();

    const p = await member.client.from("read_progress").select("*").eq("read_id", sharedRead);
    expect(p.error).toBeNull();
    expect(p.data!.map((x) => x.user_id)).toContain(owner.id);

    const m = await member.client.from("read_milestones").select("*").eq("read_id", sharedRead);
    expect(m.error).toBeNull();
    expect(m.data!.map((x) => x.user_id)).toContain(owner.id);
  });

  it("a member cannot see another member's copy link", async () => {
    const { data, error } = await member.client
      .from("read_copies")
      .select("*")
      .eq("read_id", sharedRead);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a member cannot create, change or delete group reads", async () => {
    const ins = await member.client.from("group_reads").insert({
      group_id: sharedGroup,
      title: "client made",
      source: "upload",
      outline: OUTLINE,
    });
    expect(ins.error).not.toBeNull();

    const upd = await member.client
      .from("group_reads")
      .update({ title: "renamed" })
      .eq("id", sharedRead)
      .select();
    if (!upd.error) expect(upd.data).toEqual([]);

    const del = await member.client.from("group_reads").delete().eq("id", sharedRead).select();
    if (!del.error) expect(del.data).toEqual([]);

    const { data } = await admin.from("group_reads").select("title").eq("id", sharedRead).single();
    expect(data?.title).toBe(`Read ${tag}`);
  });

  // --- Progress writes -----------------------------------------------------

  it("a member can write their own progress", async () => {
    await setProgress(member, sharedRead, { chapter_index: 2, chapter_fraction: 0.5 });
    const { data } = await admin
      .from("read_progress")
      .select("chapter_index")
      .eq("read_id", sharedRead)
      .eq("user_id", member.id)
      .single();
    expect(data?.chapter_index).toBe(2);
  });

  it("a member cannot write another member's progress", async () => {
    // Insert a row for someone else.
    const third = await makeUser("third");
    const ins = await member.client
      .from("read_progress")
      .insert({ read_id: sharedRead, user_id: third.id, chapter_index: 3 });
    expect(ins.error).not.toBeNull();

    // Update the owner's row.
    const upd = await member.client
      .from("read_progress")
      .update({ chapter_index: 11, chapter_fraction: 1 })
      .eq("read_id", sharedRead)
      .eq("user_id", owner.id)
      .select();
    if (!upd.error) expect(upd.data).toEqual([]);

    const { data } = await admin
      .from("read_progress")
      .select("chapter_index")
      .eq("read_id", sharedRead)
      .eq("user_id", owner.id)
      .single();
    expect(data?.chapter_index).toBe(4);
    expect(await count("read_progress", sharedRead, third.id)).toBe(0);
  });

  it("a member cannot delete progress rows", async () => {
    const del = await member.client
      .from("read_progress")
      .delete()
      .eq("read_id", sharedRead)
      .eq("user_id", member.id)
      .select();
    if (!del.error) expect(del.data).toEqual([]);
    expect(await count("read_progress", sharedRead, member.id)).toBe(1);
  });

  it("progress values outside range are rejected", async () => {
    const bad = await member.client
      .from("read_progress")
      .update({ chapter_fraction: 1.5 })
      .eq("read_id", sharedRead)
      .eq("user_id", member.id);
    expect(bad.error).not.toBeNull();

    const neg = await member.client
      .from("read_progress")
      .update({ chapter_index: -1 })
      .eq("read_id", sharedRead)
      .eq("user_id", member.id);
    expect(neg.error).not.toBeNull();
  });

  // --- Copies --------------------------------------------------------------

  it("a member can link their own book, and only their own", async () => {
    const own = await member.client
      .from("read_copies")
      .insert({ read_id: sharedRead, user_id: member.id, book_id: memberBook });
    expect(own.error).toBeNull();

    const seen = await member.client.from("read_copies").select("*").eq("read_id", sharedRead);
    expect(seen.data).toHaveLength(1);
    expect(seen.data![0].book_id).toBe(memberBook);
  });

  it("a member cannot insert a copy for a book they do not own", async () => {
    const other = await makeUser("copy-other");
    const g = await makeGroup(`ReadCopy ${tag}`, [owner, other]);
    const rid = await makeRead(g, owner.id);

    // Owner's book, linked by the other member.
    const res = await other.client
      .from("read_copies")
      .insert({ read_id: rid, user_id: other.id, book_id: ownerBook });
    expect(res.error).not.toBeNull();

    // Same, written as the book's owner but under someone else's user_id.
    const spoof = await other.client
      .from("read_copies")
      .insert({ read_id: rid, user_id: owner.id, book_id: ownerBook });
    expect(spoof.error).not.toBeNull();

    expect(await count("read_copies", rid)).toBe(0);
  });

  it("a member cannot repoint their copy to a book they do not own", async () => {
    const res = await member.client
      .from("read_copies")
      .update({ book_id: ownerBook })
      .eq("read_id", sharedRead)
      .eq("user_id", member.id)
      .select();
    if (!res.error) expect(res.data).toEqual([]);

    const { data } = await admin
      .from("read_copies")
      .select("book_id")
      .eq("read_id", sharedRead)
      .eq("user_id", member.id)
      .single();
    expect(data?.book_id).toBe(memberBook);
  });

  // --- Milestones: no client writes ---------------------------------------

  it("nobody can insert, update or delete read_milestones from a client", async () => {
    const before = await points(sharedRead, member.id);

    for (const u of [member, owner, outsider]) {
      const ins = await u.client
        .from("read_milestones")
        .insert({ read_id: sharedRead, user_id: u.id, point: "end" });
      expect(ins.error).not.toBeNull();

      const upd = await u.client
        .from("read_milestones")
        .update({ reached_at: new Date(0).toISOString() })
        .eq("read_id", sharedRead)
        .select();
      if (!upd.error) expect(upd.data).toEqual([]);

      const del = await u.client
        .from("read_milestones")
        .delete()
        .eq("read_id", sharedRead)
        .select();
      if (!del.error) expect(del.data).toEqual([]);
    }

    expect(await points(sharedRead, member.id)).toEqual(before);
    expect(await points(sharedRead, owner.id)).toEqual(["part:1", "part:2"]);
    expect(await points(sharedRead, outsider.id)).toEqual([]);
  });

  // --- Milestones: trigger -------------------------------------------------

  describe("milestone trigger", () => {
    let g: string;
    let rid: string;
    let a: TestUser;
    let b: TestUser;

    beforeAll(async () => {
      a = await makeUser("ms-a");
      b = await makeUser("ms-b");
      g = await makeGroup(`ReadMilestones ${tag}`, [a, b]);
      rid = await makeRead(g, a.id);
    });

    it("front matter (before any Part) reaches nothing", async () => {
      await setProgress(a, rid, { chapter_index: 0, chapter_fraction: 0.4 });
      expect(await points(rid, a.id)).toEqual([]);
    });

    it("reaching a Part start records that Part", async () => {
      await setProgress(a, rid, { chapter_index: 1, chapter_fraction: 0 });
      expect(await points(rid, a.id)).toEqual(["part:1"]);

      await setProgress(a, rid, { chapter_index: 4, chapter_fraction: 0 });
      expect(await points(rid, a.id)).toEqual(["part:1", "part:2"]);
    });

    it("reaching the halfway chapter records half", async () => {
      await setProgress(a, rid, { chapter_index: 5, chapter_fraction: 0 });
      expect(await points(rid, a.id)).toEqual(["half", "part:1", "part:2"]);
    });

    it("the last chapter below 0.98 does not record end; at 0.98 it does", async () => {
      await setProgress(a, rid, { chapter_index: 11, chapter_fraction: 0.97 });
      expect(await points(rid, a.id)).toEqual(["half", "part:1", "part:2", "part:3"]);

      await setProgress(a, rid, { chapter_index: 11, chapter_fraction: 0.98 });
      expect(await points(rid, a.id)).toEqual(["end", "half", "part:1", "part:2", "part:3"]);
    });

    it("finished_at records end from any position", async () => {
      await setProgress(b, rid, {
        chapter_index: 2,
        chapter_fraction: 0.1,
        finished_at: new Date().toISOString(),
      });
      expect(await points(rid, b.id)).toEqual(["end", "part:1"]);
    });

    it("repeat writes do not duplicate milestones or move reached_at", async () => {
      const read = async () => {
        const { data, error } = await admin
          .from("read_milestones")
          .select("point, reached_at")
          .eq("read_id", rid)
          .eq("user_id", a.id)
          .order("point");
        if (error) throw error;
        return data;
      };
      const before = await read();
      await sleep(30);
      await setProgress(a, rid, { chapter_index: 11, chapter_fraction: 0.99 });
      await setProgress(a, rid, { chapter_index: 11, chapter_fraction: 0.99 });
      expect(await read()).toEqual(before);
      expect(before).toHaveLength(5);
    });

    it("going backwards removes no milestone", async () => {
      await setProgress(a, rid, { chapter_index: 0, chapter_fraction: 0, finished_at: null });
      expect(await points(rid, a.id)).toEqual(["end", "half", "part:1", "part:2", "part:3"]);
    });

    it("jumping ahead records every point passed", async () => {
      const jumper = await makeUser("ms-jump");
      const g2 = await makeGroup(`ReadJump ${tag}`, [jumper]);
      const r2 = await makeRead(g2, jumper.id);
      await setProgress(jumper, r2, { chapter_index: 8, chapter_fraction: 0 });
      expect(await points(r2, jumper.id)).toEqual(["half", "part:1", "part:2", "part:3"]);
    });

    it("arrival order across members is preserved", async () => {
      const first = await makeUser("ms-first");
      const second = await makeUser("ms-second");
      const g3 = await makeGroup(`ReadOrder ${tag}`, [first, second]);
      const r3 = await makeRead(g3, first.id);

      await setProgress(first, r3, { chapter_index: 4, chapter_fraction: 0 });
      await sleep(50);
      await setProgress(second, r3, { chapter_index: 6, chapter_fraction: 0 });
      await sleep(50);
      // The first reader writes again and then goes back; order must not change.
      await setProgress(first, r3, { chapter_index: 7, chapter_fraction: 0.5 });
      await setProgress(first, r3, { chapter_index: 1, chapter_fraction: 0 });

      const { data, error } = await admin
        .from("read_milestones")
        .select("user_id, reached_at")
        .eq("read_id", r3)
        .eq("point", "part:2")
        .order("reached_at");
      expect(error).toBeNull();
      expect(data!.map((x) => x.user_id)).toEqual([first.id, second.id]);
      expect(new Date(data![0].reached_at).getTime()).toBeLessThan(
        new Date(data![1].reached_at).getTime(),
      );
    });
  });

  // --- Leaving and deletion -----------------------------------------------

  it("leaving deletes that member's progress, milestones and copies for the group only", async () => {
    const o = await makeUser("leave-o");
    const leaver = await makeUser("leave-l");
    const g1 = await makeGroup(`ReadLeave ${tag}`, [o, leaver]);
    const g2 = await makeGroup(`ReadStay ${tag}`, [o, leaver]);
    const r1 = await makeRead(g1, o.id);
    const r1b = await makeRead(g1, o.id, `Second ${tag}`);
    const r2 = await makeRead(g2, o.id);

    for (const rid of [r1, r1b, r2]) {
      await setProgress(leaver, rid, { chapter_index: 6, chapter_fraction: 0.5 });
      await setProgress(o, rid, { chapter_index: 6, chapter_fraction: 0.5 });
      const book = await makeBook(leaver.id);
      const c = await leaver.client
        .from("read_copies")
        .insert({ read_id: rid, user_id: leaver.id, book_id: book });
      expect(c.error).toBeNull();
    }
    expect((await points(r1, leaver.id)).length).toBeGreaterThan(0);

    const { error } = await leaver.client
      .from("group_members")
      .delete()
      .eq("group_id", g1)
      .eq("user_id", leaver.id);
    expect(error).toBeNull();

    for (const rid of [r1, r1b]) {
      expect(await count("read_progress", rid, leaver.id)).toBe(0);
      expect(await count("read_milestones", rid, leaver.id)).toBe(0);
      expect(await count("read_copies", rid, leaver.id)).toBe(0);
      // The remaining member keeps theirs.
      expect(await count("read_progress", rid, o.id)).toBe(1);
      expect((await points(rid, o.id)).length).toBeGreaterThan(0);
    }

    // The other group is untouched.
    expect(await count("read_progress", r2, leaver.id)).toBe(1);
    expect((await points(r2, leaver.id)).length).toBeGreaterThan(0);
    expect(await count("read_copies", r2, leaver.id)).toBe(1);
  });

  it("removal by the service role cleans up the same way as leaving", async () => {
    const o = await makeUser("rm-o");
    const gone = await makeUser("rm-g");
    const g = await makeGroup(`ReadRemove ${tag}`, [o, gone]);
    const rid = await makeRead(g, o.id);
    await setProgress(gone, rid, { chapter_index: 5, chapter_fraction: 0 });
    expect((await points(rid, gone.id)).length).toBeGreaterThan(0);

    const del = await admin
      .from("group_members")
      .delete()
      .eq("group_id", g)
      .eq("user_id", gone.id);
    expect(del.error).toBeNull();

    expect(await count("read_progress", rid, gone.id)).toBe(0);
    expect(await count("read_milestones", rid, gone.id)).toBe(0);
  });

  it("the owner leaving still transfers ownership and cleans up their data", async () => {
    const o = await makeUser("ot-o");
    const second = await makeUser("ot-2");
    const g = await makeGroup(`ReadOwner ${tag}`, [o, second]);
    const rid = await makeRead(g, o.id);
    await setProgress(o, rid, { chapter_index: 5, chapter_fraction: 0 });

    const { error } = await o.client
      .from("group_members")
      .delete()
      .eq("group_id", g)
      .eq("user_id", o.id);
    expect(error).toBeNull();

    const roles = await admin.from("group_members").select("user_id, role").eq("group_id", g);
    expect(roles.data).toEqual([{ user_id: second.id, role: "owner" }]);
    expect(await count("read_progress", rid, o.id)).toBe(0);
    expect(await count("read_milestones", rid, o.id)).toBe(0);
  });

  it("deleting an account removes its progress, milestones and copies", async () => {
    const o = await makeUser("acct-o");
    const m = await makeUser("acct-m");
    const g = await makeGroup(`ReadAccount ${tag}`, [o, m]);
    const rid = await makeRead(g, m.id);
    await setProgress(m, rid, { chapter_index: 5, chapter_fraction: 0 });

    const del = await admin.auth.admin.deleteUser(m.id);
    expect(del.error).toBeNull();

    expect(await count("read_progress", rid, m.id)).toBe(0);
    expect(await count("read_milestones", rid, m.id)).toBe(0);
    // The read outlives its creator's account.
    const read = await admin.from("group_reads").select("created_by").eq("id", rid).single();
    expect(read.error).toBeNull();
    expect(read.data?.created_by).toBeNull();
  });

  it("deleting a group cascades its reads, copies, progress and milestones", async () => {
    const o = await makeUser("gd-o");
    const m = await makeUser("gd-m");
    const g = await makeGroup(`ReadGroupDelete ${tag}`, [o, m]);
    const rid = await makeRead(g, o.id);
    const book = await makeBook(m.id);
    await setProgress(o, rid, { chapter_index: 5, chapter_fraction: 0 });
    await setProgress(m, rid, { chapter_index: 5, chapter_fraction: 0 });
    const c = await m.client
      .from("read_copies")
      .insert({ read_id: rid, user_id: m.id, book_id: book });
    expect(c.error).toBeNull();

    const del = await admin.from("groups").delete().eq("id", g);
    expect(del.error).toBeNull();

    const gone = await admin.from("group_reads").select("id").eq("id", rid);
    expect(gone.data).toEqual([]);
    expect(await count("read_copies", rid)).toBe(0);
    expect(await count("read_progress", rid)).toBe(0);
    expect(await count("read_milestones", rid)).toBe(0);

    // The member's own book is not affected.
    const still = await admin.from("books").select("id").eq("id", book);
    expect(still.data).toHaveLength(1);
  });
});
