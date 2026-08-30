import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AccountMenu } from "@/components/ui/AccountMenu";
import { getUser } from "@/lib/auth";

/**
 * NavBar — the slim app chrome shell (SPEC §8).
 *
 * Three stable slots at every width: the LEAF wordmark, then the theme toggle
 * and one account menu. Secondary navigation (Library, Settings, Privacy, sign
 * out) lives inside the menu — the previous flat bar put five inline items in a
 * three-column flex, which on a phone collided with the wordmark and wrapped
 * "Sign out" onto two lines. Library and Settings also appear inline once there
 * is room for them (`sm:` and up).
 *
 * NOTE: rendered by `src/app/(chrome)/layout.tsx`, NOT the root layout — the
 * reader route group (`src/app/(reader)`) has its own minimal layout with no
 * NavBar so it can go fully immersive (SPEC §8).
 */

const linkClass =
  "font-mono font-medium uppercase text-ink-mid hover:text-ink transition-colors " +
  "[transition-duration:var(--leaf-dur-ui)] " +
  "[letter-spacing:var(--leaf-tracking-wide)] [font-size:var(--leaf-text-2xs)] " +
  "rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

export async function NavBar() {
  const user = await getUser();
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    null;

  return (
    <header className="flex items-center gap-3 border-b border-rule bg-paper px-4 py-3">
      <Link
        href={user ? "/library" : "/login"}
        aria-label="Leaf — home"
        className="flex-none rounded-sm font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-xs)] [letter-spacing:var(--leaf-tracking-eyebrow)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
      >
        Leaf
      </Link>

      {/* Inline shortcuts only where they fit; the menu always carries them. */}
      {user && (
        <nav className="hidden flex-1 items-center gap-5 sm:flex">
          <Link href="/library" className={linkClass}>
            Library
          </Link>
          <Link href="/settings" className={linkClass}>
            Settings
          </Link>
        </nav>
      )}

      <div className="flex flex-1 items-center justify-end gap-2">
        <ThemeToggle mono />
        <AccountMenu name={displayName} />
      </div>
    </header>
  );
}
