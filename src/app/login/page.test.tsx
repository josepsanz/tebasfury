import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LoginPage from "./page";

/** The page is an async server component, so await the element before rendering it. */
async function render(search: Record<string, string | string[] | undefined>) {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(search) }));
}

describe("LoginPage", () => {
  it("says only 'league managers only' when nothing has failed", async () => {
    const html = await render({});
    expect(html).toContain("League managers only");
    expect(html).not.toContain("private league");
  });

  it("names the league when the allowlist turned the account away", async () => {
    const html = await render({ error: "not_in_league" });
    expect(html).toContain("private league");
    expect(html).toContain("not on its list");
  });

  it("does NOT blame the league for an unrelated failure", async () => {
    // The whole reason this page branches. Every OAuth failure lands here, so a network
    // fault or an abandoned sign-in would otherwise tell a friend they had been shut out
    // of the league — and send them to the owner to fix something that is not broken.
    const html = await render({ error: "invalid_code" });
    expect(html).toContain("did not complete");
    expect(html).not.toContain("private league");
  });

  it("reads the first value when the parameter is repeated", async () => {
    // A repeated parameter arrives as an array. Comparing the array to the code would
    // fail, and fail OPEN — the visitor would get the generic message and no idea why.
    const html = await render({ error: ["not_in_league", "not_in_league"] });
    expect(html).toContain("private league");
  });

  it("offers the sign-in button in every state, so a refusal is not a dead end", async () => {
    for (const search of [{}, { error: "not_in_league" }, { error: "invalid_code" }]) {
      expect(await render(search)).toContain("Sign in with Google");
    }
  });
});
