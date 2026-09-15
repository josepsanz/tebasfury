import { HOLD_HOURS } from "./market";

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

/**
 * How far a holding fell short of the five-day rule, in the largest unit that reaches one.
 *
 * "12 minutes short", "1 day short". The unit is the point: three of the four breaches
 * this league has committed missed the rule by MINUTES, and a shortfall written in days
 * would round every one of them to "1 day short" and accuse three managers of something
 * they did not do. It sits beside the exact period the feed already draws, so the rounded
 * phrase can never say more than the number next to it.
 *
 * Throws for a holding that met the rule. There is no shortfall to describe, and the only
 * way to arrive here with one is a caller that skipped the `breach` filter — which should
 * fail loudly rather than print a sentence that accuses somebody wrongly.
 */
export function shortOfTheHold(heldHours: number): string {
  const missing = HOLD_HOURS - heldHours;
  if (missing <= 0) {
    throw new RangeError(`${heldHours} hours is not short of the ${HOLD_HOURS}-hour hold`);
  }

  const minutes = Math.round(missing * 60);
  if (minutes < 1) return "seconds short";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} short`;

  const hours = Math.round(missing);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} short`;

  const days = Math.round(missing / 24);
  return `${days} ${days === 1 ? "day" : "days"} short`;
}
