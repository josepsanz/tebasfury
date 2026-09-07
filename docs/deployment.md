# Deploying to Vercel

Checklist for deploying TebasFury to Vercel for the first time. This is done once;
subsequent deployments only need a `git push origin main`.

## 0. Create the project on Vercel

Import `github.com/josepsanz/tebasfury` from the Vercel dashboard. Vercel detects
Next.js on its own; no build settings need changing.

**The first deployment will fail, and that is expected.** The build loads `auth.ts`,
which validates the environment at module load, and none of the variables exist yet.
The error will name the missing variables. Steps 1 to 3 supply them; step 5 redeploys.

What matters at this point is that the project now exists and Vercel has assigned it
a public domain — something like `tebasfury.vercel.app`, possibly with a suffix if the
name is taken. **A custom domain is not needed**: the `.vercel.app` one comes with
HTTPS and Google accepts it as an OAuth redirect URI. Note it down; steps 2 and 3
both need it. If you add a custom domain later, update the redirect URI in step 2 and
`BETTER_AUTH_URL` in step 3 to match, and redeploy.

## 1. Point at the Neon database

The project already has a Neon database, and production reuses the same branch that
local development uses. So do **not** create a new one from Vercel's **Storage** tab:
that would provision a second, empty Neon project and leave you with two databases.

Instead, copy the connection string from the Neon dashboard (**Connect**) and set it
as `DATABASE_URL` by hand in step 3, alongside the other variables.

Two things follow from sharing one branch, both of them deliberate — but see step 4
before assuming the first one means nothing to do there:

- The first admin is already promoted from local, so step 6 can be skipped.
- Local development writes to the same data the league sees. While there is no league
  data this costs nothing; once there is history worth keeping, create a `dev` branch
  in Neon (one button) and point `.env.local` at it instead.

## 2. Configure the Google credentials

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
create an **OAuth 2.0 web application** client.

Under **Authorized redirect URIs**, add both of these, literally:

```
http://localhost:3000/api/auth/callback/google
https://<vercel-domain>/api/auth/callback/google
```

where `<vercel-domain>` is the domain noted down in step 0 (for example,
`tebasfury.vercel.app`). Both need to be added, not just the production one: the first
is the one `pnpm dev` uses locally.

Once the client is created, save the **Client ID** and **Client Secret**: they're
needed in the next step.

Important: the domain of the production redirect URI must match exactly the domain
configured as `BETTER_AUTH_URL` in step 3. If they don't match, Google responds with
`redirect_uri_mismatch` and sign-in fails.

## 3. Environment variables on Vercel

In the project's settings on Vercel (**Settings → Environment Variables**), define:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | Generated with `openssl rand -base64 32`. **Must be different from the `.env.local` secret** |
| `BETTER_AUTH_URL` | The public production URL (e.g. `https://<vercel-domain>`) |
| `GOOGLE_CLIENT_ID` | The Client ID created in step 2 |
| `GOOGLE_CLIENT_SECRET` | The Client Secret created in step 2 |
| `DATABASE_URL` | The Neon connection string from step 1 |
| `CREDENTIALS_KEY` | Generated with `openssl rand -base64 32`. Seals the stored LaLiga refresh token. **Different per environment**, and if it is ever changed the credential has to be bootstrapped again |
| `LALIGA_LEAGUE_ID` | The private league's id as the LaLiga Fantasy API reports it. Read it from `GET /v1/competition/1/leagues` with any valid access token |
| `QSTASH_TOKEN` | Upstash console → **QStash** → the token, which publishes each next sync |
| `QSTASH_CURRENT_SIGNING_KEY` | Upstash console → **QStash** → the current signing key. `/api/sync` verifies every incoming call against it |
| `QSTASH_NEXT_SIGNING_KEY` | Upstash console → **QStash** → the next signing key, used while Upstash rotates the pair |

**All ten are required.** `getEnv()` validates the whole schema when the module
loads, so a missing one is not a degraded feature: every route answers 500 until it
is set. The error names what is missing.

A first deploy also needs the LaLiga credential bootstrapped by hand before anything
can sync — see step 7. No environment variable holds it: the refresh token rotates on
every use, and Vercel's variables cannot be rewritten at runtime.

## 4. Apply migrations

**This step is not optional, and sharing a Neon branch with local development does not
make it so.** `pnpm drizzle-kit generate` writes SQL locally; it applies nothing to any
database. Checked directly against production: `0003`, `0004`, `0005` and `0006` have
never run there — `team_gameweek_stats` does not exist on the live database. Run this
before the first deploy that needs any of them, or the first sync 500s at runtime with
`relation "players" does not exist` instead of failing at build:

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

