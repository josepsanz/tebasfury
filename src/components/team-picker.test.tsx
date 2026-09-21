import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamPicker } from "./team-picker";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const teams = [
  { id: "t2", name: "Bruno" },
  { id: "t1", name: "Ada" },
  { id: "t3", name: "Chus" },
];

const picker = (selected: string | null) =>
  renderToStaticMarkup(<TeamPicker teams={teams} selected={selected} basePath="/necroporra" />);

describe("TeamPicker", () => {
  it("lists the managers by name, in alphabetical order", () => {
    // Row order from the database is undefined, and a reader hunting one name among
    // thirteen needs the list to be somewhere predictable.
    const labels = [...picker("t1").matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Ada", "Bruno", "Chus"]);
  });

  it("marks the manager being looked at", () => {
    expect(picker("t3")).toMatch(/<option[^>]*selected[^>]*>Chus</);
  });

  it("asks for a manager when none has been chosen", () => {
    // Only ever a reader with no claimed team: everybody else opens on their own.
    const html = picker(null);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Pick a manager/);
  });

  it("offers no empty choice once a manager is being looked at", () => {
    // "Pick a manager" is a prompt, not a destination — an option that took the reader
    // back to nothing would be a choice the page cannot draw.
    expect(picker("t1")).not.toContain("Pick a manager");
  });

  it("does not disturb the caller's array, which the page reads again", () => {
    const given = [...teams];
    picker("t1");
    expect(teams).toEqual(given);
  });
});
