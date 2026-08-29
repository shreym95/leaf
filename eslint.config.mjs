import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // --- Swappable-UI seam (SPEC §3.1 / §4) ---------------------------------
  // The logic layers stay style-agnostic: no imports from the design tokens
  // or the presentational components. A future UI overhaul then touches
  // src/design + src/components only. Enforced with core `no-restricted-imports`
  // so there is no plugin to keep in sync.
  {
    files: [
      "src/reader/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "src/store/**/*.{ts,tsx}",
      "src/normalizer/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/design", "@/design/*", "**/design/**"],
              message:
                "Logic layer must stay style-agnostic (SPEC §3.1): no import from the design layer.",
            },
            {
              group: ["@/components", "@/components/*", "**/components/**"],
              message:
                "Logic layer must stay style-agnostic (SPEC §3.1): no import from the components layer.",
            },
          ],
        },
      ],
    },
  },

  // `src/reader/content-hook.ts` is the ONE sanctioned bridge from the reader
  // logic layer to the design layer: it needs `buildContentTheme` (a plain
  // selector -> declaration map — data, not presentation code) to feed epub.js
  // `rendition.themes`. The components ban still applies.
  {
    files: ["src/reader/content-hook.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components", "@/components/*", "**/components/**"],
              message:
                "Logic layer must stay style-agnostic (SPEC §3.1): no import from the components layer.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
