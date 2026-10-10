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
