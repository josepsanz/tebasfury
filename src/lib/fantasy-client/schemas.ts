import { z } from "zod";

/**
 * A team as the standing endpoint reports it.
 *
 * `teamValue`, `teamPoints` and `teamMoney` are CURRENT state even inside a past
 * gameweek's response — verified across all 13 teams, identical between the week-3
 * response and today's. Only the entry's `points` and `position` are week-specific.
 *
 * `teamMoney` is absent entirely (not `null`) for the league admin's own team in
 * both captured responses — verified for the same manager in both the live and
 * the settled fixture — so it is optional as well as nullable.
 */
const standingTeamSchema = z.object({
  id: z.string(),
  managerId: z.number(),
  teamValue: z.number(),
  teamPoints: z.number(),
  teamMoney: z.number().nullable().optional(),
  isAdmin: z.boolean(),
  manager: z.object({
    id: z.string(),
    managerName: z.string(),
  }),
});

/**
 * A live gameweek carries `livePoints` and `previousPosition`; a settled one does
 * not. Both are optional for that reason, and their absence is meaningful.
 */
export const standingEntrySchema = z.object({
  position: z.number(),
  previousPosition: z.number().optional(),
  points: z.number(),
  livePoints: z.number().optional(),
  team: standingTeamSchema,
});

export const standingSchema = z.array(standingEntrySchema);

export const currentWeekSchema = z.object({
  weekNumber: z.number(),
  isLive: z.boolean(),
  nextWeek: z.number().nullable().optional(),
  previousWeek: z.number().nullable().optional(),
  openingWeekDate: z.coerce.date(),
  closingWeekDate: z.coerce.date(),
});

export const leaguesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    managersNumber: z.number(),
  }),
);

/**
 * One gameweek's score for one player, as the catalogue reports it.
 *
 * The entry LABELS ITSELF with its gameweek, and that label is the only safe way to
 * read it. In the capture the arrays are sparse and unordered: two clubs (team ids 6
 * and 16, 47 players) had played their gameweek-6 fixture and not their fourth, so
 * their arrays run 1, 2, 3, 6 — with gameweek 5 absent from all 836 players — and 179
 * players' arrays are not in ascending order at all. Reading the array by index would
 * have filed a gameweek-6 score under gameweek 4.
 */
const weekPointsEntrySchema = z.object({
  weekNumber: z.coerce.number(),
  points: z.number(),
});

/**
 * A player as the catalogue endpoint reports them.
 *
 * `marketValue` is CURRENT state — the same trap as `teamValue` on the standing
 * endpoint. There is no market-value history anywhere in this API; it can only be
 * accumulated forward, which is why the sync writes a dated snapshot rather than a
 * column it overwrites.
 *
 * `weekPoints` is the reason no per-player call is needed: it carries the points for
 * every gameweek the player has played so far, for every player, in one response.
 *
 * The catalogue sends its numbers as strings — `id`, `positionId`, `marketValue` and
 * `lastSeasonPoints` all arrive quoted, while `points` and `averagePoints` do not.
 * Coercion absorbs that rather than spreading it, and it costs nothing if the API
 * ever settles on one or the other.
 *
 * There is no `team` object here: the catalogue names a `teamId` and nothing else. The
 * NAME behind that id comes from the squad response instead, where `playerMaster.team`
 * carries it in the same id space — which is why club affiliation costs no extra call.
 */
export const playerEntrySchema = z.object({
  id: z.coerce.string(),
  nickname: z.string(),
  positionId: z.coerce.number(),
  playerStatus: z.string(),
  marketValue: z.coerce.number(),
  points: z.number(),
  averagePoints: z.number(),
  lastSeasonPoints: z.coerce.number().nullable().optional(),
  weekPoints: z.array(weekPointsEntrySchema),
  image: z.string().nullable().optional(),
  teamId: z.coerce.string(),
});

export const playersSchema = z.array(playerEntrySchema);

