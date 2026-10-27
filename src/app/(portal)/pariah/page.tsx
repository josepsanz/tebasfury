import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loadMyTeam } from "@/lib/claims";
import { requireSession } from "@/lib/auth/guards";
import { isPariah } from "@/lib/auth/access-decision";
import { pariahLine } from "@/lib/domain/pariah";

/**
 * Where a pariah lands from every page the league has closed to them.
 *
 * The name is struck through the way a name is struck off a team sheet: that line is the
 * whole design, and everything around it stays quiet. Only a pariah sees it; anybody else
 * who types the address is sent home, because the page is a sentence and they have not
 * been handed one.
 */
export default async function PariahPage() {
  const session = await requireSession();
  if (!isPariah(session)) redirect("/");
  const myTeam = await loadMyTeam(db, { userId: session.user.id });
  // The clock's milliseconds as the roll: a different line most visits, and a read of
  // the time is what a page here may do in render, where `Math.random` is refused.
  const roll = new Date().getMilliseconds() / 1000;

  return (
    <section className="mx-auto max-w-xl py-10">
      <h1 className="text-[34px] font-semibold leading-tight sm:text-[44px]">
        <span
          className="line-through"
          style={{
            textDecorationColor: "var(--board-alert)",
            textDecorationThickness: "0.12em",
          }}
        >
          {session.user.name}
        </span>
        <span className="block text-[17px] font-normal" style={{ color: "var(--board-alert)" }}>
          is a pariah.
        </span>
      </h1>

      <p className="mt-6 text-[17px] leading-relaxed">{pariahLine(roll)}</p>

      <p className="mt-4 text-[13.5px] leading-relaxed" style={{ color: "var(--board-ink-dim)" }}>
        That page is closed to you, and so are the players, the market, the targets and every
        squad but your own. You may still read the standings, the progress, the fair-play
        register, the Necroporra and the Constitution, which you would do well to study.
      </p>

      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
        {myTeam ? (
          <Link href={`/teams/${myTeam.teamId}`} className="underline underline-offset-4">
            Back to your own team
          </Link>
        ) : null}
        <Link href="/constitution" className="underline underline-offset-4">
          Read the Constitution
        </Link>
      </p>
    </section>
  );
}
