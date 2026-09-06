# Phase 0 — LaLiga Fantasy API feasibility spike

Throwaway investigation. Nothing here is production code.

## Verdict: VIABLE — verified against the live API

Every question that gated the design is answered, and the one that worried me most —
whether per-gameweek history is retrievable — came back favourable.

This is no longer inference from third-party code. On 2026-09-06 a real refresh token
was exchanged for an access token and used to call the API successfully:

| Call | Result |
|---|---|
| `POST …/token` (refresh grant) | HTTP 200, `Bearer`, `expires_in` 86400 (24h), refresh token rotated |
| `GET /v4/user/me` | HTTP 200 |
| `GET /v1/competition/1/leagues?x-lang=es` | HTTP 200, the owner's league found |
| `GET …/week/current` | HTTP 200, gameweek 4, `isLive: true` |
| `GET …/leagues/{id}/standing` | HTTP 200, 13 teams |
| `GET …/leagues/{id}/standing/3` | HTTP 200, 13 teams — **per-gameweek history confirmed** |

Anonymised responses are in `fixtures/`. They keep their exact shape and types; manager
names, ids and the league token are replaced with stable fakes.

## Evidence gathered first-hand

A PCAPdroid capture of a full log-out / log-in cycle on the owner's phone
(2026-09-06) was TLS-encrypted, so only SNI hostnames were recoverable. Those were
enough to establish the shape:

| Offset | Host | Role |
|---|---|---|
| 0–2.6s | `fantasy-api.llt-services.com` | Data API, called on app start |
| 8.2s | `pr-api.laliga.es` | Unidentified LaLiga service |
| 9.3s | `login.laliga.es` | Authentication |
| 23.9–25.1s | `fantasy-api.llt-services.com` | Data API, now authenticated |

The web app at `fantasy.laliga.com` redirects to the mobile app, so browser DevTools
is not an option.

Probed directly, unauthenticated, and confirmed live:

- Both Azure AD B2C policies below return a valid OIDC discovery document (HTTP 200),
  issuer `https://login.laliga.es/335316eb-f606-4361-bb86-35a7edcdcec1/v2.0/`.
- `fantasy-api.llt-services.com` is a JSON API: unknown paths return
  `{"code":404,"message":"Not Found"}`.

## 1. Authentication — Azure AD B2C

Tenant `laligadspprob2c.onmicrosoft.com`, base
`https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0`.

Two policies, and **which one we can use depends on how the account was created**:

| Policy | Grant | Works for |
|---|---|---|
| `B2C_1A_ResourceOwnerv2` | password | Accounts with an email/password credential in LaLiga settings |
| `B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN` | authorization code, then refresh | Everyone, including Google / Apple / Facebook logins |

A social-login account **cannot** use the password grant. It needs a one-time
interactive bootstrap in a browser to capture the first `refresh_token`, after which
refreshes are headless.

Client IDs seen in the wild: `af88bcff-1157-40a0-b579-030728aacf0b` (public client, no
secret) and `6457fa17-1224-416a-b21a-ee6ce76e9bc0` (the `miliga.laliga.com` web
client). **Refreshes must use the same client that issued the token.**

### Token lifetimes — this is the good news

- Access token: **24 hours**
- Refresh token: **90 days**, and it **rotates on every use** — the new one must be
  persisted immediately, and the previous one kept if a response omits it.

So the central read token needs a manual bootstrap at most once every 90 days, and in
practice never, as long as the sync runs at least that often and stores each rotation.

## 2. Data API

Base `https://fantasy-api.llt-services.com/api`. Most routes now carry a competition
segment: `/v1/competition/1/...`, where 1 is LaLiga EA Sports.

| Endpoint | Purpose |
|---|---|
| `GET /v4/user/me` | Current user |
| `GET /v1/competition/1/leagues` | The account's leagues |
| `GET …/leagues/{leagueId}/standing[/{week}]` | **Standings, optionally per gameweek** |
| `GET …/leagues/{leagueId}/teams/{teamId}` | Squad composition |
| `GET …/leagues/{leagueId}/activity/{index}` | **Full transaction history — bids and sales** |
| `GET …/player/{playerId}/league/{leagueId}` | **Player values and points per gameweek** |
| `GET …/players` | All eligible players |
| `GET …/week/current` | Current gameweek number |
| `GET …/league/{leagueId}/market` | Active offers |
| `GET …/teams/{teamId}/money` | Cash available |
| `POST …/league/{leagueId}/market/{marketId}/bid` | Place a bid |
| `POST …/league/{leagueId}/market/sell` | List a player |

