# Leaf — next feature set: research and architecture plan

_Drafted 2026-10-02; social track rewritten 2026-10-11. Status: **proposal, awaiting
founder decisions (§8)**. Nothing here is built or scheduled until those are answered._

**Decided 2026-10-11 (founder):** the social layer is **reading groups, not a friend
network**. Every member **brings their own copy** of the book. Book files are never shared
between users; only progress, notes, highlights and the like are shared (§5).

**Decided 2026-10-11 (founder):**
- Groups are capped at **2–5 members** for now, to be raised later.
- Members without a copy may join and set progress by hand.
- Shared highlight quotes are capped at **300 characters**.
- The **AI track (features 1, 2, 3, 5) is deferred to the backlog** (`BACKLOG.md`),
  together with its decisions D1–D3.
- **Groups are built first.**

Nine founder ideas, grouped into three tracks:

| # | Feature | Track | Verdict |
|---|---|---|---|
| 1 | Summary up to the current page | AI | Build. Spoiler-safe by construction (§3.2). |
| 2 | Full-book summary without spoilers | AI | Build, reframed as a premise from the opening (§3.3). |
| 3 | Context-aware word meanings | AI | Build. Dictionary first, model only picks the sense (§3.4). |
| 4 | Book recommendations | Personal | Build v1 from catalog data, no AI needed (§4.2). |
| 5 | Character "who's who" | AI | Build. Shares the chapter pass with #1 (§3.2). |
| 6 | Reviews and ratings | Personal + Groups | Build. Private by default, shareable to a group read and out to other apps (§4.1). |
| 7 | Friends' progress, group reads, group bookmarks | Groups | Build as reading groups, bring your own copy (§5). |
| 8 | Group reading-speed comparison | Groups | Reshaped: personal and group milestones, with arrival order and no speed stats (§5.8). |
| 9 | Friends' highlights in the same book | Groups | Page notes in groups v1; highlights after the highlight redesign (§5.7). |

---

## 1. What these features change about Leaf

Four existing rules move. Each is a deliberate decision, not drift:

1. **"NO AI features this version"** (`CLAUDE.md`, `SPEC.md` §1). Features 1, 2, 3 and 5
   need a hosted model. That ends the $0 running cost and needs a budget (§8 D1).
   **Deferred 2026-10-11:** the AI track is in the backlog, so this rule stays as written
   for now.
2. **Owner-only RLS on every table.** Features 7–9 make some rows readable by
   other members of a group for the first time. RLS stays the guard. Group tables check
   membership, and every one needs a cross-user denial test, as today. **Storage policies
   do not change:** book files stay owner-only (§5.2).
3. **"Social features" are out of scope** in `SPEC.md` §1. Lifting that is a product call.
4. **Tenet 1, "a lean-back sanctuary, not a productivity tool"** (`REVISED_PLAN.md` §1).
   This rule stays, applied lightly: milestones show who got somewhere first, never how
   fast anyone reads (§5.8).

With AI deferred, only rule 3 needs amending before groups are built: the social line
in `SPEC.md` §1 and its echo in `CLAUDE.md`. Until then, agents will correctly refuse to
build social features.

---

## 2. Foundation: knowing two copies are the same book

Today every user has a private `books` row and a private EPUB at
`${userId}/${bookId}.epub`. Nothing says two rows are the same book. Shared AI caches
(1, 2, 5) and recommendations (4) need that link. Reading groups do **not** depend on it.
A group read carries its own chapter outline and aligns each member's copy to it (§5.4).
The edition hash is only their fast path.

### 2.1 Two levels of identity

- **Work**: "Frankenstein", whatever the file. Enough for progress percent, "finished
  together", recommendations and reviews.
- **Edition**: one exact file, identified by the **SHA-256 of the EPUB bytes**. CFIs
  only line up within one edition. Bookmarks and highlights shared between friends, and
  every cached chapter summary, are keyed by edition.

A CFI is a path of element indexes, so inserting one element earlier in a chapter shifts
every CFI after it. Standard Ebooks revises its editions over time. Treat cross-edition
CFIs as **broken by default**, not "usually fine". The second research brief overstated
their robustness. Shared anchors therefore carry a text quote as well (§5.5).

### 2.2 Schema (migration number assigned when phase 4 starts; groups take `0008`–`0010`)

```
works     (id, title, author, source, source_ref, created_at)
          unique (source, source_ref)           -- uploads get no work row by default
editions  (id, work_id null, content_sha256 unique, spine_count, word_count, created_at)
books     + work_id null, + edition_id null     -- backfilled
```

