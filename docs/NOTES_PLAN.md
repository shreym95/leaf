# Notes v1 — build plan

_Written 2026-10-17. Decisions from the founder, 2026-10-17. Ships in the same version as
reading groups v1 (`feat/groups-v1a`). Nothing goes to `dev` until the whole version is
done. Built with the same rules as `GROUPS_V1_BUILD.md`; this file says what changes and
how it is built without breaking what is live._

Design sources: `FEATURES_PLAN.md` §5.3–5.7 (group marks, notes and highlights),
`REVISED_PLAN.md` §4C (reversed here, see §8), `BACKLOG.md` ("Dropped").

---

## 1. What changes

### 1.1 One concept: Notes

- **Notes** is the one category of user action in the reader. Page marks (today's
  bookmarks), highlights and notes are one place, not three features.
- A **page mark** is a position. A **highlight** is a quoted range. A **note** is text
  attached to a page mark or a highlight, 1–500 characters. A note is not a separate kind.
- Every item is personal and private by default. Items can be shared to a group read,
  one item at a time (§1.4).

### 1.2 Reader UI

- The contents popover (`TocPopover.tsx`) becomes **Contents · Notes**. The Bookmarks tab
  and the Group tab merge into Notes.
- Notes has a **Mine / Group** filter. The Group filter appears only when the book is
  linked to a group read.
- Notes lists items grouped by chapter (`AnnotationList`).
- Item actions: **Jump**, **Add note / Edit note**, **Share / Unshare**, **Remove**.
- The dock bookmark pod stays as one-tap **Mark this page**. It creates a page mark with
  no note.
- The Group tab's separate "add a note" form is removed.
- `NotesPanel.tsx` and `GroupNotesPanel.tsx` are retired.

### 1.3 Highlighting: native long-press selection

- Highlighting uses the native long-press selection. No mode, no toggle.
- While a selection exists, a **selection action bar** shows: **Highlight · Note · Copy ·
  Define**.
- The bar sits at the **top** of the reader, in the top bar's slot. It does not sit at the
  bottom. Reason: on Android Chrome the browser's own define/search panel covers the bottom
  of the screen (founder device test, 2026-10-17).
- The bar never covers the selected text.
- **Define** opens a Google define search for the selection. It is a plain link with
  `rel="noopener noreferrer"`. It is offered only for selections of 3 words or fewer and
  40 characters or fewer.
- One highlight colour: **copper**.
- Tapping an existing highlight shows its actions (Edit note, Share/Unshare, Remove). It
  does not turn the page.
- The bar is dismissed by: a tap on the page (the first tap only dismisses), ✕, Esc, a page
  turn, or the selection collapsing.

### 1.4 Sharing

- Sharing is **per item only**. Everything is private by default.
- A shared item appears in the group read as a mark, a note or a highlight. It is behind
  the existing spoiler gate (`visible_notes`, §4.2).
- **Highlights** share at most the **first 300 characters** of the quote. When the quote is
  truncated, the UI says so. A prefix and suffix of at most 32 characters each are shared
  for anchoring.
- **Plain page marks** may be shared.
- A note on any item may be shared with that item. Editing a shared note updates the group
  copy (§4.2).
- **Unshare** removes the group copy.
- **Deleting an item** removes its group copy too.
- **Leaving a group** removes all of your shared copies from that group. Your personal
  items stay.

### 1.5 Touch page-turning

- The full-height tap overlays in `SpreadFrame.tsx` blocked long-press on touch. This was
  the root cause of the 2026-10-02 failure.
- On touch, page turns move **inside the epub.js frame**: a tap in the left 35% goes back,
  a tap in the rest goes forward.
- A guard means a tap that clears a selection never turns the page.
- Device spike: branch `spike/touch-select`. Founder test on 2026-10-17: taps and long-press
  work. Bar placement is being re-tested. The spike is a reference only. Phase 3 rebuilds it
  with tests.

### 1.6 Offline

- **Personal items** are cached for offline listing. Changes made offline queue in the
  outbox and replay on reconnect.
- **Group items** load online only.
- **Sharing** needs a connection and a synced item. A local-only item cannot be shared
  until it has synced.

