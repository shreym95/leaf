// Groups feature flag (GROUPS_V1_BUILD.md L1, L5). With the flag off Leaf behaves
// exactly as before: no group UI, routes or network calls.
//
// `process.env.NEXT_PUBLIC_LEAF_GROUPS` is read as a literal so Next inlines it into
// the client bundle. Only the exact string "1" turns groups on. Demo mode always
// wins: groups never run against fixtures.
import { IS_DEMO } from "@/lib/demo/flag";

export const GROUPS_ENABLED: boolean =
  !IS_DEMO && process.env.NEXT_PUBLIC_LEAF_GROUPS === "1";
