import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { teams, user } from "@/lib/db/schema";
import { loadPariahCandidates, setPariah } from "./index";

let h: TestDatabase;

const person = (id: string, role: string | null) => ({
  id,
  name: id,
  email: `${id}@example.com`,
  role,
});

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db
    .insert(user)
    .values([
      person("ada", "user"),
      person("bruno", "pariah"),
      person("chus", "collaborator"),
      person("owner", "admin"),
      person("dani", null),
    ]);
  await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ada FC", userId: "ada" });
});
afterEach(async () => {
  await h.close();
});

const roleOf = async (id: string) =>
  (await h.db.select({ role: user.role }).from(user).where(eq(user.id, id)))[0].role;

describe("pariahs", () => {
  it("lists the managers who can be shunned, with their team, and nobody who runs the league", async () => {
    expect(await loadPariahCandidates(h.db)).toEqual([
      { userId: "ada", name: "ada", teamName: "Ada FC", isPariah: false },
      { userId: "bruno", name: "bruno", teamName: null, isPariah: true },
      { userId: "dani", name: "dani", teamName: null, isPariah: false },
    ]);
  });

  it("declares a manager a pariah, and pardons them back to a manager", async () => {
    expect(await setPariah(h.db, { userId: "ada", pariah: true })).toBe(true);
    expect(await roleOf("ada")).toBe("pariah");
    expect(await setPariah(h.db, { userId: "ada", pariah: false })).toBe(true);
    expect(await roleOf("ada")).toBe("user");
  });

  it("treats an account with no role as an ordinary manager", async () => {
    expect(await setPariah(h.db, { userId: "dani", pariah: true })).toBe(true);
    expect(await roleOf("dani")).toBe("pariah");
  });

  it("never touches a collaborator or an admin", async () => {
    // The control lists neither, but a forged form could still name one.
    expect(await setPariah(h.db, { userId: "chus", pariah: true })).toBe(false);
    expect(await setPariah(h.db, { userId: "owner", pariah: true })).toBe(false);
    expect(await roleOf("chus")).toBe("collaborator");
    expect(await roleOf("owner")).toBe("admin");
  });
});