---

## 2. Guarantees

Extends `GROUPS_V1_BUILD.md` §1. L1, L3–L10 apply as written, with one amendment.

| # | Guarantee | How it is enforced | Checked by |
|---|---|---|---|
| N1 | **Flag.** Group items and the Group filter sit behind `GROUPS_ENABLED`. Personal Notes (marks, highlights, notes on your own books) are not behind the flag: they replace bookmarks for everyone when this version ships, and staging is the guard. Decided 2026-10-17. | `src/lib/groups/flag.ts` | Unit test; Levi; harness run with the flag off |
| N2 | **Amendment to L2.** `0012` alters existing objects: it adds `read_notes.annotation_id` and new `visible_notes` columns, and replaces the `visible_notes` function. Everything else is new. This is the only exception to L2 in v1, and it is recorded here so Levi can check against it. | Migration review | Levi |
| N3 | **Old tables are kept.** `bookmarks` and `highlights` are not dropped or changed. Rows are copied to `annotations` with the same ids. Rollback is lossless. | `0012` (copy, no delete); cleanup in Phase 4 | Levi; RLS tests |
| N4 | **Book files never cross users** (L3). | No task owns `storage.objects` or `src/lib/upload-client.ts` | Levi |
| N5 | **The reader hot path cannot fail because of notes** (L6). Note writes go through the outbox; errors are swallowed as position writes are. | Reader-hook task contract | Unit test: a throwing annotation write leaves reading and position saving untouched |
| N6 | **Existing tests are never edited** (L4). Mocks may be updated where a controller interface grows. A test is never edited to make it pass. | Brief rule; stop-and-report | Test delta in every report |
| N7 | **Account deletion works** with personal annotations and shared group copies (L8). | Cascade from `annotations`/`read_notes` to `auth.users`; `route.ts` updated | RLS integration test; deletion test |
| N8 | **Rollback is one switch** (L9). Each migration has a down script that is written and reviewed, and run only if needed. | `supabase/rollback/0012_annotations.down.sql` | Levi reviews the down script |
| N9 | **Backup before release** (L10). A fresh backup scoped to `bookmarks`, `highlights`, `read_notes` and the new `annotations` table, taken just before the migration is applied. | `scripts/db/backup.mjs` (S0) | Integrator; manifest row counts |

---

## 3. Outbox

- **New annotation kinds** in the `OutboxKind` union: create, update (note text), delete,
  share, unshare. Each has a payload type and a handler in `realHandlers()`.
- **Replay shims** for old queued `bookmark` and `highlight` entries. A queued entry from
  before the release replays as the matching annotation kind.
- **Coalescing:** an update to the same item coalesces on its id. The latest intent wins.
- **Lost-note gap, fixed:** a note added to an item that has not synced yet is currently
  lost. The note is queued with the item, and replayed after the item's create.
- `src/lib/offline/outbox.ts` is changed **additively only**. Existing outbox tests are not
  touched.

---

## 4. Schema contract (`0012_annotations`)

Tasks run in parallel against this contract. A task that needs to change it stops and
reports; it does not improvise.

### 4.1 Personal

```
annotations  id uuid pk, user_id → auth.users on delete cascade,
             book_id → books on delete cascade,
             kind text check in ('page','range'),
             cfi text not null,
             quote text null,            -- range only; ≤ 300 chars stored, see §4.3
             note text null,             -- 1–500 chars when present
             label text null,            -- chapter label at creation
             percent real null,
             created_at timestamptz, updated_at timestamptz
```

- **Copy from old tables:** `bookmarks` rows become `kind = 'page'`; `highlights` rows become
  `kind = 'range'`. Ids are kept, so queued and shared references still resolve. The copy
  is idempotent (`on conflict (id) do nothing`).
- **Re-copy at release:** a second idempotent copy step runs at release, for rows that
  production v1 writes between the first copy and the release.
- **RLS:** owner-only, as `bookmarks` and `highlights` are today. Cross-user denial test
  for every policy.
- **Note length:** `check (note is null or char_length(note) between 1 and 500)`.

### 4.2 Group share

