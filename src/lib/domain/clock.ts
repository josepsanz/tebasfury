/** The league's timezone. Every time the portal shows is a time in Spain. */
const LEAGUE_ZONE = "Europe/Madrid";

const parts = (at: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_ZONE, ...options }).format(at);

/** The calendar day something happened on, in the league's timezone, as `YYYY-MM-DD`. */
function leagueDay(at: Date): string {
  return parts(at, { year: "numeric", month: "2-digit", day: "2-digit" })
    .split("/")
    .reverse()
    .join("-");
}

/**
 * How the status strip names the moment the standings last synced.
 *
 * The hour alone when it happened today, and the day as well when it did not. The
 * distinction is the whole point: a chain that died on Sunday would otherwise still
 * report "03:09" on Wednesday, which reads as three hours old rather than three days,
 * and the strip's only job is to tell a reader how much to trust the figures under it.
 *
 * Both the comparison and the formatting happen in the league's timezone. Comparing in
 * UTC would call a 23:30 UTC sync "yesterday" when in Spain it already happened today.
 */
export function formatSyncedAt(at: Date, now: Date): string {
  const time = parts(at, { hour: "2-digit", minute: "2-digit" });
  if (leagueDay(at) === leagueDay(now)) return time;
  return `${parts(at, { day: "2-digit", month: "short" })} ${time}`;
}

/**
 * A day and a time in the league's timezone, for a deadline a reader has to act before.
 *
 * The hour is not decoration here: a fair-play hold that lifts "14 Sept" is useless to
 * somebody deciding whether to wait up for it. The same reasoning the clause board's
 * countdown already follows.
 */
export function formatLeagueMoment(at: Date): string {
  return parts(at, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
