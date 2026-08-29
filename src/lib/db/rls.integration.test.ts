/**
 * RLS cross-user isolation — the SPEC §3.3 test: prove user A cannot read
 * user B's rows.
 *
 * Runs ONLY when `.env.local` provides real Supabase keys. The skip condition
 * is exactly:
 *
 *   !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL
 *
 * Without those the whole `describe` is SKIPPED (not failed).
 * `vitest.setup.env.ts` loads `.env.local` if present; in CI without the file
 * this is a no-op and the suite skips.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const noKeys = !SERVICE_KEY || !SUPABASE_URL;

describe.skipIf(noKeys)("RLS cross-user isolation (SPEC §3.3)", () => {
  // service-role client — bypasses RLS, used only for setup/teardown + seeding.
  // Instantiated in beforeAll (the describe body runs even when skipped).
  let admin: SupabaseClient;

  const tag = Math.random().toString(36).slice(2, 10);
  const credsA = { email: `leaf-rls-a-${tag}@example.com`, password: `Aa1!${tag}${tag}` };
  const credsB = { email: `leaf-rls-b-${tag}@example.com`, password: `Bb2!${tag}${tag}` };

  let userAId = "";
  let userBId = "";
  let bookAId = "";
  let bookBId = "";
  let clientA: SupabaseClient;

  beforeAll(async () => {
    if (!ANON_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required for this test");

    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const a = await admin.auth.admin.createUser({
      email: credsA.email,
      password: credsA.password,
      email_confirm: true,
    });
    if (a.error) throw a.error;
    userAId = a.data.user!.id;

    const b = await admin.auth.admin.createUser({
      email: credsB.email,
      password: credsB.password,
      email_confirm: true,
    });
    if (b.error) throw b.error;
    userBId = b.data.user!.id;

    // Seed one book per user via the service client.
    const seedA = await admin
      .from("books")
      .insert({ user_id: userAId, title: "A's book", author: "A", source: "upload" })
      .select("id")
      .single();
    if (seedA.error) throw seedA.error;
    bookAId = seedA.data.id as string;

    const seedB = await admin
      .from("books")
      .insert({ user_id: userBId, title: "B's book", author: "B", source: "upload" })
      .select("id")
      .single();
    if (seedB.error) throw seedB.error;
    bookBId = seedB.data.id as string;

    // Seed B-owned reading_state + highlight (bypassing RLS) to prove A can't read them.
    const rs = await admin
      .from("reading_state")
      .insert({ book_id: bookBId, user_id: userBId, cfi: "epubcfi(/6/2!/4/2)", percent: 0.42 });
    if (rs.error) throw rs.error;

    const hl = await admin.from("highlights").insert({
      book_id: bookBId,
      user_id: userBId,
      cfi_range: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
      text: "B's private note text",
      color: "copper",
    });
    if (hl.error) throw hl.error;

    // anon client signed in as user A.
    clientA = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await clientA.auth.signInWithPassword(credsA);
    if (signIn.error) throw signIn.error;
  });

  afterAll(async () => {
    if (!admin) return;
    // Deleting the auth users cascades to all their rows.
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });

  it("user A can read its own book", async () => {
    const { data, error } = await clientA.from("books").select("*").eq("id", bookAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(bookAId);
  });

  it("user A cannot read user B's book (no rows, no error)", async () => {
    const { data, error } = await clientA.from("books").select("*").eq("id", bookBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot read user B's reading_state", async () => {
    const { data, error } = await clientA
      .from("reading_state")
      .select("*")
      .eq("book_id", bookBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot read user B's highlights", async () => {
    const { data, error } = await clientA
      .from("highlights")
      .select("*")
      .eq("book_id", bookBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot insert a row owned by user B (WITH CHECK blocks it)", async () => {
    const { error } = await clientA
      .from("books")
      .insert({ user_id: userBId, title: "hijack", author: "", source: "upload" });
    expect(error).not.toBeNull();
  });

  it("user A cannot read user B's profile", async () => {
    const { data, error } = await clientA.from("profiles").select("*").eq("id", userBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
