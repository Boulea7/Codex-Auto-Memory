import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.worktrees/**", "**/worktrees/**"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000
  }
});
