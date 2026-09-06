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
 * These types describe the API's own shape, and they are internal to
 * `lib/fantasy-client/`. Nothing outside this directory may import them: the mapped
 * `StandingRow` and `Gameweek` in `./index.ts` are what crosses the boundary. That is
 * the whole point of the anti-corruption layer — when the raw entry travels, so does
 * every assumption about what its fields mean.
 */
export type StandingEntry = z.infer<typeof standingEntrySchema>;
export type CurrentWeek = z.infer<typeof currentWeekSchema>;
export type League = z.infer<typeof leaguesSchema>[number];
