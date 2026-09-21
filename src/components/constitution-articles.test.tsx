import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Article } from "@/lib/domain/constitution";
import { ConstitutionArticles } from "./constitution-articles";

const article = (over: Partial<Article> = {}): Article => ({
  key: "breakfast",
  number: 2,
  title: "Breakfast",
  body: ["The team that finishes a round last brings breakfast."],
  appliedAt: { href: "/standings", label: "Standings" },
  ...over,
});

describe("ConstitutionArticles", () => {
  it("numbers and titles each article, and writes every paragraph of it", () => {
    const html = renderToStaticMarkup(
      <ConstitutionArticles
        articles={[article({ body: ["First paragraph.", "Second paragraph."] })]}
      />,
    );
    expect(html).toContain("2");
    expect(html).toContain("Breakfast");
    expect(html).toContain("First paragraph.");
    expect(html).toContain("Second paragraph.");
  });

  it("sends the reader to the page that applies the article", () => {
    const html = renderToStaticMarkup(<ConstitutionArticles articles={[article()]} />);
    expect(html).toContain('href="/standings"');
    expect(html).toContain("Standings");
  });

  it("offers no link for an article no page applies", () => {
    const html = renderToStaticMarkup(
      <ConstitutionArticles articles={[article({ appliedAt: null })]} />,
    );
    expect(html).not.toContain("href=");
  });

  it("places what a caller draws for an article under that article, and no other", () => {
    // The stakes article carries the payout ladder; the rest carry nothing. A slot that
    // rendered under every article would put the money under the breakfast rule.
    const html = renderToStaticMarkup(
      <ConstitutionArticles
        articles={[article({ key: "stakes", number: 1, title: "The stakes" }), article()]}
        aside={(entry) => (entry.key === "stakes" ? <p>the pot</p> : null)}
      />,
    );
    expect(html).toContain("the pot");
    expect(html.indexOf("the pot")).toBeLessThan(html.indexOf("Breakfast"));
  });
});
