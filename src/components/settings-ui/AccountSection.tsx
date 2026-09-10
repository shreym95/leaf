import Link from "next/link";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

/**
 * AccountSection — the body of the /settings screen (SPEC §9 M4).
 * Purely presentational + token-driven: it takes the signed-in identity and
 * renders the identity block, the pointers to reading settings + the privacy
 * policy, and the danger zone that hosts <DeleteAccountDialog>.
 */

const linkClass =
  "font-ui text-accent underline underline-offset-2 hover:opacity-80 " +
  "[font-size:var(--leaf-text-sm)] rounded-sm focus-visible:outline-none " +
  "focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono font-medium uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
      {children}
    </h2>
  );
}

export function AccountSection({
  email,
  displayName,
}: {
  email: string | null;
  displayName: string | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* Identity ------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionHeading>Signed in as</SectionHeading>
        <div className="flex flex-col gap-1">
          {displayName ? (
            <p className="font-ui text-ink [font-size:var(--leaf-text-lg)]">
              {displayName}
            </p>
          ) : null}
          <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
            {email ?? "No email on file"}
          </p>
        </div>
      </section>

      {/* Reading settings pointer ------------------------------------- */}
      <section className="flex flex-col gap-2">
        <SectionHeading>Reading settings</SectionHeading>
        <p className="max-w-prose font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
          Text size and theme are for mid-read tweaks — they stay in the
          reader itself, under the <span className="text-ink">Aa</span> menu.
          Typeface, line spacing, and margins are set up once, so they live
          below, in Reading. Every choice is saved to your account and
          follows you across devices.
        </p>
      </section>

      {/* Privacy ------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <SectionHeading>Privacy</SectionHeading>
        <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
          Read the{" "}
          <Link href="/privacy" className={linkClass}>
            privacy policy
          </Link>{" "}
          for what Leaf stores and how to remove it.
        </p>
      </section>

      {/* Danger zone ------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-md border border-rule p-5">
        <SectionHeading>Danger zone</SectionHeading>
        <p className="max-w-prose font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
          Deleting your account permanently removes your library, your uploaded
          EPUB files, your highlights and notes, your reading positions and
          settings, and your sign-in. This cannot be undone.
        </p>
        <div>
          <DeleteAccountDialog />
        </div>
      </section>
    </div>
  );
}
