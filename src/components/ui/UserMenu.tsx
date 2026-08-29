import Link from "next/link";
import { Button } from "@/components/primitives";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * UserMenu — signed-in identity + sign-out, or a "Sign in" link when signed out.
 * Presentational only, token-driven. Rendered server-side by NavBar.
 *
 * Sign-out is a POST <form> (never a GET link) so it can't be triggered by
 * prefetch/crawlers and matches the a11y floor (SPEC §3.6).
 */

const linkClass =
  "font-mono font-medium uppercase text-ink-mid hover:text-ink transition-colors " +
  "[transition-duration:var(--leaf-dur-ui)] " +
  "[letter-spacing:var(--leaf-tracking-wide)] [font-size:var(--leaf-text-2xs)] " +
  "rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

export function UserMenu({
  name,
  next,
}: {
  /** Display name or email of the signed-in user; `null` when signed out. */
  name: string | null;
  /** Path to return to after signing in (signed-out state only). */
  next?: string;
}) {
  if (!name) {
    const safeNext = safeNextPath(next, "");
    const href = safeNext
      ? `/login?next=${encodeURIComponent(safeNext)}`
      : "/login";
    return (
      <Link href={href} className={linkClass}>
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className="hidden max-w-[16ch] truncate font-ui text-ink-mid [font-size:var(--leaf-text-xs)] sm:inline"
        title={name}
      >
        {name}
      </span>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="quiet" size="sm" mono>
          Sign out
        </Button>
      </form>
    </div>
  );
}
