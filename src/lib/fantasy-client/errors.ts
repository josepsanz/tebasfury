/**
 * The name `CredentialError` carries, as a plain string, into `sync_runs.error`.
 *
 * A scheduled run has no screen to branch in: all it leaves behind is that text, and
 * the admin history reads this prefix back to recognise the state. A literal rather
 * than `CredentialError.name`, because a production build is free to mangle class
 * names and this comparison has to survive that.
 */
export const CREDENTIAL_ERROR_NAME = "CredentialError";

/**
 * The credential is missing, unreadable, or the provider refused it.
 *
 * This is a distinct state from a transport failure: recovering needs a person and a
 * browser, so the admin page names it rather than showing a generic error. A key
 * rotation belongs here too — `Unsupported state or unable to authenticate data` is
 * what an undecryptable credential says, and it tells the admin nothing.
 */
export class CredentialError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = CREDENTIAL_ERROR_NAME;
  }
}

/**
 * The code LaLiga attaches to a request about a manager who has left the league:
 * `{"code":400,"message":"Sorry, It is not possible to make this operation because the
 * manager does not belong to this league anymore","errorCode":"030.01.24"}`. Seen on
 * 2026-09-25 for a squad, the day after La Agustineta 96 left.
 */
export const MANAGER_LEFT_ERROR_CODE = "030.01.24";

/**
 * A request the API refused, with the refusal kept in fields as well as in the message.
 *
 * The message is unchanged from when this was a plain `Error`, because `sync_runs.error`
 * and the admin page print it. The fields exist so a caller can branch on a refusal it
 * expects without parsing that message.
 */
export class LaLigaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(message);
    this.name = "LaLigaApiError";
  }
}

/** Whether `error` is the API saying the team's manager no longer belongs to the league. */
export function isManagerGone(error: unknown): boolean {
  return error instanceof LaLigaApiError && error.errorCode === MANAGER_LEFT_ERROR_CODE;
}
