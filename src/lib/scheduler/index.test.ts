import { describe, expect, it } from "vitest";
import { bookingId, delaySecondsUntil } from "./index";

describe("delaySecondsUntil", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("converts a future instant into whole seconds of delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:10:00Z"), now)).toBe(600);
  });

  it("never asks for a negative delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T11:00:00Z"), now)).toBe(0);
  });

  it("rounds a sub-second delay up to zero rather than a fraction", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:00:00.400Z"), now)).toBe(0);
  });
});

describe("bookingId", () => {
  const runId = "8c1f5d02-0b3a-4a1e-9a77-6f0f0c3a1b22";

  it("is the same every time one run books its successor", () => {
    // What the id is FOR: a publish that was accepted but whose response was lost gets
    // retried by the SDK, and an id QStash has already seen is accepted without being
    // enqueued. Same run, same id, one message — which is how the chain stops forking.
    expect(bookingId("schedule", runId)).toBe(bookingId("schedule", runId));
  });

  it("differs between two runs, so one run cannot swallow another's booking", () => {
    // Deduplication ids are remembered for 90 days. An id shared across runs would make
    // the SECOND booking vanish silently — including the manual "Sync now" that exists
    // to revive a dead chain.
    const other = "1d9a77b4-6f0f-4c3a-8c1f-5d020b3a4a1e";
    expect(bookingId("schedule", runId)).not.toBe(bookingId("schedule", other));
  });

  it("keeps the two cadences apart", () => {
    expect(bookingId("schedule", runId)).not.toBe(bookingId("players-schedule", runId));
  });

  it("uses only characters QStash accepts in a deduplication id", () => {
    // Written after an outage, not before it. The first version of this id joined the
    // two halves with a colon; QStash answered `DeduplicationId cannot contain ':'`, the
    // publish threw, the run booked no successor and the standings chain stopped dead
    // until somebody pressed "Sync now". The test that was missing is this one: the id
    // is an argument to a service with its own rules, and only its shape can be pinned
    // here.
    expect(bookingId("players-schedule", runId)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
