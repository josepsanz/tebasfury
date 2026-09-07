import { describe, expect, it, vi } from "vitest";
import { FAILURE_INTERVAL_MS } from "./next-run";
import { failureMessage, runAndSchedule } from "./scheduled-run";

const now = new Date("2026-09-08T12:00:00Z");
const nextRunAt = new Date("2026-09-08T12:10:00Z");
const result = { weeksSynced: [4], nextRunAt };

describe("runAndSchedule", () => {
  it("books the successor the run asked for", async () => {
    const schedule = vi.fn<(at: Date) => Promise<void>>(async () => {});
    const outcome = await runAndSchedule({ run: async () => result, schedule, now });

    expect(outcome).toEqual({ status: "succeeded", result });
    expect(schedule).toHaveBeenCalledWith(nextRunAt);
  });

  it("still books a successor when the run fails, or the chain would end there", async () => {
    const schedule = vi.fn<(at: Date) => Promise<void>>(async () => {});
    const outcome = await runAndSchedule({
      run: async () => { throw new Error("upstream is down"); },
      schedule,
      now,
    });

    expect(outcome.status).toBe("failed");
    expect(schedule).toHaveBeenCalledTimes(1);
    const [at] = schedule.mock.calls[0];
    expect(at.getTime() - now.getTime()).toBe(FAILURE_INTERVAL_MS);
  });

  it("reports the run's own error, not a rebooking that also failed", async () => {
    const outcome = await runAndSchedule({
      run: async () => { throw new Error("upstream is down"); },
      schedule: async () => { throw new Error("QStash is down too"); },
      now,
    });

    expect(outcome.status).toBe("failed");
    expect(failureMessage(outcome.status === "failed" ? outcome.error : null))
      .toBe("upstream is down");
  });

  it("treats a run that could not book its successor as failed", async () => {
    const outcome = await runAndSchedule({
      run: async () => result,
      schedule: vi.fn(async () => { throw new Error("QStash refused"); }),
      now,
    });

    expect(outcome.status).toBe("failed");
  });

  it("books the successor with the caller's own failure interval", async () => {
    const booked: Date[] = [];
    const outcome = await runAndSchedule({
      now: new Date("2026-09-07T04:00:00Z"),
      run: async () => {
        throw new Error("the sweep failed");
      },
      schedule: async (at) => {
        booked.push(at);
      },
      nextAfterFailure: (now) => new Date(now.getTime() + 60 * 60 * 1000),
    });

    expect(outcome.status).toBe("failed");
    expect(booked[0].toISOString()).toBe("2026-09-07T05:00:00.000Z");
  });
});
