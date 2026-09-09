/**
 * Who may sign in.
 *
 * Google's consent screen is not a boundary this portal can rely on: TebasFury asks
 * only for `openid email profile`, which Google classes as non-sensitive, and a
 * non-sensitive app is not restricted to the OAuth test-user list even while the
 * consent screen is in Testing. Proven on 2026-09-09 — an account absent from the test
 * users, holding no IAM role, with its grant revoked and its portal row deleted, signed
 * in from a clean incognito window. So the allowlist has to live here.
 *
 * Pure, and imports nothing — not the environment, not `better-auth`, not the database.
 * That is the point: the rule that decides who reaches the league can be proven without
 * standing up Next, Google or Postgres, the same reasoning that shaped `decideAccess`.
 */

/**
 * The code a refused visitor arrives at `/login` with.
 *
 * It lives in this module, not beside the gate in `auth.ts`, so that the page can name
 * it without importing the auth stack — `auth.ts` builds `betterAuth` at module scope
 * and would drag the database and the whole environment into a view that needs neither.
 * Better Auth puts this on the redirect as `?error=`; change it here and both ends move.
 */
export const NOT_IN_LEAGUE = "not_in_league";

/** Trim, lower-case, and treat blank as absent. Applied to both sides of every comparison. */
function normalise(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Whether this identity is the owner's.
 *
 * Checked BEFORE the stored list is read, and that ordering is deliberate: the admin
 * must be able to sign in when the database is unreachable, because the database is
 * where the list they would need to fix now lives. It is the one door that depends on
 * nothing but an environment variable.
 */
export function isAdmin(email: string | null | undefined, adminEmail: string): boolean {
  const candidate = normalise(email);
  return candidate !== null && candidate === normalise(adminEmail);
}

/**
 * A pasted list of addresses, as addresses.
 *
 * Blanks are dropped so a trailing comma or a stray space costs nothing — this parses
 * what a person typed into a form, which is exactly where those creep in. Duplicates
 * collapse, so pasting a list twice adds nothing the second time.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const entries = raw
    // Newlines as well as commas: a list pasted out of a chat arrives one per line.
    .split(/[,\n;]/)
    .map((entry) => normalise(entry))
    .filter((entry): entry is string => entry !== null);
  return [...new Set(entries)];
}

/**
 * Whether this identity belongs to the league.
 *
 * `adminEmail` is separate from the list rather than an entry in it, and is always
 * admitted. The failure that avoids is unrecoverable: were there one list and the owner
 * mistyped it, nobody could sign in — including the one person who could correct it.
 *
 * Comparison is exact after normalisation. Gmail's dot-insensitivity is deliberately
 * NOT honoured: `f.sanz@` and `fsanz@` are one Google account but two entries here.
 * Stripping dots would make the rule invisible to whoever reads the list, and Google
 * reports each account's canonical address consistently, so an entry copied from what
 * the friend actually uses matches. See docs/deployment.md, which tells the owner to
 * compare the dots first when somebody is bounced.
 */
export function isAllowed(
  email: string | null | undefined,
  allowed: string[],
  adminEmail: string,
): boolean {
  const candidate = normalise(email);
  // A provider that returns no email must be refused outright, never fall through to an
  // empty-string comparison that an empty-string list entry would satisfy.
  if (candidate === null) return false;

  if (candidate === normalise(adminEmail)) return true;
  return allowed.includes(candidate);
}
