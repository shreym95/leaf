import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * NavBar — the slim app chrome shell rendered above every route in layout.tsx.
 * Presentational only, token-driven. Echoes the approved v0.1 bar: mono-uppercase
 * links, centered "LEAF" wordmark, theme control on the right.
 *
 * NOTE: the reader route (/reader/[bookId]) opts OUT of this chrome in M3 — it
 * renders its own immersive top/bottom bars per SPEC §8. When that lands, this
 * shell moves into a route group layout so the reader can skip it.
 */

const linkClass =
  "font-mono font-medium uppercase text-ink-mid hover:text-ink transition-colors " +
  "[transition-duration:var(--leaf-dur-ui)] " +
  "[letter-spacing:var(--leaf-tracking-wide)] [font-size:var(--leaf-text-2xs)]";

export function NavBar() {
  return (
    <header className="flex items-center border-b border-rule bg-paper px-4 py-3">
      <nav className="flex flex-1 items-center gap-5">
        <Link href="/library" className={linkClass}>
          Library
        </Link>
        <Link href="/settings" className={linkClass}>
          Settings
        </Link>
      </nav>

      <Link
        href="/library"
        aria-label="Leaf — home"
        className="flex-none font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-xs)]"
      >
        Leaf
      </Link>

      <div className="flex flex-1 items-center justify-end">
        <ThemeToggle mono />
      </div>
    </header>
  );
}
