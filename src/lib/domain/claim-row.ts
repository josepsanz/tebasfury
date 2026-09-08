export type ClaimRow = { teamId: string; managerName: string; claimedBy: string | null };

export type RowState = "free" | "mine" | "taken";

/**
 * What a row is, from where the reader sits.
 *
 * `taken` deliberately carries no identity. Who holds a team is never rendered
 * (Ruling 4), so the only thing this distinction has to support is which control the
 * row gets — and "somebody" is enough for that.
 */
export function rowState(row: ClaimRow, viewer: { userId: string }): RowState {
  if (row.claimedBy === null) return "free";
  return row.claimedBy === viewer.userId ? "mine" : "taken";
}

/** Whether the viewer already holds one, which is what silences every free row. */
export function holdsATeam(rows: ClaimRow[], viewer: { userId: string }): boolean {
  return rows.some((row) => row.claimedBy === viewer.userId);
}
