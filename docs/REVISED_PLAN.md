# Leaf — Comprehensive UI/UX Product Roadmap & Architecture Plan

This document persists the architectural and design blueprint for **Leaf**, an immersive web e-reader for public-domain classics and DRM-free EPUBs.

---

## 1. Executive Vision & Core Tenets

1. **A Pure Lean-Back Reading Sanctuary:** Leaf is an escape into literature, not a productivity or study tool. It minimizes cognitive load by avoiding flashcards, export dashboards, or analytical clutter, focusing instead on tactile intimacy, typographic beauty, and tranquil reading immersion.
2. **One Committed Aesthetic, Themes the Reader Picks:** *Vintage Fine-Press* (deckled
   paper tones, book spine depth, foil accents, illuminated drop caps, and printer's
   fleuron marks) is the house style — not a variant to be tested. The reader's only
   look-and-feel choice is the palette: **Day**, **Sepia** or **Night**, selected
   explicitly. No A/B assignment, no analytics.
3. **Streamlined Raw Discovery:** A fast, focused search bar across Standard Ebooks and Project Gutenberg without algorithmic distraction.
4. **Prioritized Offline-First Autonomy:** Instant local caching via IndexedDB and ServiceWorker, enabling full offline reading on phones and tablets with zero network latency.
5. **Strict Architectural Decoupling:** Visuals remain isolated in `/src/design` and `/src/components/*-ui`. Reader engine logic in `/src/reader` remains 100% style-agnostic.

---

## 2. Design Tokens & Theme Architecture

### A. Three-Tier Theme System (`tokens.css` & `themes.ts`)
Leaf expands from a binary Day/Night toggle to a 3-tier palette: **Day (Clean Neutral)**, **Sepia (Warm Natural Paper)**, and **Night (Deep Soot / Copper)**.

```css
/* Additions to src/design/tokens.css */

/* Tactile Elevation & Spine Shadows */
:root {
  --leaf-shadow-card: 
    0 2px 4px -1px rgba(0, 0, 0, 0.06),
    0 4px 12px -2px rgba(0, 0, 0, 0.08),
    inset 1px 0 0 0 rgba(255, 255, 255, 0.15),
    inset -1px 0 0 0 rgba(0, 0, 0, 0.08);
  --leaf-shadow-card-hover:
    0 8px 24px -4px rgba(0, 0, 0, 0.14),
    0 2px 6px -1px rgba(0, 0, 0, 0.08);
}

/* Palette — SEPIA (Warm Paper) */
[data-theme="sepia"] {
  --leaf-paper: #e4d8be;
  --leaf-page: #ede2cb;
  --leaf-edge: #d1c3a5;
  --leaf-ink: #2b2218;
  --leaf-ink-mid: #5e503f;
  --leaf-faint: #7a6b57;
  --leaf-accent: #9e472a;
  --leaf-rule: #c7b897;
  --leaf-gutter: rgba(43, 34, 24, 0.06);
  --leaf-focus: #9e472a;
  --leaf-selection: rgba(158, 71, 42, 0.22);
  --leaf-hl-copper: rgba(190, 120, 60, 0.32);
  --leaf-hl-sage: rgba(104, 140, 92, 0.30);
  --leaf-hl-sky: rgba(86, 132, 178, 0.30);
  --leaf-hl-rose: rgba(186, 92, 116, 0.30);
  color-scheme: light;
}
```

### B. Theme Picker (replaces the cycling toggle)

`ThemeToggle` today is a button labelled with the *next* theme. At two themes that
reads fine; at three, "Day → Sepia → Night → Day" is a guessing game — you cannot see
what you are choosing, only what comes next.

Three themes gets a **segmented control**: all three options visible, the current one
marked, one tap to any of them. It writes through the reader-settings store exactly as
the toggle does now, so chrome and reader keep the single persisted theme (`45d76fd`,
`1f51b41`).

There is no second axis. `data-aesthetic` and the *Quiet Modern* variant are **dropped**
— they existed to be A/B tested, and there is no A/B test. The fine-press look is simply
the app's look; its spine shadows, drop caps and fleurons are unconditional, which also
removes a token layer, a root attribute and six palette × aesthetic combinations from
the QA surface. Reviving Modern later costs one token block, so nothing is foreclosed.

---

## 3. Library View & Tactile Book Cards

