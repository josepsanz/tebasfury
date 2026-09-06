import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { teams } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

describe("createTestDatabase", () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("applies the migrations and leaves the teams table empty", async () => {
    expect(await harness.db.select().from(teams)).toEqual([]);
  });

  it("stores and reads back a team", async () => {
    await harness.db.insert(teams).values({
      id: "team-1",
      name: "The Grave Diggers",
      managerName: "Alex",
    });

    const rows = await harness.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "team-1", name: "The Grave Diggers" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});
