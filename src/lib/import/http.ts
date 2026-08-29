// Resilient outbound fetch for the import clients (server-side only).
//
// Long-running dev / serverless processes intermittently fail outbound requests
// with `AggregateError: fetch failed` — typically an IPv6 address tried first
// against a v4-only route, or a stale pooled socket. This wraps `fetch` with an
// IPv4 DNS preference, a per-attempt timeout, and a short retry on transient
// network errors / 5xx / 429.

import { setDefaultResultOrder } from "node:dns";

try {
  setDefaultResultOrder("ipv4first");
} catch {
  /* not supported in every runtime — ignore */
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;

export interface OutboundFetchInit extends RequestInit {
  timeoutMs?: number;
  attempts?: number;
}

export async function outboundFetch(
  url: string,
  init: OutboundFetchInit = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    ...rest
  } = init;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Retry server errors / rate limits; return everything else (incl. 4xx —
      // the caller maps those).
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`${url} → HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }

  throw new Error(
    `Request to ${url} failed after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { cause: lastError },
  );
}
