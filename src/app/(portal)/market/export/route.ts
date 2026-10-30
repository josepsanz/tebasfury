import { db } from "@/lib/db";
import { loadMarket } from "@/lib/db/queries";
import { marketCsv } from "@/lib/domain/market-export";
import { requireSession } from "@/lib/auth/guards";
import { refusePariah } from "@/lib/auth/pariah-guards";

/**
 * Every operation the log holds as a CSV download, linked from the count on /market.
 *
 * Behind the same guards as the page it comes from: a pariah is refused the market, and a
 * file of it is the market.
 */
export async function GET() {
  const session = await requireSession();
  refusePariah(session);
  const { operations, managerNames, playerNames } = await loadMarket(db);
  const csv = marketCsv({ operations, managerNames, playerNames });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tebasfury-market-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
