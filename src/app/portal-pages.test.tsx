import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { SEED_USER, seedLeague } from "@/lib/db/seed-league";

/**
 * What every portal page draws, rendered against a real database.
 *
 * The gap this closes: every page's own logic — the guard, the queries it chooses, the
 * props it hands its components — was covered by nothing. The unit tests exercise the
 * components with hand-built props and the domain with hand-built rows; Playwright only
 * ever visits these routes signed OUT, and proves the redirect. Between the two sat the
 * page itself, which is where a renamed column, a query that returns a shape nobody
 * expects, or a prop wired to the wrong variable actually lands.
 *
 * So: PGlite with the real schema, the real queries, the real page functions. Two things
 * are faked and only two — the database handle, which otherwise wants a Neon URL, and the
 * session, which otherwise wants Google. Everything between them is the shipped code.
 *
 * These do NOT replace the signed-out Playwright suite. The guards are mocked here, so
 * "this redirects an anonymous visitor" is not a claim this file can make; that one is
 * proven end to end in `e2e/auth.spec.ts` and belongs there.
 */
const harness = vi.hoisted(() => ({
  db: undefined as unknown as TestDatabase["db"],
  session: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return harness.db;
  },
}));

vi.mock("@/lib/auth/guards", async () => {
  const { decideAccess } = await import("@/lib/auth/access-decision");
  const { redirect } = await import("next/navigation");
  return {
    decideAccess,
    getSession: async () => harness.session,
    requireSession: async () => harness.session,
    // The real decision, on the real permission set the page asks for — only the session
    // itself is faked. So "a manager cannot reach /admin/sync" is a claim this file can
    // make, and it is the page's own `requirePermission({ sync: ["trigger"] })` making it.
    requirePermission: async (permissions: Parameters<typeof decideAccess>[1]) => {
      const decision = decideAccess(harness.session as never, permissions);
      if (decision.kind === "redirect") redirect(decision.to);
      return harness.session;
    },
  };
});

// Client components in these trees read the URL. Outside a Next request there is no
// router to read it from, so they get an empty one rather than throwing.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const asManager = { user: { id: SEED_USER.id, role: "user" } };
const asAdmin = { user: { id: SEED_USER.id, role: "admin" } };
const asCollaborator = { user: { id: SEED_USER.id, role: "collaborator" } };

const none = Promise.resolve({});
const render = async (page: () => Promise<React.ReactElement>) =>
  renderToStaticMarkup(await page());

let handle: TestDatabase;

/**
 * Dummy values, the same ones `playwright.config.ts` passes and for the same reason:
 * `/admin/sync` pulls in modules that read the environment at import time, and none of
 * these are used — the database handle is mocked and nothing here talks to Google or
 * QStash. Stubbed inside this file rather than in the vitest config so no other test
 * silently gains a valid environment it was not written against.
 */
const DUMMY_ENV = {
  DATABASE_URL: "postgres://user:password@localhost:5432/tebasfury_test",
  BETTER_AUTH_SECRET: "test-dummy-secret-that-is-at-least-32-chars-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-dummy-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-dummy-google-client-secret",
  ADMIN_EMAIL: "owner@example.com",
  CREDENTIALS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  LALIGA_LEAGUE_ID: "test-league",
  QSTASH_TOKEN: "qstash-dummy-token",
  QSTASH_CURRENT_SIGNING_KEY: "sig-current",
  QSTASH_NEXT_SIGNING_KEY: "sig-next",
};

beforeAll(async () => {
  for (const [key, value] of Object.entries(DUMMY_ENV)) vi.stubEnv(key, value);
  handle = await createTestDatabase();
  harness.db = handle.db;
  harness.session = asManager;
  await seedLeague(handle.db);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await handle.close();
});

