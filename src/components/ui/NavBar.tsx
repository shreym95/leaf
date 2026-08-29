import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { UserMenu } from "@/components/ui/UserMenu";
import { getUser } from "@/lib/auth";

/**
 * NavBar — the slim app chrome shell rendered above every route in layout.tsx.
 * Presentational + token-driven; reads the signed-in user server-side (async
 * Server Component) and hands the name to <UserMenu>.
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
    <header className="flex items-center border-b border-rule bg-paper px-4 py-3">
      <nav className="flex flex-1 items-center gap-5">
        {user && (
          <>
            <Link href="/library" className={linkClass}>
              Library
            </Link>
            <Link href="/settings" className={linkClass}>
              Settings
            </Link>
          </>
        )}
      </nav>

      <Link
        href={user ? "/library" : "/login"}
        aria-label="Leaf — home"
        className="flex-none font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-xs)]"
      >
        Leaf
      </Link>

      <div className="flex flex-1 items-center justify-end gap-4">
        <UserMenu name={displayName} />
        <ThemeToggle mono />
      </div>
    </header>
  );
}