- `works` and `editions` hold no personal data. They are readable by any signed-in user
  and writable only by the service role (import / ingest Route Handlers).
- **Uploads:** the hash is computed and an `editions` row written, but no `work_id` is
  set. The hash is never exposed to other users. A group read compares hashes only
  server-side, to choose exact anchoring (§5.4).
- **Backfill:** a one-off server script reads each stored EPUB, hashes it and fills
  `edition_id`. Migrations are still applied by hand (`docs/DEPLOY.md`), so the
  script ships as a separate step.

### 2.3 Text by position (server side)

Recap, who's-who and word meanings need "the text up to here". `jszip` and
`fast-xml-parser` are already dependencies (used by `src/lib/epub/*`).

- New `src/lib/epub/text.ts`: unzip, walk the spine, strip markup to plain text per
  spine item, and return `{ spineIndex, href, tocLabel, text, wordCount }[]`. Pure,
  unit-testable against the fixtures in `src/normalizer/fixtures/`.
- The client sends **`spineIndex` plus a fraction through that item**, both already
  known to the engine. This is coarser than a CFI but never wrong, and it needs no
  server-side DOM. A recap is bounded to "chapters before this one + this chapter up to
  roughly here".

---

## 3. AI track (features 1, 2, 3, 5)

### 3.1 Prior art (research, 2026-10-02)

| Product | What it does | Lesson |
|---|---|---|
| Kindle Recaps (2025) | AI recap of earlier books in a series | Accuracy and spoiler complaints exist; recaps need a hard text bound. |
| Kindle X-Ray | Characters, places and terms, press-and-hold on a name | The who's-who reference design; built per book by Amazon. |
| Kindle Word Wise | Inline simple glosses over hard words | Ambient, not on-demand; too busy for Leaf's page. |
| Readwise Ghostreader | Chat and define over your text, cheap model by default | Shows the "selection → ask" pattern; it is a study tool. |
| Apple Books (iOS 27) | On-demand summaries in the Accessibility Reader | Platform vendors now ship this; table stakes is coming. |

**The specific risk for Leaf:** public-domain classics are heavily represented in model
training data. A model asked about _Frankenstein_ can "remember" the ending even when it
is only shown chapters 1–5. Prompting alone does not reliably stop this. The defence is
structural: the model is never asked about the book. It is only asked to summarise the
text it is given, and that text never extends past the reader's position.

### 3.2 Features 1 and 5: one chapter pass, two features

The core design choice: **one model call per chapter per edition** produces both:

```
chapter_notes (edition_id, spine_index, summary text, characters jsonb, model, created_at)
               primary key (edition_id, spine_index)
```

`characters` = `[{ name, aliases[], note }]`, where `note` describes the character **from
that chapter's text only**.

- **Recap so far (1)** = the stored summaries for chapters `0..k-1`, condensed in one
  call, plus a short summary of the current chapter up to the reader's fraction. The
  current-chapter part is per-reader and not cached. Everything earlier is shared.
- **Who's who (5)** = the union of `characters` for chapters `0..k`, merged by name and
  alias, with each note built only from chapters already read. No later chapter is ever
  read, so it cannot spoil, whatever the model "knows".
- **Lazy, not batch:** a chapter is processed the first time any reader needs it, then
  cached for everyone on that edition. No upfront batch over 500 titles, and no cost
  for books nobody opens.
- **Public-domain editions** cache globally (`chapter_notes` is readable by any user whose
  `books.edition_id` matches). **Uploads** cache per edition too, but only the owner can
  read them, and they run only if AI is allowed for uploads (§8 D2).

**Rough cost**, stated assumptions, prices to be re-checked at build time: a 100k-word
novel is about 135k input tokens over about 30 chapters, with about 300 output tokens per
chapter (9k total). On a cheap-tier model at about $1 / $5 per million tokens, the full
pass costs about **$0.18 per edition, paid once** for public-domain books, whoever reads
them. A recap call on top is a few thousand tokens, about $0.01. Cheaper tiers cut this
several-fold.

**Latency:** Vercel functions run up to **300 s on Hobby** (Fluid compute, streaming
included; `vercel.com/docs/functions/limitations`, updated 2026-08-24). A cold recap deep
into a book may need many chapter calls. They run in parallel, the response streams, and
the UI says "Reading back through the book…". The 10 s figure in older sources is out
of date.

