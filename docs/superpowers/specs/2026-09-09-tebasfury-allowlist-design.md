# TebasFury Step 8 — The allowlist

## Context

The portal is open to any Google account on the internet. This was proven, not suspected, on
2026-09-09: an account that was not in the OAuth consent screen's test-user list, held no IAM role
on the project, had its Google grant revoked and its portal row deleted still signed in from a
clean incognito window, and a session row appeared.

The mechanism is understood. TebasFury asks only for `openid email profile`, which Google classes
as non-sensitive. The test-user list and the unverified-app warning gate apps requesting
*sensitive* scopes; a plain "sign in with Google" is not restricted to the test-user list even
while the consent screen is in Testing. **There is no Google Cloud Console setting that keeps this
league private.** The allowlist has to live in the application.

Today's exposure is small and known — three user rows, all accounted for, one team claimed of
thirteen — because nobody has been invited yet. Inviting the league is what turns this from a
theoretical hole into a real one, and inviting the league is the next thing the owner wants to do.
`/claim` is first come, first served, so a stranger who signed in before a friend could take that
friend's team.

## Decisions carried in, not re-opened

Settled in conversation on 2026-09-09 and recorded here so the implementation does not re-litigate
them:

- Somebody outside the list who gets past Google sees **nothing**. No session, no portal page —
  a short message saying this is a private league and to get in touch if they think they belong.
- A read-only tier for outsiders was **considered and rejected**: it would mean maintaining two
  permission levels on every page the portal ever gains, for the sake of strangers.
- The list lives in configuration, not in code, so adding a friend is not a commit.
- `trustedOrigins` is folded into this slice rather than waiting for its own, because Vercel
  preview deployments otherwise break every POST the same way the LAN-IP dev server does.

## Rulings

### Ruling 1 — the gate is `validateUserInfo`, and no other seam would do

`better-auth` 1.7.2 exposes `user.validateUserInfo`. Read from the package rather than assumed:

- It runs for `create-user`, `link-account` **and `sign-in`**. The `sign-in` case is the one that
  matters here — an allowlist that only gated account *creation* would let every row that already
  exists keep signing in for ever, including the stranger row created while proving the hole.
- On `sign-in` it receives the **fresh provider email**, not the stored row, so a policy decision
  is made against what Google asserts today.
- It fails closed by construction: `assertValidUserInfo` in
  `better-auth/dist/utils/validate-user-info.mjs` catches a throwing hook and rejects anyway,
  rather than admitting the user. A bug in our code cannot open the door.
- Rejecting returns `{ error, errorDescription }`, which becomes an `APIError("FORBIDDEN")`.

The alternative seams are all worse. A per-page check would run *after* a session exists, which
contradicts "sees nothing". A `databaseHooks.user.create.before` hook gates creation only. Checking
in the UI gates nothing at all.

### Ruling 2 — the session cookie is never set for a rejected visitor, and the callback proves it

In `better-auth/dist/api/routes/callback.mjs`, `handleOAuthUserInfo` — which is what invokes the
gate — is wrapped in a `try`/`catch` that turns an `APIError` carrying a `code` into
`redirectOnError(code, message)`. `setSessionCookie` is only reached on the success path, after
that call returns. So a rejected visitor gets a redirect and no cookie: the ruling above is
enforced by the library's control flow, not by anything we remember to do.

### Ruling 3 — the admin address is its own variable, so a typo cannot lock the owner out

`LEAGUE_ALLOWLIST` and `ADMIN_EMAIL` are two variables, not one list.

The failure this avoids is unrecoverable: if the only way in were a single comma-separated list and
the owner mistyped it, nobody could sign in — including the one person who could fix it — and the
portal has no other door. `ADMIN_EMAIL` is required, validated as an email, and always admitted.
`LEAGUE_ALLOWLIST` is optional and may be malformed without consequence beyond its own entries.

