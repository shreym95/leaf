// readLocalIdentity against auth-js's REAL offline behaviour: once the access
// token has expired, `getSession()` tries to refresh, the refresh fails
// offline, and getSession RESOLVES `{ session: null, error:
// AuthRetryableFetchError }` — it does not throw. The earlier tests for this
// area mocked a throw that auth-js never does, which is how the bug shipped.
// Real error classes are used so the classification is exercised end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import {
  OWNER_MARKER_KEY,
  identityUserId,
  readLocalIdentity,
  type IdentityClient,
} from "./identity";

type SessionResult = Awaited<ReturnType<IdentityClient["auth"]["getSession"]>>;

function clientResolving(result: SessionResult): IdentityClient {
  return { auth: { getSession: vi.fn(async () => result) } };
}

const offlineError = () => new AuthRetryableFetchError("Failed to fetch", 0);

beforeEach(() => {
  window.localStorage.clear();
});

describe("readLocalIdentity", () => {
  it("signed-in: getSession gave a session", async () => {
    const client = clientResolving({
      data: { session: { user: { id: "user-a" } } },
      error: null,
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-in",
      userId: "user-a",
    });
  });

  it("signed-in wins over a stale marker for someone else", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-b");
    const client = clientResolving({
      data: { session: { user: { id: "user-a" } } },
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-in",
      userId: "user-a",
    });
  });

  it("unverifiable WITH a marker: retryable error carries the marker's id", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-a");
    const client = clientResolving({
      data: { session: null },
      error: offlineError(),
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "unverifiable",
      userId: "user-a",
    });
  });

  it("unverifiable WITHOUT a marker: userId is undefined", async () => {
    const client = clientResolving({
      data: { session: null },
      error: offlineError(),
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "unverifiable",
      userId: undefined,
    });
  });

  it("signed-out: no session and no error (a real sign-out)", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-a");
    const client = clientResolving({ data: { session: null }, error: null });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-out",
    });
  });

  it("signed-out: no session, error field absent", async () => {
    const client = clientResolving({ data: { session: null } });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-out",
    });
  });

  it("signed-out: a non-retryable auth API error (revoked session)", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "user-a");
    const client = clientResolving({
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-out",
    });
  });

  it("signed-out: AuthSessionMissingError", async () => {
    const client = clientResolving({
      data: { session: null },
      error: new AuthSessionMissingError(),
    });
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-out",
    });
  });

  it("signed-out, never throws, when getSession() throws", async () => {
    const client: IdentityClient = {
      auth: {
        getSession: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    };
    await expect(readLocalIdentity(client)).resolves.toEqual({
      kind: "signed-out",
    });
  });
});

describe("identityUserId", () => {
  it("maps each state to an id or null", () => {
    expect(identityUserId({ kind: "signed-in", userId: "a" })).toBe("a");
    expect(identityUserId({ kind: "unverifiable", userId: "m" })).toBe("m");
    expect(identityUserId({ kind: "unverifiable", userId: undefined })).toBeNull();
    expect(identityUserId({ kind: "signed-out" })).toBeNull();
  });
});
