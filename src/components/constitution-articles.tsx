import type { ReactNode } from "react";
import Link from "next/link";
import type { Article } from "@/lib/domain/constitution";

/**
 * The league's law, set as a document.
 *
 * The only page in this portal that is prose rather than figures, so it is the only one
 * that departs from the dense row: the measure is held near 58 characters and the lines
 * are given air, because these paragraphs are read once and argued about later, not
 * scanned for a number.
 *
 * The numbers in the margin are structure and not decoration — an article of a
 * constitution IS numbered, and "article 4" is how somebody will cite it in the group
 * chat. They are set in the mono face for the same reason the figures are: they are
 * addresses, not words.
 */
export function ConstitutionArticles({
  articles,
  aside,
}: {
  articles: Article[];
  /**
   * What to draw under a given article's text, or nothing. A render prop rather than a
   * flag: only the stakes carry anything — the payout ladder — and the alternative is
   * this component knowing what money looks like.
   */
  aside?: (article: Article) => ReactNode;
}) {
  return (
    <ol className="mt-5 border-t" style={{ borderColor: "var(--board-line)" }}>
      {articles.map((article) => (
        <li
          key={article.key}
          className="grid grid-cols-[26px_1fr] gap-x-3 border-b px-2 py-5"
          style={{ borderColor: "var(--board-line)" }}
        >
          <span
            className="text-[12.5px] tabular-nums"
            style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
          >
            {article.number}
          </span>

          <div>
            <h2 className="text-[13.5px] font-medium">{article.title}</h2>

            {article.body.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-2 max-w-[58ch] text-[12.5px] leading-[1.7]"
                style={{ color: "var(--board-ink)" }}
              >
                {paragraph}
              </p>
            ))}

            {aside?.(article)}

            {/* Where the rule stops being words. An article the portal enforces can be
                checked against what actually happened, and the law should hand the reader
                the receipt rather than leave them to find the page. */}
            {article.appliedAt === null ? null : (
              <p className="mt-3 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                Applied on{" "}
                <Link href={article.appliedAt.href} className="underline underline-offset-4">
                  {article.appliedAt.label}
                </Link>
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