`x-lang=es` appears as a query parameter on league calls.

### Full history is available — verified

`GET …/leagues/{id}/standing/3` returned the full 13-team table for gameweek 3 while
gameweek 4 was live. The standings endpoint takes an optional week and serves the past.

The standing entries carry `position`, `previousPosition`, `points`, `livePoints`, and
a nested `team` with `teamValue`, `teamPoints`, `teamMoney` and `isAdmin` — which is
most of what the standings-and-progress slice needs, from one call per gameweek.

This removes the risk flagged in the spec: the historical series does not depend on our
sync never missing a gameweek. We can backfill.

### The activity endpoint makes fair play cheap

`…/leagues/{leagueId}/activity/{index}` returns the league's transaction history. The
5-day rule can be evaluated from it directly, rather than inferred by diffing squad
snapshots between syncs, which is what the spec assumed.

## 3. Rate limits

None documented. The consensus guidance among the projects using it is one full player
sweep per day, sequential, with a small delay, backing off on 429 and 403. Treat as
rate-limited but not tight for a ten-person league.

## 4. Fragility, confirmed rather than theoretical

The spec accepted "the API may change without notice" as a risk. **It already has.**
The previous host `api-fantasy.llt-services.com` with `/v3` and `/v4` routes is frozen,
and the competition segment was introduced in the 26/27 season migration. Most older
scrapers on GitHub are broken because of it.

This vindicates the anti-corruption layer: when it moves again, one directory changes.

## What the spike changes about the plan

1. **The `raw_sync_payloads` table matters more than assumed.** Routes have already
   moved once. Keeping raw responses is what will let us diagnose the next break.
2. **Fair play can read the activity feed** instead of diffing squad snapshots.
   Simpler, and it catches operations the portal never observed.
3. **The central token needs a bootstrap path, not just a password field.** If the
   owner's LaLiga account is a social login, there is no password to store — the
   design needs a place to paste a first refresh token, and rotation must be persisted
   on every use.
4. **Backfill is possible**, so the standings slice can start with real history rather
   than an empty table that fills up one gameweek a week.

## Decided: the account is a Google login

So the password grant is out, and the central token takes the bootstrap route:
`B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN`, one interactive sign-in to obtain the first
refresh token, headless from then on.

No proxy and no rooted phone are needed. `https://miliga.laliga.com/` is a live web
app that signs in with Google, and its page source carries the same client id
(`6457fa17-1224-416a-b21a-ee6ce76e9bc0`) and policy as the token endpoint — both
confirmed first-hand. Browser DevTools is enough.

### Bootstrap procedure

1. Open `https://miliga.laliga.com/` and sign in with Google.
2. DevTools, Network tab, filter on `token`.
3. Find the `POST` to
   `login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN`.
4. In its JSON response, take `refresh_token`.

Then refresh headlessly, with the same client id that issued it:

```
POST https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token
     ?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN
  grant_type=refresh_token
  client_id=6457fa17-1224-416a-b21a-ee6ce76e9bc0
  scope=openid offline_access
  refresh_token=<stored>
```

Persist the rotated `refresh_token` from every response.

### What this means for the design

The spec's `league_credentials` table was drafted around storing a token. It needs to
hold a **rotating** refresh token, written back on every sync, plus the client id that
issued it — refreshing with a different client fails. And the admin screen needs a
field to paste the bootstrap token into, not a password field.

If the refresh token is ever lost or expires past 90 days of disuse, recovery is the
four steps above: a person, a browser, two minutes. Worth stating in the runbook so it
is not rediscovered under pressure.


## Reproducing this

`refresh.mjs`, `probe.mjs`, `probe2.mjs` and `anonymise.mjs` are throwaway scripts kept
only so the next person can re-run the investigation. They read `.env.local` for
`LALIGA_REFRESH_TOKEN` and `LALIGA_LEAGUE_ID`, and `refresh.mjs` writes the rotated
refresh token straight back to it.

The access token is deliberately **not** persisted anywhere: it lives 24 hours and is
one call away from the refresh token, so storing it would add a second secret to guard
for no benefit. Production should do the same — fetch it at the start of a sync and
keep it in memory.
