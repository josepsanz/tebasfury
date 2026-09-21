import { describe, expect, it } from "vitest";
import { urlWithParam } from "./picker-url";

const at = (query: string) => new URLSearchParams(query);

describe("urlWithParam", () => {
  it("puts the choice in the query", () => {
    expect(urlWithParam("/necroporra", at(""), "round", "3")).toBe("/necroporra?round=3");
  });

  it("keeps every other choice already in the query", () => {
    // The whole reason this exists: two pickers on one page. Choosing a round used to
    // rewrite the URL from scratch, which silently dropped the manager being looked at.
    expect(urlWithParam("/necroporra", at("manager=t3"), "round", "3")).toBe(
      "/necroporra?manager=t3&round=3",
    );
  });

  it("replaces a choice rather than adding a second one", () => {
    expect(urlWithParam("/necroporra", at("round=2"), "round", "3")).toBe("/necroporra?round=3");
  });

  it("drops the parameter when the choice is nothing", () => {
    // The standings' "Season total": no round, and the bare path is the page's default.
    expect(urlWithParam("/standings", at("round=2"), "round", null)).toBe("/standings");
  });

  it("keeps the others when one is dropped", () => {
    expect(urlWithParam("/necroporra", at("manager=t3&round=2"), "round", null)).toBe(
      "/necroporra?manager=t3",
    );
  });

  it("leaves the caller's parameters untouched, because they belong to the router", () => {
    const current = at("round=2");
    urlWithParam("/necroporra", current, "manager", "t3");
    expect(current.toString()).toBe("round=2");
  });
});
