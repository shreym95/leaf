"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
  Button,
} from "@/components/primitives";

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
 */

export interface AccountMenuProps {
  /** Display name or email of the signed-in user; `null` when signed out. */
  name: string | null;
}

const itemLink =
  "block w-full rounded-xs px-3 py-2 font-ui text-ink [font-size:var(--leaf-text-sm)]";

export function AccountMenu({ name }: AccountMenuProps) {
  const signOutForm = useRef<HTMLFormElement>(null);

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
                // race the navigation.
                setTimeout(() => signOutForm.current?.requestSubmit(), 0);
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
