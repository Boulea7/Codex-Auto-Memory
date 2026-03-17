import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemory } from "../src/lib/commands/memory.js";
import { configPaths } from "../src/lib/config/load-config.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import type { AppConfig, MemoryCommandOutput } from "../src/lib/types.js";

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

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
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
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-1.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      operations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          reason: "Manual note.",
          sources: ["manual"]
        }
      ]
    });
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:05:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-2.jsonl",
      sessionId: "session-2",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "no-op",
      appliedCount: 0,
      scopesTouched: [],
      resultSummary: "0 operations applied",
      operations: []
    });
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:10:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-3.jsonl",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "skipped",
      skipReason: "already-processed",
      appliedCount: 0,
      scopesTouched: [],
      resultSummary: "Skipped rollout; it was already processed",
      operations: []
    });

    const output = await runMemory({
      cwd: projectDir,
      scope: "project",
      recent: "3"
    });

    expect(output).toContain("Startup budget:");
    expect(output).toContain("Edit paths:");
    expect(output).toContain("project: 1 entry");
    expect(output).toContain("Topics: workflow");
    expect(output).toContain("Startup loaded files:");
    expect(output).toContain(store.getMemoryFile("project"));
    expect(output).toContain("Topic files on demand:");
    expect(output).toContain("- global:");
    expect(output).toContain("- project:");
    expect(output).toContain("  - workflow:");
    expect(output).toContain(store.getTopicFile("project", "workflow"));
    expect(output).toContain("Recent sync events");
    expect(output).toContain("1 operation(s) applied");
    expect(output).toContain("[skipped] Skipped rollout; it was already processed");
    expect(output).toContain("Configured: codex-ephemeral (codex) -> Actual: heuristic (heuristic)");
    expect(output).toContain("Skip reason: already-processed");
    expect(output).toContain("Applied: 0 | Scopes: none");
  });

  it("adds startupFilesByScope, recentSyncAudit, and syncAuditPath in json output", async () => {
    const homeDir = await tempDir("cam-memory-json-home-");
    const projectDir = await tempDir("cam-memory-json-project-");
    const memoryRoot = await tempDir("cam-memory-json-root-");
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

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
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
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-1.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      operations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          reason: "Manual note.",
          sources: ["manual"]
        }
      ]
    });

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true,
        recent: "3"
      })
    ) as MemoryCommandOutput;

    expect(output.startupBudget.usedLines).toBeGreaterThan(0);
    expect(output.startupBudget.maxLines).toBe(200);
    expect(output.startupFilesByScope.global).toHaveLength(1);
    expect(output.startupFilesByScope.project).toContain(store.getMemoryFile("project"));
    expect(output.startupFilesByScope.projectLocal).toHaveLength(1);
    expect(output.loadedFiles).toEqual([
      store.getMemoryFile("project-local"),
      store.getMemoryFile("project"),
      store.getMemoryFile("global")
    ]);
    expect(output.loadedFiles).not.toContain(store.getTopicFile("project", "workflow"));
    expect(output.refCountsByScope.global).toEqual({ startupFiles: 1, topicFiles: 0 });
    expect(output.refCountsByScope.project).toEqual({ startupFiles: 1, topicFiles: 1 });
    expect(output.refCountsByScope.projectLocal).toEqual({ startupFiles: 1, topicFiles: 0 });
    expect(output.topicFilesByScope.global).toEqual([]);
    expect(output.topicFilesByScope.project).toEqual([
      expect.objectContaining({
        topic: "workflow",
        path: store.getTopicFile("project", "workflow")
      })
    ]);
    expect(output.topicFilesByScope.projectLocal).toEqual([]);
    expect(output.syncAuditPath).toBe(store.getSyncAuditPath());
    expect(output.recentSyncAudit).toHaveLength(1);
    expect(output.recentSyncAudit[0]).toMatchObject({
      rolloutPath: "/tmp/rollout-1.jsonl",
      status: "applied",
      appliedCount: 1,
      configuredExtractorMode: "codex",
      actualExtractorMode: "heuristic"
    });
    expect(output.recentAudit).toEqual(output.recentSyncAudit);
  });

  it("keeps manual remember and forget outside the recent durable sync audit surface", async () => {
    const homeDir = await tempDir("cam-memory-manual-home-");
    const projectDir = await tempDir("cam-memory-manual-project-");
    const memoryRoot = await tempDir("cam-memory-manual-root-");
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

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
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
    await store.forget("project", "prefer-pnpm");

    const jsonOutput = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true,
        recent: "5"
      })
    ) as MemoryCommandOutput;
    const textOutput = await runMemory({
      cwd: projectDir,
      recent: "5"
    });

    expect(jsonOutput.recentSyncAudit).toEqual([]);
    expect(jsonOutput.recentAudit).toEqual([]);
    expect(textOutput).not.toContain("Recent sync events");
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
