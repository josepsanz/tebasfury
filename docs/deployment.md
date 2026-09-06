# Deploying to Vercel

Checklist for deploying TebasFury to Vercel for the first time. This is done once;
subsequent deployments only need a `git push origin main`.

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

where `<vercel-domain>` is the public domain Vercel assigns to the deployment (for
example, `tebasfury.vercel.app`, or the custom domain, if there is one). Both need to
be added, not just the production one: the first is the one `pnpm dev` uses locally.

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

## 5. Deploy and verify

```bash
git push origin main
```

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
