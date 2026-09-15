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
  });

  it("tallies who the league names, and who has named the reader", async () => {
    // The seeded ballot is t1 naming Chus first and Bruno second, so both sit on one and
    // the sentence has to carry a tie. Nobody has named Ada, who is the reader.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: none }));
    // Ada and Chus are each named twice across the three ballots, Bruno once — so the
    // sentence has to carry a tie. Ada is the reader, and two people have named them.
    expect(html).toContain("The league has named Ada and Chus more than anyone: 2 votes each.");
    expect(html).not.toContain("Nobody has named you yet.");
  });

  it("states what a decided round costs, and who owes it", async () => {
    // Round 1: Ada won it, Chus finished last, and both Bruno and Chus had named Ada for
    // the bottom. Chus therefore meets both conditions at once.
    const { default: Page } = await import("./(portal)/necroporra/page");
    const html = await render(() => Page({ searchParams: Promise.resolve({ round: "1" }) }));
    expect(html).toContain("Bruno and Chus owe the league an apology: they named the winner.");
    expect(html).toContain("Chus finished last as well, so Ada sends them a hate message.");
    // And on the rows themselves, for a reader scanning for their own name.
    expect(html).toContain("apology + hate message");
    expect(html).toContain("owes an apology");
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
