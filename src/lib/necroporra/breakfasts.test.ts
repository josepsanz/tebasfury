import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { breakfasts, teams, user } from "@/lib/db/schema";
import { loadBreakfasts, removeBreakfast, saveBreakfast } from "./breakfasts";

let h: TestDatabase;
const NOW = new Date("2026-10-09T10:00:00Z");

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values({ id: "u1", name: "Ada A", email: "ada@example.com" });
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "Ada", userId: "u1" },
    { id: "t2", managerId: 2, managerName: "Bruno" },
    { id: "t9", managerId: 9, managerName: "Gone", leftAt: new Date("2026-09-01T00:00:00Z") },
  ]);
});
afterEach(async () => {
  await h.close();
});

const save = (input: { teamId: string; broughtOn: string; what?: string }, id?: number) =>
  saveBreakfast(h.db, {
    id,
    input: { what: "", ...input },
    now: NOW,
    recordedBy: "u1",
  });

describe("saveBreakfast", () => {
  it("records a breakfast and names who brought it", async () => {
    const result = await save({ teamId: "t2", broughtOn: "2026-10-07", what: "Churros" });
    expect(result).toEqual({ ok: true, message: "Recorded: Bruno brought breakfast on Wed 7 Oct." });
    expect(await loadBreakfasts(h.db)).toEqual([
      { id: expect.any(Number), teamId: "t2", broughtOn: "2026-10-07", what: "Churros" },
    ]);
  });

  it("refuses in words, and writes nothing", async () => {
    expect(await save({ teamId: "t2", broughtOn: "2026-10-10" })).toEqual({
      ok: false,
      message: "That day has not happened yet.",
    });
    expect(await save({ teamId: "t9", broughtOn: "2026-10-01" })).toEqual({
      ok: false,
      message: "Gone has left the league.",
    });
    expect(await loadBreakfasts(h.db)).toEqual([]);
  });

  it("edits an entry in place, even one for a manager who has since left", async () => {
    await h.db.insert(breakfasts).values({ teamId: "t9", broughtOn: "2026-08-20", what: "Coca" });
    const [{ id }] = await loadBreakfasts(h.db);
    const result = await save({ teamId: "t9", broughtOn: "2026-08-21", what: "Coca de llardons" }, id);
    expect(result.ok).toBe(true);
    expect(await loadBreakfasts(h.db)).toEqual([
      { id, teamId: "t9", broughtOn: "2026-08-21", what: "Coca de llardons" },
    ]);
  });

  it("answers an edit of a vanished entry instead of throwing", async () => {
    expect(await save({ teamId: "t2", broughtOn: "2026-10-07" }, 999)).toEqual({
      ok: false,
      message: "That breakfast is no longer there.",
    });
  });
});

describe("removeBreakfast", () => {
  it("deletes once, and answers the second time", async () => {
    await save({ teamId: "t2", broughtOn: "2026-10-07" });
    const [{ id }] = await loadBreakfasts(h.db);
    expect(await removeBreakfast(h.db, id)).toEqual({ ok: true, message: "Deleted." });
    expect(await removeBreakfast(h.db, id)).toEqual({
      ok: false,
      message: "That breakfast is no longer there.",
    });
  });
});

describe("loadBreakfasts", () => {
  it("lists newest first, and the later entry first on the same day", async () => {
    await save({ teamId: "t1", broughtOn: "2026-09-01" });
    await save({ teamId: "t1", broughtOn: "2026-10-07" });
    await save({ teamId: "t2", broughtOn: "2026-10-07" });
    const rows = await loadBreakfasts(h.db);
    expect(rows.map((r) => [r.broughtOn, r.teamId])).toEqual([
      ["2026-10-07", "t2"],
      ["2026-10-07", "t1"],
      ["2026-09-01", "t1"],
    ]);
  });
});
