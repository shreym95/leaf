// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertOutsideRepo, findRepoRoots, isInside } from "./lib/path-guard.mjs";

let base: string;
let repo: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "leaf-guard-"));
  repo = join(base, "repo");
  outside = join(base, "elsewhere");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("assertOutsideRepo", () => {
  it("refuses the repo root and paths inside it, existing or not", () => {
    expect(() => assertOutsideRepo(repo, { repoRoots: [repo] })).toThrow(/inside the git repository/);
    expect(() => assertOutsideRepo(join(repo, "backups", "x"), { repoRoots: [repo] })).toThrow(
      /inside the git repository/,
    );
  });

  it("refuses a `..` path that lands inside the repo", () => {
    expect(() => assertOutsideRepo(join(outside, "..", "repo", "out"), { repoRoots: [repo] })).toThrow(
      /inside the git repository/,
    );
  });

  it("refuses a symlink that points into the repo", () => {
    const link = join(outside, "link");
    symlinkSync(repo, link);
    expect(() => assertOutsideRepo(link, { repoRoots: [repo] })).toThrow(/inside the git repository/);
    expect(() => assertOutsideRepo(join(link, "new", "dir"), { repoRoots: [repo] })).toThrow(
      /inside the git repository/,
    );
  });

  it("refuses a repo root that is itself reached through a symlink", () => {
    const aliasOfRepo = join(base, "alias");
    symlinkSync(repo, aliasOfRepo);
    expect(() => assertOutsideRepo(join(repo, "x"), { repoRoots: [aliasOfRepo] })).toThrow();
  });

  it("refuses a dangling symlink", () => {
    const link = join(outside, "dangling");
    symlinkSync(join(base, "does-not-exist"), link);
    expect(() => assertOutsideRepo(link, { repoRoots: [repo] })).toThrow(/dangling/);
  });

  it("allows paths outside the repo and returns the real path", () => {
    const target = join(outside, "backups", "2026");
    expect(assertOutsideRepo(target, { repoRoots: [repo] })).toMatch(/elsewhere\/backups\/2026$/);
  });

  it("allows a sibling directory whose name merely starts with the repo name", () => {
    const sibling = join(base, "repo-backups");
    mkdirSync(sibling);
    expect(() => assertOutsideRepo(sibling, { repoRoots: [repo] })).not.toThrow();
  });
});

describe("isInside", () => {
  it("treats equal paths as inside and parents/siblings as outside", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
    expect(isInside("/a", "/a/b")).toBe(false);
    expect(isInside("/a/bc", "/a/b")).toBe(false);
  });
});

describe("findRepoRoots", () => {
  it("finds the git root above the working directory", () => {
    const nested = join(repo, "a", "b");
    mkdirSync(nested, { recursive: true });
    const roots = findRepoRoots(nested, outside);
    expect(roots.some((r) => r.endsWith("/repo"))).toBe(true);
  });

  it("includes the main checkout when run from a linked worktree", () => {
    const main = join(base, "main");
    const gitDir = join(main, ".git", "worktrees", "wt");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "commondir"), "../..\n");
    const worktree = join(base, "wt");
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
    const roots = findRepoRoots(worktree, outside);
    expect(roots.some((r) => r.endsWith("/main"))).toBe(true);
    expect(roots.some((r) => r.endsWith("/wt"))).toBe(true);
  });

  it("always includes the repository the scripts live in", () => {
    const roots = findRepoRoots(outside);
    expect(roots.length).toBeGreaterThan(0);
    expect(() => assertOutsideRepo(join(process.cwd(), "leaf-backups-test"), { repoRoots: roots })).toThrow();
  });
});
