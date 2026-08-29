// Guards the `next=` round-trip through the login flow against open redirects.
// A value is only honoured if it is a same-origin absolute path — not a
// protocol-relative URL (`//evil.com`), not a backslash-tricked one (`/\evil`).
// Zero deps so it is safe to import from both server and client code.

export function safeNextPath(
  value: string | null | undefined,
  fallback = "/library",
): string {
  if (!value || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
