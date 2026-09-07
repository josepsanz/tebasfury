import { ownerDisplay } from "@/lib/domain/players";

/**
 * The three-state owner treatment, shared by the catalogue, the home page's boards and
 * the player detail page so the three states cannot be worded differently across them.
 * Takes the two fields it actually reads rather than a whole `CatalogueRow`, so a
 * caller that only has an `Ownership | null` (the player page) can use it too. Holds no
 * state itself, which is why a server component and a client component can both
 * import it.
 */
export function OwnerLabel({
  ownerName,
  ownershipKnown,
}: {
  ownerName: string | null;
  ownershipKnown: boolean;
}) {
  const display = ownerDisplay(ownerName, ownershipKnown);
  if (display.kind === "owned") return <>{display.name}</>;
  // Nobody has read the squads yet, so "unowned" is a gap in what we know, not a fact
  // about the player.
  if (display.kind === "unknown") {
    return <span style={{ color: "var(--board-ink-dim)" }}>Owners not swept yet</span>;
  }
  return <span style={{ color: "var(--board-free)" }}>Free agent</span>;
}
