/**
 * The error's name is part of the record: the admin history reads it back.
 *
 * `isCredentialFailure` in the admin screen matches on the `CredentialError:` prefix
 * this produces, and it is the only thing that turns a scheduled run's failure into
 * "the credential needs re-bootstrapping". Both cadences exchange the same credential,
 * so both must record it the same way — which is why this is a module and not a
 * private helper in one of them.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
}
