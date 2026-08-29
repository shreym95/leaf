# Deploy — Vercel

Leaf deploys to Vercel (frontend + serverless API). Supabase stays as-is.

## First deploy (CLI)

From the repo root:

```bash
npx vercel login          # opens a browser; pick your login
npx vercel                 # links the project — accept the defaults:
                           #   set up and deploy: yes
                           #   scope: your account
                           #   link to existing project: no
                           #   project name: leaf
                           #   directory: ./
                           #   auto-detected settings (Next.js): yes
npx vercel --prod          # promote to production → prints the live URL
```

## Environment variables

Add the three Supabase vars to the Vercel project — dashboard
(**Project → Settings → Environment Variables**) or CLI:

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

Paste each value from `.env.local`. Then redeploy: `npx vercel --prod`.
(Repeat with `preview` + `development` targets if you want preview deploys to work too.)

## Auth wiring (once you have the `*.vercel.app` URL)

- **Supabase → Authentication → URL Configuration**
  - Site URL: `https://<your-app>.vercel.app`
  - Redirect URLs → add: `https://<your-app>.vercel.app/**`
- **Google Cloud → APIs & Services → Credentials → your OAuth client**
  - Authorized JavaScript origins → add: `https://<your-app>.vercel.app`
  - (redirect URI stays the `https://<ref>.supabase.co/auth/v1/callback` one — unchanged)

## Notes

- `next.config.ts` `allowedDevOrigins` is dev-only — no effect on the deploy.
- Serverless function limits (Hobby): `/api/import` downloads the EPUB server-side.
  Standard Ebooks (~0.7 MB) is fine; large Gutenberg "images" editions (~24 MB) may
  hit the function timeout — revisit in M4 (stream, or bump the plan).
- Custom domain + the auth-screen domain fix are M4.
