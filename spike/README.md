# Phase 0 — LaLiga Fantasy API feasibility spike

Throwaway investigation. Nothing here is production code. The deliverable is an
answer plus anonymised fixtures for `lib/fantasy-client/`'s tests.

**Verdict so far: inconclusive — hosts identified, protocol not yet observed.**

## What we know

Captured with PCAPdroid on the owner's phone on 2026-09-06, covering a full
log-out / log-in cycle of the official Android app. The capture is **TLS-encrypted**,
so only SNI hostnames were recoverable, not paths or payloads.

The web app at `fantasy.laliga.com` redirects to the mobile app, so browser DevTools
is not an option — traffic has to come from the phone.

### Hosts, in the order the login flow touches them

| Offset | Host | Role |
|---|---|---|
| 0–2.6s | `fantasy-api.llt-services.com` | Data API, called on app start with the existing session |
| 8.2s | `pr-api.laliga.es` | Unidentified LaLiga service |
| 9.3s | `login.laliga.es` | **Authentication** — the ~15s gap after it is the owner typing |
| 23.9–25.1s | `fantasy-api.llt-services.com` | Data API again, now with a fresh session |

A second data host, `fantasy-api-nc.llt-services.com`, appears once. The `-nc` suffix
suggests a no-cache variant.

Everything else in the capture is third-party noise: Google/AdMob, AppLovin, Tappx,
AppsFlyer, OneTrust, Tealium, Crashlytics, Pushologies.

### Probed directly, unauthenticated

- `login.laliga.es` serves no OIDC discovery document (`/.well-known/openid-configuration`
  and `/.well-known/oauth-authorization-server` both 404 with an IIS-style HTML error).
  So authentication is a bespoke service, not standards-based OIDC.
- `fantasy-api.llt-services.com` is a live JSON API: an unknown path returns
  `{"code":404,"message":"Not Found"}` with `content-type: application/json`.
- The API root 301-redirects to `https://fantasy.laliga.com/`.

## Still unanswered

Every question that decides feasibility:

1. How the token is obtained — endpoint, request shape, response shape.
2. Whether there is a refresh token, and how long a session lasts.
3. Which headers are mandatory outside the app.
4. The endpoint for the private league and its standings.
5. Whether per-gameweek points come back as full history or only the current round.
   **This one matters most**: if only the current round is available, the whole
   historical series depends on our sync never missing a gameweek.
6. Rate limits.

## Next step

A TLS-decrypted capture. PCAPdroid supports this through its separate mitm addon.
The risk is certificate pinning: if the app pins, decryption fails and the traffic
stays opaque, at which point the data-source decision in the spec has to be revisited.