describe("/standings", () => {
  it("names the league and says who brings breakfast", async () => {
    const { default: Page } = await import("./(portal)/standings/page");
    const html = await render(() => Page({ searchParams: none }));
    expect(html).toContain("Ada");
    expect(html).toContain("Chus");
    // Chus finished last in the one settled round.
    expect(html).toContain("Chus brings breakfast");
  });

  it("hedges the bringer of the round still being played, but not the shields", async () => {
    const { default: Page } = await import("./(portal)/standings/page");
    const html = await render(() => Page({ searchParams: Promise.resolve({ round: "2" }) }));
    // Round 2 is live. Chus brought breakfast in round 1, so its shield is settled fact and
    // is stated flatly; Ada is lowest among the unshielded on the points so far, which is a
    // reading of a round still moving and says so.
    expect(html).toContain("Chus is shielded for round 2.");
    expect(html).toContain(
      "Provisional: as it stands, Ada brings breakfast, and that changes while the round is played.",
    );
  });
});

describe("/market", () => {
  it("draws the operation log with the profit the sale made", async () => {
    const { default: Page } = await import("./(portal)/market/page");
    const html = await render(() => Page({ searchParams: none }));
    expect(html).toContain("sold");
    expect(html).toContain("Forward 1");
    expect(html).toContain("1.0M");
  });
});

describe("/fair-play", () => {
  it("names the sale that broke the five-day rule, and how short it fell", async () => {
    const { default: Page } = await import("./(portal)/fair-play/page");
    const html = await render(() => Page());
    // Bruno held Forward 2 for two days. Ada's eight-day holding of Forward 1 is the
    // control: a clean sale must not appear here at all.
    expect(html).toContain("Bruno");
    expect(html).toContain("Forward 2");
    expect(html).toContain("held 2.000 days");
    expect(html).toContain("3 days short");
    expect(html).not.toContain("Forward 1");
  });
});

describe("/progress", () => {
  it("plots every team's season and pins the reader's own", async () => {
    const { default: Page } = await import("./(portal)/progress/page");
    const html = await render(() => Page());
    expect(html).toContain("Ada");
    expect(html).toContain("Bruno");
  });
});

describe("/players", () => {
  it("lists the catalogue with what each player is worth", async () => {
    const { default: Page } = await import("./(portal)/players/page");
    const html = await render(() => Page());
    expect(html).toContain("Courtois");
    expect(html).toContain("Midfielder 3");
  });
});

describe("/targets", () => {
  it("ranks other managers' players and today's auction, never the reader's own", async () => {
    const { default: Page } = await import("./(portal)/targets/page");
    const html = await render(() => Page({ searchParams: none }));
    expect(html).toContain("Rival Striker");
    expect(html).toContain("Rising fast");
    expect(html).toContain("Free Agent");
    expect(html).toContain("No bids yet");
    expect(html).toContain("Locked — no route open (1)");
    expect(html).toContain("Locked Keeper");
    // Ada owns the whole seeded squad.
    expect(html).not.toContain("Courtois");
    // The seeded read is from August: the page must say the market is old.
    expect(html).toContain("over a day old");
  });
});

describe("/players/[id]", () => {
  it("leads with what the player scored", async () => {
    const { default: Page } = await import("./(portal)/players/[id]/page");
    const html = await render(() => Page({ params: Promise.resolve({ id: "gk1" }) }));
    expect(html).toContain("Courtois");
  });

  it("404s an id the catalogue has never seen", async () => {
    const { default: Page } = await import("./(portal)/players/[id]/page");
    await expect(Page({ params: Promise.resolve({ id: "nobody" }) })).rejects.toThrow(
      /NEXT_(NOT_FOUND|HTTP_ERROR_FALLBACK)/,
    );
  });
});

describe("/teams/[id]", () => {
  it("draws the manager's own season, squad and market history", async () => {
    const { default: Page } = await import("./(portal)/teams/[id]/page");
    const html = await render(() =>
      Page({ params: Promise.resolve({ id: "t1" }), searchParams: none }),
    );
    expect(html).toContain("Ada");
    expect(html).toContain("Courtois");
  });
});

