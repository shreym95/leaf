import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Treat the test run as a configured (non-demo) environment by default, so
    // the db / auth / storage helpers exercise their real (mocked) Supabase
    // path. `IS_DEMO` otherwise defaults on when no Supabase env is present (a
    // fresh clone) — see `src/lib/demo/flag.ts`. Demo-mode tests opt in with
    // `LEAF_DEMO`. Real keys in `.env.local` still win (dotenv, loaded below,
    // does not override values already set).
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
    // env loader first (populates process.env from .env.local), then jsdom setup.
    setupFiles: ["./vitest.setup.env.ts", "./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
