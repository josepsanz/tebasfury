# Phase 0 — LaLiga Fantasy API feasibility spike

Throwaway investigation. Nothing here is production code.

## Verdict: VIABLE

Every question that gated the design is answered, and the answer to the one that
worried me most — whether per-gameweek history is retrievable — is favourable.

One caveat on provenance: most of what follows comes from reading several independent
open-source projects that use this API, cross-checked against each other, plus a
TLS-encrypted capture of the official Android app and direct probes of the public
metadata endpoints. **It has not yet been exercised with a real token.** That is the
first task of Step 2, and it is cheap: one authenticated call either works or it
doesn't.

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

### Full history is available

The player endpoint returns a points breakdown **per gameweek across the season**, not
just the current one. The standings endpoint takes an optional week.

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

## Open question for the owner

Does the LaLiga Fantasy account sign in with **email and password**, or with
**Google / Apple / Facebook**? That decides which of the two auth routes the central
token uses, and whether a one-time browser bootstrap is required.
