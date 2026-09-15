import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { loadBallots, loadMyBallot, loadRounds, loadVoters } from "@/lib/necroporra";
import type { RoundBallot } from "@/lib/domain/necroporra";
import {
  isOpen,
  roundLast,
  picksOf,
  roundBallots,
  roundConsequences,
  roundLeaders,
  haters,
  mostHated,
  seasonTable,
} from "@/lib/domain/necroporra";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { NecroporraBallot, type BallotTeam } from "@/components/necroporra-ballot";
import { NecroporraBallots } from "@/components/necroporra-ballots";
import { Haters, MostHated } from "@/components/necroporra-hate";
import { NecroporraConsequences } from "@/components/necroporra-consequences";
import { joinNames } from "@/lib/domain/prose";
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

/**
 * The ballot form as it appears inside somebody else's row.
 *
 * The same form a manager uses for themselves, told whose row it is filling in and
 * labelled with their name — "Save Ana's picks" is a different promise from "Save my
 * picks", and the button should keep it. Both lists on this page hand it the round they
 * are drawing, which is how an admin can fill in a CLOSED round's row: the action lets
 * that through for an entered ballot and refuses it for your own.
 */
function BallotForRow({
  gameweek,
  row,
  teams,
}: {
  gameweek: number;
  row: RoundBallot;
  teams: BallotTeam[];
}) {
  return (
    <NecroporraBallot
      gameweek={gameweek}
      forTeamId={row.teamId}
      submitLabel={`Save ${row.name}'s picks`}
      // A team may not pick itself, so its own name has no business in its own ballot.
      teams={teams.filter((team) => team.id !== row.teamId)}
      chosen={row.picks}
      action={vote}
    />
  );
}

export default async function NecroporraPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const now = new Date();

  const [rounds, { snapshots, teams }, myTeam, voters] = await Promise.all([
    loadRounds(db),
    loadSnapshots(db),
    loadMyTeam(db, { userId: session.user.id }),
    loadVoters(db),
  ]);

  // The season table's names come from the voters themselves now. `loadVoterNames` existed
  // to map accounts to manager names; with the ballot on the team, the voter list already
  // carries both.
  const names = new Map(voters.map((voter) => [voter.teamId, voter.name]));

  const resolved = rounds.map((round) => ({
    ...round,
    lastTeamIds: roundLast(snapshots, round.gameweek),
    // Shown beside it, never scored: the Necroporra is only ever about the bottom, but a
    // round has two ends and the league reads both. Plural, because teams level at the
    // top are co-leaders however the API ordered them — the owner's ruling.
    firstTeamIds: roundLeaders(snapshots, round.gameweek),
  }));
  const ballots = await loadBallots(db, rounds.map((r) => r.gameweek));

  // At most one round takes votes: the sync opens the week the API calls current, and the
  // previous one closed when it kicked off.
  const open = resolved.find((round) => isOpen(round, now)) ?? null;
  const myBallot =
    open && myTeam ? await loadMyBallot(db, { gameweek: open.gameweek, teamId: myTeam.teamId }) : null;

  const teamName = new Map(teams.map((t) => [t.id, t.managerName]));
  const table = seasonTable(ballots, resolved, names);

  // Who may fill in somebody else's row. The mark the rows draw needs no lookup: it names
  // the act and not the person.
  const mayCastForOthers = decideAccess(session, { poll: ["voteFor"] }).kind === "allow";

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

  // Worked out once and read twice — by the sentence and by the marks on the rows — so
  // the two cannot name different people.
  const verdict =
    looking === null ? null : roundConsequences(ballots, looking.gameweek, looking);

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
            rows={roundBallots(voters, ballots, open.gameweek, [])}
            teamName={teamName}
            viewerTeamId={myTeam?.teamId ?? null}
            resolved={false}
            castFor={
              mayCastForOthers
                ? (row) => <BallotForRow gameweek={open.gameweek} row={row} teams={teams} />
                : null
            }
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
              key={row.teamId}
              className="grid grid-cols-[24px_1fr_auto] items-baseline gap-2 border-b px-2 py-[6px]"
              style={{
                borderColor: "var(--board-line)",
                background:
                  row.teamId === myTeam?.teamId
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

      {/* The season table above measures the voters. These two measure the voted, which is
          the half the group actually argues about — once league-wide, once at the reader. */}
      <h2 className={HEADING} style={{ color: "var(--board-ink-dim)" }}>
        Most hated
      </h2>
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Every vote cast this season. Two picks a round, so one week can name you twice.
      </p>
      <MostHated
        rows={mostHated(ballots, teamName)}
        viewerTeamId={myTeam?.teamId ?? null}
      />

      <h2 className={HEADING} style={{ color: "var(--board-ink-dim)" }}>
        Your haters
      </h2>
      {myTeam === null ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          This one is about your own team.{" "}
          <Link href="/claim" className="underline underline-offset-4">
            Claim yours
          </Link>{" "}
          to see who has been naming you.
        </p>
      ) : (
        <Haters rows={haters(ballots, myTeam.teamId, teamName)} />
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

          {/* Both ends of the round, on one line. `firstPlaced` and `lastPlaced` share a
              guard, so the winner can never be named for a round whose loser is not. */}
          <p className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]">
            {looking.lastTeamIds.length === 0 ? (
              // "Not yet" is not "nobody": a round whose standings have not settled must
              // not read as a round everybody lost.
              <span style={{ color: "var(--board-ink-dim)" }}>Still being decided.</span>
            ) : (
              <>
                <span>
                  <span style={{ color: "var(--board-ink-dim)" }}>Finished first: </span>
                  <span style={{ color: "var(--board-gain)" }}>
                    {looking.firstTeamIds.length === 0
                      ? "—"
                      : joinNames(
                          looking.firstTeamIds.map((id) => teamName.get(id) ?? id),
                        )}
                  </span>
                </span>
                <span>
                  <span style={{ color: "var(--board-ink-dim)" }}>Finished last: </span>
                  <span style={{ color: "var(--board-alert)" }}>
                    {joinNames(looking.lastTeamIds.map((id) => teamName.get(id) ?? id))}
                  </span>
                </span>
              </>
            )}
          </p>

          {verdict === null ? null : (
            <NecroporraConsequences consequences={verdict} names={teamName} />
          )}

          <NecroporraBallots
            rows={roundBallots(voters, ballots, looking.gameweek, looking.lastTeamIds)}
            teamName={teamName}
            viewerTeamId={myTeam?.teamId ?? null}
            resolved={looking.lastTeamIds.length > 0}
            consequences={verdict}
            castFor={
              mayCastForOthers
                ? (row) => <BallotForRow gameweek={looking.gameweek} row={row} teams={teams} />
                : null
            }
          />
        </>
      )}
    </section>
  );
}
