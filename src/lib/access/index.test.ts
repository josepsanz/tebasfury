import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import {
  addAllowedEmails,
  existingAllowedEmails,
  loadAllowedEmailRows,
  loadAllowedEmails,
  removeAllowedEmail,
} from "./index";

let h: TestDatabase;

beforeEach(async () => {
  h = await createTestDatabase();
});
afterEach(async () => {
  await h.close();
});

describe("the sign-in list", () => {
  it("is empty before anybody is added, which admits only the admin", () => {
    // The gate checks the admin BEFORE reading this, so an empty table is a locked
    // portal rather than an open one — the safe direction.
    return expect(loadAllowedEmails(h.db)).resolves.toEqual([]);
  });

  it("adds addresses and reads them back", async () => {
    const added = await addAllowedEmails(h.db, {
      emails: ["joan@example.com", "marta@example.com"],
      addedBy: "alice",
    });
    expect(added).toBe(2);
    expect((await loadAllowedEmails(h.db)).sort()).toEqual([
      "joan@example.com",
      "marta@example.com",
    ]);
  });

  it("counts only what it actually inserted, so the screen cannot overclaim", async () => {
    // "5 added" when three were already there is a small lie that costs a real minute
    // the day somebody is bounced.
    await addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "alice" });
    const added = await addAllowedEmails(h.db, {
      emails: ["joan@example.com", "marta@example.com"],
      addedBy: "alice",
    });
    expect(added).toBe(1);
  });

  it("adding somebody already allowed is not an error", async () => {
    await addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "alice" });
    await expect(
      addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "bruno" }),
    ).resolves.toBe(0);
  });

  it("adds nothing, and touches no database, for an empty list", async () => {
    await expect(addAllowedEmails(h.db, { emails: [], addedBy: "alice" })).resolves.toBe(0);
  });

  it("removes an address and says whether it was there", async () => {
    await addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "alice" });
    await expect(removeAllowedEmail(h.db, "joan@example.com")).resolves.toBe(true);
    await expect(removeAllowedEmail(h.db, "joan@example.com")).resolves.toBe(false);
    expect(await loadAllowedEmails(h.db)).toEqual([]);
  });

  it("reports which of a batch were already on the list", async () => {
    await addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "alice" });
    const already = await existingAllowedEmails(h.db, [
      "joan@example.com",
      "marta@example.com",
    ]);
    expect(already).toEqual(["joan@example.com"]);
    await expect(existingAllowedEmails(h.db, [])).resolves.toEqual([]);
  });

  it("keeps who added each address and when, oldest first", async () => {
    await addAllowedEmails(h.db, { emails: ["joan@example.com"], addedBy: "alice" });
    const rows = await loadAllowedEmailRows(h.db);
    expect(rows[0]).toMatchObject({ email: "joan@example.com", addedBy: "alice" });
    expect(rows[0].addedAt).toBeInstanceOf(Date);
  });
});
