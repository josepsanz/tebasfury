import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

describe("parseEnv", () => {
  it("retorna la configuració quan totes les variables hi són", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("falla i anomena la variable que manca", () => {
    const { GOOGLE_CLIENT_SECRET, ...incomplete } = valid;
    expect(() => parseEnv(incomplete)).toThrowError(/GOOGLE_CLIENT_SECRET/);
  });

  it("rebutja un secret massa curt", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "massa-curt" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rebutja una URL de base de dades que no és una URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "no-soc-una-url" })).toThrowError(
      /DATABASE_URL/,
    );
  });
});
