import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import {
  loadBallots,
  loadMyBallot,
  loadRounds,
  loadVoterNames,
} from "@/lib/necroporra";
import {
  isOpen,
  lastPlaced,
  picksOf,
  seasonTable,
  type Ballot,
} from "@/lib/domain/necroporra";
import { requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { NecroporraBallot } from "@/components/necroporra-ballot";
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

export default async function NecroporraPage() {
  const session = await requireSession();
  const now = new Date();

  const [rounds, { snapshots, teams }, myTeam, names] = await Promise.all([
    loadRounds(db),
    loadSnapshots(db),
    loadMyTeam(db, { userId: session.user.id }),
    loadVoterNames(db),
  ]);

  const resolved = rounds.map((round) => ({
    ...round,
    lastTeamId: lastPlaced(snapshots, round.gameweek),
  }));
  const ballots = await loadBallots(db, rounds.map((r) => r.gameweek));

  // The one round still taking votes. There is at most one: the sync opens the week the
  // API calls current, and the previous one closed when it kicked off.
  const open = resolved.find((round) => isOpen(round, now)) ?? null;
  const myBallot = open ? await loadMyBallot(db, { gameweek: open.gameweek, userId: session.user.id }) : null;

  const teamName = new Map(teams.map((t) => [t.id, t.managerName]));
  const table = seasonTable(ballots, resolved, names);

  const past = resolved.filter((round) => !isOpen(round, now)).sort((a, b) => b.gameweek - a.gameweek);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Necroporra"
        note="Name the two teams you think finish the round last. One point if you get it."
        meta={rounds.length === 0 ? "no rounds yet" : `${rounds.length} rounds`}
      />

      <h2 className="mt-8 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        {open === null ? "Nothing open" : `Round ${open.gameweek} — closes ${madrid(open.closesAt)}`}
      </h2>

      {open === null ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          {rounds.length === 0
            ? "No round has been opened yet. One appears within a day of the last round closing."
            : "Voting is shut until the next round is named, which happens a few days before it kicks off."}
        </p>
      ) : myTeam === null ? (
        // Said, not hidden: an account with no claim is a person who has not finished
        // signing up, and "claim your team" is a thing they can act on.
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
          // Your own team is not offered. The action refuses it too — this only spares
          // the reader a refusal they could not have avoided.
          teams={teams.filter((team) => team.id !== myTeam.teamId)}
          chosen={myBallot ? picksOf(myBallot) : []}
          action={vote}
        />
      )}

      <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
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

      {past.length === 0 ? null : (
        <>
          <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
            Closed rounds
          </h2>
          {/* Every ballot, now that it is too late to copy one. Before the deadline the
              page shows a voter only their own picks, because committing early is the
              whole game. */}
          {past.map((round) => (
            <PastRound
              key={round.gameweek}
              gameweek={round.gameweek}
              lastTeamId={round.lastTeamId}
              ballots={ballots.filter((b) => b.gameweek === round.gameweek)}
              names={names}
              teamName={teamName}
            />
          ))}
        </>
      )}
    </section>
  );
}

function PastRound({
  gameweek,
  lastTeamId,
  ballots,
  names,
  teamName,
}: {
  gameweek: number;
  lastTeamId: string | null;
  ballots: Ballot[];
  names: Map<string, string>;
  teamName: Map<string, string>;
}) {
  return (
    <div className="mt-4">
      <p className="text-[12px]">
        <span style={{ color: "var(--board-ink-dim)" }}>Round {gameweek} — </span>
        {lastTeamId === null ? (
          // "Not yet" is not "nobody": a round still being played, or one whose standings
          // have not settled, must not read as a round everybody lost.
          <span style={{ color: "var(--board-ink-dim)" }}>still being decided</span>
        ) : (
          <>
            last was <span style={{ color: "var(--board-alert)" }}>{teamName.get(lastTeamId) ?? lastTeamId}</span>
          </>
        )}
      </p>

      {ballots.length === 0 ? (
        <p className="mt-1 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
          Nobody voted.
        </p>
      ) : (
        <ul className="mt-1">
          {ballots.map((ballot) => {
            const picks = picksOf(ballot);
            const hit = lastTeamId !== null && picks.includes(lastTeamId);
            return (
              <li
                key={ballot.userId}
                className="text-[11.5px]"
                style={{ color: hit ? "var(--board-gain)" : "var(--board-ink-dim)" }}
              >
                {names.get(ballot.userId) ?? ballot.userId}:{" "}
                {picks.map((id) => teamName.get(id) ?? id).join(", ") || "—"}
                {hit ? " ✓" : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
