import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import {
  loadBallots,
  loadMyBallot,
  loadRounds,
  loadVoterNames,
  loadVoters,
} from "@/lib/necroporra";
import {
  isOpen,
  lastPlaced,
  picksOf,
  roundBallots,
  seasonTable,
} from "@/lib/domain/necroporra";
import { requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { NecroporraBallot } from "@/components/necroporra-ballot";
import { NecroporraBallots } from "@/components/necroporra-ballots";
import { RoundPicker } from "@/components/round-picker";
import { vote } from "./actions";

/** The deadline as the league would say it, in the league's own timezone. */
const madrid = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);

const HEADING = "mt-10 text-[11px] uppercase tracking-[0.06em]";

export default async function NecroporraPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const now = new Date();

  const [rounds, { snapshots, teams }, myTeam, names, voters] = await Promise.all([
    loadRounds(db),
    loadSnapshots(db),
    loadMyTeam(db, { userId: session.user.id }),
    loadVoterNames(db),
    loadVoters(db),
  ]);

  const resolved = rounds.map((round) => ({
    ...round,
    lastTeamId: lastPlaced(snapshots, round.gameweek),
  }));
  const ballots = await loadBallots(db, rounds.map((r) => r.gameweek));

  // At most one round takes votes: the sync opens the week the API calls current, and the
  // previous one closed when it kicked off.
  const open = resolved.find((round) => isOpen(round, now)) ?? null;
  const myBallot = open
    ? await loadMyBallot(db, { gameweek: open.gameweek, userId: session.user.id })
    : null;

  const teamName = new Map(teams.map((t) => [t.id, t.managerName]));
  const table = seasonTable(ballots, resolved, names);

  // Newest first, so the picker opens on the round just decided rather than on August.
  const closed = resolved
    .filter((round) => !isOpen(round, now))
    .sort((a, b) => b.gameweek - a.gameweek);

  // A round that is not a number, or one nothing was opened for, falls back to the most
  // recent — a hand-edited URL is not an exceptional condition worth a 404.
  const asked = (await searchParams).round;
  const wanted = Number(Array.isArray(asked) ? asked[0] : asked);
  const looking =
    closed.find((round) => round.gameweek === wanted) ?? closed[0] ?? null;

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Necroporra"
        note="Name the two teams you think finish the round last. One point if you get it."
        meta={rounds.length === 0 ? "no rounds yet" : `${rounds.length} rounds`}
      />

      <h2 className={HEADING} style={{ color: "var(--board-ink-dim)" }}>
        {open === null ? "Nothing open" : `Round ${open.gameweek} — closes ${madrid(open.closesAt)}`}
      </h2>

      {open === null ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          {rounds.length === 0
            ? "No round has been opened yet. One appears within a day of the last round closing."
            : "Voting is shut until the next round is named, which happens a few days before it kicks off."}
        </p>
      ) : myTeam === null ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          The Necroporra is per manager.{" "}
          <Link href="/claim" className="underline underline-offset-4">
            Claim your team
          </Link>{" "}
          and you can vote.
        </p>
      ) : (
        <NecroporraBallot
          gameweek={open.gameweek}
          teams={teams.filter((team) => team.id !== myTeam.teamId)}
          chosen={myBallot ? picksOf(myBallot) : []}
          action={vote}
        />
      )}

      {open === null ? null : (
        <>
          <h3 className="mt-6 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
            Everyone&rsquo;s picks so far
          </h3>
          <NecroporraBallots
            rows={roundBallots(voters, ballots, open.gameweek, null)}
            teamName={teamName}
            viewerId={session.user.id}
            resolved={false}
          />
        </>
      )}

      <h2 className={HEADING} style={{ color: "var(--board-ink-dim)" }}>
        Season
      </h2>
      {table.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          Nobody has scored yet. The table fills in as rounds are decided.
        </p>
      ) : (
        <ol className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
          {table.map((row, i) => (
            <li
              key={row.userId}
              className="grid grid-cols-[24px_1fr_auto] items-baseline gap-2 border-b px-2 py-[6px]"
              style={{
                borderColor: "var(--board-line)",
                background:
                  row.userId === session.user.id
                    ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                    : undefined,
              }}
            >
              <span
                className="text-[12px] tabular-nums"
                style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
              >
                {i + 1}
              </span>
              <span className="truncate text-[13px]">{row.name}</span>
              <span
                className="text-right text-[13px] tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {row.points}
                <span className="text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {" "}
                  from {row.rounds}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {looking === null ? null : (
        <>
          <h2 className={HEADING} style={{ color: "var(--board-ink-dim)" }}>
            Past rounds
          </h2>
          {/* A picker rather than every round stacked down the page: by May there are
              thirty-eight of them, and the one anybody wants is rarely the oldest. Same
              component the standings use, pointed at this route. */}
          <div className="mt-3">
            <RoundPicker
              gameweeks={closed.map((round) => round.gameweek).reverse()}
              selected={looking.gameweek}
              basePath="/necroporra"
              allLabel={null}
              legend="Round"
            />
          </div>

          <p className="mt-3 text-[12px]">
            {looking.lastTeamId === null ? (
              // "Not yet" is not "nobody": a round whose standings have not settled must
              // not read as a round everybody lost.
              <span style={{ color: "var(--board-ink-dim)" }}>Still being decided.</span>
            ) : (
              <>
                <span style={{ color: "var(--board-ink-dim)" }}>Finished last: </span>
                <span style={{ color: "var(--board-alert)" }}>
                  {teamName.get(looking.lastTeamId) ?? looking.lastTeamId}
                </span>
              </>
            )}
          </p>

          <NecroporraBallots
            rows={roundBallots(voters, ballots, looking.gameweek, looking.lastTeamId)}
            teamName={teamName}
            viewerId={session.user.id}
            resolved={looking.lastTeamId !== null}
          />
        </>
      )}
    </section>
  );
}