```
read_notes     existing table (0010). Adds:
               annotation_id uuid null → annotations on delete cascade
```

- `read_notes` stays the share projection. A shared item is one `read_notes` row. The
  `annotation_id` link is the cascade: deleting the personal item removes the group copy.
- **Direct select stays owner-only.** Other members read only through `visible_notes`.
- **`visible_notes(read_id)`** gains the quote columns: `quote_exact`, `quote_prefix`,
  `quote_suffix`. It keeps the spoiler gate: a row is returned only if it sits at or behind
  the caller's own `read_progress`.
- **Sync trigger:** `after update on annotations`, `security definer`, `search_path = ''`.
  When a shared item's note changes, the matching `read_notes` row is updated. Editing a
  shared note updates the group.
- **Unshare** deletes the `read_notes` row. **Delete** of an item removes it through the
  cascade.

### 4.3 Length caps

- `quote_exact`: `check (char_length(quote_exact) <= 300)`. Truncation happens in the client
  before insert, and the UI says so when it truncates.
- `quote_prefix`, `quote_suffix`: each `check (char_length(...) <= 32)`.
- `note`: 1–500 characters (§4.1).

### 4.4 Row types

`src/lib/types.ts` is hand-maintained (`GROUPS_V1_BUILD.md` §3). Append only: the
`Annotation` row type, the `kind` union, and the amended `read_notes` and `visible_notes`
row types.

---

## 5. Tasks

Byte-sized, with one owner and a fixed set of files each. `→` means "depends on". Owners
follow the crew: senku (backend), sanji (frontend), levi (review), the integrator (runs
the integration tests and the full suite).

### Phase 0 — database

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **N0a** | senku | Migration `0012_annotations.sql` per §4, idempotent copy step, and the down script | `supabase/migrations/0012_annotations.sql`, `supabase/rollback/0012_annotations.down.sql`, `src/lib/types.ts` (append only) | Matches §4; additive except the N2 amendment; idempotency style matches `0005`; down script written |
| **N0b** | senku | RLS integration test file for annotations and `visible_notes` | `src/lib/db/annotations-rls.integration.test.ts` (new) | Covers each policy's allow and deny case; a member cannot read notes ahead of their position; a deleted item removes its group copy; a note edit updates the group copy. Written here; run by the integrator only |

→ N0b depends on N0a. Neither runs against a live project. The integrator runs both (§6).

### Phase 1 — data layer

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **N1a** | senku | Data client for annotations | `src/lib/db/annotations.ts` (new), `src/lib/db/annotations.test.ts` (new) | Create, update note, delete, list (by book), and copy-from-old checks tested with a mocked client |
| **N1b** | senku | Outbox kinds and replay shims | `src/lib/offline/outbox.ts` (additive only), `src/lib/offline/outbox-annotations.test.ts` (new) | New kinds complete (union, payload, handler); old `bookmark`/`highlight` entries replay; coalescing tested; the lost-note-on-unsynced-item case has a test that fails without the fix; existing outbox tests untouched and green |
| **N1c** | senku | Reader annotation manager, replacing the bookmarks and highlights managers | `src/reader/annotations.ts` (new), `src/reader/annotations.test.ts` (new) | Manager covers page marks and ranges; a throwing write leaves reading untouched (N5); `src/reader/bookmarks.ts` and `src/reader/highlights.ts` are removed in Phase 2 once no caller remains |
| **N1d** | senku | Share and unshare, with the 300-char truncation | `src/lib/db/read-notes.ts`, `src/lib/db/read-notes.test.ts` | Truncation to 300 and the prefix/suffix caps tested; unshare deletes the group copy; a shared note edit reaches the group |
| **N1e** | senku | Offline cache of personal items | `src/lib/db/annotations.ts` (cache functions only) and its test | Listing works offline from cache; group items are not cached |
| **N1f** | senku | Account deletion and privacy | `src/app/api/account/delete/route.ts` (only if a change is needed), `src/app/(chrome)/privacy/**` (text only) | Deletion covers the new table and group copies; `/privacy` says personal notes are private and shared items are visible to group members behind the spoiler gate |

