import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Capped, because the integration tests each build a real Postgres in-process with
    // PGlite. Left to spawn one worker per core, several of those exist at once, the box
    // runs out of memory and the kernel SIGKILLs a worker — which surfaces as a test file
    // that "failed" with no failing assertion in it. The cap lives here rather than in the
    // `test` script so the watch mode, an IDE runner and any future CI all inherit it.
    maxWorkers: 2,
  },
});
