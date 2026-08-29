import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/library")).toBe("/library");
    expect(safeNextPath("/reader/abc?page=2")).toBe("/reader/abc?page=2");
  });

  it("falls back for empty / missing", () => {
    expect(safeNextPath(undefined)).toBe("/library");
    expect(safeNextPath(null)).toBe("/library");
    expect(safeNextPath("")).toBe("/library");
  });

  it("rejects open-redirect payloads", () => {
    expect(safeNextPath("//evil.com")).toBe("/library");
    expect(safeNextPath("/\\evil.com")).toBe("/library");
    expect(safeNextPath("https://evil.com")).toBe("/library");
    expect(safeNextPath("javascript:alert(1)")).toBe("/library");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath(null, "")).toBe("");
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });
});
