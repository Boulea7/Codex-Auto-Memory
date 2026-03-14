import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { compileStartupMemory } from "../src/lib/domain/startup-memory.js";
import type { AppConfig } from "../src/lib/types.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("MemoryStore", () => {
  it("writes topic files, rebuilds MEMORY.md, and supports forgetting entries", async () => {
    const projectDir = await tempDir("cam-store-project-");
    const memoryRoot = await tempDir("cam-store-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      codexBinary: "codex"
    };

    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Run `pnpm install` and `pnpm test` for local workflows."],
      "Manual note."
    );
    await store.remember(
      "project-local",
      "debugging",
      "redis-needed",
      "API tests require a local Redis instance.",
      ["Start Redis before running integration tests in this worktree."],
      "Manual note."
    );

    const startup = await compileStartupMemory(store, 200);
    const projectMemory = await store.readMemoryFile("project");
    const deleted = await store.forget("all", "redis");

    expect(projectMemory).toContain("workflow.md");
    expect(startup.lineCount).toBeLessThanOrEqual(200);
    expect(startup.text).toContain("workflow.md");
    expect(deleted).toHaveLength(1);
    expect(await store.listEntries("project-local")).toHaveLength(0);
  });
});
