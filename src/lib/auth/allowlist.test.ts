import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist } from "./allowlist";

const ADMIN = "owner@example.com";

describe("parseAllowlist", () => {
  it("is empty when the variable is not set", () => {
    // Ruling 4: an unset list must mean "the admin only". Returning an empty list here
    // is what makes that true downstream — the alternative, treating unset as
    // unrestricted, is exactly how the hole this slice closes would come back.
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });

  it("splits on commas and lower-cases, so the list can be pasted as people write it", () => {
    expect(parseAllowlist("Joan@Example.com,Marta@example.COM")).toEqual([
      "joan@example.com",
      "marta@example.com",
    ]);
  });

  it("drops blanks, so a trailing comma or a stray space is harmless", () => {
    expect(parseAllowlist(" joan@example.com , , marta@example.com ,")).toEqual([
      "joan@example.com",
      "marta@example.com",
    ]);
  });
});

describe("isAllowed", () => {
  it("admits an address on the list", () => {
    expect(isAllowed("joan@example.com", ["joan@example.com"], ADMIN)).toBe(true);
  });

  it("turns away an address that is not on it", () => {
    expect(isAllowed("stranger@example.com", ["joan@example.com"], ADMIN)).toBe(false);
  });

  it("admits the admin even when the list is empty", () => {
    // Ruling 3. The failure this prevents is unrecoverable: a mistyped LEAGUE_ALLOWLIST
    // would otherwise lock out the only person who could correct it, and the portal has
    // no other door.
    expect(isAllowed(ADMIN, [], ADMIN)).toBe(true);
  });

  it("admits nobody but the admin when the list is empty", () => {
    expect(isAllowed("joan@example.com", [], ADMIN)).toBe(false);
  });

  it("ignores case and surrounding whitespace on the candidate", () => {
    // Google reports the address it holds; the owner types the list by hand. Neither
    // side should have to match the other's capitalisation.
    expect(isAllowed("  Joan@Example.COM ", ["joan@example.com"], ADMIN)).toBe(true);
    expect(isAllowed("OWNER@example.com", [], ADMIN)).toBe(true);
  });

  it("turns away a missing or blank email rather than treating it as a match", () => {
    // A provider that returns no email must not fall through to an empty-string
    // comparison against an empty-string list entry.
    expect(isAllowed(null, ["joan@example.com"], ADMIN)).toBe(false);
    expect(isAllowed(undefined, ["joan@example.com"], ADMIN)).toBe(false);
    expect(isAllowed("   ", ["joan@example.com"], ADMIN)).toBe(false);
  });

  it("matches whole addresses, not substrings of them", () => {
    // "an@example.com" must not ride in on "joan@example.com" being listed.
    expect(isAllowed("an@example.com", ["joan@example.com"], ADMIN)).toBe(false);
    expect(isAllowed("joan@example.com.evil.test", ["joan@example.com"], ADMIN)).toBe(false);
  });

  it("does not treat Gmail dots as interchangeable, which is a documented hazard", () => {
    // Ruling 5: Google considers these one account, and we deliberately do not. The
    // rule stays readable — an entry matches exactly what it says — and the cure for a
    // bounced friend is to fix the list, which docs/deployment.md says first.
    expect(isAllowed("f.sanz@gmail.com", ["fsanz@gmail.com"], ADMIN)).toBe(false);
  });
});