### Ruling 4 — an unset list means "the admin only", never "everyone"

`LEAGUE_ALLOWLIST` absent or empty admits `ADMIN_EMAIL` and nobody else. The opposite default —
absent means unrestricted — is how this hole would come back: a missed environment variable on a
new deployment target would silently reopen the portal, and nothing would look wrong.

The cost is that deploying this code before setting the variable locks the league out until it is
set. That is the correct direction to fail, and the owner controls both.

### Ruling 5 — matching is lower-cased and trimmed, and nothing else

Addresses are compared after `trim()` and `toLowerCase()`. Entries are split on commas, and blanks
are dropped so a trailing comma is harmless.

Deliberately **not** implemented: Gmail's dot-insensitivity (`f.sanz.xicola@` and `fsanzxicola@`
are the same Google account). Stripping dots would make the rule invisible — a reader of the list
could not tell which addresses match — and Google reports each account's canonical address
consistently, so an entry copied from what the friend actually uses will match. The hazard is real
but narrow: **if a friend is bounced and swears they are on the list, compare the dots first.**
This is the first thing `docs/deployment.md` should say about the variable.

### Ruling 6 — the rejected visitor lands on `/login`, which names the reason

`onAPIError.errorURL` is set to `/login`. The library appends `?error=<code>` and
`&error_description=<message>`; the parameter name is fixed in `oauth2/errors.mjs` and every OAuth
failure routes through it, so `/login` is where all sign-in failures already end up.

`/login` therefore has to tell two stories apart, and must not tell the wrong one: `not_in_league`
gets the private-league message, and **every other code** gets a generic "sign-in did not
complete". Showing "you are not in this league" after a network fault or a revoked Google grant
would be a lie that sends a friend to the owner for the wrong reason.

The error page is not a new route. A visitor who is rejected is already looking at the only page
they can reach, and a dedicated `/denied` route would be a second place to maintain that says the
same thing.

### Ruling 7 — a live session outlives its welcome, and only deleting the row cuts it

The gate is at sign-in. Somebody removed from the list keeps any session they already hold until it
expires — seven days here. This is a real limitation and is recorded rather than hidden.

The operator's lever is deleting the user row: `session.user_id` is `ON DELETE CASCADE`, so the
sessions go with it, and `teams.user_id` is `ON DELETE SET NULL`, so a claimed team is released
rather than orphaned. That is the whole procedure, and it belongs in `docs/deployment.md`.

Not built: a background job that revokes sessions when the list changes. It would be machinery for
an event that happens when somebody leaves the league, which has not happened once.

### Ruling 8 — the stranger row is deleted by hand, not by a migration

`f.sanz.xicola@gmail.com` still holds a row from the test that proved the hole. It has no live
session and no team.

Deleting it is one statement, once, and it is not a schema change. A migration that deletes user
rows would be a bad precedent in a repository where migrations are the reviewed, replayable record
of structure — and it would run again, meaninglessly, on any future database rebuilt from zero.
The owner runs it against Neon after the allowlist is live, in that order: with the gate in place,
the row cannot come back.

### Ruling 9 — `trustedOrigins` names this project's previews, not every app on `vercel.app`

The pattern is `https://tebasfury-*.vercel.app`, plus `http://localhost:3000` for development.

`https://*.vercel.app` would have been shorter and is wrong: it trusts every application anybody
has ever deployed to Vercel. The wildcard matcher (`better-auth/dist/auth/trusted-origins.mjs`)
compares against the request's host, so the narrower pattern costs nothing.

The LAN-IP dev server stays broken on purpose — the recorded cure is to use `localhost`, and adding
a machine's address here would bless a URL that also breaks hydration for unrelated reasons.

## Architecture

### Configuration

Two new entries in `src/lib/env.ts`:

| Variable | Required | Shape |
| --- | --- | --- |
| `ADMIN_EMAIL` | yes | one address, validated |
| `LEAGUE_ALLOWLIST` | no | comma-separated addresses; blanks dropped |

