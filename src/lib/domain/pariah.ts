/**
 * What the pariah page says to whoever lands on it, one line per visit.
 *
 * Insults about the standing, never about the person: the league shuns a manager for
 * something they did, and the page is the sentence being served, not a fresh offence.
 */
export const PARIAH_LINES = [
  "The league has looked at you and decided it has seen enough.",
  "You may watch. You may not touch. Like a child at a sweet shop window.",
  "Your scouting privileges have been revoked. Your dignity went first.",
  "Other managers' squads are for managers. You are something else now.",
  "Even the substitutes' bench has a better view than you.",
  "Every league needs a cautionary tale. Congratulations on the role.",
] as const;

/** One line, from a roll in [0, 1): the clock at the page, a fixed number in tests. */
export function pariahLine(roll: number): string {
  const index = Math.min(Math.floor(roll * PARIAH_LINES.length), PARIAH_LINES.length - 1);
  return PARIAH_LINES[index];
}
