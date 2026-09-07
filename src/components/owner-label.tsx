import { ownerDisplay, type CatalogueRow } from "@/lib/domain/players";

/**
 * The three-state owner treatment, shared by the catalogue and the home page's
 * boards so the three states cannot be worded differently in two places. Holds no
 * state itself, which is why a server component and a client component can both
 * import it.
 */
export function OwnerLabel({
  row,
  ownershipKnown,
}: {
  row: CatalogueRow;
  ownershipKnown: boolean;
}) {
  const display = ownerDisplay(row.ownerName, ownershipKnown);
  if (display.kind === "owned") return <>{display.name}</>;
  // Nobody has read the squads yet, so "unowned" is a gap in what we know, not a fact
  // about the player.
  if (display.kind === "unknown") {
    return <span style={{ color: "var(--board-ink-dim)" }}>Owners not swept yet</span>;
  }
  return <span style={{ color: "var(--board-free)" }}>Free agent</span>;
}
