import type { Metadata } from "next";
import Link from "next/link";

/**
 * /privacy — Leaf's privacy policy (SPEC §9 M4). Public: no auth, safe to
 * prerender. Plain language, no legalese, no invented company. Keep this in
 * sync with what the app actually does.
 *
 * PLACEHOLDER: the contact line uses `[your contact email]` — the founder must
 * replace it before launch.
 */

export const metadata: Metadata = {
  title: "Privacy Policy — Leaf",
  description: "What Leaf collects, where it is stored, and how to delete it.",
};

const LAST_UPDATED = "30 August 2026";

const linkClass =
  "font-ui text-accent underline underline-offset-2 hover:opacity-80 " +
  "rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-ink [font-size:var(--leaf-text-xl)]">
        {heading}
      </h2>
      {children}
    </section>
  );
}

const proseClass =
  "max-w-prose font-ui text-ink-mid [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-body)]";
const listClass =
  "flex max-w-prose list-disc flex-col gap-2 pl-5 font-ui text-ink-mid [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-body)]";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Privacy
        </p>
        <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
          Privacy Policy
        </h1>
        <p className="font-ui text-faint [font-size:var(--leaf-text-sm)]">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      <p className={proseClass}>
        Leaf is a web reader for public-domain books and your own DRM-free EPUB
        files. This page explains, in plain terms, what Leaf stores about you,
        where it lives, who else is involved, and how to remove all of it.
      </p>

      <Section heading="What Leaf collects">
        <ul className={listClass}>
          <li>
            <span className="text-ink">Your account.</span> When you sign in with
            Google, Leaf receives your email address and your display name
            through Supabase Auth. Leaf does not see your Google password.
          </li>
          <li>
            <span className="text-ink">Your library.</span> The books you add —
            their titles and authors — and the EPUB files you upload or that Leaf
            fetches for you when you import a public-domain title.
          </li>
          <li>
            <span className="text-ink">Your reading data.</span> Your position in
            each book, your reading settings (font, size, spacing, margins,
            theme), and any highlights and notes you make.
          </li>
          <li>
            <span className="text-ink">Basic usage events.</span> Which screens
            you open and when you import a book, so we can tell whether the app
            is working. See below for what this never includes.
          </li>
        </ul>
      </Section>

      <Section heading="What Leaf never collects">
        <p className={proseClass}>
          Leaf does not record the content of what you read. Usage events count
          screen views and import actions only — never the text of a book, a
          page you are on, or the words you highlight. There are no advertising
          trackers and no third-party analytics profiles.
        </p>
      </Section>

      <Section heading="Where it is stored">
        <p className={proseClass}>
          Everything is stored in Supabase: your account and reading data in a
          Postgres database, your EPUB files in Supabase Storage. Every database
          table and every file is protected by owner-only Row-Level Security —
          your rows and files are readable only by your signed-in account, not by
          other users. The app is hosted on Vercel.
        </p>
      </Section>

      <Section heading="Who else is involved">
        <ul className={listClass}>
          <li>
            <span className="text-ink">Google</span> — used only to sign you in.
          </li>
          <li>
            <span className="text-ink">Supabase</span> — hosts the database,
            file storage, and authentication.
          </li>
          <li>
            <span className="text-ink">Vercel</span> — hosts and serves the app.
          </li>
          <li>
            <span className="text-ink">
              Standard Ebooks and Project Gutenberg
            </span>{" "}
            — when you import a public-domain book, Leaf&apos;s server fetches the
            EPUB from one of these sources on your behalf. Your identity is not
            sent to them.
          </li>
        </ul>
        <p className={proseClass}>
          Leaf does not sell your data and does not share it with anyone beyond
          the services above, which act only to run the app.
        </p>
      </Section>

      <Section heading="How to delete everything">
        <p className={proseClass}>
          Go to{" "}
          <Link href="/settings" className={linkClass}>
            Settings
          </Link>{" "}
          and choose <span className="text-ink">Delete account</span>. This
          permanently removes, with no recovery:
        </p>
        <ul className={listClass}>
          <li>every book in your library and every EPUB file you uploaded;</li>
          <li>all of your highlights and notes;</li>
          <li>your reading positions and reading settings;</li>
          <li>your profile and your Leaf sign-in.</li>
        </ul>
        <p className={proseClass}>
          Deletion happens immediately when you confirm. If you signed in with
          Google, you may also want to remove Leaf&apos;s access from your Google
          account settings.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p className={proseClass}>
          If this policy changes, the &ldquo;last updated&rdquo; date above will
          change with it. Leaf is a small project; changes will be substantive,
          not cosmetic.
        </p>
      </Section>

      <Section heading="Contact">
        <p className={proseClass}>
          Questions about privacy, or a request about your data, can go to{" "}
          <span className="text-ink">[your contact email]</span>.
        </p>
      </Section>
    </main>
  );
}
