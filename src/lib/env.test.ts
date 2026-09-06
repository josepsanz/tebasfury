import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  CREDENTIALS_KEY: Buffer.alloc(32).toString("base64"),
};

describe("parseEnv", () => {
  it("returns the configuration when every variable is present", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("fails and names the missing variable", () => {
    const incomplete: Record<string, string | undefined> = {
      DATABASE_URL: valid.DATABASE_URL,
      BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: valid.BETTER_AUTH_URL,
      GOOGLE_CLIENT_ID: valid.GOOGLE_CLIENT_ID,
      // GOOGLE_CLIENT_SECRET is left out on purpose.
    };
    expect(() => parseEnv(incomplete)).toThrowError(/GOOGLE_CLIENT_SECRET/);
  });

  it("rejects a secret that is too short", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "too-short" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects the placeholder secret published in .env.example", () => {
    expect(() =>
      parseEnv({
        ...valid,
        BETTER_AUTH_SECRET: "generate one with: openssl rand -base64 32",
      }),
    ).toThrowError(/BETTER_AUTH_SECRET/);
  });

  it("rejects a database URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it("rejects a credentials key that is not 32 bytes", () => {
    expect(() =>
      parseEnv({ ...valid, CREDENTIALS_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrowError(/CREDENTIALS_KEY/);
  });
});
