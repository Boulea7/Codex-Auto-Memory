import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemory } from "../src/lib/commands/memory.js";
import { configPaths } from "../src/lib/config/load-config.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import type { AppConfig } from "../src/lib/types.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runMemory", () => {
  it("shows scope details and recent audit entries", async () => {
    const homeDir = await tempDir("cam-memory-home-");
    const projectDir = await tempDir("cam-memory-project-");
    const memoryRoot = await tempDir("cam-memory-root-");
    process.env.HOME = homeDir;

    const projectConfig: AppConfig = {
      autoMemoryEnabled: true,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    await fs.writeFile(
      path.join(projectDir, "codex-auto-memory.json"),
      JSON.stringify(projectConfig),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".codex-auto-memory.local.json"),
      JSON.stringify({
        autoMemoryDirectory: memoryRoot
      }),
      "utf8"
    );

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await store.appendAuditLog({
      appliedAt: "2026-03-14T12:00:00.000Z",
      sessionId: "session-1",
      extractorMode: "heuristic",
      resultSummary: "1 operation(s) applied",
      rolloutPath: "/tmp/rollout-1.jsonl"
    });

    const output = await runMemory({
      cwd: projectDir,
      scope: "project",
      recent: "3"
    });

    expect(output).toContain("project: 1 entry");
    expect(output).toContain("Topics: workflow");
    expect(output).toContain("Recent sync events");
    expect(output).toContain("1 operation(s) applied");
  });

  it("updates local config when enabling or disabling auto memory", async () => {
    const homeDir = await tempDir("cam-memory-home-");
    const projectDir = await tempDir("cam-memory-project-");
    const memoryRoot = await tempDir("cam-memory-root-");
    process.env.HOME = homeDir;

    await fs.writeFile(
      path.join(projectDir, "codex-auto-memory.json"),
      JSON.stringify({
        autoMemoryEnabled: true,
        extractorMode: "heuristic",
        defaultScope: "project",
        maxStartupLines: 200,
        codexBinary: "codex"
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectDir, ".codex-auto-memory.local.json"),
      JSON.stringify({
        autoMemoryDirectory: memoryRoot
      }),
      "utf8"
    );

    const disableOutput = await runMemory({
      cwd: projectDir,
      disable: true,
      configScope: "local"
    });
    expect(disableOutput).toContain("Auto memory enabled: false");

    const localConfigPath = configPaths.getLocalConfigPath(projectDir);
    const localConfig = JSON.parse(await fs.readFile(localConfigPath, "utf8")) as {
      autoMemoryEnabled: boolean;
    };
    expect(localConfig.autoMemoryEnabled).toBe(false);

    const enableOutput = await runMemory({
      cwd: projectDir,
      enable: true,
      configScope: "local"
    });
    expect(enableOutput).toContain("Auto memory enabled: true");
  });
});
