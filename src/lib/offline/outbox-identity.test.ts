// resolveUserId against auth-js's REAL offline behaviour: `getUser()` does not
// throw on a network failure, it RESOLVES `{ data: { user: null }, error }`
// with an `AuthRetryableFetchError`. Real error classes are used (not
// look-alikes) so the classification is exercised end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { getCachedUserId, resolveUserId } from "./outbox";
import { OWNER_MARKER_KEY } from "./identity";

type GetUserResult = {
  data: { user: { id: string } | null };
  error?: unknown;
};

function makeClient(
  getUser: () => Promise<GetUserResult>,
  cachedUserId: string | null,
) {
  const getSession = vi.fn(async () => ({
    data: { session: cachedUserId ? { user: { id: cachedUserId } } : null },
  }));
  return { client: { auth: { getUser, getSession } }, getSession };
}

const offline = () =>
  Promise.resolve({
    data: { user: null },
    error: new AuthRetryableFetchError("Failed to fetch", 0),
  });

describe("resolveUserId — getUser resolves (not throws) offline", () => {
  it("returns the cached session id on a retryable network error", async () => {
    const { client } = makeClient(offline, "cached-user");
    expect(await resolveUserId(client)).toBe("cached-user");
  });

  it("returns null on a network error when there is no cached session", async () => {
    const { client } = makeClient(offline, null);
    expect(await resolveUserId(client)).toBeNull();
  });

  it("returns null on a session-missing error even if a stale cached session exists", async () => {
    const { client, getSession } = makeClient(
      async () => ({
        data: { user: null },
        error: new AuthSessionMissingError(),
      }),
      "stale-user",
    );
    expect(await resolveUserId(client)).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns null on a non-retryable auth API error (e.g. revoked token)", async () => {
    const { client } = makeClient(
      async () => ({
        data: { user: null },
        error: new AuthApiError("invalid JWT", 401, "bad_jwt"),
      }),
      "stale-user",
    );
    expect(await resolveUserId(client)).toBeNull();
  });

  it("returns null when there is no user and no error (signed out)", async () => {
    const { client, getSession } = makeClient(
      async () => ({ data: { user: null } }),
      "stale-user",
    );
    expect(await resolveUserId(client)).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("prefers the server-verified user over the cached session", async () => {
    const { client, getSession } = makeClient(
      async () => ({ data: { user: { id: "live-user" } }, error: null }),
      "cached-user",
    );
    expect(await resolveUserId(client)).toBe("live-user");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("still falls back to the cached session if getUser throws", async () => {
    const { client } = makeClient(async () => {
      throw new TypeError("Failed to fetch");
    }, "cached-user");
    expect(await resolveUserId(client)).toBe("cached-user");
  });
});

// getCachedUserId against the REAL expired-token-offline shape: `getSession()`
// resolves `{ session: null, error: AuthRetryableFetchError }` and the stored
// session survives. The owner marker (last verified user on this device) is
// the identity to queue against; a genuine sign-out must still yield null.
describe("getCachedUserId — getSession resolves (not throws) offline", () => {
  const sessionClient = (result: {
    data: { session: { user: { id: string } } | null };
    error?: unknown;
  }) => ({
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(async () => result),
    },
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the session's id when signed in", async () => {
    const client = sessionClient({
      data: { session: { user: { id: "live" } } },
      error: null,
    });
    expect(await getCachedUserId(client)).toBe("live");
  });

  it("returns the owner marker's id when the session is unverifiable", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    const client = sessionClient({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    expect(await getCachedUserId(client)).toBe("marker-user");
  });

  it("returns null when unverifiable and there is no marker", async () => {
    const client = sessionClient({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    expect(await getCachedUserId(client)).toBeNull();
  });

  it("returns null on a real sign-out even with a marker present", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    const client = sessionClient({ data: { session: null }, error: null });
    expect(await getCachedUserId(client)).toBeNull();
  });

  it("returns null on a non-retryable error even with a marker present", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    const client = sessionClient({
      data: { session: null },
      error: new AuthApiError("revoked", 400, "refresh_token_not_found"),
    });
    expect(await getCachedUserId(client)).toBeNull();
  });

  it("returns null, never throws, when getSession throws", async () => {
    const client = {
      auth: {
        getUser: vi.fn(),
        getSession: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    };
    expect(await getCachedUserId(client)).toBeNull();
  });

  it("resolveUserId queues against the marker when both getUser and getSession fail retryably", async () => {
    window.localStorage.setItem(OWNER_MARKER_KEY, "marker-user");
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: new AuthRetryableFetchError("Failed to fetch", 0),
        }),
        getSession: async () => ({
          data: { session: null },
          error: new AuthRetryableFetchError("Failed to fetch", 0),
        }),
      },
    };
    expect(await resolveUserId(client)).toBe("marker-user");
  });
});
