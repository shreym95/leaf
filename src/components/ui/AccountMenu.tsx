"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
  Button,
} from "@/components/primitives";
import { purgeAllOfflineData } from "@/lib/offline/purge";

/**
 * AccountMenu — everything in the app bar that is not the wordmark or the theme
 * toggle: navigation, the signed-in identity, privacy, sign out.
 *
 * It exists because the flat bar did not survive a phone: five inline items in a
 * three-column flex collided with the wordmark and wrapped "Sign out" onto two
 * lines. Collapsing the secondary items behind one trigger keeps the bar to
 * three stable slots at every width.
 *
 * Sign-out stays a POST <form> (never a GET link) so it can't be triggered by
 * prefetch or a crawler — but the form lives OUTSIDE the menu content and is
 * submitted from `onSelect`. Nesting it in a `MenuItem` silently broke sign-out:
 * Radix closes and unmounts the menu on select, tearing the form out of the DOM
 * before the browser's native submit could run.
 *
 * Offline purge, and why it lives here:
 *
 * Sign-out clears the session server-side, but the device may also hold
 * offline reading data for this user (cached books, queued writes, cached
 * reader pages — see `src/lib/offline/purge.ts`), none of which the server
 * can reach. That has to be purged client-side, and the ordering matters:
 * firing an async purge and then *immediately* submitting the sign-out form
 * risks the ensuing navigation killing the purge mid-flight, but *awaiting*
 * an unbounded purge before submitting risks a browser with blocked/slow
 * storage hanging sign-out — and a user who cannot sign out is a security
 * problem in its own right. `purgeAllOfflineData()` resolves this by never
 * throwing and always settling within its own bounded timeout, so awaiting
 * it here before submitting is safe: normally it finishes in a few
 * milliseconds (well before the timer), and even in the pathological case
 * the form still submits, just slightly later — sign-out is never blocked
 * or failed by a purge problem.
 *
 * That still leaves a race this component alone can't close: the purge
 * above runs in the tab that clicked "Sign out", but the sign-out POST does
 * a real navigation (a fresh document load of `/login`), so this component
 * instance is torn down and a brand-new one mounts there. The effect below
 * is the other half — an idempotent safety purge that fires whenever this
 * (freshly mounted) component observes `name === null`, i.e. every time the
 * app bar renders signed-out. That covers: the primary purge above losing
 * its race for any reason, and any other route by which the app ends up
 * signed-out (session expiry, the account-deletion flow, a stale cookie).
 * It is safe to run unconditionally in that state because it is idempotent
 * (clearing already-empty stores and messaging a worker with nothing cached
 * are both no-ops) and because `name` can only read `null` here for a
 * request whose cookies this browser is *currently* sending — the App
 * Router's chrome layout derives it fresh, per request, from
 * `getUser()`/cookies, so it reflects this browser's one shared session,
 * not a stale client belief. A browser only ever has one Supabase session
 * (cookies are shared across tabs of the same profile), and IndexedDB/Cache
 * Storage are shared per-origin across those same tabs — so there is no
 * reachable scenario where purging here, in a tab that has just observed
 * `name === null`, discards another tab's *different, still-signed-in*
 * session: a genuinely different signed-in session implies a different
 * storage partition entirely (a different profile or private window),
 * which this purge cannot touch anyway. The one residual case is an
 * in-flight write from a stale tab that hasn't yet learned the session
 * ended — an inherent cross-tab timing hazard, not a different-user leak,
 * and out of scope for this change.
 */

export interface AccountMenuProps {
  /** Display name or email of the signed-in user; `null` when signed out. */
  name: string | null;
}

const itemLink =
  "block w-full rounded-xs px-3 py-2 font-ui text-ink [font-size:var(--leaf-text-sm)]";

export function AccountMenu({ name }: AccountMenuProps) {
  const signOutForm = useRef<HTMLFormElement>(null);

  // Idempotent safety-net purge — see the block comment above. Fires once
  // per mount/transition into the signed-out state; harmless to also fire
  // for a visitor who was never signed in (nothing to clear).
  useEffect(() => {
    if (name === null) {
      void purgeAllOfflineData();
    }
  }, [name]);

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="quiet"
            size="sm"
            mono
            aria-label={name ? `Account menu — ${name}` : "Menu"}
          >
            Menu
          </Button>
        </MenuTrigger>

        <MenuContent align="end">
          {name && (
            <>
              <div className="max-w-[22ch] truncate px-3 py-2 font-ui text-faint [font-size:var(--leaf-text-2xs)]">
                {name}
              </div>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href="/library" className={itemLink}>
                  Library
                </Link>
              </MenuItem>
              <MenuItem asChild>
                <Link href="/settings" className={itemLink}>
                  Settings
                </Link>
              </MenuItem>
            </>
          )}

          <MenuItem asChild>
            <Link href="/privacy" className={itemLink}>
              Privacy
            </Link>
          </MenuItem>

          <MenuSeparator />

          {name ? (
            <MenuItem
              onSelect={() => {
                // Submit after Radix has finished closing, so the unmount can't
                // race the navigation. The purge is awaited (bounded — see the
                // block comment above) before the submit, so the sign-out
                // navigation can't cut it off mid-flight; `.catch` is a second
                // belt-and-suspenders guarantee — on top of `purgeAllOfflineData`
                // already never rejecting — that a purge problem can never stop
                // the form from submitting.
                setTimeout(() => {
                  void purgeAllOfflineData()
                    .catch(() => undefined)
                    .finally(() => signOutForm.current?.requestSubmit());
                }, 0);
              }}
            >
              Sign out
            </MenuItem>
          ) : (
            <MenuItem asChild>
              <Link href="/login" className={itemLink}>
                Sign in
              </Link>
            </MenuItem>
          )}
        </MenuContent>
      </Menu>

      {/* Outside the menu so closing it cannot tear the form out mid-submit. */}
      {name && (
        <form ref={signOutForm} action="/auth/signout" method="post" hidden>
          <button type="submit" tabIndex={-1} aria-hidden>
            Sign out
          </button>
        </form>
      )}
    </>
  );
}
