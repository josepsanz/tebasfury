import type { BreakfastDuty } from "@/lib/domain/breakfast";
import { joinNames } from "@/lib/domain/prose";

/** A team's name, or its id when the roster does not know it — never an empty gap. */
function nameFor(names: Map<string, string>, teamId: string): string {
  return names.get(teamId) ?? teamId;
}

/**
 * The sentences that say who brings breakfast.
 *
 * A `null` duty means no round to speak for — the gap between teams syncing and the
 * first gameweek landing — so it gets a sentence of its own rather than a blank space
 * where a name should be. There is nothing else on this line: no icon, no card, just the
 * fact stated the way the league says it out loud.
 *
 * A round still being played gets TWO sentences, because it holds two facts of different
 * weight. Who is shielded was settled by the rounds that have finished and is stated
 * plainly. Who brings it is read off points that are still climbing, so it opens with the
 * word "provisional" and says outright that it moves. Keeping them apart is the point:
 * a reader must be able to tell which half they can hold somebody to.
 *
 * Both sentences name people rather than pointing at them — they get screenshotted into
 * the group chat and read on their own, with no table underneath.
 */
export function BreakfastLine({
  duty,
  gameweek,
  names,
}: {
  duty: BreakfastDuty | null;
  gameweek: number;
  names: Map<string, string>;
}) {
  if (duty === null) {
    return (
      <p className="mt-4 text-[12.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Round {gameweek} is still being played.
      </p>
    );
  }

  const bringers = duty.bringers.map((teamId) => nameFor(names, teamId));
  const verb = bringers.length === 1 ? "brings" : "bring";

  if (!duty.provisional) {
    return (
      <p className="mt-4 text-[12.5px]">
        Round {duty.gameweek}: {joinNames(bringers)} {verb} breakfast.
      </p>
    );
  }

  // Sorted on the name that is read, not on the order the duty arrived in: the shields
  // are built by walking the round's rows, and row order from the database is undefined,
  // so an unsorted sentence would swap the same two names between loads. `bringers` is
  // sorted in the domain for exactly this reason.
  const shielded = duty.shielded.map((s) => nameFor(names, s.teamId)).sort();

  return (
    <>
      {shielded.length > 0 ? (
        <p className="mt-4 text-[12.5px]">
          {joinNames(shielded)} {shielded.length === 1 ? "is" : "are"} shielded for round{" "}
          {duty.gameweek}.
        </p>
      ) : null}
      <p
        className={shielded.length > 0 ? "mt-1 text-[12.5px]" : "mt-4 text-[12.5px]"}
        style={{ color: "var(--board-ink-dim)" }}
      >
        {bringers.length === 0 ? (
          <>
            Nobody has scored in round {duty.gameweek} yet, so there is no last place to name.
          </>
        ) : (
          <>
            Provisional: as it stands, {joinNames(bringers)} {verb} breakfast, and that changes
            while the round is played.
          </>
        )}
      </p>
    </>
  );
}