### A. Tactile Card Features (`src/components/library-ui/BookCard.tsx`)
1. **Spine Crease Illusion:** A soft CSS gradient overlay along the left spine edge simulating book binding.
2. **Hover Elevation Physics:** Smooth `-translate-y-1` lift with expanding drop shadow.
3. **Integrated Progress Ribbon:** Subtle bottom progress meter replacing flat text badges.
4. **Frosted Action Trigger:** More menu (`BookActions`) protected by a frosted glass disc (`bg-page/80 backdrop-blur-md`) preventing visual clashes with cover artwork.
5. **Offline Readiness Badge:** Visual indicator displaying whether a title is cached on-device.

---

## 4. Lean-Back Sensory Reader Experience

### A. Silk Ribbon Bookmark
A tactile bookmark anchored to the top-right corner of the spread frame (`src/components/reader-ui/SpreadFrame.tsx`):
- Click/tap drapes a crimson silk ribbon (`bg-accent`) down the page edge.
- Saves the current CFI position as a primary favorite bookmark.

### B. Chapter End Printer's Fleuron
Injected automatically at chapter conclusions in Vintage mode via `src/reader/content-hook.ts`:
- Classical typography printer's mark (❦, ❧, ⚜) providing visual breath between chapters.

### C. Highlight Mode — deliberate, never on by accident

**The rule: a plain selection is a plain selection.** Selecting a word to copy it or look
up its meaning must do nothing else. That is the whole reason highlighting was pulled at
M4 — it fired on every selection, misfired constantly on touch, and would not go away.

So highlighting is a **mode**, not a reaction:

- **Off (default, and the state you are in almost always).** Nothing intercepts
  selection. Copy, define, share, native callout — all behave exactly as they do now.
  Zero surface for a misfire, because zero listeners are attached.
- **On.** Entered from a single control in the reader top bar, which shows the active
  colour. Selecting a passage highlights it in that colour and clears the selection. The
  bottom ribbon carries the 4 colour pips (`Copper`, `Sage`, `Sky`, `Rose`) and a note
  icon, acting on the highlight just made — so changing your mind is one tap, not an
  undo. While on, `-webkit-touch-callout` is suppressed so the OS menu stops competing.
- **Sticky until you leave it.** A reader marking up a chapter marks several passages;
  auto-exiting after one would be its own kind of janky. Leaving is the same control,
  plus page-turn-independent — turning pages inside the mode is normal.
- **Existing highlights stay tappable in both states**, so re-reading a note never
  requires entering the mode.

Long-press was considered and rejected: on touch it *is* the native selection gesture,
so overloading it recreates the ambiguity we are removing.

### D. Calm Reading Velocity (WPM)
- Calculates reading pace quietly in the background.
- Presents human-centric estimates (*"~12 minutes left in this chapter"*) on subtle footer tap/hover.

---

## 5. Offline-First PWA & Storage Architecture

### A. Pure IndexedDB Storage Client (`src/lib/storage/offline-store.ts`)
Zero-dependency client storing book `ArrayBuffer` data, metadata, and reading positions directly in browser IndexedDB:

```typescript
export interface CachedBook {
  bookId: string;
  title: string;
  author: string;
  bytes: ArrayBuffer;
  cachedAt: number;
}
```

### B. Automatic Mobile/Tablet Caching
- When a user on a touch device (`pointer: coarse`) opens a book in `ReaderShell.tsx`, the EPUB bytes are automatically written to IndexedDB.
- Subsequent opens load **instantly from IndexedDB**, eliminating network dependencies.

### C. Offline Fallback & Background Sync
- Reading positions (CFI) and annotations created offline are queued in `localStorage` / IndexedDB.
- When network connectivity returns, positions silently synchronize back to Supabase Postgres.

---

## 6. Implementation Phasing & Milestones

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     STEP-BY-STEP IMPLEMENTATION ROADMAP                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  PHASE 0: UNBLOCK (small, first)                                                │
│  ├── 1. Wire Supabase CLI; replay 0001–0003; ship 0004 (sepia constraints)      │
│  └── 2. Fix `--leaf-rule` contrast + `/privacy` email in the token pass         │
│                                                                                 │
│  PHASE 1: TOKENS & VISUAL POLISH                                                │
│  ├── 1. Add `[data-theme="sepia"]` + fill both Record<ThemeId> palettes         │
│  ├── 2. Replace cycling ThemeToggle with a 3-way segmented picker               │
│  ├── 3. Upgrade `BookCard.tsx` with spine shadow, hover lift, & progress ribbon │
│  └── 4. Refine `ReaderTopBar.tsx` with tactile pill buttons & badge counts      │
│                                                                                 │
│  PHASE 2: LEAN-BACK SENSORY ELEMENTS                                            │
│  ├── 1. Implement `RibbonBookmark` in `SpreadFrame.tsx` (storage decided in 0004)│
│  ├── 2. Add chapter-end fleuron ornaments in `content-hook.ts`                   │
│  └── 3. Highlight MODE: top-bar control + colour ribbon; off = native selection │
│                                                                                 │
│  PHASE 3: OFFLINE-FIRST PWA ENGINE                                              │
│  ├── 1. Implement `src/lib/storage/offline-store.ts` (IndexedDB caching)        │
│  ├── 2. Auto-cache book bytes on mobile/tablet in `ReaderShell.tsx`             │
│  └── 3. Add offline indicator badge to `BookCard.tsx`                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Alignment with the shipped codebase and the open backlog