The inline `DATABASE_URL` takes priority over the one in `.env.local`, so the
migrations land on the database you name here rather than the development one.

`0005` (the four player tables) and `0006` (an index on `player_value_snapshots`) are
both safe to run against a populated database: neither touches a row that is already
there — `0005` only creates tables and `0006` only creates an index.

## 5. Redeploy and verify

The code is already on GitHub, so there is nothing to push. Trigger a new build from
the Vercel dashboard instead — **Deployments → the failed one → Redeploy** — so it
picks up the variables added in step 3. From here on, every `git push origin main`
deploys on its own.

Once deployed, check on the public URL that:

- The homepage shows **TebasFury**.
- `/login` offers the option to sign in with Google.
- Signing in with Google works.
- In a private window (no session), `/admin/sync` redirects to `/login`.

## 6. Promote the first admin

Nothing to do while production and local share one Neon branch: the first admin was
already promoted from local, and the same row serves production.

The rest of this section applies to a fresh database. The `defaultRole` configured in
`src/lib/auth/auth.ts` is `"user"`, so **everyone who signs in for the first time —
including the project owner — gets the `user` role**.
There is no `admin` user until someone is promoted by hand directly in the database:
this is a manual step needed only once, for the first admin.

Using the `psql` client (or the equivalent in the Neon panel), against the production
database:

```bash
psql "<neon-url>" \
  -c "update \"user\" set role = 'admin' where email = '<first-admin-email>';"
```

Note: `user` is a reserved word in Postgres, which is why it's double-quoted in the
SQL statement.

There's no cache (`cookieCache`) configured in `src/lib/auth/auth.ts`, so
`getSession()` reads the user's row again on every request: the role change takes
effect immediately, with no need to sign in again. Then check that the "Sync" entry
appears in the navigation and that `/admin/sync` opens correctly.

## 7. Bootstrap the LaLiga credential

Nothing syncs until this is done, and it cannot be done from a deploy: the LaLiga
account is a Google login, so there is no password to store, and the refresh token it
issues rotates on every use.

Sign in to the portal as an admin, open **/admin/sync**, and paste a bootstrap refresh
token into the field. Capture it with the four steps below. Then press **Sync now**:
the first run backfills the season and books the next run on QStash, and from then on
the chain schedules itself.

### Recovering the LaLiga credential

The same four steps recover the credential later. They are needed if `CREDENTIALS_KEY`
is changed (the stored token can no longer be decrypted), if the refresh token is
unused for more than 90 days, or if LaLiga invalidates it. The admin page names this
state explicitly — "the credential needs re-bootstrapping" — both for a manual run and
in the history of scheduled ones.

1. Open <https://miliga.laliga.com/> and sign in with Google.
2. Open DevTools, go to the **Network** tab, and filter on `token`.
3. Find the `POST` to
   `login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN`.
4. Copy `refresh_token` out of its JSON response, and paste it into the field on
   **/admin/sync**.

It is a person, a browser and two minutes. Refreshes are headless from then on, using
the same client id that issued the token — refreshing with a different one fails.

## 8. Start the daily player sweep

The sweep runs on its own self-scheduling chain, separate from the standings sync, and
like that one it has no cron behind it: each sweep books the next. Nothing books the
first, so it has to be started by hand, once, per environment.

On `/admin/sync`, press **Sweep players**. A successful sweep reports how many players
and squads it read and when the next one is due; from then on the chain runs itself.

Do not press it again just to check the chain is alive: nothing detects a QStash
message already in flight, so a second press starts a second, permanent chain running
alongside the first — harmless for correctness (the sweep is idempotent) but it doubles
load on an API the design is trying to be polite to.

If sweeps stop, `/admin/sync` names the moment: the **last successful sweep** line next
to the buttons is the whole diagnostic (the run history table is not — the standings
chain can log ten rows in under one busy weekend hour, pushing a daily sweep's own row
off the bottom of its `limit(10)` almost immediately). If that line is more than a day
old, press the button again — that is the whole recovery, the chain restarts from it.

The Vercel Hobby plan clamps a function's `maxDuration` to 60s regardless of what the
route requests (see `src/app/api/sync/players/route.ts`); if a sweep starts timing out
late in the season on Hobby, that ceiling — not a bug — is why, and Pro's 300s ceiling
is the fix.

The first sweep also backfills every player's points for every gameweek played so far,
so it does more work than the ones after it. Market value is different: it has no
history anywhere in LaLiga's API, so the value chart starts on the day of the first
sweep and fills in one day at a time. There is no way to recover the days before it.
