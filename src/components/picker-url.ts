/**
 * Where a picker sends the reader, with the rest of the query left alone.
 *
 * The Necroporra now carries two of them — which round, and which manager — and a picker
 * that wrote `?round=3` over the whole query would throw away the manager being looked at
 * every time somebody changed round. Each picker owns one parameter and inherits the
 * others, which is also what makes both choices linkable at once.
 *
 * `null` means "no choice", and a query with nothing left in it leaves the bare path: the
 * standings' season total is the page's own default, and `/standings?` is not an address
 * anybody should be handed.
 */
export function urlWithParam(
  basePath: string,
  current: URLSearchParams,
  param: string,
  value: string | null,
): string {
  // Copied, never mutated: this is the router's own object, and the caller reads it again
  // on the next render.
  const next = new URLSearchParams(current);
  if (value === null) next.delete(param);
  else next.set(param, value);

  const query = next.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
}