`.env.example` gains both, with the Gmail-dot warning as a comment.

### Modules

- **`src/lib/auth/allowlist.ts`** — pure, no I/O, the whole rule:
  - `parseAllowlist(raw: string | undefined): string[]` — split, trim, lower-case, drop blanks.
  - `isAllowed(email: string | null | undefined, allowed: string[], adminEmail: string): boolean`
    — normalises the candidate the same way, returns `true` for the admin address always, `false`
    for a missing or blank email.

  This is where the tests live. It is a pure function precisely so the rule can be proven without
  standing up Next, Google, or a database — the same reasoning that shaped `decideAccess`.

- **`src/lib/auth/auth.ts`** — wires the pure rule into `betterAuth`: `user.validateUserInfo`,
  `onAPIError.errorURL`, and `trustedOrigins`. It reads the environment and calls the module above;
  it decides nothing itself.

### Views

- **`/login`** — reads `searchParams.error`. `not_in_league` renders the private-league message;
  any other value renders the generic failure; absent renders today's page unchanged.

## Error handling

| Situation | What happens |
| --- | --- |
| Email absent from the provider | Rejected. `isAllowed` returns `false` for null, blank or missing. |
| `LEAGUE_ALLOWLIST` unset | Only `ADMIN_EMAIL` is admitted (Ruling 4). |
| `ADMIN_EMAIL` unset or malformed | The app fails to boot, as with every other required variable. |
| The gate itself throws | `better-auth` rejects the sign-in (fail-closed, Ruling 1). |
| Any other OAuth failure | `/login` shows the generic message, never the league one (Ruling 6). |

## Testing

- `allowlist.test.ts` — the pure rule: the admin always in; an unset list admitting only the admin;
  case and whitespace; a trailing comma; a null or blank email; an address that is a *substring* of
  a listed one not matching.
- `login` page — the three states of the error parameter.
- The existing Playwright suite is unchanged and still never signs in. **This slice cannot be
  covered end to end without a real Google account**, so the sign-in path stays a manual check.

## The visual and manual checks this slice leaves for a human

Numbered so a later commit can record the outcome, as previous slices have.

1. Sign in with `ADMIN_EMAIL` while `LEAGUE_ALLOWLIST` is unset — expect success.
2. Sign in with the second owner account while it is *not* in the list — expect the private-league
   message on `/login`, and no new `session` row in Neon.
3. Add that account to `LEAGUE_ALLOWLIST`, redeploy, sign in again — expect success.
4. The private-league message at 320px and 375px.
5. Interrupt a sign-in (close the Google window) and confirm `/login` shows the *generic* failure,
   not the league one.

## Out of scope

- Revoking live sessions when the list changes (Ruling 7).
- Moving the list into the database with an admin screen. It becomes worth it if the league churns;
  it does not churn.
- Anything about `/claim`'s first-come-first-served race, which is unchanged and now reachable only
  by people on the list.

## Practical notes for whoever implements this

- **A Vercel environment variable change needs a redeploy to take effect.** The memory this slice
  came from says adding a friend "needs no deploy"; that is true of *code* and not of deployment.
  It is one click in the dashboard with no commit, and `docs/deployment.md` must say so, or the
  owner will add an address and wonder why the friend is still bounced.
- Put **both** owner addresses in `LEAGUE_ALLOWLIST`, not just the admin one. `ADMIN_EMAIL` covers
  `jsanz83@gmail.com`; `josep.sanz@powens.com` is the account for seeing the portal as the league
  will, and Ruling 4 will otherwise lock it out.
- Delete the stranger row **after** the gate is live (Ruling 8), or it can simply be recreated.

## Follow-ups this slice is expected to leave behind

- **Inviting the league.** The point of the slice; it is the owner's to do.
- **The Necroporra**, which needs voters and therefore needs the invitations above.