### 3.3 Feature 2: "what is this book about", without spoilers

Reframed: a summary of the **whole** book cannot be spoiler-free if it is built from the
whole text, and it leaks from model memory if it is not. So:

1. **Standard Ebooks** publishes an editor-written long description for its books. It is
   human-written, so no model is needed. Store it at import. Not yet verified:
   whether the feed `src/lib/import/standard-ebooks.ts` reads carries it (the importer
   parses no description today). Check before building.
2. For **Gutenberg and uploads**, generate a "premise" from **the opening chapters only**
   (about the first 10%, reusing `chapter_notes`): who, where, what sets things moving.
   Bounded text means no late-book spoilers by construction.

Shown on the book's detail or end-of-shelf sheet, and offered before you start reading.

### 3.4 Feature 3: meaning in context

**Lookup:** Wiktionary-derived data (Wiktextract or the Free Dictionary API) is free and
covers most of the vocabulary. Webster's 1913 covers archaic senses ("the _closet_" in
Austen is a private room), and it is public domain. **Sense picking** is the only model
step: send the sentence and the numbered dictionary senses, and get back the number of
the sense that fits, with a one-line gloss. The model chooses between real definitions
instead of inventing one. That bounds hallucination, and the call is about 300 tokens.

**Trigger: this is the hard part.** `REVISED_PLAN.md` §4C says a plain selection stays a
plain selection: copy and the OS "Look Up" must keep working. Options (§8 D3):

- **(a) Passive chip:** when the selection is a single word, a small "Meaning" chip appears
  in the dock. It does nothing until tapped and never replaces the native callout.
- **(b) Lookup mode:** a dock control, like highlight mode. Off by default, so nothing
  changes for readers who never use it.

Recommendation: **(a)**. Defining a word is a one-off act, and a mode is heavy for it.
The chip must be tested on a real iPhone: iOS draws its callout over the selection, and
the chip must not collide with it.

### 3.5 Shared AI infrastructure

- **`src/lib/ai/`:** a provider interface (`summarise`, `pickSense`). One provider
  implementation, chosen at build time by a **10-book spoiler and quality evaluation**
  (feed chapters 1–k, check the output for facts from chapter > k). Style-agnostic,
  server-only. The key lives in Vercel env vars, never `NEXT_PUBLIC_*`. The repo is public.
- **Route Handlers:** `/api/ai/recap`, `/api/ai/characters`, `/api/ai/premise`,
  `/api/ai/define`. Each verifies the session, checks the caller owns the `books` row,
  and resolves `edition_id` server-side. The client never names an edition.
- **Cost control:** an `ai_usage (user_id, feature, day, count)` table, owner-readable,
  service-role write. A per-user daily quota is checked before any model call. A hard
  monthly spend limit is set **at the provider**, which is the only cap that cannot
  have a bug in our code.
- **Offline:** AI features need the network. Cached `chapter_notes` for the open book
  can be written to IndexedDB with the book, so who's-who works offline up to the last
  synced chapter. This is a nice-to-have, not v1.
- **Privacy:** `/privacy` must name the provider, say what is sent (book text, for
  uploads only with consent) and state the provider's retention terms. Never log
  prompts or outputs alongside user IDs.

---

## 4. Reviews and recommendations (features 6, 4)

### 4.1 Feature 6: reviews and ratings

**Decided 2026-10-11 (founder):** ratings are in. Their purpose is **comparison inside a
group** and **sharing out** to other apps, not only a private journal.

StoryGraph, Bookmory and Oku all ship a review or journal entry after you finish a book.
Leaf has the hook already: finished-book detection and the end-of-book panel shipped
2026-10-02.

```
reviews (id, book_id, user_id, rating smallint null check (rating between 1 and 5),
         body text null, read_id null,              -- set when written for a group read
         visibility 'private'|'group' default 'private', created_at, updated_at)
        unique (book_id, user_id)
```

- **Rating:** 1–5 whole stars, optional. A rating alone, with no text, is a valid review.
- **Entry points:** "Rate and review" on `EndOfBookPanel` and on each `CompletedBooks` row.
  Prompts ("What will you remember?") are placeholder text only, never required.
- **My reviews:** finished books with your rating and words, newest first.
- **In a group read:** a review written for that read can be shared with the group
  (`visibility = 'group'`). Members read group reviews only through
  `group_reviews(read_id)`, which returns them **only to members who have finished the
  book themselves**. A review is a spoiler, and not seeing others' ratings first keeps
  your own unbiased. Once you have finished, a comparison card shows everyone's rating
  side by side, plus the group average.
