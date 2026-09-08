import { describe, expect, it } from "vitest";
import { holdsATeam, rowState } from "./claim-row";

const row = (claimedBy: string | null) => ({
  teamId: "t1",
  managerName: "La rataneta",
  claimedBy,
});

describe("rowState", () => {
  it("calls an unclaimed team free", () => {
    expect(rowState(row(null), { userId: "alice" })).toBe("free");
  });

  it("calls the viewer's own team mine", () => {
    expect(rowState(row("alice"), { userId: "alice" })).toBe("mine");
  });

  it("calls somebody else's team taken, without caring who", () => {
    expect(rowState(row("bruno"), { userId: "alice" })).toBe("taken");
  });
});

describe("holdsATeam", () => {
  it("is true when one of the rows is the viewer's", () => {
    expect(holdsATeam([row(null), row("alice")], { userId: "alice" })).toBe(true);
  });

  it("is false when somebody else holds every claimed row", () => {
    expect(holdsATeam([row(null), row("bruno")], { userId: "alice" })).toBe(false);
  });
});
