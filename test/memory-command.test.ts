import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemory } from "../src/lib/commands/memory.js";
import { configPaths } from "../src/lib/config/load-config.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import type { AppConfig, MemoryCommandOutput } from "../src/lib/types.js";
import {
  makeAppConfig,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function snapshotFiles(filePaths: string[]): Promise<Record<string, string | null>> {
  return Object.fromEntries(
    await Promise.all(
      filePaths.map(async (filePath) => [filePath, await readFileIfExists(filePath)] as const)
    )
  );
}

function buildUnsafeWorkflowTopicContents(entryId: string, summary: string, detail: string): string {
  return [
    "# Workflow",
    "",
    "<!-- cam:topic workflow -->",
    "",
    "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
    "",
    "Manual note that cannot be round-tripped safely.",
    "",
    `## ${entryId}`,
    `<!-- cam:entry ${JSON.stringify({ id: entryId, scope: "project", updatedAt: "2026-03-14T00:00:00.000Z" })} -->`,
    `Summary: ${summary}`,
    "Details:",
    `- ${detail}`,
    "",
    "## malformed-entry",
    "<!-- cam:entry THIS IS NOT JSON -->",
    "Summary: Broken entry.",
    "Details:",
    "- Must not be deleted by rewrite.",
    ""
  ].join("\n");
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const buildProjectConfig = makeAppConfig;
const writeProjectConfig = writeCamConfig;

describe("runMemory", () => {
  it("shows archive behavior in forget help output", async () => {
    const projectDir = await tempDir("cam-forget-help-project-");

    const result = runCli(projectDir, ["forget", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Delete or archive matching memory entries");
    expect(result.stdout).toContain("Move matching entries into archive instead of deleting them");
  });

  it("shows scope details and recent audit entries", async () => {
    const homeDir = await tempDir("cam-memory-home-");
    const projectDir = await tempDir("cam-memory-project-");
    const memoryRoot = await tempDir("cam-memory-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
      suppressedOperationCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      conflicts: [
        {
          scope: "project",
          topic: "preferences",
          candidateSummary: "Maybe use bun instead of pnpm in this repository.",
          conflictsWith: ["Prefer pnpm in this repository."],
          source: "existing-memory",
          resolution: "suppressed"
        }
      ],
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
    expect(output).toContain(
      "Startup loaded files are the index files actually quoted into the current startup payload."
    );
    expect(output).toContain(
      "Topic files on demand stay as references until a later read needs them."
    );
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
    expect(output).toContain("Applied: 0 | No-op: 0 | Suppressed: 0 | Scopes: none");
    expect(output).toContain("Suppressed: 1");
    expect(output).toContain("Conflict review:");
    expect(output).toContain("[existing-memory] preferences: Maybe use bun instead of pnpm in this repository.");
  });

  it("adds startupFilesByScope, recentSyncAudit, and syncAuditPath in json output", async () => {
    const homeDir = await tempDir("cam-memory-json-home-");
    const projectDir = await tempDir("cam-memory-json-project-");
    const memoryRoot = await tempDir("cam-memory-json-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
      suppressedOperationCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      conflicts: [
        {
          scope: "project",
          topic: "preferences",
          candidateSummary: "Maybe use bun instead of pnpm in this repository.",
          conflictsWith: ["Prefer pnpm in this repository."],
          source: "existing-memory",
          resolution: "suppressed"
        }
      ],
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
      suppressedOperationCount: 1,
      configuredExtractorMode: "codex",
      actualExtractorMode: "heuristic"
    });
    expect(output.recentSyncAudit[0]?.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "existing-memory",
          resolution: "suppressed"
        })
      ])
    );
    expect(output.recentAudit).toEqual(output.recentSyncAudit);

    const textOutput = await runMemory({
      cwd: projectDir,
      recent: "3"
    });
    expect(textOutput).toContain("Recent sync events (1 grouped):");
  });

  it("keeps json recent sync audit raw while compacting repeated sync events in text output", async () => {
    const homeDir = await tempDir("cam-memory-compact-home-");
    const projectDir = await tempDir("cam-memory-compact-project-");
    const memoryRoot = await tempDir("cam-memory-compact-root-");
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
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-oldest.jsonl",
      sessionId: "session-oldest",
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
      appliedAt: "2026-03-14T12:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-repeat.jsonl",
      sessionId: "session-repeat",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
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
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:02:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-repeat.jsonl",
      sessionId: "session-repeat",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
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
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:03:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-latest.jsonl",
      sessionId: "session-latest",
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
          id: "latest",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          reason: "Manual note.",
          sources: ["manual"]
        }
      ]
    });

    const jsonOutput = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true,
        recent: "2"
      })
    ) as MemoryCommandOutput;
    const textOutput = await runMemory({
      cwd: projectDir,
      recent: "2"
    });

    expect(jsonOutput.recentSyncAudit).toHaveLength(2);
    expect(jsonOutput.recentSyncAudit[0]?.rolloutPath).toBe("/tmp/rollout-latest.jsonl");
    expect(jsonOutput.recentSyncAudit[1]?.rolloutPath).toBe("/tmp/rollout-repeat.jsonl");
    expect(textOutput).toContain("Recent sync events (2 grouped):");
    expect(textOutput).toContain("Repeated similar sync events hidden: 1");
    expect(textOutput).toContain("- older sync events omitted: 1");
    expect(textOutput.match(/\/tmp\/rollout-repeat\.jsonl/g) ?? []).toHaveLength(1);
  });

  it("supports memory --recent --json and --print-startup from the CLI command surface", async () => {
    const homeDir = await tempDir("cam-memory-cli-home-");
    const projectDir = await tempDir("cam-memory-cli-project-");
    const memoryRoot = await tempDir("cam-memory-cli-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
      rolloutPath: "/tmp/rollout-memory-cli.jsonl",
      sessionId: "session-memory-cli",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      suppressedOperationCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      conflicts: [
        {
          scope: "project",
          topic: "preferences",
          candidateSummary: "Maybe use bun instead of pnpm in this repository.",
          conflictsWith: ["Prefer pnpm in this repository."],
          source: "existing-memory",
          resolution: "suppressed"
        }
      ],
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

    const jsonResult = runCli(projectDir, ["memory", "--recent", "2", "--json"]);
    expect(jsonResult.exitCode).toBe(0);
    const jsonOutput = JSON.parse(jsonResult.stdout) as MemoryCommandOutput;
    expect(jsonOutput.recentSyncAudit).toHaveLength(1);
    expect(jsonOutput.recentSyncAudit[0]).toMatchObject({
      rolloutPath: "/tmp/rollout-memory-cli.jsonl",
      suppressedOperationCount: 1
    });
    expect(jsonOutput.recentSyncAudit[0]?.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolution: "suppressed"
        })
      ])
    );
    expect(jsonOutput.recentAudit).toEqual(jsonOutput.recentSyncAudit);
    expect(jsonOutput.syncAuditPath).toBe(store.getSyncAuditPath());

    const textResult = runCli(projectDir, ["memory", "--recent", "2", "--print-startup"]);
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).toContain("Startup memory:");
    expect(textResult.stdout).toContain("# Codex Auto Memory");
    expect(textResult.stdout).toContain("Recent sync events (1 grouped):");
    expect(textResult.stdout).toContain(store.getMemoryFile("project"));
  }, 30_000);

  it("does not report startup-loaded files when the startup budget cannot fit quoted lines", async () => {
    const homeDir = await tempDir("cam-memory-header-only-home-");
    const projectDir = await tempDir("cam-memory-header-only-project-");
    const memoryRoot = await tempDir("cam-memory-header-only-root-");
    process.env.HOME = homeDir;

    const projectConfig: AppConfig = {
      autoMemoryEnabled: true,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 8,
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

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.loadedFiles).toEqual([]);
    expect(output.startupFilesByScope.global).toEqual([]);
    expect(output.startupFilesByScope.project).toEqual([]);
    expect(output.startupFilesByScope.projectLocal).toEqual([]);
    expect(output.startup.text).not.toContain("## Project Local");
    expect(output.startup.text).not.toContain("| # Project Local Memory");
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

  it("surfaces a pending sync recovery marker without mixing it into recent sync audit", async () => {
    const homeDir = await tempDir("cam-memory-recovery-home-");
    const projectDir = await tempDir("cam-memory-recovery-project-");
    const memoryRoot = await tempDir("cam-memory-recovery-root-");
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
    await store.writeSyncRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-sync-fail.jsonl",
      sessionId: "session-recovery",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      failedStage: "audit-write",
      failureMessage: "audit write failed",
      auditEntryWritten: false
    });

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
    expect(jsonOutput.pendingSyncRecovery).toMatchObject({
      rolloutPath: "/tmp/rollout-sync-fail.jsonl",
      sessionId: "session-recovery",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      failedStage: "audit-write",
      failureMessage: "audit write failed",
      auditEntryWritten: false
    });
    expect(jsonOutput.syncRecoveryPath).toBe(store.getSyncRecoveryPath());
    expect(textOutput).toContain("Pending sync recovery:");
    expect(textOutput).toContain("/tmp/rollout-sync-fail.jsonl");
    expect(textOutput).not.toContain("Recent sync events");
  });

  it("ignores a corrupted sync recovery marker instead of crashing the reviewer surface", async () => {
    const homeDir = await tempDir("cam-memory-bad-recovery-home-");
    const projectDir = await tempDir("cam-memory-bad-recovery-project-");
    const memoryRoot = await tempDir("cam-memory-bad-recovery-root-");
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
    await fs.writeFile(store.getSyncRecoveryPath(), "{\"broken\":\n", "utf8");

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

    expect(jsonOutput.pendingSyncRecovery).toBeNull();
    expect(textOutput).not.toContain("Pending sync recovery:");
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

  it("fails closed at the CLI surface when remember targets an unsafe active topic file", async () => {
    const homeDir = await tempDir("cam-remember-unsafe-active-home-");
    const projectDir = await tempDir("cam-remember-unsafe-active-project-");
    const memoryRoot = await tempDir("cam-remember-unsafe-active-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      topicFile,
      buildUnsafeWorkflowTopicContents(
        "keep-entry",
        "Keep this valid entry.",
        "Preserve this."
      ),
      "utf8"
    );

    const snapshot = await snapshotFiles([
      topicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project")
    ]);

    const result = runCli(projectDir, ["remember", "Do not rewrite unsafe files"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(result.stdout).toBe("");
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("fails closed at the CLI surface when forget delete targets an unsafe topic file", async () => {
    const homeDir = await tempDir("cam-forget-unsafe-delete-home-");
    const projectDir = await tempDir("cam-forget-unsafe-delete-project-");
    const memoryRoot = await tempDir("cam-forget-unsafe-delete-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      topicFile,
      buildUnsafeWorkflowTopicContents(
        "keep-entry",
        "Keep this valid entry.",
        "Preserve this."
      ),
      "utf8"
    );

    const snapshot = await snapshotFiles([
      topicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project")
    ]);

    const result = runCli(projectDir, ["forget", "keep-entry", "--scope", "project"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(result.stdout).toBe("");
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("fails closed at the CLI surface when forget archive targets an unsafe topic file", async () => {
    const homeDir = await tempDir("cam-forget-unsafe-archive-home-");
    const projectDir = await tempDir("cam-forget-unsafe-archive-project-");
    const memoryRoot = await tempDir("cam-forget-unsafe-archive-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      topicFile,
      buildUnsafeWorkflowTopicContents(
        "keep-entry",
        "Keep this valid entry.",
        "Preserve this."
      ),
      "utf8"
    );

    const snapshot = await snapshotFiles([
      topicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project"),
      store.getArchiveIndexFile("project"),
      store.getArchiveTopicFile("project", "workflow")
    ]);

    const result = runCli(projectDir, ["forget", "keep-entry", "--scope", "project", "--archive"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(result.stdout).toBe("");
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("fails closed at the CLI surface when remember would rewrite an unsafe archived topic file", async () => {
    const homeDir = await tempDir("cam-remember-unsafe-archived-home-");
    const projectDir = await tempDir("cam-remember-unsafe-archived-project-");
    const memoryRoot = await tempDir("cam-remember-unsafe-archived-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    const archivedTopicFile = store.getArchiveTopicFile("project", "workflow");
    await fs.writeFile(
      archivedTopicFile,
      buildUnsafeWorkflowTopicContents(
        "resurrect-archived-entry",
        "Resurrect archived entry",
        "Keep archived note."
      ),
      "utf8"
    );

    const snapshot = await snapshotFiles([
      store.getTopicFile("project", "workflow"),
      store.getMemoryFile("project"),
      store.getHistoryPath("project"),
      store.getArchiveIndexFile("project"),
      archivedTopicFile
    ]);

    const result = runCli(projectDir, ["remember", "Resurrect archived entry"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(result.stdout).toBe("");
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("fails closed across all scopes when default forget hits an unsafe later scope", async () => {
    const homeDir = await tempDir("cam-forget-all-atomic-home-");
    const projectDir = await tempDir("cam-forget-all-atomic-project-");
    const memoryRoot = await tempDir("cam-forget-all-atomic-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    await store.remember(
      "global",
      "workflow",
      "global-pnpm",
      "Global pnpm preference.",
      ["Use pnpm globally."],
      "Manual note."
    );
    const globalSnapshot = await snapshotFiles([
      store.getTopicFile("global", "workflow"),
      store.getMemoryFile("global"),
      store.getHistoryPath("global"),
      store.getArchiveIndexFile("global"),
      store.getArchiveTopicFile("global", "workflow")
    ]);
    const unsafeProjectTopicFile = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      unsafeProjectTopicFile,
      buildUnsafeWorkflowTopicContents(
        "project-pnpm",
        "Project pnpm preference.",
        "Use pnpm in this repository."
      ),
      "utf8"
    );
    const projectSnapshot = await snapshotFiles([
      unsafeProjectTopicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project"),
      store.getArchiveIndexFile("project"),
      store.getArchiveTopicFile("project", "workflow")
    ]);
    const projectLocalSnapshot = await snapshotFiles([
      store.getTopicFile("project-local", "workflow"),
      store.getMemoryFile("project-local"),
      store.getHistoryPath("project-local"),
      store.getArchiveIndexFile("project-local"),
      store.getArchiveTopicFile("project-local", "workflow")
    ]);

    const result = runCli(projectDir, ["forget", "pnpm"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(await store.listEntries("global")).toHaveLength(1);
    expect(await readFileIfExists(store.getTopicFile("global", "workflow"))).not.toBeNull();
    expect(await snapshotFiles(Object.keys(globalSnapshot))).toEqual(globalSnapshot);
    expect(await snapshotFiles(Object.keys(projectSnapshot))).toEqual(projectSnapshot);
    expect(await snapshotFiles(Object.keys(projectLocalSnapshot))).toEqual(projectLocalSnapshot);
  });

  it("fails closed across all scopes when forget archive hits an unsafe later scope", async () => {
    const homeDir = await tempDir("cam-forget-all-archive-home-");
    const projectDir = await tempDir("cam-forget-all-archive-project-");
    const memoryRoot = await tempDir("cam-forget-all-archive-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    await store.remember(
      "global",
      "workflow",
      "global-pnpm",
      "Global pnpm preference.",
      ["Use pnpm globally."],
      "Manual note."
    );
    const globalSnapshot = await snapshotFiles([
      store.getTopicFile("global", "workflow"),
      store.getMemoryFile("global"),
      store.getHistoryPath("global"),
      store.getArchiveIndexFile("global"),
      store.getArchiveTopicFile("global", "workflow")
    ]);
    const unsafeProjectTopicFile = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      unsafeProjectTopicFile,
      buildUnsafeWorkflowTopicContents(
        "project-pnpm",
        "Project pnpm preference.",
        "Use pnpm in this repository."
      ),
      "utf8"
    );
    const projectSnapshot = await snapshotFiles([
      unsafeProjectTopicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project"),
      store.getArchiveIndexFile("project"),
      store.getArchiveTopicFile("project", "workflow")
    ]);
    const projectLocalSnapshot = await snapshotFiles([
      store.getTopicFile("project-local", "workflow"),
      store.getMemoryFile("project-local"),
      store.getHistoryPath("project-local"),
      store.getArchiveIndexFile("project-local"),
      store.getArchiveTopicFile("project-local", "workflow")
    ]);

    const result = runCli(projectDir, ["forget", "pnpm", "--archive"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot rewrite topic file");
    expect(await store.listEntries("global")).toHaveLength(1);
    expect(await store.listEntries("global", "archived")).toEqual([]);
    expect(await snapshotFiles(Object.keys(globalSnapshot))).toEqual(globalSnapshot);
    expect(await snapshotFiles(Object.keys(projectSnapshot))).toEqual(projectSnapshot);
    expect(await snapshotFiles(Object.keys(projectLocalSnapshot))).toEqual(projectLocalSnapshot);
  });
});
