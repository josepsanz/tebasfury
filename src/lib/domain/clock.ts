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

const numericParts = (at: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LEAGUE_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

/** How far the league's clock runs ahead of UTC at one instant, in milliseconds. */
function zoneOffsetMs(at: Date): number {
  const p = numericParts(at);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar day an instant falls on in Spain. Months are 1-based. */
export function leagueDate(at: Date): { year: number; month: number; day: number } {
  const p = numericParts(at);
  return { year: p.year, month: p.month, day: p.day };
}

/**
 * The instant a Spanish wall-clock time names.
 *
 * Two passes, because the offset depends on the instant being looked for: the first
 * guesses with the offset at the naive UTC reading, the second corrects it in case a
 * daylight-saving change sits between the two. The sweep grid's slots (HH:45) never
 * fall inside the skipped or the repeated hour, so the answer is always unique.
 *
 * A day past the month's end rolls over, as `Date.UTC` does, so a caller can ask for
 * "tomorrow" as `day + 1`.
 */
export function leagueWallTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = naive - zoneOffsetMs(new Date(naive));
  instant = naive - zoneOffsetMs(new Date(instant));
  return new Date(instant);
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
