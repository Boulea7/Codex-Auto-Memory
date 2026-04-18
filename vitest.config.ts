import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.worktrees/**", "**/worktrees/**"],
    execArgv: ["--max-old-space-size=6144"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "json-summary", "lcov"],
    include: ["src/**/*.ts"],
    exclude: ["src/cli.ts"],
    reportOnFailure: true,
    thresholds: {
      statements: 60,
      branches: 75,
      functions: 80,
      lines: 60
    }
  }
});
