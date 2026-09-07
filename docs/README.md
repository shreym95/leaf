# Leaf — documentation

Everything that explains the project, in one place. Start with whichever row matches
what you are about to do.

| Doc | Read it when |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | **Changing how Leaf looks.** Design language, tokens, the three themes, type/spacing/motion scales, the a11y floor, how to add a theme. Start here for any visual work. |
| [`SPEC.md`](./SPEC.md) | You need the full build spec — scope, stack, data model, architecture, the original milestones. Historical brief, kept as written. |
| [`REVISED_PLAN.md`](./REVISED_PLAN.md) | Planning the next feature. The UI/UX roadmap: §2 theme architecture, §4 reader experience, §6 phasing, §7 how it lines up with the shipped code. |
| [`BACKLOG.md`](./BACKLOG.md) | Looking for known open work and deferred decisions. |
| [`DEPLOY.md`](./DEPLOY.md) | Shipping, or applying a database migration. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Asking "why is it like this?" — every deviation from the approved v0.1 prototype is recorded with its reason. Search here before re-litigating a decision. |

Three files deliberately stay at the repo root:

- [`../README.md`](../README.md) — GitHub renders it as the landing page.
- [`../LICENSE`](../LICENSE) — GitHub only detects a licence at the root.
- [`../CLAUDE.md`](../CLAUDE.md) — Claude Code auto-loads the root copy; in a
  subdirectory it would load only while working inside that subdirectory.

Component-level docs live next to what they document — e.g.
[`../supabase/README.md`](../supabase/README.md) for the migration workflow.
