"use client";

import { useState } from "react";
import { THEMES } from "@/design/themes";
import { useTheme } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
} from "@/components/primitives";

/* ---------------------------------------------------------------------------
   Token inventories — NAMES only. Every value is pulled live from tokens.css
   via `var(--leaf-*)`, so these swatches restyle when the theme toggles.
   ------------------------------------------------------------------------- */

const PALETTE = [
  "paper",
  "page",
  "edge",
  "ink",
  "ink-mid",
  "faint",
  "accent",
  "rule",
  "focus",
] as const;

const TYPE_SCALE = [
  "3xs",
  "2xs",
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "display",
] as const;

const SPACE = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const RADII = ["xs", "sm", "md", "lg", "pill"] as const;

function themeLabel(id: string): string {
  return (THEMES as Record<string, { label: string }>)[id]?.label ?? id;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-rule pt-6">
      <h2 className="font-mono font-medium uppercase text-ink-mid [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  const { theme } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10 bg-paper text-ink">
      <header className="flex flex-col gap-3">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Leaf · M0 styleguide
        </p>
        <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
          The swappable UI layer
        </h1>
        <div className="flex items-center gap-4">
          <ThemeToggle mono />
          <span className="font-body text-ink-mid [font-size:var(--leaf-text-sm)]">
            Current theme: <strong className="text-ink">{themeLabel(theme)}</strong>
          </span>
        </div>
        <p className="font-body text-ink [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-body)]">
          Focus rings are visible on Tab; page-turn / theme motion is instant
          under <code className="font-mono">prefers-reduced-motion</code>.
        </p>
      </header>

      {/* ---- Colour ---------------------------------------------------- */}
      <Section title="Colour — palette tokens (toggle the theme to watch them change)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PALETTE.map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-sm border border-rule p-2"
            >
              <span
                aria-hidden
                className="h-10 w-10 flex-none rounded-xs border border-rule"
                style={{ background: `var(--leaf-${name})` }}
              />
              <code className="font-mono text-ink-mid [font-size:var(--leaf-text-2xs)]">
                --leaf-{name}
              </code>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- Type ----------------------------------------------------- */}
      <Section title="Type scale — font-body">
        <div className="flex flex-col gap-2">
          {TYPE_SCALE.map((step) => (
            <div key={step} className="flex items-baseline gap-4">
              <code className="w-20 flex-none font-mono text-faint [font-size:var(--leaf-text-2xs)]">
                {step}
              </code>
              <span
                className="font-body text-ink"
                style={{ fontSize: `var(--leaf-text-${step})` }}
              >
                The quick brown fox
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <p
            className="font-display text-ink"
            style={{ fontSize: "var(--leaf-text-2xl)" }}
          >
            Chapter I · The Cyclone
          </p>
          <p className="font-mono uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
            An eyebrow label
          </p>
        </div>
      </Section>

      {/* ---- Spacing ------------------------------------------------- */}
      <Section title="Spacing — --leaf-space-1 … 8">
        <div className="flex flex-col gap-2">
          {SPACE.map((n) => (
            <div key={n} className="flex items-center gap-3">
              <code className="w-8 flex-none font-mono text-faint [font-size:var(--leaf-text-2xs)]">
                {n}
              </code>
              <span
                aria-hidden
                className="h-4 rounded-xs [background:var(--leaf-accent)]"
                style={{ width: `var(--leaf-space-${n})` }}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* ---- Radii ------------------------------------------------- */}
      <Section title="Radii — --leaf-radius-*">
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <span
                aria-hidden
                className="h-16 w-16 bg-edge border border-rule"
                style={{ borderRadius: `var(--leaf-radius-${r})` }}
              />
              <code className="font-mono text-faint [font-size:var(--leaf-text-2xs)]">
                {r}
              </code>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- Primitives -------------------------------------------- */}
      <Section title="Primitives — Button">
        <div className="flex flex-col gap-4">
          {(["primary", "ghost", "quiet"] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <code className="w-16 flex-none font-mono text-faint [font-size:var(--leaf-text-2xs)]">
                {variant}
              </code>
              <Button variant={variant} size="sm">
                Small
              </Button>
              <Button variant={variant} size="md">
                Medium
              </Button>
              <Button variant={variant} size="md" disabled>
                Disabled
              </Button>
              <Button variant={variant} size="sm" mono>
                Mono
              </Button>
            </div>
          ))}
          <p className="font-body text-ink-mid [font-size:var(--leaf-text-sm)]">
            Tab to a button to see the focus ring (
            <code className="font-mono">--leaf-shadow-focus</code>).
          </p>
        </div>
      </Section>

      <Section title="Primitives — overlays">
        <div className="flex flex-wrap gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="md">
                Open Dialog
              </Button>
            </DialogTrigger>
            <DialogContent
              title="A dialog"
              description="Radix-backed: focus-trapped, Esc closes, scroll locked."
            >
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="quiet" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary" size="sm">
                    Confirm
                  </Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="md">
                Open Sheet
              </Button>
            </SheetTrigger>
            <SheetContent title="Reading settings">
              <p className="font-body text-ink-mid [font-size:var(--leaf-text-sm)]">
                The bottom-sheet pattern for reading settings on mobile (SPEC §8).
              </p>
              <div className="mt-4 flex justify-end">
                <SheetClose asChild>
                  <Button variant="primary" size="sm">
                    Done
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>

          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="md">
                Open Menu
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem onSelect={() => undefined}>Day theme</MenuItem>
              <MenuItem onSelect={() => undefined}>Night theme</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => undefined}>About Leaf</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </Section>
    </main>
  );
}
