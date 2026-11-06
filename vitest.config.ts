// Root guard: run tests per workspace (`npm test`), never from the repository root,
// where workspace setup files (test database, env) would not be applied.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: [], passWithNoTests: false },
});
