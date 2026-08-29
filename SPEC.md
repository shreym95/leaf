# Leaf — MVP 1 Build Spec (for Claude Code)

> **What this is.** Instructions to build MVP 1 of *Leaf*, a beautiful web e-reader for public-domain classics and users' own DRM-free EPUBs, deployed full-stack on Vercel. It is written for two readers: the **founder** (owns product decisions, tests on real devices) and the **coding agent** (implements against the specs and acceptance criteria below). Put this file at repo root as `SPEC.md`, keep `CLAUDE.md` (template in §11) beside it.
>
> **Status going in.** A working v0.1 reading-screen prototype already exists and is approved: it runs **epub.js** for real pagination (two-page spread on desktop, single page on mobile), with a fine-press design and two themes (Day / Night). MVP 1 wraps a real product — library, accounts, sync, book sources, upload — around that reader. The prototype file and the Python normalizer from prototyping are the visual + logic reference; the agent should ask the founder for them and treat them as the source of truth for look and for heading-normalization behavior.
>
> **Read this first — the UI is provisional.** The founder will do **major UI overhauls next version**. Therefore: the reader's visual layer (design tokens, chrome components, themes) MUST be built as an isolated, swappable layer with no business logic in it, so a future redesign touches only that layer. Do **not** hard-code colors, spacing, or fonts in components — everything comes from tokens. Do **not** couple pagination, sync, or data logic to specific markup. Getting this separation right is a primary success criterion, ranked above visual polish in MVP 1.

---

## 1. SCOPE

**In scope for MVP 1:**
- Google sign-in; per-user library synced across devices
- Add books two ways: (a) search & import public-domain titles from **Standard Ebooks** (primary) and **Project Gutenberg** (secondary); (b) upload own **DRM-free EPUB**
- Read with epub.js: paginated two-page spread (desktop) / single page (mobile), Day/Night themes, adjustable font + size, position saved & synced
- Highlights + notes, saved by CFI and synced
- Basic library screen (functional, not final visual)
- Full-stack deploy on Vercel (frontend + serverless API + Postgres + file storage)

