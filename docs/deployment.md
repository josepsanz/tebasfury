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

## 1. Create the database on Neon

From the project's panel on Vercel, **Storage** tab, create a **Neon Postgres**
database and connect it to the project. Vercel injects the `DATABASE_URL` variable
automatically: there's no need to paste it into the environment variables by hand.

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

`DATABASE_URL` is **not** set by hand: Vercel already injected it in step 1.

## 4. Apply migrations to the production database

From local, using the Neon connection from step 1 (found in the project's Storage
tab, or in the environment variables Vercel generated from it):

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

The `DATABASE_URL` passed inline takes priority over the one in `.env.local`: this way
the migrations are applied against the **production** database even if `.env.local`
points to the local development one.

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

The `defaultRole` configured in `src/lib/auth/auth.ts` is `"user"`, so **everyone who
signs in for the first time — including the project owner — gets the `user` role**.
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
