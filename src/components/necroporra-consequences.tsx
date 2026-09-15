import type { RoundConsequences } from "@/lib/domain/necroporra";
import { joinNames } from "@/lib/domain/prose";

/** A team's name, or its id when the roster does not know it — never an empty gap. */
function nameFor(names: Map<string, string>, teamId: string): string {
  return names.get(teamId) ?? teamId;
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
  const { apologists, hateTargets, winnerTeamIds } = consequences;
  const owing = apologists.map((teamId) => nameFor(names, teamId));
  const winners = winnerTeamIds.map((teamId) => nameFor(names, teamId));

  // Built as strings rather than assembled out of coloured spans. Two reasons, and the
  // second is the real one: a sentence broken into fragments is a sentence no test can
  // assert whole, and colour inside a sentence is decoration — this portal's rule is that
  // the words carry the meaning and the colour only ever repeats them.
  //
  // It OPENS on the winners, by name. This is the line somebody screenshots into the
  // group chat, so "they named the winner" — which sends the reader back up the page to
  // find out who that was — is not good enough. On a tie every co-leader is named: the
  // owner ruled they count equally however the API ordered them.
  const won =
    winners.length === 0
      ? null
      : `${joinNames(winners)} won the round${winners.length > 1 ? " together" : ""}.`;

  const verdict =
    won === null
      ? null
      : owing.length === 0
        ? `${won} Nobody named them for last.`
        : `${won} ${joinNames(owing)} named ${
            winners.length > 1 ? "one of them" : "them"
          } for last, and ${owing.length === 1 ? "owes" : "owe"} the league an apology.`;

  const hated = hateTargets.map((teamId) => nameFor(names, teamId));
  const hate =
    won === null || hated.length === 0
      ? null
      : `${joinNames(hated)} finished last as well, so ${joinNames(winners)} ${
          winners.length === 1 ? "sends" : "send"
        } ${hated.length === 1 ? "them" : "them all"} a hate message.`;

  return (
    <div className="mt-3">
      <p className="text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Name a team that wins the round and you owe the league an apology — teams level
        at the top all count. Do it in a round you finished last, and the winner sends you
        a hate message.
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
