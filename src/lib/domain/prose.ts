/**
 * "A", "A and B", or "A, B and C" — the way this portal writes a list of names, with no
 * Oxford comma before the last "and".
 *
 * Lived twice as a local helper, in the breakfast line and in the Necroporra's verdict,
 * each with a comment saying a shared one would be the larger thing. A third caller
 * settles that: three copies of a sentence rule is how two of them end up different.
 */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