**Explicitly OUT of scope for MVP 1** (do not build, do not stub in UI):
- Any AI feature (that's a later phase)
- Payments / Pro tier / ads
- Native mobile apps, PDF/MOBI support, TTS, social features
- The final polished UI (this is next version — keep the layer swappable instead)

**What we're validating with MVP 1:** that people will sign in, build a shelf, and come back to read. Reading quality + reliability of sync are the bar.

---

## 2. STACK (do not deviate without asking the founder)

- **Framework:** Next.js (App Router) + React + TypeScript, deployed on **Vercel**
- **Reader engine:** **epub.js** (`epubjs`) — real pagination; this is settled, do not substitute or hand-roll pagination
- **Styling:** Tailwind + a **design-token layer** (CSS variables). No component library that imposes a look (no MUI/Chakra). Radix headless primitives allowed for a11y of menus/dialogs only.
- **Auth:** Google OAuth via **Supabase Auth** (or Auth.js if the agent justifies it; default Supabase)
- **DB:** **Supabase Postgres** with Row-Level Security (owner-only on every table)
- **File storage:** **Supabase Storage** for uploaded EPUBs and cached public-domain EPUBs (per-user, RLS-protected)
- **Serverless:** Next.js Route Handlers (`app/api/*`) on Vercel for the import proxy and any server work
- **State:** React state + Zustand for reader settings. No Redux.

Rationale for Supabase over Vercel Postgres alone: we need Postgres **+ auth + file storage** in one free tier; Supabase gives all three and runs fine alongside a Vercel-hosted Next.js app. If the agent prefers Vercel Postgres + a separate storage/auth solution, it must justify the tradeoff before choosing.

Everything must deploy at **$0** on the Vercel + Supabase free tiers for MVP 1.

---

## 3. AGENT GROUND RULES (read before coding)

1. **UI is a swappable layer.** All visual decisions live in `/src/design/` (tokens, themes) and `/src/components/reader-ui/` (presentational chrome). Business logic (pagination control, sync, data, auth) lives elsewhere and must not import from or depend on specific markup/classes. A future redesign should not require touching logic files. This is a hard architectural requirement.
2. **No hard-coded style values in components.** Every color/space/font references a token. If a value isn't in the token set, add it to the token set, don't inline it.
3. **No secrets in the client.** Supabase anon key is fine client-side (protected by RLS). Service-role keys only in server Route Handlers / env vars. Enforce all data access with RLS; write a test proving user A can't read user B's rows or files.
4. **epub.js owns pagination.** Do not reimplement column/spread math by hand (the prototype proved hand-rolling breaks across screen sizes; epub.js handles it). Configure it (`flow:"paginated"`, `spread:"always"` ≥1024px else `"none"`), style content via `rendition.themes`, and drive position from its `locations`/`relocated` APIs.
5. **Legal invariants (hard):** only Standard Ebooks / Project Gutenberg / user-uploaded **DRM-free** EPUBs. Never implement DRM removal. Reject DRM-protected uploads with a clear message.
6. **Accessibility floor, always:** semantic HTML, visible keyboard focus, `prefers-reduced-motion` respected (page-turn becomes instant), sufficient contrast in **both** themes, screen-reader labels, full keyboard nav (←/→ pages, Esc closes overlays).
7. **Tests on the risky parts:** position save/restore (CFI round-trip), highlight round-trip, RLS isolation, and the import flow. A wrong page on reopen breaks the core promise.
8. **Ask on product ambiguity; pick boring on technical ambiguity.** When unsure about UX/scope, ask the founder. When unsure on a technical detail, choose the well-documented option.
9. **Per milestone:** unit tests for logic, a manual test checklist for the founder, and an updated `CHANGELOG.md`.
10. **Verify Anthropic/tooling facts against docs, not memory.** For any Vercel/Supabase/epub.js specifics, consult current official docs (epub.js: https://github.com/futurepress/epub.js; Vercel + Supabase: their docs) rather than assuming.

---

## 4. ARCHITECTURE & REPO LAYOUT

```
/src
  /app                 Next.js App Router (routes + api handlers)
    /api
      /import          Route handlers: search + fetch public-domain EPUBs (server-side)
      /library         CRUD for the user's books (thin; most via Supabase client + RLS)
    /(routes)          login, library, reader/[bookId], settings
  /design              *** SWAPPABLE UI LAYER ***
    tokens.css         all CSS variables: colors (both themes), type scale, spacing, radii
    themes.ts          theme registry (day, night) — adding a theme = data, not code changes
  /components
    /reader-ui         PRESENTATIONAL chrome only (bars, footer, spread frame, settings sheet)
    /library-ui        library/shelf presentational components
    /primitives        button, sheet, dialog (Radix-wrapped), token-driven
  /reader              READER LOGIC (no styling): epubjs setup, pagination control,
                       position tracking, highlight manager, normalization hooks
  /lib                 supabase client, auth helpers, import clients (SE/Gutenberg), types
  /store               Zustand stores (reader settings, session)
/normalizer            heading/first-para normalization (port of the Python prototype logic to TS,
                       run as an epubjs content hook)
SPEC.md  CLAUDE.md  CHANGELOG.md
```

The separation between `/reader` (logic) and `/components/reader-ui` + `/design` (looks) is the mechanism that makes next version's UI overhaul cheap. Enforce it.

---

## 5. DATA MODEL (Supabase Postgres, RLS = owner-only on every table)

- `profiles (id = auth uid, display_name, default_theme, created_at)`
- `books (id, user_id, title, author, source['standardebooks'|'gutenberg'|'upload'], source_ref, storage_path, cover_url?, added_at, status['reading'|'finished'])`
- `reading_state (book_id, user_id, cfi, percent, updated_at)`
- `highlights (id, book_id, user_id, cfi_range, text, color, note?, created_at)`
- `reader_settings (user_id, font_family, font_size, line_spacing, margins, theme)`

RLS policy on every table: `user_id = auth.uid()`. Uploaded/cached EPUBs live under a per-user Storage path, also RLS-protected. Test that cross-user access is denied.

---

## 6. BOOK SOURCES & IMPORT (server-side)

- **Standard Ebooks (primary):** rigorously, uniformly marked-up public-domain EPUBs — this uniformity is *why* the reader design lands consistently, so prefer it. Use their catalog/OPDS feed for search + download. (Note from prototyping: fetch server-side from your Route Handler; some hosts block direct browser fetches.)
- **Project Gutenberg (secondary):** use the **Gutendex** API (`https://gutendex.com`) for search/metadata and download the EPUB. Gutenberg markup is inconsistent — this is where the normalizer earns its place.
- **Upload:** accept `.epub`, verify it's not DRM-protected, store in the user's Storage bucket.

Import is a **server Route Handler** (`/api/import`): it searches, fetches the EPUB server-side, stores it in Supabase Storage bound to the user, and writes the `books` row. The client never fetches third-party EPUB bytes directly.

---

## 7. THE NORMALIZER (ported from the approved prototype)

Port the Python prototype's logic to TypeScript and run it as an **epub.js content hook** (`rendition.hooks.content`) so it operates on each chapter's DOM as it renders. Behavior (proven against real Standard Ebooks + Gutenberg files in prototyping):

- Detect the chapter wrapper (`section[epub:type="chapter"]` etc.).
- **Tiered heading extraction:** if an `<hgroup>` with an ordinal (`epub:type~="z3998:ordinal"`) + a title (`epub:type~="title"`) exists → render ordinal eyebrow + Fraunces title (e.g. Oz: "I" / "The Cyclone"). If only a bare heading like `<h2>Chapter V</h2>` → ordinal only, no invented title (e.g. Frankenstein). If neither → graceful fallback.
- **First paragraph** (via `header + p` / `hgroup + p` logic, mirroring Standard Ebooks' own convention): no indent, receives the drop cap + small-caps lede.
- Reset publisher CSS/fonts so books look consistent; apply our injected stylesheet.
- **Tiered degradation is the contract:** rich treatment when structure is clean, safe restyle when messy, never broken. Do not assume a subtitle exists.

Keep this in `/normalizer` as pure functions with unit tests fed by a few real chapter fixtures (include one Standard Ebooks and one Gutenberg sample).

---

## 8. THE READER (wrap the approved v0.1)

- **Engine:** epub.js `renderTo` with `flow:"paginated"`. `spread:"always"` at ≥1024px, `"none"` below; update on resize. Let epub.js do all column/clip math.
- **Design applied via `rendition.themes`:** inject the token-driven stylesheet (Garamond body, Fraunces titles, justified text w/ hyphenation, drop cap, small-caps lede). Day/Night switch updates both chrome and content-theme overrides.
- **Chrome** (in `/components/reader-ui`, presentational, token-driven): top bar (Library / title / theme / Aa), open-book spread frame with gutter shadow, bottom bar (prev / progress / next / percent), immersive mode (chrome hides; `F`). All legible — larger, higher-contrast than a first instinct; the prototype's earlier too-light chrome was a rejected state, so meet real contrast minimums.
- **Reading settings sheet:** font size, body font (curated: serif / humanist sans / Atkinson Hyperlegible), line spacing, margins, theme. Persist to `reader_settings` and sync.
- **Position:** save epub.js CFI continuously to `reading_state`; restore exactly on reopen; sync across devices. **Test this.**
- **Highlights/notes:** use epub.js annotations; persist by CFI to `highlights`; a per-book notes list. Contextual note display (click a highlight → note) — acceptable to land this late in the milestone.
- **Page-turn animation:** keep it calm (a soft crossfade/opacity settle, paper stationary — the sliding-text version was rejected). Instant under reduced-motion. Treat the exact motion as provisional (next-version polish).

---

## 9. MILESTONES (in order; founder tests each on desktop **and** a real phone before advancing)

**M0 — Scaffold & the swappable UI seam.** Next.js + TS + Tailwind + token layer; Supabase wired; `/design/tokens.css` with both themes + type scale; a `/styleguide` route rendering primitives + both themes; empty routes behind nav. *Accept:* builds, installs, theme toggle works on styleguide, folder seam (§4) in place.

**M1 — Auth + library shell + data.** Google login; `profiles` on first login; all tables + RLS; library route showing the user's books (functional shelf, not final art); empty-state invitation. *Accept:* log in on desktop + phone; RLS verified (can't read another user's data).

**M2 — Import + upload.** `/api/import` for Standard Ebooks + Gutendex; DRM-checked EPUB upload; books persist to `books` + Storage and appear in the library; a few bundled classics for instant first read. *Accept:* import a Standard Ebooks title and a Gutenberg title, upload one EPUB; all three open; reload + second device (same account) show the same shelf.

**M3 — The reader (core).** epub.js paginated spread/single with the approved design via `rendition.themes`; normalizer hook (§7); Day/Night; reading settings; **CFI position save/restore + sync (tested)**; page-turn crossfade. *Accept:* read 20 min on desktop and phone; close/reopen and on a second device → exact same page; renders cleanly at phone, tablet, and desktop widths (the prototype's small-screen bleed must not recur — epub.js prevents it).

**M4 — Highlights, polish, ship.** Highlights + notes by CFI, synced; notes list; progress; delete-account cleanup (rows + files); a11y + reduced-motion pass; crash reporting + minimal analytics (screen views, import events — never log reading content); privacy policy + Supabase data-safety; deploy to Vercel with a custom domain. *Accept:* highlights survive reopen and sync; keyboard-only + screen-reader pass; live on Vercel.

---

## 10. QUALITY BAR & THE NEXT-VERSION CONTRACT

MVP 1 is judged on: reading works and feels calm; sync is reliable (position + highlights follow you across devices); it's clean at every screen size; nothing says "AI tool" or "SaaS dashboard." Visual *polish* is explicitly **not** the MVP 1 bar — "it just works and is pleasant" is the target, per the founder.

**Because a UI overhaul is coming next version, the agent must, in MVP 1:** keep all visuals in `/design` + `/components/*-ui`; keep `/reader` logic style-agnostic; document in `CHANGELOG.md` any place where logic and presentation had to touch, so the next redesign knows where to look. If the agent is ever tempted to inline a style into a logic file "just for now," it must instead add a token and note it. A clean seam here is worth more than any single polished screen.

---

## 11. CLAUDE.md (place at repo root)
```
# Project: Leaf — a web e-reader (MVP 1)
Read SPEC.md fully. v0.1 reader prototype (epub.js + fine-press design, Day/Night) is APPROVED;
MVP 1 wraps library + accounts + sync + import around it. NO AI features this version.
Stack: Next.js (App Router)+TS+Tailwind(token layer) · epub.js (real pagination, don't hand-roll) ·
Supabase (Postgres/Auth/Storage, RLS owner-only) · deploy on Vercel.
HARD RULES:
- UI is a SWAPPABLE layer: visuals only in /src/design + /src/components/*-ui; /src/reader stays style-agnostic.
- No hard-coded colors/space/fonts in components — use tokens.
- No secrets client-side; RLS on every table (test cross-user denial).
- Only Standard Ebooks / Gutenberg / DRM-free uploads; never DRM removal.
- a11y floor + reduced-motion always; tests on CFI position, highlights, RLS, import.
- Ask founder on product ambiguity; pick boring on technical ambiguity.
Current milestone: M__.  Build: npm run dev  Test: npm test
Ask the founder for: the approved v0.1 reader HTML and the Python normalizer (reference for look + logic).
Expect major UI overhauls next version — keep the seam clean.
```

---

## 12. FIRST MESSAGE TO SEND CLAUDE CODE
> "Read SPEC.md and CLAUDE.md. We're on M0. First, restate (a) the swappable-UI architecture and why /reader must stay style-agnostic, and (b) how epub.js will own pagination, in your own words. Then propose the exact folder structure and the tokens file. I'll also give you the approved v0.1 reader HTML and the normalizer to use as reference. Plan before writing component code — don't build screens yet."
