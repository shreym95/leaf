# Deploy — Vercel

Leaf deploys to Vercel (frontend + serverless API). Supabase stays as-is.

**Live:** https://leaf-black.vercel.app  ·  project `leaf` (scope `leaf23`)
**Repo:** https://github.com/shreym95/leaf (private)

## Deploying

The Vercel project is connected to the GitHub repo, so deploys are automatic:

| Push to | Result |
|---|---|
| `dev` (default + production branch) | production deploy → https://leaf-black.vercel.app |
| any other branch, or a PR | preview deploy (its own URL) |

```bash
git push origin dev      # ← this is the deploy
```

Env vars are set on the Vercel project for Production / Preview / Development and
apply to git-triggered deploys automatically.

`npx vercel --prod` still works for a manual deploy from the working tree
(useful for testing uncommitted changes).

## Environment variables

Three Supabase vars, set on the Vercel project for all three environments
(**Project → Settings → Environment Variables**):

| var | scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server (RLS protects every table) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** — bypasses RLS |

## Auth wiring (already done for the current URL)

- **Supabase → Authentication → URL Configuration**
  - Site URL: `https://leaf-black.vercel.app`
  - Redirect URLs: `https://leaf-black.vercel.app/**`
- **Google Cloud → APIs & Services → Credentials → the `leaf-web` OAuth client**
  - Authorized JavaScript origins: `https://leaf-black.vercel.app`
  - Authorized redirect URI: `https://<supabase-ref>.supabase.co/auth/v1/callback`

Preview deploys get their own URLs, so Google sign-in only works on the
production alias unless you add the preview origin too.

## Notes

- `next.config.ts` `allowedDevOrigins` is dev-only — no effect on the deploy.
- Serverless function limits (Hobby): `/api/import` downloads the EPUB server-side.
  Standard Ebooks (~0.7 MB) is fine; large Gutenberg "images" editions (~24 MB) may
  hit the function timeout — revisit in M4 (stream, or bump the plan).
- Custom domain + the auth-screen domain fix are M4.
