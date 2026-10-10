// Input validation shared by the groups handlers.

export const GROUP_NAME_MAX = 60;
export const READ_TITLE_MAX = 300;

/** Trimmed text of 1..max characters (counted like Postgres: code points), else null. */
export function parseBoundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= max ? trimmed : null;
}

export function parseGroupName(value: unknown): string | null {
  return parseBoundedText(value, GROUP_NAME_MAX);
}
