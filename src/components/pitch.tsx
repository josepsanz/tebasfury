import Image from "next/image";
import Link from "next/link";

/**
 * A shape plus a word: a mark drawn after a player's name, given its own accessible name
 * so a screen reader hears what the shape means without depending on an aggregate
 * caption to say WHICH row it belongs to. `★` on a round's ideal eleven, `!` on a
 * flagged status, `~` on a thin sample are all marks in this sense — the pitch does not
 * care which symbol a caller uses or what it stands for, only that both travel together.
 */
export type PitchMark = {
  symbol: string;
  label: string;
};

/**
 * How a figure reads: a gain, a loss, or neither. The pitch cannot work this out for
 * itself — `figure` is already a string by the time it arrives, and whether it has a
 * sign at all is the caller's business (a round's points do, an average of them does
 * not necessarily, an unmeasured "—" has none). So the caller says, and the pitch paints.
 *
 * Colour is never the only carrier: the number and its minus sign say the same thing,
 * and the colour only makes eleven of them scannable at once.
 */
export type PitchTone = "gain" | "loss" | "flat";

/**
 * The tone of a figure that is a plain signed number — the rule the owner asked for,
 * kept in one place so two callers cannot drift apart on it. `null` means unmeasured,
 * which is not a zero and gets no tone at all.
 */
export function toneOf(value: number | null): PitchTone | undefined {
  if (value === null) return undefined;
  return value > 0 ? "gain" : value < 0 ? "loss" : "flat";
}

const TONE_INK: Record<PitchTone, string> = {
  gain: "var(--board-gain)",
  loss: "var(--board-alert)",
  flat: "var(--board-ink)",
};

/**
 * One player as a caller hands them to the pitch: an id and a name to link to their own
 * page, a portrait or null for the initials fallback, and a figure that is ALREADY the
 * string to print — "7", "40 pts", "10.4 avg" are the caller's business, not the
 * pitch's, since what a figure means differs by caller (a round's own points here, a
 * season total or average there) and the pitch has no way to know which. Marks default
 * to none: most players carry none.
 */
export type PitchPlayer = {
  id: string;
  nickname: string;
  imageUrl: string | null;
  figure: string;
  tone?: PitchTone;
  marks?: PitchMark[];
};

/**
 * One row of the pitch. `line` is never displayed — it is only a hook (`data-line`) for
 * tests and CSS, so each caller's own vocabulary for "line" (round-lineup's
 * `goalkeeper`/`defender`/`midfield`/`striker`, the lineup board's
 * `Goalkeeper`/`Defender`/`Midfielder`/`Forward`) passes straight through unchanged.
 */
export type PitchLine = {
  line: string;
  players: PitchPlayer[];
};

/**
 * One player on the grass: their portrait, their name, their figure.
 *
 * The portrait is the same one `/players/[id]` draws, from the API's own assets host — it
 * has been sending them all along. `alt=""` because the name is right underneath: an image
 * announced as "Courtois" above the word Courtois is the same fact twice.
 *
 * A player with no portrait gets their initials in the same circle rather than a hole in
 * the eleven, which would read as a missing player instead of a missing photo.
 */
function OnThePitch({ player }: { player: PitchPlayer }) {
  const initials = player.nickname
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li className="flex min-w-0 flex-col items-center" style={{ width: "19%" }}>
      {/* The whole player is the link, face included: a thumb on a phone aims at the
          shirt, not at eight pixels of underlined text. Every caller links its names the
          same way and to the same place — one player, one page, however you arrived. */}
      <Link
        href={`/players/${player.id}`}
        className="flex min-w-0 w-full flex-col items-center gap-1"
      >
        <span
          className="block h-8 w-8 shrink-0 overflow-hidden rounded-full border"
          style={{ borderColor: "var(--board-line)", background: "var(--board-panel)" }}
        >
          {player.imageUrl === null ? (
            <span
              className="flex h-full w-full items-center justify-center text-[9px]"
              style={{ color: "var(--board-ink-dim)" }}
            >
              {initials}
            </span>
          ) : (
            <Image
              src={player.imageUrl}
              alt=""
              width={32}
              height={32}
              // The source is 256×256; at 32 CSS pixels the optimizer is asked for 64 as
              // well, for retina, and never upscales. Eleven of these to a round.
              className="block h-8 w-8 object-cover"
            />
          )}
        </span>

        <span
          className="block w-full truncate text-center text-[10px] underline decoration-[var(--board-line)] underline-offset-4"
          title={player.nickname}
        >
          {player.nickname}
          {/* The shape half of "a shape and a word": a caption below the pitch says the
              word once, aggregated, and cannot say WHICH row it belongs to — so each mark
              carries its own accessible name here, on the row itself. */}
          {(player.marks ?? []).map((mark) => (
            <span key={`${mark.symbol}-${mark.label}`} role="img" aria-label={mark.label}>
              {" "}
              {mark.symbol}
            </span>
          ))}
        </span>

        {/* Dim when the caller offers no tone: that is the figure the portal could not
            put a sign on, and it should not be shouted. */}
        <span
          className="block text-[10px] tabular-nums"
          style={{
            fontFamily: "var(--font-mono)",
            color: player.tone === undefined ? "var(--board-ink-dim)" : TONE_INK[player.tone],
          }}
        >
          {player.figure}
        </span>
      </Link>
    </li>
  );
}

/** One line of the eleven, spread across the pitch the way it stands on it. */
function Line({ line, players }: { line: string; players: PitchPlayer[] }) {
  return (
    <div data-line={line} className="py-2">
      <ul className="flex flex-wrap items-start justify-evenly gap-x-1 gap-y-2">
        {players.map((player) => (
          <OnThePitch key={player.id} player={player} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The shared pitch: four lines of players drawn on `public/pitch.svg`.
 *
 * Extracted from `RoundLineup`, which drew a round's own eleven this way first. Its own
 * spec said a shared pitch was "worth doing when a third caller appears, and not
 * before" — `LineupBoard`'s best eleven is that caller.
 *
 * A lineup is read as a shape before it is read as a list, so this draws one LINE PER
 * ROW, the keeper at the foot of the pitch and the attack running up — the way every
 * fantasy game draws an eleven. `lines` is passed keeper-first, the order the data
 * naturally has and the order a screen reader should hear; `flex-col-reverse` below is
 * what turns that into the pitch's own reading order without asking any caller to supply
 * its rows backwards. Callers are expected to always pass all four lines, including any
 * that are empty, so a 5-4-1 and a 3-4-3 can be told apart at a glance instead of by
 * reading a formation label.
 *
 * Each player is a fifth of the width, so a five-man line fits across a phone without the
 * row wrapping and without a horizontal scroll; the names `truncate` inside that width
 * rather than pushing their neighbours out of line.
 *
 * Presentational only: no state, no caption. Each caller writes its own caption, because
 * each has different marks to explain.
 */
export function Pitch({ lines }: { lines: PitchLine[] }) {
  return (
    <div
      className="mt-3 flex flex-col-reverse overflow-hidden border px-1 py-2"
      style={{
        borderColor: "var(--board-line)",
        background: "var(--board-panel) url(/pitch.svg) center / 100% 100% no-repeat",
      }}
    >
      {lines.map(({ line, players }) => (
        <Line key={line} line={line} players={players} />
      ))}
    </div>
  );
}
