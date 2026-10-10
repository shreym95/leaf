import { describe, expect, it } from "vitest";
import {
  INVITE_DEFAULT_MAX_USES,
  INVITE_TTL_MS,
  isPlausibleInviteToken,
  mintInviteToken,
} from "./token";
import { parseGroupName, parseBoundedText } from "./validate";

describe("mintInviteToken", () => {
  it("is base64url from 32 bytes: 43 characters, url-safe", () => {
    const token = mintInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPlausibleInviteToken(token)).toBe(true);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, mintInviteToken));
    expect(tokens.size).toBe(200);
  });

  it("defaults to 7 days and 4 uses", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(INVITE_DEFAULT_MAX_USES).toBe(4);
  });
});

describe("isPlausibleInviteToken", () => {
  it.each([undefined, null, 5, "", "short", "a".repeat(42), "a".repeat(129), `${"a".repeat(43)}/`, `${"a".repeat(43)} `])(
    "rejects %j",
    (value) => {
      expect(isPlausibleInviteToken(value)).toBe(false);
    },
  );
});

describe("parseGroupName", () => {
  it("trims and bounds to 1..60 characters", () => {
    expect(parseGroupName("  Club ")).toBe("Club");
    expect(parseGroupName("")).toBeNull();
    expect(parseGroupName("   ")).toBeNull();
    expect(parseGroupName("x".repeat(60))).toBe("x".repeat(60));
    expect(parseGroupName("x".repeat(61))).toBeNull();
    expect(parseGroupName(12)).toBeNull();
  });

  it("counts code points, as Postgres char_length does", () => {
    expect(parseBoundedText("😀".repeat(60), 60)).not.toBeNull();
    expect(parseBoundedText("😀".repeat(61), 60)).toBeNull();
  });
});