→ N1a and N1b are independent. N1c and N1d depend on N1a. N1e depends on N1a and N1b.
N1f depends on N0a.

### Phase 2 — Notes UI

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **N2a** | sanji | `AnnotationList` row and list, grouped by chapter, with Mine / Group filter | `src/components/reader-ui/AnnotationList.tsx` (new) and its test | Filter hidden when the book has no group read; item actions Jump, Add/Edit note, Share/Unshare, Remove; tokens only; `DESIGN.md` read first |
| **N2b** | sanji | `TocPopover` becomes Contents · Notes | `src/components/reader-ui/TocPopover.tsx`, `TocPopover.group.test.tsx` (mocks only, if the interface grows) | Bookmarks and Group tabs merged; the tab `role` / `tabpanel` gap (BACKLOG) stays noted, not fixed here unless the tab markup is already changed |
| **N2c** | sanji | Wire into the reader | `src/components/reader-ui/ReaderShell.tsx`, `src/components/reader-ui/ReaderDock.tsx` | Dock pod creates a page mark with one tap; the Group tab's add-note form is removed; no change when the flag is off |
| **N2d** | sanji | Retire the old panels | `src/components/reader-ui/NotesPanel.tsx`, `GroupNotesPanel.tsx` and their tests (deleted, not edited) | No import of either remains; `src/reader/bookmarks.ts` and `src/reader/highlights.ts` removed once N1c has no caller |
| **N2e** | sanji | Group read page: `NotesList` reuses the row | `src/app/(chrome)/groups/[id]/reads/**`, `src/components/groups-ui/**` | Same row as `AnnotationList`; spoiler gate unchanged |

→ N2a before N2b, N2c and N2e. N2d last in the phase.

Deleting a test file is a change to the test set. The integrator reports it as a delta
and the founder is told before the phase is merged.

### Phase 3 — selection bar and touch page-turning

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **N3a** | sanji | Selection action bar at the top of the reader, in the top bar's slot | `src/components/reader-ui/SelectionBar.tsx` (new) and its test, `src/components/reader-ui/ReaderTopBar.tsx` (slot only) | Shows Highlight · Note · Copy · Define; never covers the selection; dismissal rules of §1.3 tested; Define only for ≤3 words / ≤40 chars; link has `rel="noopener noreferrer"` |
| **N3b** | senku | Selection plumbing in the reader | `src/reader/selection.ts` (new) and its test | Selection state and collapse events exposed as a plain interface; no imports from `components` |
| **N3c** | sanji | Touch page-turn inside the epub.js frame | `src/components/reader-ui/SpreadFrame.tsx`, `SpreadFrame.test.tsx` (mocks only, if needed) | Full-height overlays removed on touch; left 35% back, rest forward; a tap that clears a selection never turns the page; reduced-motion honoured |
| **N3d** | sanji | Re-plumb the tap handlers in the reader shell | `src/components/reader-ui/ReaderShell.tsx` (tap wiring only), `ReaderShell.test.tsx` (mocks only) | Existing tap tests keep passing; no test edited to pass |

→ N3a and N3c can run in parallel. N3b precedes N3a. N3d after N3c.

Phase 3 is rebuilt from `spike/touch-select`, not merged from it. The spike has no tests.

### Phase 4 — cleanup (later, separate migration)

| ID | Agent | Task | Owns | Done when |
|---|---|---|---|---|
| **N4** | senku | Migration `0013_drop_legacy_notes.sql` dropping `bookmarks` and `highlights`, with its down script | `supabase/migrations/0013_*`, `supabase/rollback/0013_*` | Run only after the release has been stable. Backup taken first (N9) |

Phase 4 is **not** part of this version. It is scheduled after release, when the rollback
window has closed.

---

## 6. Verification (integrator)

1. **Levi** reviews the integrated diff against N1–N9 and §4. Levi checks the N2 amendment
   against the migration text.
2. Backup taken before the migration is applied (N9). Migrations applied to the live project
   by the founder. The integrator runs `annotations-rls.integration.test.ts`
   and `groups-rls.integration.test.ts`. Denials are tested for every new policy.