Written 2026-08-30, after M0–M7 (218 tests green, `1f51b41`). Sections 1–6 above are
the design intent; this section reconciles them with what is actually in the repo
and with the work `BACKLOG.md` still lists as open. Nothing above is discarded —
it is sequenced, and the gaps are named.

### A. Backlog items this plan already covers

| Open backlog item | Covered by | Note |
|---|---|---|
| **Library shelf redesign** (the "UI overhaul", founder-scoped as separate) | §3 Tactile Book Cards + Phase 1.2 | This is the plan's real centre of gravity. The shelf now has covers, progress and a last-read sort (M5/M6), so the redesign inherits data worth showing. |
| **Highlight creation — DISABLED, needs a touch-first design** | §4C Highlight Mode + Phase 2.3 | **Trigger settled (founder, 2026-08-31):** highlighting is an explicit mode, off by default. A plain selection stays a plain selection — copying a word or looking up its meaning must not offer to annotate it. Re-enable point is marked at `ReaderShell.tsx:202`. |

### B. Backlog items this plan does NOT cover — still open, unscheduled

These survive untouched and need a home:

1. **Ratings via Open Library** — Goodreads' API was retired in 2020; Open Library is the
   only free option. Deferred at M6, still deferred. Note §1 tenet 1 ("no analytical
   clutter") arguably argues *against* ever adding ratings — worth a decision, not a drift.
2. **Custom domain** — infrastructure, not design. Also the only fix for Google's consent
   screen reading *"Sign in to `<project-ref>.supabase.co`"*. Needs a paid Supabase add-on.
3. **`--leaf-rule` hairline contrast** (~1.5:1, arguably short of WCAG 1.4.11). Phase 1
   touches tokens anyway — fix it in the same pass rather than opening tokens twice.
4. **Privacy policy contact address** — `/privacy` still says `[your contact email]`.
5. **Guaranteed cross-device sync** — position sync is best-effort and last-write-wins today.
   Scoped in §8 (lower priority, unscheduled). Related: DEFECTS D8.
6. **Migrations are applied by hand** — `0001`–`0003` were run in the Supabase SQL editor;
   there is no CLI wired. See §D: this plan needs at least one more migration, which makes
   wiring the CLI a prerequisite rather than housekeeping.

### C. What the code says about each phase

Verified against the tree, not assumed:

- **Sepia / `data-aesthetic`** — neither string appears in `tokens.css`. `THEMES` in
  `src/design/themes.ts` has exactly `night` and `day`, and `THEME_IDS` drives the toggle.
- **Blocked by the database.** `0001_init.sql` constrains both theme columns:
  `check (default_theme in ('day','night'))` (line 25) and
  `check (theme in ('day','night'))` (line 80). Sepia is a **migration**, not a CSS block.
- **The type system will enforce the rest.** `content-theme.ts:32` and
  `highlight-theme.ts:31` are both `Record<ThemeId, …>` — adding `sepia` to the registry
  fails typecheck until every palette is filled in. That is the seam working; follow the
  compiler.
- **`ThemeToggle` is a cycle button** whose label names the next theme. At three themes,
  "Day → Sepia → Night → Day" is a guessing game — now Phase 1.2, a segmented picker (§2B).
- **Offline is greenfield.** No `serviceWorker`, no `indexedDB` anywhere in `src/` or
  `public/`. `manifest.ts` exists (that is the PWA work from the immersive-mode change) but
  it installs no worker, so today "offline" means nothing is cached.
- **`BookCard.tsx` is presentational and clean** — props in, markup out, every value a
  token. The Phase 1.2 rework has no logic to untangle.

### D. Consequences the plan under-states

- **Two features need schema, and migrations are manual.**
  Sepia needs `0004` (drop and re-add both CHECK constraints).
  The **Silk Ribbon Bookmark** (§4A) persists a CFI — that is a table or a column, and the
  plan never says which. Wire the Supabase CLI *before* either, or the count of
  hand-applied migrations goes to five with no way to replay them.
- **Offline caching and signed URLs fight each other.** Book bytes in IndexedDB are fine.
  Cover art is served through **short-lived signed Storage URLs** — an offline shelf shows
  broken images unless cover *bytes* are cached too. §5 only mentions book bytes.
- ~~**A/B testing has no mechanism.**~~ **Resolved (founder, 2026-08-31): dropped.** No
  A/B test, no analytics, no `data-aesthetic`. Fine-press is the house style; the reader
  picks a palette from a visible three-way control. See §2B.
- **Reading Velocity (§4D) is the one item that pulls against tenet 1.** "A lean-back
  sanctuary, not a productivity tool" and a WPM tracker are in tension. *"~12 minutes left
  in this chapter"* is calm; a pace metric is not. Keep the estimate, skip the statistic.

### E. Recommended order

Phases 1 → 2 → 3 is sound: visual, then sensory, then infrastructure. Amendments:

**Phase 0 — unblock (small, do first).**
Wire the Supabase CLI and replay `0001`–`0003`. Ship migration `0004` (sepia constraints).
Fix `--leaf-rule` contrast and the `/privacy` email in the same commit as the token work.

**Phase 1 — tokens, theme picker, shelf.**
Sepia palettes, the segmented picker, then the tactile cards. No aesthetic axis, no
analytics — both dropped, so Phase 1 is smaller than the original roadmap implied.

**Phase 2 — sensory.**
Highlight *mode* per §4C; the trigger is settled. Decide the bookmark's storage shape
with the Phase 0 migration, not after it.

**Phase 3 — offline.**
Largest and riskiest; it wants a service worker, a cache for cover bytes, and a sync queue
with conflict rules (two devices, one CFI — last-write-wins is a choice, make it explicitly).
Sequence it last, and consider splitting "read a cached book offline" from "sync writes made
offline" — the first is most of the value at a fraction of the risk.

**Unscheduled, deliberately:** Open Library ratings, custom domain.

---

## 8. Guaranteed cross-device sync (enhancement — lower priority, unscheduled)

**Founder ask, 2026-09-09:** move reading position from *silent best-effort* to *guaranteed
state*, correct across multiple live devices.

### Where it stands today

`src/reader/position.ts` debounces relocations by 1.5s and upserts `{cfi, percent}` straight
from the browser into `reading_state` (PK `(book_id, user_id)`, RLS-scoped). `restore()` reads
that row on open and calls `goTo(cfi)`. That is a sound skeleton, and CFIs are the right unit —
they survive different screen sizes, fonts and margins, so laptop page 40 and phone page 112
resolve to the same place.

Three properties it does NOT have:

1. **Not live.** Restore runs only on open. Devices open at the same time never see each other.
2. **Last write wins, blindly.** The upsert has no version or timestamp guard, so any stale device
   that turns a single page can clobber a further-along position written by another.
3. **Silent failure.** Write errors are swallowed by design (reading must never be interrupted),
   so a reader gets no signal that their position was not saved. See DEFECTS D8 for the related
   loss-on-backgrounding bug.

### What "guaranteed" should mean

Worth agreeing before building — "guaranteed" is not one thing:

- **(a) Durable.** A turn that happened is eventually persisted, even if the tab is killed.
  Needs the D8 fix (`visibilitychange` / `pagehide` + `sendBeacon`/`keepalive`) plus a retry
  queue for offline writes. Cheapest, and the biggest real-world win.
- **(b) Convergent.** Any set of devices that wrote ends up agreeing, deterministically. Needs a
  conflict rule. The honest default for a reader is **furthest-position-wins**, not
  last-write-wins — a reader almost never wants to be pulled backwards. Requires comparing CFIs
  (epub.js `EpubCFI.compare`), or `percent` as a cheap proxy, plus an `updated_at` tiebreak.
- **(c) Live.** Device B follows device A while both are open. Supabase Realtime on
  `reading_state` makes this small to build, but it raises a product question: should the page
  you are reading *move under you*? Probably not — the right shape is a passive prompt
  ("Continue from page 112, last read on your phone?"), which also handles the non-live case.

### Suggested order

(a) durability → (b) convergence with furthest-wins → (c) a resume prompt rather than live
following. (c) is the only part that changes what a reader sees, so it wants a design pass.

### Interactions

- **Phase 3 offline** (§5) needs the same retry queue and the same conflict rule — build them
  once, here, and let Phase 3 consume them.
- **Bookmarks and highlights** have the same silent best-effort write path and would inherit
  whatever durability layer this adds.
- A `version` or `updated_at` guard on `reading_state` may mean migration `0006`.