describe("/teams/[id]/lineup", () => {
  it("draws the eleven that was fielded, on the pitch", async () => {
    const { default: Page } = await import("./(portal)/teams/[id]/lineup/page");
    const html = await render(() =>
      Page({ params: Promise.resolve({ id: "t1" }), searchParams: none }),
    );
    expect(html).toContain("/pitch.svg");
    expect(html).toContain("Courtois");
  });
});

describe("/necroporra", () => {
  it("shows the round being voted on and the ballot already cast", async () => {
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: none }));
    expect(html).toContain("Chus");
    expect(html).toContain('href="/necroporra/breakfasts"');
  });

  it("tallies who the league names, and who has named the reader", async () => {
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: none }));
    // Chus is named three times across the four ballots, Ada twice and Bruno once. Ada is
    // the reader, and two managers have named them.
    expect(html).toContain("The league has named Chus more than anyone: 3 votes.");
    expect(html).not.toContain("Nobody has named you yet.");
  });

  it("lists the teams the reader keeps naming, most often first", async () => {
    // Ada named Chus in the settled round and Chus and Bruno in the live one, so Chus is
    // on two and Bruno on one — and the section exists whether or not anybody agrees.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: none }));
    const section = html.slice(html.indexOf("Your usual suspects"));
    expect(section).toContain("Chus");
    expect(section.indexOf("Chus")).toBeLessThan(section.indexOf("Bruno"));
    expect(html).not.toContain("You have not named anybody yet.");
  });

  it("reads another manager's boards when one is asked for", async () => {
    // Chus was named by Ada twice and by Bruno once, and named Ada once. Both boards
    // follow the same manager, and the headings stop saying "your".
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: Promise.resolve({ manager: "t3" }) }));
    expect(html).toContain("Chus’s haters");
    expect(html).toContain("Chus’s usual suspects");
    expect(html).not.toContain("Your haters");
    const haters = html.slice(html.indexOf("Chus’s haters"), html.indexOf("Chus’s usual suspects"));
    expect(haters.indexOf("Ada")).toBeLessThan(haters.indexOf("Bruno"));
  });

  it("falls back to the reader's own boards when the manager asked for is not a team", async () => {
    // A hand-edited URL is not an exceptional condition worth a 404 — the same ruling the
    // round picker made.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() =>
      Page({ searchParams: Promise.resolve({ manager: "nobody" }) }),
    );
    expect(html).toContain("Your haters");
  });

  it("states what a decided round costs, and what it earns", async () => {
    // Round 1: Ada won it and Chus finished last. Bruno and Chus had both named Ada for
    // the bottom, which is the apology; Ada had named Chus, which together with Ada's own
    // win is the whole of article 4. Chus therefore collects both marks.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: Promise.resolve({ round: "1" }) }));
    expect(html).toContain(
      "Ada won the round. Bruno and Chus named them for last, and owe the league an apology.",
    );
    expect(html).toContain(
      "Ada won the round and named Chus for last, so Ada may send Chus a denigrating message.",
    );
    // And on the rows themselves, for a reader scanning for their own name.
    expect(html).toContain("owes an apology + denigrated");
    expect(html).toContain("may denigrate");
  });

  it("names both ends of a decided round, not only the loser", async () => {
    // Round 1 is settled: Ada took it, Chus finished last. Round 2 is still provisional,
    // which is why the round has to be asked for by number.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: Promise.resolve({ round: "1" }) }));
    const first = html.indexOf("Finished first: ");
    const last = html.indexOf("Finished last: ");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(last);
    // The names themselves, not just the labels: a line that printed the two ends the
    // wrong way round would pass on the labels alone.
    expect(html.slice(first, last)).toContain("Ada");
    expect(html.slice(last, last + 120)).toContain("Chus");
  });
});

