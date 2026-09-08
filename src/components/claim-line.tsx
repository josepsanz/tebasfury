import Link from "next/link";

/**
 * One slot on the home page, two states. It is the only door to `/claim`: the nav has
 * six destinations across two tiers already, and this is done once in a lifetime
 * (Ruling 6).
 */
export function ClaimLine({ myTeamName }: { myTeamName: string | null }) {
  return (
    <p className="mt-3 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
      {myTeamName === null ? (
        <>
          No team claimed yet.{" "}
          <Link href="/claim" className="underline underline-offset-4">
            Claim yours
          </Link>
        </>
      ) : (
        <>
          Your team: {myTeamName} ·{" "}
          <Link href="/claim" className="underline underline-offset-4">
            change
          </Link>
        </>
      )}
    </p>
  );
}
