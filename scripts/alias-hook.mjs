// Node 24 runs .ts and .mts directly, but it resolves neither the `@/` alias from
// tsconfig nor the extensionless relative specifiers TypeScript allows. This hook
// adds both, so `scripts/*.mts` can import the application's own modules instead of
// re-implementing them. It is used by scripts only — never by the app or the tests.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url).href;

function withExtension(url) {
  if (/\.[cm]?[jt]sx?$/.test(url)) return url;
  for (const candidate of [`${url}.ts`, `${url}/index.ts`, `${url}.tsx`]) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return url;
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(withExtension(`${SRC}${specifier.slice(2)}`), context);
  }
  if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
    return next(withExtension(new URL(specifier, context.parentURL).href), context);
  }
  return next(specifier, context);
}
