import type { RoundConsequences } from "@/lib/domain/necroporra";

/** A team's name, or its id when the roster does not know it — never an empty gap. */
function nameFor(names: Map<string, string>, teamId: string): string {
  return names.get(teamId) ?? teamId;
}

/**
 * "A", "A and B", or "A, B and C" — the portal's list, no Oxford comma before the last
 * "and". The same shape `BreakfastLine` writes.
 */
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What a decided round costs, said out loud.
 *
 * The rules are printed whether or not anybody owes anything this week: they are two
 * league rules that live nowhere else, and a rule only stated on the weeks it bites is a
 * rule somebody will dispute on the week it does.
 *
 * The verdict itself waits for a decided round. "Nobody named the winner" is a result
 * worth printing — a week the whole league read the table sensibly — but it is only true
 * once the round has ends, so an undecided round gets the rules and no accusation.
 */
export function NecroporraConsequences({
  consequences,
  names,
}: {
  consequences: RoundConsequences;
  names: Map<string, string>;
}) {
  const { apologists, hateTarget, winnerTeamId } = consequences;
  const owing = apologists.map((teamId) => nameFor(names, teamId));

  // Built as strings rather than assembled out of coloured spans. Two reasons, and the
  // second is the real one: a sentence broken into fragments is a sentence no test can
  // assert whole, and colour inside a sentence is decoration — this portal's rule is that
  // the words carry the meaning and the colour only ever repeats them.
  const verdict =
    winnerTeamId === null
      ? null
      : owing.length === 0
        ? "Nobody named the winner."
        : `${joinNames(owing)} ${owing.length === 1 ? "owes" : "owe"} the league an apology: they named the winner.`;

  const hate =
    winnerTeamId === null || hateTarget === null
      ? null
      : `${nameFor(names, hateTarget)} finished last as well, so ${nameFor(names, winnerTeamId)} sends them a hate message.`;

  return (
    <div className="mt-3">
      <p className="text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Name the team that wins the round and you owe the league an apology. Do it in a
        round you finished last, and the winner sends you a hate message.
      </p>

      {verdict === null ? null : (
        <p
          className="mt-2 text-[12.5px]"
          style={{ color: owing.length === 0 ? "var(--board-ink-dim)" : undefined }}
        >
          {verdict}
        </p>
      )}

      {hate === null ? null : (
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--board-alert)" }}>
          {hate}
        </p>
      )}
    </div>
  );
}
