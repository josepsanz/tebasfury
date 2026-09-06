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

  it("aplica les migracions i deixa la taula d'equips buida", async () => {
    expect(await harness.db.select().from(teams)).toEqual([]);
  });

  it("desa i recupera un equip", async () => {
    await harness.db.insert(teams).values({
      id: "team-1",
      name: "Els Necrofílics",
      managerName: "Josep",
    });

    const rows = await harness.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "team-1", name: "Els Necrofílics" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});
