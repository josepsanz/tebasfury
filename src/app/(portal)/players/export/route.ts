import { db } from "@/lib/db";
import { loadPlayerCatalogue, loadPlayerExportExtras } from "@/lib/db/queries";
import { buildCatalogue } from "@/lib/domain/players";
import { playersCsv } from "@/lib/domain/player-export";
import { requireSession } from "@/lib/auth/guards";

/**
 * Every player as a CSV download, linked from the count on /players.
 *
 * Behind the same session the catalogue is: the clauses and owners in it are the league's
 * own business. `redirect` works in a route handler as it does in a page, so a signed-out
 * reader lands on the login screen rather than on an error.
 */
export async function GET() {
  await requireSession();
  const [catalogue, extras] = await Promise.all([loadPlayerCatalogue(db), loadPlayerExportExtras(db)]);
  const now = new Date();
  const rows = buildCatalogue(catalogue);
  const csv = playersCsv({ rows, ...extras }, now);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tebasfury-players-${now.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