/**
 * The club a player belongs to, nested under `playerMaster` on a squad response.
 *
 * `team` is OPTIONAL and that is the point: all 15 entries in the committed fixture
 * carry it, but one capture is not a specification, and a squad response that omits
 * it must leave the club unlearned rather than fail the sweep for that team.
 *
 * The response also carries `assets` and `badgeWhite`. They are deliberately not
 * described here — nothing has a use for them, and an unused field is an assumption
 * travelling for free.
 */
const squadTeamSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  slug: z.string(),
  badgeColor: z.string().nullable().optional(),
});

/**
 * One league team's squad. The entries nest the catalogue player under
 * `playerMaster` in every response seen so far, but a flat `id` is accepted too —
 * and `getSquad`'s test asserts that no entry is silently dropped, so a third shape
 * fails loudly instead of quietly shrinking a squad.
 */
export const squadSchema = z.object({
  id: z.coerce.string(),
  players: z.array(
    z.object({
      id: z.coerce.string().optional(),
      playerMaster: z
        .object({ id: z.coerce.string(), team: squadTeamSchema.optional() })
        .optional(),
      /**
       * What it costs to take this player off their owner, and when they stop being
       * protected. Both are OPTIONAL rather than required, because a missing field must
       * cost one player's clause figure and not the whole sweep: `getSquad` is called
       * thirteen times a run, and a schema that fails on an absent extra would stop the
       * catalogue, the squads and the market log along with it.
       *
       * `buyoutClause` is NOT derivable from market value — measured across one captured
       * squad the ratio ran from 1.00 to 7.15, because an owner can raise their own
       * clause to shield a player. Only the API knows it.
       */
      buyoutClause: z.coerce.number().optional(),
      buyoutClauseLockedEndTime: z.coerce.date().optional(),
      /** An extra 24-hour shield an owner may apply. Stored, not yet shown. */
      isShielded: z.boolean().optional(),
    }),
  ),
});

/**
 * One entry in the league activity feed.
 *
 * Everything but the id, the type, the actor and the timestamp is OPTIONAL, and that is
 * the shape of the data rather than caution about it: a weekly bookkeeping entry
 * carries no player, a market purchase carries no counterparty, and one observed type
 * carries neither an amount nor a second party. A schema that required them would fail
 * the sweep on data the API sends every day.
 *
 * `activityTypeId` stays a plain number. The set is open — the probe saw six types and
 * could name three — so an enum here would either reject tomorrow's type or invite a
 * `default: throw`, and both lose data that a rolling seven-day window never returns.
 *
 * `createdAt` is left a string and parsed on the far side of the mapping, where the
 * offset it carries (`+02:00`) becomes an instant. Coercing it here would hide which
 * layer owns that conversion.
 */
export const activityEntrySchema = z.object({
  id: z.coerce.string(),
  activityTypeId: z.coerce.number(),
  user1Id: z.coerce.number(),
  user2Id: z.coerce.number().nullable().optional(),
  playerMasterId: z.coerce.string().nullable().optional(),
  amount: z.coerce.number().nullable().optional(),
  weekNumber: z.coerce.number().nullable().optional(),
  createdAt: z.string(),
});

export const activitySchema = z.array(activityEntrySchema);

/**
 * These types describe the API's own shape, and they are internal to
 * `lib/fantasy-client/`. Nothing outside this directory may import them: the mapped
 * `StandingRow` and `Gameweek` in `./index.ts` are what crosses the boundary. That is
 * the whole point of the anti-corruption layer — when the raw entry travels, so does
 * every assumption about what its fields mean.
 */
export type StandingEntry = z.infer<typeof standingEntrySchema>;
export type CurrentWeek = z.infer<typeof currentWeekSchema>;
export type League = z.infer<typeof leaguesSchema>[number];
export type PlayerEntry = z.infer<typeof playerEntrySchema>;
export type Squad = z.infer<typeof squadSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
