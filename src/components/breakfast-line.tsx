import type { BreakfastDuty } from "@/lib/domain/breakfast";
import { joinNames } from "@/lib/domain/prose";

/** A team's name, or its id when the roster does not know it — never an empty gap. */
function nameFor(names: Map<string, string>, teamId: string): string {
  return names.get(teamId) ?? teamId;
}

/**
 * The one sentence that says who brings breakfast this round.
 *
 * A `null` duty means the round has no last place yet — still being played, per
 * `breakfastDuties`' own reading of that state — so it gets a sentence of its own
 * rather than a blank space where a name should be. There is nothing else on this line:
 * no icon, no card, just the fact stated the way the league says it out loud.
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

  return (
    <p className="mt-4 text-[12.5px]">
      Round {duty.gameweek}: {joinNames(bringers)} {verb} breakfast.
    </p>
  );
}
