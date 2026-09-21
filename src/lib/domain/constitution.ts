/**
 * The Constitution of the Fantasy Comité: the league's own law, written down.
 *
 * None of this comes from an API. Every article was ruled by the league in conversation,
 * and until now they lived in a group chat, in three different pages of this portal, and
 * in the heads of the people they bind. A rule nobody can point at is a rule somebody
 * disputes on the week it costs them something.
 *
 * The articles are DATA rather than markup for one reason: written prose drifts from the
 * arithmetic that enforces it. `constitution.test.ts` reads both — the words here and the
 * constants in `breakfast.ts` and `market.ts` — and fails when they stop agreeing. That is
 * why the numbers below are written out literally instead of interpolated: a body built
 * from `SHIELD_ROUNDS` could never contradict it, and could never be caught either.
 */

export type ArticleKey =
  | "stakes"
  | "breakfast"
  | "apology"
  | "denigration"
  | "holding";

export type Article = {
  key: ArticleKey;
  /** Its place in the document, from 1. */
  number: number;
  title: string;
  /** The article itself, a paragraph to an entry. */
  body: string[];
  /** The page where the portal applies it, or null for an article no page enforces. */
  appliedAt: { href: string; label: string } | null;
};

/** What each manager pays to enter the season. */
export const ENTRY_FEE_EUROS = 15;

/** The pot's split, in per cent: champion, runner-up, third. */
export const PRIZE_SHARES = [65, 25, 10] as const;

export const ARTICLES: Article[] = [
  {
    key: "stakes",
    number: 1,
    title: "The stakes",
    body: [
      "Every manager pays 15 € to play the season. The whole of it is prize money — the league keeps nothing back.",
      "The pot is settled at the end of the season and split three ways: 65 % to the champion, 25 % to the runner-up and 10 % to third place. Nobody else is paid.",
    ],
    // The one article no page enforces. Nothing has ever been paid through this portal,
    // and a link to a page that cannot settle up would promise something untrue.
    appliedAt: null,
  },
  {
    key: "breakfast",
    number: 2,
    title: "Breakfast",
    body: [
      "The team that finishes a round last brings breakfast, on the Wednesday after the round.",
      "Bringing it shields that team for the next 3 rounds. While a team is shielded the duty walks up the table to the next team that is not: the second from bottom, or the third from bottom when the two below it are both shielded.",
      "Teams level at the bottom all bring it. And somebody always brings it — if every team were shielded the shields yield and the bottom brings it anyway.",
    ],
    appliedAt: { href: "/standings", label: "Standings" },
  },
  {
    key: "apology",
    number: 3,
    title: "The apology",
    body: [
      "Each round, every manager names the two teams they believe will finish it last.",
      "Name a team that goes on to finish the round first, and you owe the league a message of humility asking its pardon. Teams level at the top all count: naming any of them is naming a winner.",
    ],
    appliedAt: { href: "/necroporra", label: "Necroporra" },
  },
  {
    key: "denigration",
    number: 4,
    title: "The denigration",
    body: [
      "Name a team that goes on to finish the round last, and finish that same round first yourself, and you have earned the right to send that team a denigrating message.",
      "Both halves are required. Calling the bottom correctly is worth a point either way; the right to use it is only earned by the manager who also took the round.",
    ],
    appliedAt: { href: "/necroporra", label: "Necroporra" },
  },
  {
    key: "holding",
    number: 5,
    title: "The holding rule",
    body: [
      "No manager sells a player within 5 days of buying them. This is the league's own rule and not LaLiga's: the game permits the sale, and nothing but the register stops it.",
    ],
    appliedAt: { href: "/fair-play", label: "Fair play" },
  },
];

/** One article by name, so a test or a page can cite it without counting positions. */
export function articleOn(key: ArticleKey): Article {
  const article = ARTICLES.find((candidate) => candidate.key === key);
  // Unreachable through the type, and thrown rather than defaulted so a key renamed on
  // one side of the portal cannot quietly print nothing.
  if (!article) throw new Error(`No article for ${key}`);
  return article;
}

export type Prize = {
  /** 1, 2, 3 — the place this is paid for. */
  place: number;
  /** Its share of the pot, in per cent. */
  share: number;
  cents: number;
};

/**
 * What the pot holds and what each place takes, given how many managers are in.
 *
 * In cents, and divided in cents, because "65 % of 195 €" is the sort of arithmetic that
 * pays out 126.74 € when it is done in floating point. The shares are whole multiples of
 * 5 % of a whole number of euros, so today every division is exact; the test asserts the
 * three prizes add back up to the pot rather than trusting that to stay true.
 */
export function prizePot(teamCount: number): { potCents: number; prizes: Prize[] } {
  const potCents = teamCount * ENTRY_FEE_EUROS * 100;
  return {
    potCents,
    prizes: PRIZE_SHARES.map((share, i) => ({
      place: i + 1,
      share,
      cents: Math.round((potCents * share) / 100),
    })),
  };
}

/**
 * The league's money, as the league writes it: "126.75 €", the sign after the figure.
 *
 * Always two decimals. A prize of 19.50 € printed as "19.5 €" beside 126.75 € breaks the
 * column, and this portal sets every figure a reader compares in the mono face for
 * exactly that reason.
 */
export function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}
