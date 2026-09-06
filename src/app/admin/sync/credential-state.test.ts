import { describe, expect, it } from "vitest";
import { CredentialError } from "@/lib/fantasy-client";
import { isCredentialFailure } from "./credential-state";

/** The same shape `runSync` writes into `sync_runs.error`. */
const recorded = (error: Error) => `${error.name}: ${error.message}`;

describe("isCredentialFailure", () => {
  it("recognises what a scheduled run records for a credential failure", () => {
    const error = new CredentialError("The stored LaLiga credential could not be decrypted");
    expect(isCredentialFailure(recorded(error))).toBe(true);
  });

  it("does not mistake an ordinary failure for one", () => {
    expect(isCredentialFailure(recorded(new Error("LaLiga API answered 503")))).toBe(false);
    expect(isCredentialFailure("Unsupported state or unable to authenticate data")).toBe(false);
  });

  it("treats a run with no error as no failure", () => {
    expect(isCredentialFailure(null)).toBe(false);
  });
});
