import { SignInButton } from "@/components/sign-in-button";
import { NOT_IN_LEAGUE } from "@/lib/auth/allowlist";

/**
 * Every OAuth failure lands here: Better Auth routes them all through one helper that
 * appends `?error=`, and `onAPIError.errorURL` points at this page.
 *
 * So this page has to tell two stories apart, and must not tell the wrong one. Only
 * `not_in_league` earns the private-league message; a network fault, a revoked Google
 * grant or an abandoned sign-in gets the generic one. Saying "you are not in this
 * league" after an ordinary failure would send a friend to the owner convinced they had
 * been shut out, which is worse than saying nothing precise at all.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  // A repeated parameter arrives as an array. Take the first rather than rendering
  // "not_in_league,not_in_league" into a comparison that would then fail open.
  const code = Array.isArray(error) ? error[0] : error;

  return (
    <section className="mx-auto max-w-sm text-center">
      <h1 className="text-xl font-semibold">Sign in to TebasFury</h1>

      {code === NOT_IN_LEAGUE ? (
        <>
          <p className="mt-2 text-sm" style={{ color: "var(--board-alert)" }}>
            This is a private league.
          </p>
          <p className="mt-2 mb-6 text-sm" style={{ color: "var(--board-ink-dim)" }}>
            That account is not on its list. If you think it should be, ask whoever runs
            the league to add you — then sign in again.
          </p>
        </>
      ) : code ? (
        <>
          <p className="mt-2 text-sm" style={{ color: "var(--board-alert)" }}>
            That sign-in did not complete.
          </p>
          <p className="mt-2 mb-6 text-sm" style={{ color: "var(--board-ink-dim)" }}>
            Nothing was changed. Try again.
          </p>
        </>
      ) : (
        <p className="mt-2 mb-6 text-sm" style={{ color: "var(--board-ink-dim)" }}>
          League managers only.
        </p>
      )}

      <SignInButton />
    </section>
  );
}
