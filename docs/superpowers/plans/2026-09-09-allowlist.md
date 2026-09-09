# The Allowlist Implementation Plan

**Design:** [2026-09-09-tebasfury-allowlist-design.md](../specs/2026-09-09-tebasfury-allowlist-design.md)

**Goal:** Only the league signs in. Any other Google account is turned away before a session
exists, and the list of who counts is configuration rather than code.

This slice is four files and one pure function. It gets a short plan rather than the usual long one
because the spec's rulings already fix every decision an implementer would otherwise have to make;
what is left is transcription.

## Global constraints

- **`npx tsc --noEmit` is the typecheck.** `npm test` passes over type errors here.
- Every artefact in English, UI strings included.
- Nothing in this slice may create a session for a rejected visitor. If a change makes that
  possible, the change is wrong, not the ruling.
- No migration. This slice touches no schema.

## Task 1: The rule, as a pure function

`src/lib/auth/allowlist.ts` and its test. `parseAllowlist` and `isAllowed` per the spec's Modules
section. Tests first: the admin always admitted; an unset list admitting the admin alone; case and
surrounding whitespace ignored; a trailing comma harmless; a null, undefined or blank email
rejected; an address that is a substring of a listed one rejected.

No import of `env`, `better-auth` or the database — that is what makes it testable, and the reason
it is its own module rather than a closure inside `auth.ts`.

## Task 2: The configuration

`ADMIN_EMAIL` (required, validated as an email) and `LEAGUE_ALLOWLIST` (optional string) in
`src/lib/env.ts`. Both into `.env.example`, with the Gmail-dot warning as a comment.

Required means the app refuses to boot without it, which is the existing contract for every other
secret and is what Ruling 3 depends on.

## Task 3: The gate

`src/lib/auth/auth.ts` gains three options: `user.validateUserInfo` calling `isAllowed` and
returning `{ error: "not_in_league", errorDescription: … }` on refusal, `onAPIError.errorURL` set
to `/login`, and `trustedOrigins` per Ruling 9.

The callback turns that `error` into `?error=not_in_league` on the redirect. Do not hand-build that
parameter anywhere; the library owns its name.

## Task 4: The two messages on `/login`

`/login` reads `searchParams.error`: `not_in_league` gets the private-league message, any other
value gets a generic failure, absent renders as today. Ruling 6 — never show the league message for
an unrelated failure.

`searchParams` is a Promise in this version of Next; read the App Router page docs in
`node_modules/next/dist/docs/` before writing it rather than trusting recall.

## Task 5: The handover

`docs/deployment.md` gains: the two variables, that a Vercel variable change needs a redeploy to
take effect, the procedure for removing somebody (delete the row; sessions cascade, the team is
released), and the Gmail-dot hazard as the first thing to check when a friend is bounced.

Then `npx tsc --noEmit`, `npx vitest run`, `npx next build`, and hand the manual checks over — this
slice's sign-in path cannot be covered end to end without a real Google account.