3. Full suite and `npm run build` in the main checkout. Run once for the whole workstream.
4. Harness run with the flag off (no new requests, no visual change) and on. Demo mode check.
5. Founder device test on the staging link (`GROUPS_V1_BUILD.md` §2). Phone test covers:
   long-press on iOS and Android; bar placement; Define; touch page-turn; offline list; share
   and unshare.
6. Release: the second idempotent copy step (§4.1) runs just before the flag is turned on.
7. `docs/CHANGELOG.md` entry, and the presentation/logic coupling the redesign must know
   about (`CLAUDE.md`).

---

## 7. Test plan

| Layer | Covers |
|---|---|
| **jsdom (Tier 1)** | Data clients, outbox kinds and shims, truncation, length caps, manager logic, `AnnotationList` filter and actions, `SelectionBar` dismissal rules |
| **Real browser** | Selection bar placement against the text; touch page-turn guard; Define link; the epub.js iframe, which jsdom cannot test |
| **Device** | iOS Safari callout against the top bar; Android Chrome contextual panel; iOS home-screen app (Define); selection across a page boundary; tap regressions |
| **Integration (integrator)** | RLS on `annotations`, `read_notes`, `visible_notes`; cross-user denial; spoiler gate; cascade on delete and account deletion |

Regression tests must be shown to fail without their fix before they are kept.

---

## 8. Decision reversal

**Reverses `REVISED_PLAN.md` §4C and the 2026-08-31 trigger note in §7A** (highlight as an
explicit mode, off by default). Recorded in `REVISED_PLAN.md` on 2026-10-17.

- **Old decision (2026-08-31):** highlighting is a mode, off by default. A plain selection
  stays a plain selection.
- **New decision (2026-10-17, founder):** Highlight, Note, Copy and Define appear on any
  selection, through the selection bar in §1.3.
- **Reason:** the founder wants Highlight, Copy and Define on any selection. The mode adds a
  step the founder does not want.

---

## 9. Risks

1. **iOS callout vs the top bar.** The native callout may draw over the bar or the bar may
   cover the callout. Tested on a real iPhone (§7).
2. **Android contextual panel.** Chrome's define/search panel may still overlap the top bar.
   The bar is placed at the top for this reason; re-tested on a device.
3. **Define from the iOS home-screen app.** The define link may open outside the app. Not
   verified; tested on a device.
4. **Selection across page boundaries.** A selection that crosses a page turn must still
   anchor and share correctly. Covered by the quote anchor (§4.2). Tested on a device.
5. **Tap re-plumb regressions.** Moving tap handling into the epub.js frame can break page
   turns or existing tap tests. Existing tests are kept; mocks are updated only where the
   interface grows (N6).
6. **Guarantee N2.** `0012` alters existing objects. This is a documented exception to L2.
   Levi checks it against the migration text.
7. **Outbox replay.** Old queued `bookmark` and `highlight` entries must replay after the
   release. The shims are tested with recorded queue entries.

---

## 10. Guardrails for every subagent brief

Every brief in this workstream includes `GROUPS_V1_BUILD.md` §5, verbatim or tighter, plus:

- **Notes UI** uses tokens only. No hard-coded colours, spacing or fonts. `DESIGN.md` is read
  before any visual work.
- **`src/reader/*` and `src/lib/*`** never import from `design` or `components`. The
  selection plumbing (N3b) exposes plain state only.
- **Copy:** minimal and plain, as in `GROUPS_V1_BUILD.md` §5.
- **No persona, no marketing wording** in code, comments, docs or commit text.
- **Commits:** one subject line, Conventional Commits, trailer exactly `Co-Authored-By: Claude`.
  No body paragraphs unless asked.

---

## 11. Open

- Define link URL form (the exact Google define search URL) is not fixed here. Set in N3a
  and checked on a device.
- Decided 2026-10-17: personal Notes are not behind `GROUPS_ENABLED` (N1). In demo mode,
  Notes behave as bookmarks do today.
- `FEATURES_PLAN.md` §5.5 and §5.7 still say highlights are a v2 item for groups. This file
  supersedes them for highlights. Those sections are not edited here (scope).