describe("/necroporra/breakfasts", () => {
  const month = (m: string) => ({ searchParams: Promise.resolve({ month: m }) });

  it("marks both bringers on a shared day, and lists every breakfast newest first", async () => {
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-08")));
    expect(html).toContain("August 2026");
    const grid = html.slice(html.indexOf("August 2026"), html.indexOf("Every breakfast"));
    expect(grid).toContain("Chus");
    expect(grid).toContain("Bruno");
    const list = html.slice(html.indexOf("Every breakfast"));
    expect(list.indexOf("Thu 20 Aug")).toBeLessThan(list.indexOf("Thu 30 Jul"));
    expect(list).toContain("Ensaïmada");
  });

  it("falls back to the current month on a malformed one", async () => {
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-13")));
    expect(html).not.toContain("2026-13");
    expect(html).toContain("Every breakfast");
  });

  it("shows a manager no way to write", async () => {
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-08")));
    expect(html).not.toMatch(/>Record</);
    expect(html).not.toMatch(/>Delete</);
  });

  it("gives a collaborator the form and the row controls", async () => {
    harness.session = asCollaborator;
    try {
      const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
      const html = await render(() => Page(month("2026-08")));
      expect(html).toMatch(/>Record</);
      expect(html).toMatch(/>Delete</);
    } finally {
      harness.session = asManager;
    }
  });

  it("shows a recorder which rows open, and names each one apart", async () => {
    harness.session = asCollaborator;
    try {
      const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
      const html = await render(() => Page(month("2026-08")));
      expect(html).toMatch(/>Edit</);
      // Chus brought two breakfasts; a screen reader must be able to tell them apart.
      expect(html).toMatch(/Edit Chus(&#x27;|')s breakfast of Thu 20 Aug/);
      expect(html).toMatch(/Edit Chus(&#x27;|')s breakfast of Thu 30 Jul/);
    } finally {
      harness.session = asManager;
    }
  });

  it("caps no date in the form, so a tab left open past midnight can still record today", async () => {
    // The server refuses a future day against Madrid's clock at the moment of saving; a
    // `max` frozen at render time would quietly block today after midnight.
    harness.session = asCollaborator;
    try {
      const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
      const html = await render(() => Page(month("2026-08")));
      expect(html).toContain('type="date"');
      expect(html).not.toMatch(/type="date"[^>]*max=/);
    } finally {
      harness.session = asManager;
    }
  });
});

describe("/claim", () => {
  it("offers the unclaimed teams and marks the one already taken", async () => {
    const { default: Page } = await import("./(portal)/claim/page");
    const html = await render(() => Page());
    expect(html).toContain("Bruno");
    expect(html).toContain("Chus");
  });
});

describe("/admin/sync", () => {
  it("draws the chain's state for somebody who may trigger it", async () => {
    harness.session = asAdmin;
    const { default: Page } = await import("./admin/sync/page");
    const html = await render(() => Page());
    expect(html).toContain("Sync");
    harness.session = asManager;
  });

  it("turns away a manager, because triggering a sync is not a manager's to do", async () => {
    // The page's own `requirePermission({ sync: ["trigger"] })`, decided by the real
    // access rules. A permission quietly widened to the `user` role fails here.
    const { default: Page } = await import("./admin/sync/page");
    await expect(Page()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("/constitution", () => {
  it("writes the league's law, with the pot its managers are playing for", async () => {
    const { default: Page } = await import("./(portal)/constitution/page");
    const html = await render(() => Page());
    expect(html).toContain("The stakes");
    // Three seeded managers at 15 € each, and the champion's 65 % of it.
    expect(html).toContain("3 managers × 15 €");
    expect(html).toContain("45.00 €");
    expect(html).toContain("29.25 €");
  });

  it("states the breakfast shield the standings actually apply", async () => {
    const { default: Page } = await import("./(portal)/constitution/page");
    const html = await render(() => Page());
    expect(html).toContain("shields that team for the next 3 rounds");
    expect(html).toContain('href="/standings"');
  });
});