- **Sharing out:**
  - v1 uses the Web Share API (the native share sheet on phones; copy to clipboard on
    desktop). The text is: book, author, stars, your review, and an import link to the
    book in Leaf for catalog titles. It needs no public page and no new server surface.
  - v2 option: an image card (cover + stars + a pull quote) for Instagram-style sharing.
- **RLS:** direct select stays owner-only. The group path is the security-definer
  function above, using `is_member` (§5.3) plus the caller's own `finished_at`. Denial
  tests cover a non-member, and a member who has not yet finished.
- **Solo reads** (no group) are private, with share-out only. Showing them to all your
  groups needs §2 work identity to match "the same book". That is v2.
- Offline: writes go through the existing outbox, as a new kind, like `book-status`.

### 4.2 Feature 4: recommendations

Collaborative filtering ("readers who finished X also read Y") needs a user base Leaf
does not have. Pure model-generated lists recommend books that may not exist or cannot
be imported. So, in three stages:

1. **v1, catalog only, no AI:** from the user's finished and in-progress works, pull
   subjects from Standard Ebooks (subjects and collections) and Gutendex (subjects,
   bookshelves, download counts). Rank unread titles by subject overlap, then
   popularity. **Only recommend books Leaf can import**, with one-tap import.
2. **v2, model re-rank:** give the model the finished list, review text if consented, and
   **a candidate list from step 1**. It orders and explains ("because you liked the
   moors in _Wuthering Heights_"). It never generates titles.
3. **v3, social:** "Finished by 2 friends", once §5 exists.

Shown as a quiet shelf row ("Next, perhaps"), not a feed.

---

## 5. Reading groups (features 7, 8, 9): bring your own copy

### 5.1 Prior art and the model chosen

| Product | Social unit | Spoiler handling |
|---|---|---|
| StoryGraph readalongs / buddy reads | A read with invited people | Comments locked until you reach that point |
| Fable | Clubs | Chapter-separated discussion, shared highlights |
| Apple Fitness sharing | Mutual invite, small circle | n/a (model for consent and leaving) |
| Kindle Popular Highlights | Everyone, aggregated | None |

**Chosen (founder, 2026-10-11):** the **group is the network**. There is no friend graph,
no follow model and no public profile. Someone creates a group, invites people by link,
and the group reads books together. This solves the cold-start problem: a group only
exists when people chose to read together.

### 5.2 The invariant: files never cross users

- Every member reads **their own copy**: a catalog import or their own upload. Uploads
  already go from the client straight to the uploader's private Storage path
  (`src/lib/upload-client.ts`). Nothing in that path changes.
- **Storage policies stay owner-only.** No group table stores a storage path or a
  `books.id` that another member can read.
- **What crosses users:** group membership and display names, the group read's chapter
  **outline** (chapter labels only, no text), progress positions, milestones, notes and
  marks, and, for highlights, a **length-capped quote** (§5.5).
- This is why the approach is legally clean. It is the book-club model: everyone owns
  the book, and the club shares the conversation.

**Joining, by book type:**

- **Catalog book (Standard Ebooks / Gutenberg):** accepting the invite imports the book into
  the new member's own library automatically. Friction: accept and sign up, nothing else.
- **Uploaded book:** the new member sees the group read with an **"Add your copy"** step.
  Until they add it, they still see the group, the schedule and everyone's progress, and
  can set their own progress by tapping a chapter in the outline (decided, D6). Uploading
  later switches them to automatic progress.

### 5.3 Schema (`0008_groups_core`, `0009_group_reads`, `0010_read_notes`; build detail in `GROUPS_V1_BUILD.md`)

```
groups         (id, name, created_at)      -- owner = the group_members row with role 'owner'
group_members  (group_id, user_id, role 'owner'|'member', joined_at)   -- cap: 5 members, by trigger
group_invites  (token, group_id, created_by, expires_at, max_uses, uses)
group_reads    (id, group_id, title, author, source, source_ref null,
                outline jsonb,            -- [{ index, label }] from the creator's copy, labels only
                schedule jsonb null,      -- optional checkpoints: [{ chapter_index, due_on }]
                created_by, created_at)
read_copies    (read_id, user_id, book_id, content_sha256, alignment jsonb)
                -- private to the owner; links a member's own book to the read
read_progress  (read_id, user_id, chapter_index, chapter_fraction, percent,
                finished_at null, manual bool, updated_at)
read_notes     (id, read_id, user_id, chapter_index, chapter_fraction, kind 'mark'|'note'|'highlight',
                note text null, quote_exact null, quote_prefix null, quote_suffix null,
                cfi null, content_sha256 null, created_at)
read_milestones (read_id, user_id, point, reached_at)   -- append-only, trigger-written (§5.8)
```

**RLS:**

- `is_member(group_id)`: one `security definer` function with a fixed `search_path`. It
  is the only cross-user check in the system.
- `read_copies`: owner-only, as `books` is today.
- `read_progress`: members may select; a member may write only their own row.
- `read_notes`: **direct select is owner-only.** Other members read notes only through
  `visible_notes(read_id)`, which returns a note only if it sits at or behind the
  caller's own `read_progress`. The spoiler gate is enforced in the database, not in
  the UI, and cannot be bypassed by a raw query.
- Invite acceptance runs through a Route Handler. It checks token, expiry, uses and
  the size cap, then inserts membership with the service role.
- Every table gets cross-user denial tests: a non-member sees nothing, and a member
  cannot read notes ahead of their own position.

### 5.4 Lining up different copies: the main engineering risk

Two members' files may differ: different stores, a revised edition, UK and US texts, or
even a different translation. Positions are therefore shared in **outline coordinates**,
`(chapter_index, chapter_fraction)`, never as raw CFIs.

- **Alignment** (client-side, when a copy is linked): match the copy's table of contents
  to the read's outline by normalised label and order. Normalising lowercases, strips
  "Chapter", and maps Roman numerals to Arabic ones. The result is stored in
  `read_copies.alignment`. **Identical `content_sha256`:** identity alignment, exact
  CFIs. **Low-confidence match:** ask the member once ("Is this where Chapter 1 starts
  in your copy?"), else fall back to whole-book percent.
- **Progress:** the reader's existing position flush (`src/reader/position.ts`) also
  writes `read_progress` through the outbox, as a new kind. The engine already knows
  the spine index and the fraction. It needs no new server text processing.
- **Anchoring a shared note or highlight in your copy:**
  - Same hash: use the CFI.
  - Otherwise: search for `quote_exact` (with prefix and suffix) inside the aligned
    chapter. This is the W3C TextQuoteSelector approach Hypothesis uses, and it runs
    client-side, in the reader's own copy.
  - If no match: show it in that chapter's notes list instead of inline. **Never
    misplace a note.** A different translation always ends up here, and that is fine.
- **Edge cases to test:** a copy with front matter split differently, a book with no
  TOC, Parts plus Chapters nesting, and a member who re-uploads a different file
  mid-read. On re-upload, re-align and keep progress by outline coordinates.

### 5.5 The only text that crosses users

Highlight quotes. Short excerpts shared among people who own the book, for commentary,
are low-risk. A highlight with no length limit would turn into a channel for sharing the
text. So:

- `quote_exact` is capped server-side (CHECK constraint), **300 characters**
  (decided, D7). Prefix and suffix are capped at 32 characters each.
- Marks and notes need no quote: a page mark is a position plus the member's own words.

### 5.6 Leaving, removal, deletion

- Members can leave at any time. **Their progress and notes are deleted on leave**
  (privacy-first, no "former member" ghosts).
- The owner can remove members and revoke invites. If the owner leaves, ownership passes
  to the longest-standing member. When the last member leaves, the group is deleted.
- Account deletion (existing cleanup path) cascades through all group tables.
- **Live updates are not needed.** Group state is fetched on open and on focus, and
  cached with the book for offline reading. Supabase Realtime stays unused. A reader's
  page never moves because of someone else.

### 5.7 How the original features map onto groups

| Original idea | Groups v1 | Groups v2 |
|---|---|---|
| 7 Friends' progress | Members' markers on your progress track; a "where everyone is" outline view | — |
| 7 Group read | Group read with an optional chapter schedule ("Chapters 1–5 by Friday") | Several reads per group over time; challenges such as "3 books by December" |
| 7 Group bookmarks | `read_notes` of kind `mark` or `note`: a position plus your words, created like a bookmark, **no selection UI needed** | — |
| 8 Speed comparison | **Personal and group milestones** (§5.8) | — |
| 9 Friends' highlights | — | `kind = 'highlight'` with a capped quote, once the highlight redesign lands. Make that redesign store quote anchors from day one |
| Meetup discussion | — | Per-chapter threads, unlocked when you reach the chapter |

**Group reviews and ratings** (§4.1) live inside a group read: they are revealed to
each member when they finish, with a side-by-side comparison card.

Page marks and notes do not need the highlight redesign. This lets groups v1 ship
something shared inside the text without waiting for it.

### 5.8 Milestones: personal and group (feature 8, reshaped)

**Decided 2026-10-11 (founder):** milestones are both **personal** and **group**. They
add a light sense of competition and a shared sense of achievement when everyone
gets there.

- **Milestone points**, from the read's outline: each Part (if the book has Parts), the
  halfway mark, and the end. Scheduled checkpoints (§5.7) count too.
- **Personal milestone:** you reached it. It shows in the group as "Shrey reached Part
  Two", with the date.
- **Arrival order, the light competition:** "First to Part Two: Priya". The order is
  shown, never the time gaps, pages per hour or words per minute. Who got there first is
  friendly; how fast someone reads is not anyone's business.
- **Group milestone:** "Everyone reached Part Two". This is the moment of achievement,
  shown to the whole group.
- **Spoiler-safe:** milestone names come from the outline labels. A member who has not
  reached a Part sees "Someone reached Part Three", without the label, if the label
  could spoil (Parts named after events). Simplest rule: unreached labels are masked.
- **Storage:** derived from `read_progress` crossing outline points. Arrival is recorded
  once in `read_milestones (read_id, user_id, point, reached_at)`, written by a
  **database trigger** on `read_progress`, never by the client. The trigger compares the
  new position against the outline's milestone points. The table is append-only, so a
  later "Mark as unread" or going back a chapter never reorders who arrived first.
- **Manual progress** (members without a copy, D6) counts the same way.

---

## 6. Build order

| Phase | Contents | Depends on | Size |
|---|---|---|---|
Order decided 2026-10-11: **groups first**.

| Phase | Contents | Depends on | Size |
|---|---|---|---|
| **1** | Amend the social scope line in `SPEC.md` / `CLAUDE.md` | founder sign-off | XS |
| **2** | Groups v1: groups, invites, group reads, copy alignment, progress, page marks and notes, schedule, milestones (§5) | 1 | L |
| **3** | Reviews and ratings (6): private + share-out first; group reviews and the comparison card once 2 lands | private part: none; group part: 2 | S–M |
| **4** | §2 works and editions plus backfill; recommendations v1 (4) | — | M |
| **5** | Groups v2: shared highlights, per-chapter threads, challenges | highlight redesign, 2 | M–L |
| Backlog | AI: infrastructure (§3.5), recap (1), who's-who (5), premise (2), word meanings (3) | D1–D3, 4 | L |

Groups do not need §2: they carry their own outline (§5.4). Each phase is one
workstream: Tier 1 tests per agent, then one full suite run at the end of each phase
(`docs/TESTING.md`). Every new cross-user policy gets a denial test. If the AI track is
revived, its evals (§3.5) are a release gate.

## 7. Risks

1. **Model memory spoils classics.** Mitigated structurally (bounded text) and checked
   by the eval. It cannot be proven to zero, so keep a visible "recap covers up to
   Ch. k" label.
2. **Runaway AI spend on a public app.** Provider-side hard cap, per-user quota, and
   authenticated routes only.
3. **First cross-user data in the database.** One function (`is_member`), one policy
   shape, and denial tests for every table. A mistake here leaks reading history.
4. **Different copies in one group.** Alignment by outline plus quote anchoring
   (§5.4). The worst case (different translation, no TOC) degrades to percent progress
   and a per-chapter notes list. It must never misplace a note.
5. **Hand-applied migrations.** This plan adds 3–4 more (0008+). Wiring the Supabase CLI
   (`BACKLOG.md`) gets more valuable with each one.

## 8. Decisions

**Decided 2026-10-11**
- D4: milestones are both personal and group, with arrival order as the light
  competition, and no speed statistics (§5.8).
- D5: group size cap 2–5 members, to be raised later.
- D6: members without a copy may join and set progress by hand.
- D7: highlight quote cap 300 characters.
- D8: groups first.
- D9: ratings included (1–5 stars, optional). Reviews can be shared to a group read
  (revealed on finishing) and out via the share sheet (§4.1).

**Deferred with the AI track (backlog)**
- D1: AI budget.
- D2: AI on uploaded books.
- D3: word-lookup trigger.
