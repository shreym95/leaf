// Refuses backup output inside the git repository. The repo is public and a
// backup holds personal data, so this is a hard stop, not a warning.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Real path of `p` even when it (or its tail) does not exist yet: resolve the
 * deepest existing ancestor through symlinks, then re-append the missing tail.
 * A dangling symlink is refused outright because it can be created through later.
 */
export function resolveRealPath(p) {
  let current = resolve(p);
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...tail.reverse());
    } catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
      let isLink = false;
      try {
        isLink = lstatSync(current).isSymbolicLink();
      } catch {
        // Does not exist at all.
      }
      if (isLink) {
        throw new Error(`Refusing "${p}": "${current}" is a dangling symlink.`);
      }
      const parent = dirname(current);
      if (parent === current) throw err;
      tail.push(basename(current));
      current = parent;
    }
  }
}

export function isInside(child, root) {
  const rel = relative(root, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Walk up from `start` to the first directory holding `.git` (dir or file). */
function findGitRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** For a linked worktree, `.git` is a file; return the main checkout's root too. */
function mainCheckoutRoot(gitRoot) {
  try {
    const dotGit = join(gitRoot, ".git");
    if (!lstatSync(dotGit).isFile()) return null;
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    if (!match) return null;
    const gitDir = resolve(gitRoot, match[1].trim());
    const common = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
    return dirname(common);
  } catch {
    return null;
  }
}

/** Every repo root a backup must stay out of (real paths, de-duplicated). */
export function findRepoRoots(cwd = process.cwd(), scriptRoot = SCRIPT_REPO_ROOT) {
  const roots = new Set();
  const add = (p) => {
    if (!p) return;
    try {
      roots.add(realpathSync(p));
    } catch {
      // A root that cannot be resolved cannot contain the output either.
    }
  };
  add(scriptRoot);
  const cwdRoot = findGitRoot(cwd);
  add(cwdRoot);
  if (cwdRoot) add(mainCheckoutRoot(cwdRoot));
  return [...roots];
}

/**
 * Throw if `outDir` is, or would be created inside, any repo root. Returns the
 * resolved real path for the caller to use.
 */
export function assertOutsideRepo(outDir, { repoRoots = findRepoRoots() } = {}) {
  const real = resolveRealPath(outDir);
  for (const root of repoRoots) {
    if (isInside(real, resolveRealPath(root))) {
      throw new Error(
        `Refusing output path "${outDir}" (resolves to "${real}"): it is inside the git ` +
          `repository at "${root}". Backups contain personal data and the repo is public.`,
      );
    }
  }
  return real;
}
