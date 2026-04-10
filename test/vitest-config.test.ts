import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("vitest config", () => {
  it("excludes project-local worktree directories from test discovery", async () => {
    const configSource = await fs.readFile(path.resolve("vitest.config.ts"), "utf8");

    expect(configSource).toContain("**/.worktrees/**");
    expect(configSource).toContain("**/worktrees/**");
  });
});
