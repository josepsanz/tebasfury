import { describe, expect, it } from "vitest";
import { buttonLabel } from "./button-label";

describe("buttonLabel", () => {
  it("labels the button for the action that is actually running", () => {
    expect(buttonLabel("sync", true, "sync")).toBe("Syncing…");
    expect(buttonLabel("sweep", true, "sweep")).toBe("Working…");
  });

  it("does not relabel the OTHER action's button while one is running", () => {
    // Regression guard for Important 10: one shared `pending` flag from one
    // `useTransition` used to drive both labels, so pressing "Sweep players" made
    // "Sync now" claim a sync was in flight, and vice versa. `busy` names which
    // action is actually running, and only that button's label may change.
    expect(buttonLabel("sync", true, "sweep")).toBe("Sync now");
    expect(buttonLabel("sweep", true, "sync")).toBe("Sweep players");
  });

  it("shows the resting label when nothing is running", () => {
    expect(buttonLabel("sync", false, null)).toBe("Sync now");
    expect(buttonLabel("sweep", false, null)).toBe("Sweep players");
  });
});
