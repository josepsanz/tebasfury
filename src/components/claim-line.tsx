import Link from "next/link";

/**
 * Your team, at the top of the home page — and the only door to `/claim`: the nav has
 * six destinations across two tiers already, and claiming is done once in a lifetime
 * (Ruling 6).
 *
 * Claimed, the manager's name is a heading in amber. It used to be the dimmest text on
 * the page, at 11.5px in `--board-ink-dim`, sitting above a strip of figures that were
 * entirely about that team and never named it. Amber is the portal's one word for "you",
 * so this is the same claim the standings makes about a row, made where the reader lands.
 *
 * It also gives the figures below a heading, which every other section on this page has.
 * The name links to that manager's own page, which is where the rest of their season is.
 */
export function ClaimLine({
  myTeamName,
  myTeamId,
}: {
  myTeamName: string | null;
  myTeamId?: string | null;
}) {
  if (myTeamName === null) {
    return (
      <p className="mt-3 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        No team claimed yet.{" "}
        <Link href="/claim" className="underline underline-offset-4">
          Claim yours
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{ color: "var(--board-you)" }}
        >
          your team
        </span>
        <Link href="/claim" className="text-[10.5px] underline underline-offset-4" style={{ color: "var(--board-ink-dim)" }}>
          change
        </Link>
      </div>
      {myTeamId ? (
        <Link
          href={`/teams/${myTeamId}`}
          className="text-[19px] underline decoration-[var(--board-line)] underline-offset-4"
          style={{ color: "var(--board-you)" }}
        >
          {myTeamName}
        </Link>
      ) : (
        <span className="text-[19px]" style={{ color: "var(--board-you)" }}>
          {myTeamName}
        </span>
      )}
    </div>
  );
}
