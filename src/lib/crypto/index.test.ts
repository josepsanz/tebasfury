import { describe, expect, it } from "vitest";
import { open, seal } from "./index";

// `getEnv()` validates the whole application configuration as a single
// object, so exercising CREDENTIALS_KEY here still requires stubbing the
// other required variables with dummy values — none of them are read by
// this module.
process.env.DATABASE_URL = "postgres://user:pass@host/db";
process.env.BETTER_AUTH_SECRET = "x".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.LALIGA_LEAGUE_ID = "test-league";

const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.CREDENTIALS_KEY = KEY;

describe("seal and open", () => {
  it("round-trips a secret", () => {
    expect(open(seal("a-refresh-token"))).toBe("a-refresh-token");
  });

  it("produces a different ciphertext each time", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = seal("a-refresh-token");
    const [iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 0xff;
    expect(() => open([iv, flipped.toString("base64url"), tag].join("."))).toThrowError();
  });

  it("refuses a sealed value with the wrong number of parts", () => {
    expect(() => open("only.two")).toThrowError(/malformed/i);
  });
});
