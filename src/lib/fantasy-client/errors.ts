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
