import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("shows the title, the note and the size of what is below", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Market" note="Sales inside five days are marked." meta="426 operations" />,
    );
    expect(html).toContain("Market");
    expect(html).toContain("Sales inside five days are marked.");
    expect(html).toContain("426 operations");
  });

  it("renders a bare title when there is nothing else to say", () => {
    const html = renderToStaticMarkup(<PageHeader title="Progress" />);
    expect(html).toContain("Progress");
    expect(html).not.toContain("<p");
    expect(html).not.toContain("var(--font-mono)");
  });
});
