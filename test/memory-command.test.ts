import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemory, runMemoryReindex } from "../src/lib/commands/memory.js";
import { toManualMutationForgetPayload } from "../src/lib/commands/manual-mutation-review.js";
import { configPaths } from "../src/lib/config/load-config.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import type { AppConfig, ManualMutationReviewEntry, MemoryCommandOutput } from "../src/lib/types.js";
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

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function pathContainsCam(dir: string): Promise<boolean> {
  const candidates =
    process.platform === "win32"
      ? [path.join(dir, "cam.cmd"), path.join(dir, "cam.exe")]
      : [path.join(dir, "cam")];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }

  return false;
}

async function buildPathWithoutCam(extraDir: string): Promise<string> {
  const baseEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const filteredEntries: string[] = [];

  for (const entry of baseEntries) {
    if (!(await pathContainsCam(entry))) {
      filteredEntries.push(entry);
    }
  }

  return [extraDir, ...filteredEntries].join(path.delimiter);
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
      "Topic files on demand stay as safe references until a later read needs them."
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
    expect(output).toContain("Applied: 0 | No-op: 0 | Suppressed: 0 | Rejected: 0 | Scopes: none");
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
    expect(output.highlightCount).toBe(output.startup.highlights.length);
    expect(output.omittedHighlightCount).toBe(output.startup.omittedHighlightCount);
    expect(output.highlightsByScope.project).toEqual(output.startup.highlights);
    expect(output.startupSectionsRendered).toMatchObject({
      projectLocal: true,
      project: true,
      global: true,
      highlights: true,
      topicFiles: true
    });
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

  it("does not collapse repeated sync audit previews when rejected reason counts differ", async () => {
    const homeDir = await tempDir("cam-memory-rejected-grouping-home-");
    const projectDir = await tempDir("cam-memory-rejected-grouping-project-");
    const memoryRoot = await tempDir("cam-memory-rejected-grouping-root-");
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

    for (const [appliedAt, rejectedReasonCounts] of [
      [
        "2026-03-14T12:00:00.000Z",
        {
          sensitive: 1
        }
      ],
      [
        "2026-03-14T12:01:00.000Z",
        {
          "unknown-topic": 1
        }
      ]
    ] as const) {
      await store.appendSyncAuditEntry({
        appliedAt,
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
        status: "no-op",
        appliedCount: 0,
        rejectedOperationCount: 1,
        rejectedReasonCounts,
        scopesTouched: [],
        resultSummary: "0 operations applied, 1 rejected",
        operations: []
      });
    }

    const textOutput = await runMemory({
      cwd: projectDir,
      recent: "5"
    });

    expect(textOutput).toContain("2026-03-14T12:00:00.000Z");
    expect(textOutput).toContain("2026-03-14T12:01:00.000Z");
    expect(textOutput).not.toContain("Repeated similar sync events hidden: 1");
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
    expect(output.highlightCount).toBe(0);
    expect(output.omittedHighlightCount).toBe(0);
    expect(output.startupSectionsRendered).toMatchObject({
      projectLocal: false,
      project: false,
      global: false,
      highlights: false,
      topicFiles: false
    });
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
      rejectedOperationCount: 2,
      rejectedReasonCounts: {
        sensitive: 1,
        "unknown-topic": 1
      },
      rejectedOperations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "sensitive-note",
          reason: "sensitive"
        },
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "unknown-note",
          reason: "unknown-topic"
        }
      ],
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
      rejectedOperationCount: 2,
      rejectedReasonCounts: {
        sensitive: 1,
        "unknown-topic": 1
      },
      rejectedOperations: [
        expect.objectContaining({
          id: "sensitive-note",
          reason: "sensitive"
        }),
        expect.objectContaining({
          id: "unknown-note",
          reason: "unknown-topic"
        })
      ],
      scopesTouched: ["project"],
      failedStage: "audit-write",
      failureMessage: "audit write failed",
      auditEntryWritten: false
    });
    expect(jsonOutput.syncRecoveryPath).toBe(store.getSyncRecoveryPath());
    expect(textOutput).toContain("Pending sync recovery:");
    expect(textOutput).toContain("/tmp/rollout-sync-fail.jsonl");
    expect(textOutput).toContain("Rejected: 2");
    expect(textOutput).toContain("Rejected reasons: sensitive=1, unknown-topic=1");
    expect(textOutput).toContain("Rejected operations:");
    expect(textOutput).toContain("[sensitive] project/workflow/sensitive-note");
    expect(textOutput).toContain("[unknown-topic] project/workflow/unknown-note");
    expect(textOutput).not.toContain("Recent sync events");
  });

  it("normalizes legacy sync recovery reviewer fields in json output", async () => {
    const homeDir = await tempDir("cam-memory-legacy-recovery-home-");
    const projectDir = await tempDir("cam-memory-legacy-recovery-project-");
    const memoryRoot = await tempDir("cam-memory-legacy-recovery-root-");
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
    await fs.writeFile(
      store.getSyncRecoveryPath(),
      `${JSON.stringify({
        recordedAt: "2026-03-18T00:00:00.000Z",
        projectId: project.projectId,
        worktreeId: project.worktreeId,
        rolloutPath: "/tmp/legacy-recovery.jsonl",
        configuredExtractorMode: "heuristic",
        configuredExtractorName: "heuristic",
        actualExtractorMode: "heuristic",
        actualExtractorName: "heuristic",
        status: "no-op",
        appliedCount: 0,
        scopesTouched: [],
        failedStage: "audit-write",
        failureMessage: "legacy recovery marker",
        auditEntryWritten: false
      })}\n`,
      "utf8"
    );

    const jsonOutput = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true,
        recent: "5"
      })
    ) as MemoryCommandOutput;

    expect(jsonOutput.pendingSyncRecovery).toMatchObject({
      rolloutPath: "/tmp/legacy-recovery.jsonl",
      rejectedOperationCount: 0,
      rejectedReasonCounts: {},
      rejectedOperations: [],
      noopOperationCount: 0,
      suppressedOperationCount: 0
    });
  });

  it("surfaces unsafe topic diagnostics in json output and excludes unsafe topic entries from startup highlights", async () => {
    const homeDir = await tempDir("cam-memory-unsafe-json-home-");
    const projectDir = await tempDir("cam-memory-unsafe-json-project-");
    const memoryRoot = await tempDir("cam-memory-unsafe-json-root-");
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

    const unsafeTopicPath = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      unsafeTopicPath,
      buildUnsafeWorkflowTopicContents(
        "prefer-pnpm",
        "Prefer pnpm in this repository.",
        "Use pnpm instead of npm in this repository."
      ),
      "utf8"
    );
    await store.rebuildIndex("project");

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput & {
      topicDiagnostics: Array<{
        scope: string;
        state: string;
        topic: string;
        safeToRewrite: boolean;
        invalidEntryBlockCount: number;
        manualContentDetected: boolean;
        unsafeReason?: string;
      }>;
    };

    expect(output.topicDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          topic: "workflow",
          safeToRewrite: false,
          invalidEntryBlockCount: 1,
          manualContentDetected: true,
          unsafeReason: expect.stringContaining("malformed or unsupported entry blocks")
        })
      ])
    );
    expect(output.highlightCount).toBe(0);
    expect(output.highlightsByScope.project).toEqual([]);
    expect(output.topicFilesByScope.project).toEqual([]);
    expect(output.topicFileOmissionCounts).toMatchObject({
      "unsafe-topic": 1
    });
    expect(output.omittedTopicFileCount).toBeGreaterThanOrEqual(1);
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

  it("fails closed at the CLI surface when forget query is empty or whitespace-only", async () => {
    const homeDir = await tempDir("cam-forget-empty-cli-home-");
    const projectDir = await tempDir("cam-forget-empty-cli-project-");
    const memoryRoot = await tempDir("cam-forget-empty-cli-root-");
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

    const emptyResult = runCli(projectDir, ["forget", ""], {
      env: { HOME: homeDir }
    });
    expect(emptyResult.exitCode).toBe(1);
    expect(emptyResult.stderr).toContain("non-empty");

    const blankResult = runCli(projectDir, ["forget", "   "], {
      env: { HOME: homeDir }
    });
    expect(blankResult.exitCode).toBe(1);
    expect(blankResult.stderr).toContain("non-empty");
    expect(await store.listEntries("project")).toHaveLength(1);
  });

  it("fails closed at the CLI surface when remember text is empty or whitespace-only", async () => {
    const homeDir = await tempDir("cam-remember-empty-cli-home-");
    const projectDir = await tempDir("cam-remember-empty-cli-project-");
    const memoryRoot = await tempDir("cam-remember-empty-cli-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const emptyResult = runCli(projectDir, ["remember", ""], {
      env: { HOME: homeDir }
    });
    expect(emptyResult.exitCode).toBe(1);
    expect(emptyResult.stderr).toContain("non-empty");

    const blankResult = runCli(projectDir, ["remember", "   "], {
      env: { HOME: homeDir }
    });
    expect(blankResult.exitCode).toBe(1);
    expect(blankResult.stderr).toContain("non-empty");
  });

  it("surfaces a structured reviewer payload for remember --json", async () => {
    const homeDir = await tempDir("cam-remember-json-home-");
    const projectDir = await tempDir("cam-remember-json-project-");
    const memoryRoot = await tempDir("cam-remember-json-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      projectDir,
      [
        "remember",
        "Prefer pnpm in this repository.",
        "--scope",
        "project",
        "--topic",
        "workflow",
        "--detail",
        "Use pnpm instead of npm in this repository.",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      action: string;
      mutationKind: string;
      entryCount: number;
      warningCount: number;
      uniqueAuditCount: number;
      auditCountsDeduplicated: boolean;
      warningsByEntryRef: Record<string, number>;
      leadEntryRef?: string | null;
      leadEntryIndex?: number | null;
      detailsAvailable?: boolean;
      reviewRefState?: string | null;
      matchedCount: number;
      appliedCount: number;
      noopCount: number;
      affectedRefs: string[];
      followUp: {
        timelineRefs: string[];
        detailsRefs: string[];
      };
      primaryEntry: {
        ref: string;
        detailsRef: string | null;
        lifecycleAction: string;
      };
      scope: string;
      topic: string;
      id: string;
      text: string;
      ref: string;
      path: string;
      historyPath: string;
      lifecycleAction: string;
      latestState: string;
      latestLifecycleAttempt: { action: string; outcome: string; updateKind: string | null } | null;
      reviewerSummary: {
        matchedAuditOperationCount: number;
        noopOperationCount: number;
        suppressedOperationCount: number;
        rejectedOperationCount: number;
        rolloutConflictCount: number;
      };
      nextRecommendedActions: string[];
      lineageSummary: { latestAction: string | null; latestUpdateKind: string | null };
      entry: { summary: string; details: string[] };
      warnings: string[];
    };

    expect(payload).toMatchObject({
      action: "remember",
      mutationKind: "remember",
      entryCount: 1,
      warningCount: 0,
      uniqueAuditCount: 0,
      auditCountsDeduplicated: true,
      warningsByEntryRef: {},
      leadEntryRef: "project:active:workflow:prefer-pnpm-in-this-repository",
      leadEntryIndex: 0,
      detailsAvailable: true,
      reviewRefState: "active",
      matchedCount: 1,
      appliedCount: 1,
      noopCount: 0,
      primaryEntry: {
        ref: "project:active:workflow:prefer-pnpm-in-this-repository",
        timelineRef: "project:active:workflow:prefer-pnpm-in-this-repository",
        detailsRef: "project:active:workflow:prefer-pnpm-in-this-repository",
        lifecycleAction: "add"
      },
      scope: "project",
      topic: "workflow",
      id: "prefer-pnpm-in-this-repository",
      text: "Prefer pnpm in this repository.",
      ref: "project:active:workflow:prefer-pnpm-in-this-repository",
      lifecycleAction: "add",
      latestState: "active",
      latestLifecycleAttempt: {
        action: "add",
        outcome: "applied",
        updateKind: null
      },
      reviewerSummary: {
        matchedAuditOperationCount: 0,
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        rejectedOperationCount: 0,
        rolloutConflictCount: 0
      },
      lineageSummary: {
        latestAction: "add",
        latestUpdateKind: null
      },
      entry: {
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."]
      },
      warnings: []
    });
    expect(payload.affectedRefs).toEqual([payload.ref]);
    expect(payload.followUp.timelineRefs).toEqual([payload.ref]);
    expect(payload.followUp.detailsRefs).toEqual([payload.ref]);
    expect(payload.nextRecommendedActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("recall timeline"),
        expect.stringContaining("memory --recent")
      ])
    );
    expect(payload.path).toContain(path.join("workflow.md"));
    expect(payload.historyPath).toContain(path.join("project", "memory-history.jsonl"));
  });

  it("includes review-oriented next steps in remember text output", async () => {
    const homeDir = await tempDir("cam-remember-text-home-");
    const projectDir = await tempDir("cam-remember-text-project-");
    const memoryRoot = await tempDir("cam-remember-text-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      projectDir,
      [
        "remember",
        "Prefer pnpm in this repository.",
        "--scope",
        "project",
        "--topic",
        "workflow",
        "--detail",
        "Use pnpm instead of npm in this repository."
      ],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Saved memory to project/workflow with id prefer-pnpm-in-this-repository."
    );
    expect(result.stdout).toContain("Next steps:");
    expect(result.stdout).toContain("recall timeline");
    expect(result.stdout).toContain("recall details");
    expect(result.stdout).toContain("memory --recent");
    expect(result.stdout).toContain("memory reindex");
  });

  it("pins remember follow-up commands to --cwd and resolved launcher when called from another directory", async () => {
    const homeDir = await tempDir("cam-remember-cwd-home-");
    const projectDir = await tempDir("cam-remember-cwd-project-");
    const callerDir = await tempDir("cam-remember-cwd-caller-");
    const memoryRoot = await tempDir("cam-remember-cwd-root-");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      callerDir,
      [
        "remember",
        "Prefer pnpm in this repository.",
        "--scope",
        "project",
        "--topic",
        "workflow",
        "--detail",
        "Use pnpm instead of npm in this repository.",
        "--cwd",
        projectDir,
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      nextRecommendedActions: string[];
    };

    expect(payload.nextRecommendedActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("--cwd"),
        expect.stringContaining(realProjectDir),
        expect.stringContaining("recall timeline"),
        expect.stringContaining("recall details"),
        expect.stringContaining("memory --recent"),
        expect.stringContaining("memory reindex")
      ])
    );
  });

  it("surfaces a structured reviewer payload for remember --json noop updates", async () => {
    const homeDir = await tempDir("cam-remember-noop-json-home-");
    const projectDir = await tempDir("cam-remember-noop-json-project-");
    const memoryRoot = await tempDir("cam-remember-noop-json-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const first = runCli(
      projectDir,
      [
        "remember",
        "Prefer pnpm in this repository.",
        "--scope",
        "project",
        "--topic",
        "workflow",
        "--detail",
        "Use pnpm instead of npm in this repository.",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(first.exitCode, first.stderr).toBe(0);

    const second = runCli(
      projectDir,
      [
        "remember",
        "Prefer pnpm in this repository.",
        "--scope",
        "project",
        "--topic",
        "workflow",
        "--detail",
        "Use pnpm instead of npm in this repository.",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(second.exitCode, second.stderr).toBe(0);

    const payload = JSON.parse(second.stdout) as {
      mutationKind: string;
      entryCount: number;
      warningCount: number;
      uniqueAuditCount: number;
      auditCountsDeduplicated: boolean;
      warningsByEntryRef: Record<string, number>;
      matchedCount: number;
      appliedCount: number;
      noopCount: number;
      affectedCount: number;
      summary: {
        matchedCount: number;
        appliedCount: number;
        noopCount: number;
        affectedCount: number;
      };
      primaryEntry: {
        ref: string;
        detailsRef: string | null;
        lifecycleAction: string;
      };
      reviewerSummary: {
        matchedAuditOperationCount: number;
        noopOperationCount: number;
        suppressedOperationCount: number;
        rejectedOperationCount: number;
        rolloutConflictCount: number;
      };
      nextRecommendedActions: string[];
      entries: Array<{
        lifecycleAction: string;
        latestAppliedLifecycle: { action: string } | null;
        latestLifecycleAttempt: { action: string; outcome: string } | null;
      }>;
      latestAppliedLifecycle: { action: string } | null;
      latestLifecycleAttempt: { action: string; outcome: string } | null;
      lifecycleAction: string;
      followUp: {
        timelineRefs: string[];
        detailsRefs: string[];
      };
    };

    expect(payload).toMatchObject({
      mutationKind: "remember",
      entryCount: 1,
      warningCount: 1,
      uniqueAuditCount: 0,
      auditCountsDeduplicated: true,
      warningsByEntryRef: {
        "project:active:workflow:prefer-pnpm-in-this-repository": 1
      },
      matchedCount: 1,
      appliedCount: 0,
      noopCount: 1,
      affectedCount: 1,
      summary: {
        matchedCount: 1,
        appliedCount: 0,
        noopCount: 1,
        affectedCount: 1
      },
      primaryEntry: {
        ref: "project:active:workflow:prefer-pnpm-in-this-repository",
        timelineRef: "project:active:workflow:prefer-pnpm-in-this-repository",
        detailsRef: "project:active:workflow:prefer-pnpm-in-this-repository",
        lifecycleAction: "noop"
      },
      lifecycleAction: "noop",
      latestAppliedLifecycle: {
        action: "add"
      },
      latestLifecycleAttempt: {
        action: "noop",
        outcome: "noop"
      },
      entries: [
        {
          lifecycleAction: "noop",
          latestAppliedLifecycle: {
            action: "add"
          },
          latestLifecycleAttempt: {
            action: "noop",
            outcome: "noop"
          }
        }
      ]
    });
    expect(payload.reviewerSummary).toMatchObject({
      matchedAuditOperationCount: 0,
      noopOperationCount: 1,
      suppressedOperationCount: 0,
      rejectedOperationCount: 0,
      rolloutConflictCount: 0
    });
    expect(payload.nextRecommendedActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("recall timeline"),
        expect.stringContaining("memory --recent")
      ])
    );
    expect(payload.followUp.timelineRefs).toHaveLength(1);
    expect(payload.followUp.detailsRefs).toHaveLength(1);
  });

  it("infers a durable topic for remember when --topic is omitted", async () => {
    const homeDir = await tempDir("cam-remember-infer-topic-home-");
    const projectDir = await tempDir("cam-remember-infer-topic-project-");
    const memoryRoot = await tempDir("cam-remember-infer-topic-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      projectDir,
      ["remember", "Prefer pnpm in this repository.", "--scope", "project", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      primaryEntry: {
        ref: string;
      };
      entry: {
        topic: string;
        summary: string;
      };
    };

    expect(payload.primaryEntry.ref).toContain(":preferences:");
    expect(payload.entry).toMatchObject({
      topic: "preferences",
      summary: "Prefer pnpm in this repository."
    });
  });

  it("updates a single clear commands memory instead of appending a duplicate when --topic is omitted", async () => {
    const homeDir = await tempDir("cam-remember-command-update-home-");
    const projectDir = await tempDir("cam-remember-command-update-project-");
    const memoryRoot = await tempDir("cam-remember-command-update-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const first = runCli(
      projectDir,
      [
        "remember",
        "Use `pnpm test` to run the test suite.",
        "--scope",
        "project",
        "--topic",
        "commands",
        "--detail",
        "Run `pnpm test` from the repository root.",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(first.exitCode, first.stderr).toBe(0);

    const second = runCli(
      projectDir,
      [
        "remember",
        "Run `pnpm run test` to execute the test suite.",
        "--scope",
        "project",
        "--detail",
        "Prefer the canonical `pnpm test` form in this repository.",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(second.exitCode, second.stderr).toBe(0);

    const payload = JSON.parse(second.stdout) as {
      lifecycleAction: string;
      primaryEntry: {
        ref: string;
      };
      entry: {
        topic: string;
        summary: string;
      };
    };

    expect(payload).toMatchObject({
      lifecycleAction: "update",
      primaryEntry: {
        ref: "project:active:commands:use-pnpm-test-to-run-the-test-suite"
      },
      entry: {
        topic: "commands",
        summary: "Run `pnpm run test` to execute the test suite."
      }
    });

    const inspection = runCli(projectDir, ["memory", "--json"], {
      env: { HOME: homeDir }
    });
    expect(inspection.exitCode, inspection.stderr).toBe(0);

    const memoryOutput = JSON.parse(inspection.stdout) as {
      scopes: Array<{
        scope: string;
        count: number;
        topics: string[];
      }>;
    };
    expect(memoryOutput.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          count: 1,
          topics: ["commands"]
        })
      ])
    );
  });

  it("surfaces a structured reviewer payload for forget --json including archive refs", async () => {
    const homeDir = await tempDir("cam-forget-json-home-");
    const projectDir = await tempDir("cam-forget-json-project-");
    const memoryRoot = await tempDir("cam-forget-json-root-");
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

    const result = runCli(projectDir, ["forget", "pnpm", "--scope", "project", "--archive", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      action: string;
      mutationKind: string;
      entryCount: number;
      warningCount: number;
      uniqueAuditCount: number;
      auditCountsDeduplicated: boolean;
      warningsByEntryRef: Record<string, number>;
      leadEntryRef?: string | null;
      leadEntryIndex?: number | null;
      detailsAvailable?: boolean;
      reviewRefState?: string | null;
      detailsUsableEntryCount: number;
      timelineOnlyEntryCount: number;
      query: string;
      scope: string;
      archive: boolean;
      matchedCount: number;
      appliedCount: number;
      noopCount: number;
      affectedCount: number;
      affectedRefs: string[];
      followUp: {
        timelineRefs: string[];
        detailsRefs: string[];
      };
      primaryEntry: {
        ref: string;
        detailsRef: string | null;
        lifecycleAction: string;
      };
      reviewerSummary: {
        matchedAuditOperationCount: number;
        noopOperationCount: number;
        suppressedOperationCount: number;
        rejectedOperationCount: number;
        rolloutConflictCount: number;
      };
      ref: string;
      timelineRef: string;
      detailsRef: string | null;
      lifecycleAction: string;
      latestLifecycleAction: string | null;
      latestAppliedLifecycle: { action: string } | null;
      latestLifecycleAttempt: { action: string; outcome: string; updateKind: string | null } | null;
      latestState: string;
      latestSessionId: string | null;
      latestRolloutPath: string | null;
      latestAudit: unknown;
      timelineWarningCount: number;
      lineageSummary: { latestAction: string | null; latestUpdateKind: string | null };
      warnings: string[];
      entry: {
        id: string;
        scope: string;
        topic: string;
        summary: string;
      };
      nextRecommendedActions: string[];
      entries: Array<{
        ref: string;
        timelineRef: string;
        detailsRef: string | null;
        lifecycleAction: string;
        latestState: string;
        latestLifecycleAttempt: { action: string; outcome: string; updateKind: string | null } | null;
        lineageSummary: { latestAction: string | null; latestUpdateKind: string | null };
      }>;
    };

    expect(payload).toMatchObject({
      action: "forget",
      mutationKind: "forget",
      entryCount: 1,
      warningCount: 0,
      uniqueAuditCount: 0,
      auditCountsDeduplicated: true,
      warningsByEntryRef: {},
      leadEntryRef: "project:archived:workflow:prefer-pnpm",
      leadEntryIndex: 0,
      detailsAvailable: true,
      reviewRefState: "archived",
      detailsUsableEntryCount: 1,
      timelineOnlyEntryCount: 0,
      query: "pnpm",
      scope: "project",
      archive: true,
      matchedCount: 1,
      appliedCount: 1,
      noopCount: 0,
      affectedCount: 1,
      ref: "project:archived:workflow:prefer-pnpm",
      timelineRef: "project:archived:workflow:prefer-pnpm",
      detailsRef: "project:archived:workflow:prefer-pnpm",
      lifecycleAction: "archive",
      primaryEntry: {
        ref: "project:archived:workflow:prefer-pnpm",
        timelineRef: "project:archived:workflow:prefer-pnpm",
        detailsRef: "project:archived:workflow:prefer-pnpm",
        lifecycleAction: "archive"
      },
      latestLifecycleAction: "archive",
      latestAppliedLifecycle: {
        action: "archive"
      },
      latestLifecycleAttempt: {
        action: "archive",
        outcome: "applied",
        updateKind: null
      },
      latestState: "archived",
      latestSessionId: null,
      latestRolloutPath: null,
      timelineWarningCount: 0,
      lineageSummary: {
        latestAction: "archive",
        latestUpdateKind: null
      },
      warnings: [],
      entry: {
        id: "prefer-pnpm",
        scope: "project",
        topic: "workflow",
        summary: "Prefer pnpm in this repository."
      },
      entries: [
        {
          ref: "project:archived:workflow:prefer-pnpm",
          timelineRef: "project:archived:workflow:prefer-pnpm",
          detailsRef: "project:archived:workflow:prefer-pnpm",
          lifecycleAction: "archive",
          latestState: "archived",
          latestLifecycleAttempt: {
            action: "archive",
            outcome: "applied",
            updateKind: null
          },
          lineageSummary: {
            latestAction: "archive",
            latestUpdateKind: null
          }
        }
      ]
    });
    expect(payload.affectedRefs).toEqual(["project:archived:workflow:prefer-pnpm"]);
    expect(payload.followUp.timelineRefs).toEqual(["project:archived:workflow:prefer-pnpm"]);
    expect(payload.followUp.detailsRefs).toEqual(["project:archived:workflow:prefer-pnpm"]);
    expect(payload.reviewerSummary).toMatchObject({
      matchedAuditOperationCount: 0,
      noopOperationCount: 0,
      suppressedOperationCount: 0,
      rejectedOperationCount: 0,
      rolloutConflictCount: 0
    });
    expect(payload.latestAudit).toBeNull();
    expect(payload.nextRecommendedActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("recall timeline"),
        expect.stringContaining("memory --recent")
      ])
    );
  });

  it("surfaces delete-only review routes for forget --json when details are no longer available", async () => {
    const homeDir = await tempDir("cam-forget-delete-json-home-");
    const projectDir = await tempDir("cam-forget-delete-json-project-");
    const memoryRoot = await tempDir("cam-forget-delete-json-root-");
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

    const result = runCli(projectDir, ["forget", "pnpm", "--scope", "project", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      mutationKind: string;
      entryCount: number;
      warningCount: number;
      uniqueAuditCount: number;
      auditCountsDeduplicated: boolean;
      warningsByEntryRef: Record<string, number>;
      leadEntryRef?: string | null;
      leadEntryIndex?: number | null;
      detailsAvailable?: boolean;
      reviewRefState?: string | null;
      detailsUsableEntryCount: number;
      timelineOnlyEntryCount: number;
      matchedCount: number;
      appliedCount: number;
      noopCount: number;
      affectedRefs: string[];
      ref: string;
      timelineRef: string;
      detailsRef: string | null;
      lifecycleAction: string;
      latestLifecycleAction: string | null;
      latestAppliedLifecycle: { action: string } | null;
      latestLifecycleAttempt: { action: string; outcome: string; updateKind: string | null } | null;
      latestState: string;
      latestSessionId: string | null;
      latestRolloutPath: string | null;
      latestAudit: unknown;
      timelineWarningCount: number;
      lineageSummary: { latestAction: string | null; latestUpdateKind: string | null };
      warnings: string[];
      entry: {
        id: string;
        scope: string;
        topic: string;
        summary: string;
      };
      followUp: {
        timelineRefs: string[];
        detailsRefs: string[];
      };
      entries: Array<{
        ref: string;
        timelineRef: string;
        detailsRef: string | null;
      }>;
    };

    expect(payload).toMatchObject({
      mutationKind: "forget",
      entryCount: 1,
      warningCount: 0,
      uniqueAuditCount: 0,
      auditCountsDeduplicated: true,
      warningsByEntryRef: {},
      leadEntryRef: null,
      leadEntryIndex: null,
      detailsAvailable: false,
      reviewRefState: null,
      detailsUsableEntryCount: 0,
      timelineOnlyEntryCount: 1,
      matchedCount: 1,
      appliedCount: 1,
      noopCount: 0,
      ref: null,
      timelineRef: null,
      detailsRef: null,
      lifecycleAction: null,
      latestLifecycleAction: null,
      latestAppliedLifecycle: null,
      latestLifecycleAttempt: null,
      latestState: null,
      latestSessionId: null,
      latestRolloutPath: null,
      timelineWarningCount: 0,
      lineageSummary: null,
      warnings: [],
      entry: null,
      affectedRefs: ["project:active:workflow:prefer-pnpm"],
      followUp: {
        timelineRefs: ["project:active:workflow:prefer-pnpm"],
        detailsRefs: []
      },
      entries: [
        {
          ref: "project:active:workflow:prefer-pnpm",
          timelineRef: "project:active:workflow:prefer-pnpm",
          detailsRef: null
        }
      ]
    });
    expect(payload.latestAudit).toBeNull();
  });

  it("matches forget queries across summary and details using the shared retrieval query semantics", async () => {
    const homeDir = await tempDir("cam-forget-multi-term-home-");
    const projectDir = await tempDir("cam-forget-multi-term-project-");
    const memoryRoot = await tempDir("cam-forget-multi-term-root-");
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

    const result = runCli(
      projectDir,
      ["forget", "pnpm npm", "--scope", "project", "--archive", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      matchedCount: number;
      appliedCount: number;
      affectedRefs: string[];
    };
    expect(payload).toMatchObject({
      matchedCount: 1,
      appliedCount: 1,
      affectedRefs: ["project:archived:workflow:prefer-pnpm"]
    });
  });

  it("matches forget queries even when shared retrieval terms contain trailing punctuation", async () => {
    const homeDir = await tempDir("cam-forget-punctuated-query-home-");
    const projectDir = await tempDir("cam-forget-punctuated-query-project-");
    const memoryRoot = await tempDir("cam-forget-punctuated-query-root-");
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

    const result = runCli(
      projectDir,
      ["forget", "pnpm, npm.", "--scope", "project", "--archive", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      matchedCount: number;
      appliedCount: number;
      affectedRefs: string[];
    };
    expect(payload).toMatchObject({
      matchedCount: 1,
      appliedCount: 1,
      affectedRefs: ["project:archived:workflow:prefer-pnpm"]
    });
  });

  it("matches forget queries when natural separators split shared query terms", async () => {
    const homeDir = await tempDir("cam-forget-separated-query-home-");
    const projectDir = await tempDir("cam-forget-separated-query-project-");
    const memoryRoot = await tempDir("cam-forget-separated-query-root-");
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

    const result = runCli(
      projectDir,
      ["forget", "pnpm/npm", "--scope", "project", "--archive", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      matchedCount: number;
      appliedCount: number;
      affectedRefs: string[];
    };
    expect(payload).toMatchObject({
      matchedCount: 1,
      appliedCount: 1,
      affectedRefs: ["project:archived:workflow:prefer-pnpm"]
    });
  });

  it("matches forget queries across topic and content fields with shared retrieval semantics", async () => {
    const homeDir = await tempDir("cam-forget-topic-query-home-");
    const projectDir = await tempDir("cam-forget-topic-query-project-");
    const memoryRoot = await tempDir("cam-forget-topic-query-root-");
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

    const result = runCli(
      projectDir,
      ["forget", "workflow pnpm", "--scope", "project", "--archive", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      matchedCount: number;
      appliedCount: number;
      affectedRefs: string[];
    };
    expect(payload).toMatchObject({
      matchedCount: 1,
      appliedCount: 1,
      affectedRefs: ["project:archived:workflow:prefer-pnpm"]
    });
  });

  it("deduplicates rollout-level reviewer summary counts across multiple forget entries", async () => {
    const sharedAudit = {
      auditPath: "/tmp/shared-sync-audit.jsonl",
      appliedAt: "2026-03-30T12:00:00.000Z",
      rolloutPath: "/tmp/shared-rollout.jsonl",
      sessionId: "session-reviewer-dedupe",
      status: "applied" as const,
      resultSummary: "2 operation(s) applied, 2 suppressed, 3 rejected",
      matchedOperationCount: 2,
      noopOperationCount: 1,
      suppressedOperationCount: 2,
      rejectedOperationCount: 3,
      rejectedReasonCounts: {
        "unknown-topic": 2,
        sensitive: 1
      },
      rejectedOperations: [
        {
          action: "upsert" as const,
          scope: "project" as const,
          topic: "workflow",
          id: "dropped-topic",
          reason: "unknown-topic" as const
        }
      ],
      conflicts: [
        {
          scope: "project" as const,
          topic: "workflow",
          candidateSummary: "Maybe use npm instead.",
          conflictsWith: ["Prefer pnpm in this repository."],
          source: "existing-memory" as const,
          resolution: "suppressed" as const
        },
        {
          scope: "project" as const,
          topic: "workflow",
          candidateSummary: "Maybe use npm in smoke tests.",
          conflictsWith: ["Prefer pnpm for smoke tests in this repository."],
          source: "within-rollout" as const,
          resolution: "suppressed" as const
        }
      ]
    };
    const entries: ManualMutationReviewEntry[] = [
      {
        ref: "project:deleted:workflow:prefer-pnpm",
        timelineRef: "project:deleted:workflow:prefer-pnpm",
        detailsRef: null,
        scope: "project",
        state: "active",
        topic: "workflow",
        id: "prefer-pnpm",
        path: null,
        historyPath: "/tmp/project-history.jsonl",
        lifecycleAction: "delete",
        latestLifecycleAction: "delete",
        latestAppliedLifecycle: {
          at: "2026-03-30T12:05:00.000Z",
          action: "delete",
          outcome: "applied",
          state: "deleted",
          previousState: "active",
          nextState: "deleted",
          summary: "Prefer pnpm in this repository.",
          updateKind: null,
          sessionId: null,
          rolloutPath: null
        },
        latestLifecycleAttempt: {
          at: "2026-03-30T12:05:00.000Z",
          action: "delete",
          outcome: "applied",
          state: "deleted",
          previousState: "active",
          nextState: "deleted",
          summary: "Prefer pnpm in this repository.",
          updateKind: null,
          sessionId: null,
          rolloutPath: null
        },
        latestState: "deleted",
        latestSessionId: null,
        latestRolloutPath: null,
        latestAudit: sharedAudit,
        timelineWarningCount: 0,
        lineageSummary: {
          eventCount: 2,
          firstSeenAt: "2026-03-30T12:00:00.000Z",
          latestAt: "2026-03-30T12:05:00.000Z",
          latestAction: "delete",
          latestState: "deleted",
          latestAttemptedAction: "delete",
          latestAttemptedState: "deleted",
          latestAttemptedOutcome: "applied",
          latestUpdateKind: null,
          archivedAt: null,
          deletedAt: "2026-03-30T12:05:00.000Z",
          latestAuditStatus: "applied",
          refNoopCount: 0,
          matchedAuditOperationCount: 1,
          rolloutNoopOperationCount: 1,
          rolloutSuppressedOperationCount: 2,
          rolloutConflictCount: 2,
          noopOperationCount: 0,
          suppressedOperationCount: 2,
          conflictCount: 2,
          rejectedOperationCount: 3,
          rejectedReasonCounts: {
            "unknown-topic": 2,
            sensitive: 1
          }
        },
        warnings: [],
        entry: {
          id: "prefer-pnpm",
          scope: "project",
          topic: "workflow",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          updatedAt: "2026-03-30T12:00:00.000Z",
          sources: ["manual"]
        }
      },
      {
        ref: "project:deleted:workflow:prefer-pnpm-for-smoke-tests",
        timelineRef: "project:deleted:workflow:prefer-pnpm-for-smoke-tests",
        detailsRef: null,
        scope: "project",
        state: "active",
        topic: "workflow",
        id: "prefer-pnpm-for-smoke-tests",
        path: null,
        historyPath: "/tmp/project-history.jsonl",
        lifecycleAction: "delete",
        latestLifecycleAction: "delete",
        latestAppliedLifecycle: {
          at: "2026-03-30T12:05:00.000Z",
          action: "delete",
          outcome: "applied",
          state: "deleted",
          previousState: "active",
          nextState: "deleted",
          summary: "Prefer pnpm for smoke tests in this repository.",
          updateKind: null,
          sessionId: null,
          rolloutPath: null
        },
        latestLifecycleAttempt: {
          at: "2026-03-30T12:05:00.000Z",
          action: "delete",
          outcome: "applied",
          state: "deleted",
          previousState: "active",
          nextState: "deleted",
          summary: "Prefer pnpm for smoke tests in this repository.",
          updateKind: null,
          sessionId: null,
          rolloutPath: null
        },
        latestState: "deleted",
        latestSessionId: null,
        latestRolloutPath: null,
        latestAudit: sharedAudit,
        timelineWarningCount: 0,
        lineageSummary: {
          eventCount: 2,
          firstSeenAt: "2026-03-30T12:00:00.000Z",
          latestAt: "2026-03-30T12:05:00.000Z",
          latestAction: "delete",
          latestState: "deleted",
          latestAttemptedAction: "delete",
          latestAttemptedState: "deleted",
          latestAttemptedOutcome: "applied",
          latestUpdateKind: null,
          archivedAt: null,
          deletedAt: "2026-03-30T12:05:00.000Z",
          latestAuditStatus: "applied",
          refNoopCount: 0,
          matchedAuditOperationCount: 1,
          rolloutNoopOperationCount: 1,
          rolloutSuppressedOperationCount: 2,
          rolloutConflictCount: 2,
          noopOperationCount: 0,
          suppressedOperationCount: 2,
          conflictCount: 2,
          rejectedOperationCount: 3,
          rejectedReasonCounts: {
            "unknown-topic": 2,
            sensitive: 1
          }
        },
        warnings: [],
        entry: {
          id: "prefer-pnpm-for-smoke-tests",
          scope: "project",
          topic: "workflow",
          summary: "Prefer pnpm for smoke tests in this repository.",
          details: ["Use pnpm when validating smoke flows."],
          updatedAt: "2026-03-30T12:00:00.000Z",
          sources: ["manual"]
        }
      }
    ];

    const payload = toManualMutationForgetPayload("Prefer pnpm", "project", false, entries);
    expect(payload.reviewerSummary).toMatchObject({
      matchedAuditOperationCount: 2,
      noopOperationCount: 0,
      suppressedOperationCount: 2,
      rejectedOperationCount: 3,
      rejectedReasonCounts: {
        "unknown-topic": 2,
        sensitive: 1
      },
      rolloutConflictCount: 2,
      uniqueAuditCount: 1,
      auditCountsDeduplicated: true,
      warningCount: 0,
      warningsByEntryRef: {}
    });
    expect(payload.nextRecommendedActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("project:deleted:workflow:prefer-pnpm"),
        expect.stringContaining("project:deleted:workflow:prefer-pnpm-for-smoke-tests")
      ])
    );
  });

  it("includes review-oriented next steps in forget text output", async () => {
    const homeDir = await tempDir("cam-forget-text-home-");
    const projectDir = await tempDir("cam-forget-text-project-");
    const memoryRoot = await tempDir("cam-forget-text-root-");
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

    const result = runCli(projectDir, ["forget", "pnpm", "--scope", "project"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Deleted 1 memory entry:");
    expect(result.stdout).toContain("Next steps:");
    expect(result.stdout).toContain("recall timeline");
    expect(result.stdout).toContain("Details are unavailable for deleted refs");
    expect(result.stdout).toContain("memory --recent");
    expect(result.stdout).toContain("memory reindex");
  });

  it("keeps delete-only forget follow-up commands aligned with the resolved launcher and pinned cwd", async () => {
    const homeDir = await tempDir("cam-forget-delete-only-home-");
    const projectDir = await tempDir("cam-forget-delete-only-project-");
    const callerDir = await tempDir("cam-forget-delete-only-caller-");
    const memoryRoot = await tempDir("cam-forget-delete-only-root-");
    const emptyPathDir = await tempDir("cam-forget-delete-only-empty-path-");
    const fakeDistDir = await tempDir("cam-forget-delete-only-dist-");
    const fakeDistCliPath = path.join(fakeDistDir, "cli.js");
    const realProjectDir = await fs.realpath(projectDir);
    process.env.HOME = homeDir;

    await fs.writeFile(
      fakeDistCliPath,
      "#!/usr/bin/env node\nconsole.log('fake dist cli');\n",
      "utf8"
    );

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

    const result = runCli(
      callerDir,
      ["forget", "pnpm", "--scope", "project", "--cwd", projectDir],
      {
        env: {
          HOME: homeDir,
          PATH: await buildPathWithoutCam(emptyPathDir),
          CODEX_AUTO_MEMORY_DIST_CLI_PATH: fakeDistCliPath
        }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `node ${JSON.stringify(fakeDistCliPath)} recall timeline "project:active:workflow:prefer-pnpm" --cwd '${realProjectDir}'`
    );
    expect(result.stdout).toContain("node ");
    expect(result.stdout).not.toContain("use cam recall timeline to review the deletion trail");
  });

  it("surfaces an additive empty reviewer payload for forget --json when nothing matches", async () => {
    const homeDir = await tempDir("cam-forget-empty-json-home-");
    const projectDir = await tempDir("cam-forget-empty-json-project-");
    const memoryRoot = await tempDir("cam-forget-empty-json-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["forget", "missing entry", "--scope", "project", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      mutationKind: string;
      entryCount: number;
      warningCount: number;
      uniqueAuditCount: number;
      auditCountsDeduplicated: boolean;
      warningsByEntryRef: Record<string, number>;
      detailsUsableEntryCount: number;
      timelineOnlyEntryCount: number;
      matchedCount: number;
      appliedCount: number;
      noopCount: number;
      affectedCount: number;
      summary: {
        matchedCount: number;
        appliedCount: number;
        noopCount: number;
        affectedCount: number;
      };
      affectedRefs: string[];
      followUp: {
        timelineRefs: string[];
        detailsRefs: string[];
      };
      nextRecommendedActions: string[];
      entries: unknown[];
    };

    expect(payload).toEqual(
      expect.objectContaining({
        mutationKind: "forget",
        entryCount: 0,
        warningCount: 0,
        uniqueAuditCount: 0,
        auditCountsDeduplicated: true,
        warningsByEntryRef: {},
        detailsUsableEntryCount: 0,
        timelineOnlyEntryCount: 0,
        matchedCount: 0,
        appliedCount: 0,
        noopCount: 0,
        affectedCount: 0,
        summary: {
          matchedCount: 0,
          appliedCount: 0,
          noopCount: 0,
          affectedCount: 0
        },
        affectedRefs: [],
        followUp: {
          timelineRefs: [],
          detailsRefs: []
        },
        nextRecommendedActions: [],
        entries: []
      })
    );
  });

  it("supports --cwd so remember and forget can target another project directory", async () => {
    const homeDir = await tempDir("cam-memory-manual-cwd-home-");
    const projectDir = await tempDir("cam-memory-manual-cwd-project-");
    const shellDir = await tempDir("cam-memory-manual-cwd-shell-");
    const memoryRoot = await tempDir("cam-memory-manual-cwd-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const rememberResult = runCli(
      shellDir,
      ["remember", "Prefer pnpm in this repository.", "--cwd", projectDir, "--scope", "project", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(rememberResult.exitCode, rememberResult.stderr).toBe(0);
    expect(JSON.parse(rememberResult.stdout)).toMatchObject({
      mutationKind: "remember",
      scope: "project",
      ref: "project:active:preferences:prefer-pnpm-in-this-repository"
    });

    const forgetResult = runCli(
      shellDir,
      ["forget", "pnpm", "--cwd", projectDir, "--scope", "project", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(forgetResult.exitCode, forgetResult.stderr).toBe(0);
    expect(JSON.parse(forgetResult.stdout)).toMatchObject({
      mutationKind: "forget",
      matchedCount: 1,
      ref: null,
      timelineRef: null,
      detailsRef: null
    });
  });

  it("fails closed when --cwd does not point to an existing directory", async () => {
    const homeDir = await tempDir("cam-memory-invalid-cwd-home-");
    const callerDir = await tempDir("cam-memory-invalid-cwd-caller-");
    const missingDir = path.join(callerDir, "missing-project-dir");
    process.env.HOME = homeDir;

    const result = runCli(
      callerDir,
      ["remember", "Prefer pnpm in this repository.", "--cwd", missingDir],
      {
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("existing directory");
  });

  it("surfaces startup omission reasons for low-signal, duplicate, unsafe, and budget-trimmed highlights", async () => {
    const homeDir = await tempDir("cam-memory-startup-omissions-home-");
    const projectDir = await tempDir("cam-memory-startup-omissions-project-");
    const memoryRoot = await tempDir("cam-memory-startup-omissions-root-");
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
      "commands",
      "release-command",
      "Run pnpm build before release.",
      ["Build before release."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "duplicate-workflow",
      "Verify release-facing surfaces before claiming completion.",
      ["Same summary in another topic."],
      "Manual note."
    );
    await store.remember(
      "project",
      "architecture",
      "markdown-canonical",
      "Preserve Markdown as the canonical store.",
      ["Do not make the runtime DB-first."],
      "Manual note."
    );
    await store.remember(
      "project",
      "debugging",
      "capture-rollout",
      "Capture rollout evidence before fixing regressions.",
      ["Use rollout evidence before changing code."],
      "Manual note."
    );
    await store.remember(
      "project",
      "testing",
      "verify-release-surface",
      "Verify release-facing surfaces before claiming completion.",
      ["Run release-facing checks before completion claims."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "placeholder-summary",
      "placeholder-summary",
      ["Low-signal placeholder entry."],
      "Manual note."
    );

    const unsafeTopicFile = store.getTopicFile("project", "commands");
    await fs.writeFile(
      unsafeTopicFile,
      buildUnsafeWorkflowTopicContents(
        "unsafe-command",
        "Unsafe command summary",
        "Unsafe command detail"
      ),
      "utf8"
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput & {
      startupOmissionCounts?: Record<string, number>;
      startupOmissions: Array<{
        topic: string;
        id?: string;
        reason: string;
      }>;
      startupOmissionCountsByTargetAndStage: {
        highlight: {
          selection: number;
          render: number;
        };
      };
    };

    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "placeholder-summary",
          reason: "low-signal",
          target: "highlight",
          stage: "selection"
        }),
        expect.objectContaining({
          id: "duplicate-workflow",
          reason: "duplicate-summary",
          target: "highlight",
          stage: "selection"
        }),
        expect.objectContaining({
          topic: "commands",
          reason: "unsafe-topic",
          target: "highlight",
          stage: "selection"
        }),
        expect.objectContaining({
          id: "markdown-canonical",
          reason: "budget-trimmed",
          target: "highlight",
          stage: "selection"
        })
      ])
    );
    expect(output.omittedHighlightCount).toBe(4);
    expect(output.omittedTopicFileCount).toBe(1);
    expect(output.startupOmissionCounts).toMatchObject({
      "low-signal": 1,
      "duplicate-summary": 1,
      "unsafe-topic": 2,
      "budget-trimmed": 1
    });
    expect(output.startupOmissionCountsByTargetAndStage.highlight).toEqual({
      selection: 4,
      render: 0
    });
    expect(output.topicFileOmissionCounts).toMatchObject({
      "unsafe-topic": 1
    });
  });

  it("surfaces no-eligible-entry when startup cannot render any highlight candidates", async () => {
    const homeDir = await tempDir("cam-memory-no-eligible-highlight-home-");
    const projectDir = await tempDir("cam-memory-no-eligible-highlight-project-");
    const memoryRoot = await tempDir("cam-memory-no-eligible-highlight-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "placeholder-summary",
      "placeholder-summary",
      ["Low-signal placeholder entry."],
      "Manual note."
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput & {
      startupOmissionCountsByTargetAndStage: {
        highlight: {
          selection: number;
          render: number;
        };
      };
    };

    expect(output.highlightCount).toBe(0);
    expect(output.startupSectionsRendered.highlights).toBe(false);
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "low-signal",
          target: "highlight",
          stage: "selection"
        }),
        expect.objectContaining({
          reason: "no-eligible-entry",
          target: "highlight",
          stage: "selection"
        })
      ])
    );
    expect(output.startupOmissionCountsByTargetAndStage.highlight).toEqual({
      selection: 2,
      render: 0
    });
  });

  it("keeps startup omissions distinct across target and stage while exposing explainability fields", async () => {
    const homeDir = await tempDir("cam-memory-omission-explainability-home-");
    const projectDir = await tempDir("cam-memory-omission-explainability-project-");
    const memoryRoot = await tempDir("cam-memory-omission-explainability-root-");
    process.env.HOME = homeDir;

    const projectConfig: AppConfig = {
      ...buildProjectConfig(),
      maxStartupLines: 14
    };
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
    await store.remember(
      "project",
      "architecture",
      "markdown-canonical",
      "Preserve Markdown as the canonical store.",
      ["Do not make the runtime DB-first."],
      "Manual note."
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.startup).toMatchObject({
      highlights: expect.arrayContaining([
        expect.objectContaining({
          selectionReason: "eligible-highlight",
          selectionRank: 1
        })
      ]),
      omissions: expect.arrayContaining([
        expect.objectContaining({
          topic: "startup",
          target: "scope-block",
          stage: "selection",
          reason: "budget-trimmed",
          budgetKind: "line-budget"
        }),
        expect.objectContaining({
          target: "topic-file",
          stage: "render",
          reason: "budget-trimmed",
          budgetKind: "line-budget"
        })
      ])
    });
    expect(output.startupOmissionCountsByTargetAndStage.topicFile.render).toBeGreaterThanOrEqual(1);
    expect(output.startupOmissionCountsByTargetAndStage.scopeBlock.selection).toBeGreaterThanOrEqual(1);
  });

  it("records budget omissions for duplicate ids that remain distinct across topics", async () => {
    const homeDir = await tempDir("cam-memory-duplicate-id-home-");
    const projectDir = await tempDir("cam-memory-duplicate-id-project-");
    const memoryRoot = await tempDir("cam-memory-duplicate-id-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "shared-id",
      "Keep workflow checks on pnpm.",
      ["Workflow detail."],
      "Manual note."
    );
    await store.remember(
      "project",
      "architecture",
      "architecture-id",
      "Keep Markdown as the canonical store.",
      ["Architecture detail."],
      "Manual note."
    );
    await store.remember(
      "project",
      "reference",
      "shared-id",
      "The runbook lives at https://example.test/runbook.",
      ["Reference detail."],
      "Manual note."
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.highlightCount).toBe(2);
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          topic: "workflow",
          id: "shared-id",
          reason: "budget-trimmed",
          target: "highlight",
          stage: "selection"
        })
      ])
    );
  });

  it("records render-stage scope-block omissions when budget cannot fit a remaining non-empty scope block", async () => {
    const homeDir = await tempDir("cam-memory-scope-block-render-home-");
    const projectDir = await tempDir("cam-memory-scope-block-render-project-");
    const memoryRoot = await tempDir("cam-memory-scope-block-render-root-");
    process.env.HOME = homeDir;

    const projectConfig: AppConfig = {
      ...buildProjectConfig(),
      maxStartupLines: 10
    };
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project-local",
      "workflow",
      "local-keep",
      "Keep local startup checks visible.",
      ["Local detail."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "project-blocked",
      "This project scope block should be omitted at render time.",
      ["Project detail."],
      "Manual note."
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          topic: "startup",
          target: "scope-block",
          stage: "render",
          reason: "budget-trimmed",
          budgetKind: "line-budget"
        })
      ])
    );
    expect(output.startupOmissionCountsByTargetAndStage.scopeBlock.render).toBeGreaterThanOrEqual(
      1
    );
  });

  it("surfaces topic file omission counts and reasons when startup topic refs are budget-trimmed", async () => {
    const homeDir = await tempDir("cam-memory-topic-ref-omissions-home-");
    const projectDir = await tempDir("cam-memory-topic-ref-omissions-project-");
    const memoryRoot = await tempDir("cam-memory-topic-ref-omissions-root-");
    process.env.HOME = homeDir;

    const projectConfig: AppConfig = {
      ...buildProjectConfig(),
      maxStartupLines: 100
    };
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    for (let i = 0; i < 50; i++) {
      await store.remember(
        "project",
        `topic-${i}`,
        `entry-${i}`,
        `Workflow entry number ${i}.`,
        [`Detail for entry ${i}.`],
        "Manual note."
      );
    }

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.topicRefCountsByScope.project.discovered).toBe(50);
    expect(output.topicRefCountsByScope.project.rendered).toBeGreaterThan(0);
    expect(output.topicRefCountsByScope.project.rendered).toBeLessThan(50);
    expect(output.topicRefCountsByScope.project.omitted).toBe(
      50 - output.topicRefCountsByScope.project.rendered
    );
    expect(output.omittedTopicFileCount).toBe(output.topicRefCountsByScope.project.omitted);
    expect(output.topicFileOmissionCounts).toMatchObject({
      "budget-trimmed": output.omittedTopicFileCount
    });
    expect(output.startupOmissionCounts["budget-trimmed"]).toBeGreaterThanOrEqual(
      output.omittedTopicFileCount
    );
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: expect.stringMatching(/^topic-/),
          reason: "budget-trimmed",
          target: "topic-file",
          stage: "render"
        })
      ])
    );
  });

  it("keeps scanning later scopes for startup omissions even after earlier scopes fill the highlight budget", async () => {
    const homeDir = await tempDir("cam-memory-cross-scope-omissions-home-");
    const projectDir = await tempDir("cam-memory-cross-scope-omissions-project-");
    const memoryRoot = await tempDir("cam-memory-cross-scope-omissions-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    await store.remember(
      "project-local",
      "workflow",
      "local-one",
      "Use pnpm for local smoke checks.",
      ["Local detail one."],
      "Manual note."
    );
    await store.remember(
      "project-local",
      "workflow",
      "local-two",
      "Keep wrapper verification local-first.",
      ["Local detail two."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "project-one",
      "Prefer startup audits before sync.",
      ["Project detail one."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "project-two",
      "Review durable memory after integration changes.",
      ["Project detail two."],
      "Manual note."
    );
    await store.remember(
      "global",
      "commands",
      "global-unsafe",
      "Use a shared global command.",
      ["Global unsafe detail."],
      "Manual note."
    );
    await fs.writeFile(
      store.getTopicFile("global", "commands"),
      [
        "# Commands",
        "",
        "<!-- cam:topic commands -->",
        "",
        "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
        "",
        "Manual note that cannot be round-tripped safely.",
        "",
        "## global-unsafe",
        '<!-- cam:entry {"id":"global-unsafe","scope":"global","updatedAt":"2026-03-14T00:00:00.000Z"} -->',
        "Summary: Use a shared global command.",
        "Details:",
        "- Global unsafe detail.",
        "",
        "## malformed-entry",
        "<!-- cam:entry THIS IS NOT JSON -->",
        "Summary: Broken entry.",
        "Details:",
        "- Must not be deleted by rewrite.",
        ""
      ].join("\n"),
      "utf8"
    );
    await store.rebuildIndex("global");

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.highlightCount).toBe(4);
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "global",
          topic: "commands",
          id: "global-unsafe",
          reason: "unsafe-topic",
          target: "highlight",
          stage: "selection"
        })
      ])
    );
    expect(output.startupOmissionCounts["unsafe-topic"]).toBeGreaterThanOrEqual(1);
  });

  it("records a selection-stage omission when the global highlight cap drops a later-scope highlight", async () => {
    const homeDir = await tempDir("cam-memory-global-cap-home-");
    const projectDir = await tempDir("cam-memory-global-cap-project-");
    const memoryRoot = await tempDir("cam-memory-global-cap-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    await store.remember(
      "project-local",
      "workflow",
      "local-one",
      "Use pnpm for local smoke checks.",
      ["Local detail one."],
      "Manual note."
    );
    await store.remember(
      "project-local",
      "workflow",
      "local-two",
      "Keep wrapper verification local-first.",
      ["Local detail two."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "project-one",
      "Prefer startup audits before sync.",
      ["Project detail one."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "project-two",
      "Review durable memory after integration changes.",
      ["Project detail two."],
      "Manual note."
    );
    await store.remember(
      "global",
      "workflow",
      "global-one",
      "Keep global release review habits consistent.",
      ["Global detail one."],
      "Manual note."
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.highlightCount).toBe(4);
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "global",
          topic: "workflow",
          id: "global-one",
          reason: "budget-trimmed",
          target: "highlight",
          stage: "selection"
        })
      ])
    );
  });

  it("omits unsafe topic files from startup topic refs in memory command JSON output", async () => {
    const homeDir = await tempDir("cam-memory-unsafe-topic-ref-home-");
    const projectDir = await tempDir("cam-memory-unsafe-topic-ref-project-");
    const memoryRoot = await tempDir("cam-memory-unsafe-topic-ref-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "commands",
      "unsafe-command",
      "Run the unsafe command.",
      ["Unsafe detail."],
      "Manual note."
    );
    await fs.writeFile(
      store.getTopicFile("project", "commands"),
      buildUnsafeWorkflowTopicContents(
        "unsafe-command",
        "Run the unsafe command.",
        "Unsafe detail."
      ),
      "utf8"
    );

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.topicFilesByScope.project).toEqual([]);
    expect(output.omittedTopicFileCount).toBeGreaterThanOrEqual(1);
    expect(output.topicFileOmissionCounts).toMatchObject({
      "unsafe-topic": 1
    });
    expect(output.startupOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          topic: "commands",
          reason: "unsafe-topic",
          target: "topic-file",
          stage: "selection"
        })
      ])
    );
    expect(output.topicRefCountsByScope.project).toMatchObject({
      discovered: 1,
      rendered: 0,
      omitted: 1
    });
  });

  it("surfaces layout diagnostics through memory inspection and reindex reviewer outputs", async () => {
    const homeDir = await tempDir("cam-memory-layout-diagnostics-home-");
    const projectDir = await tempDir("cam-memory-layout-diagnostics-project-");
    const memoryRoot = await tempDir("cam-memory-layout-diagnostics-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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

    await fs.writeFile(
      path.join(path.dirname(store.getMemoryFile("project")), "Bad Topic.md"),
      "# stray\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(path.dirname(store.getMemoryFile("project")), "orphan-topic.md"),
      [
        "# Orphan Topic",
        "",
        "<!-- cam:topic orphan-topic -->",
        "",
        "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(path.dirname(store.getMemoryFile("project")), "ARCHIVE.md"),
      "# Archived Project Memory\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(path.dirname(store.getMemoryFile("project")), "retrieval-index.backup.json"),
      "{}\n",
      "utf8"
    );
    await fs.writeFile(store.getMemoryFile("project"), "# Project Memory\n\nDrifted index.\n", "utf8");

    const output = JSON.parse(
      await runMemory({
        cwd: projectDir,
        json: true
      })
    ) as MemoryCommandOutput;

    expect(output.topicFilesByScope.project).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "orphan-topic"
        })
      ])
    );

    expect(output.layoutDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "malformed-topic-filename",
          fileName: "Bad Topic.md"
        }),
        expect.objectContaining({
          kind: "orphan-topic-markdown",
          fileName: "orphan-topic.md"
        }),
        expect.objectContaining({
          kind: "misplaced-index-markdown",
          fileName: "ARCHIVE.md"
        }),
        expect.objectContaining({
          kind: "unexpected-sidecar",
          fileName: "retrieval-index.backup.json"
        }),
        expect.objectContaining({
          kind: "index-drift",
          fileName: "MEMORY.md"
        })
      ])
    );

    const reindexOutput = JSON.parse(
      await runMemoryReindex({
        cwd: projectDir,
        json: true
      })
    ) as {
      layoutDiagnostics: Array<{ kind: string; fileName: string }>;
    };

    expect(reindexOutput.layoutDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "malformed-topic-filename",
          fileName: "Bad Topic.md"
        }),
        expect.objectContaining({
          kind: "orphan-topic-markdown",
          fileName: "orphan-topic.md"
        }),
        expect.objectContaining({
          kind: "misplaced-index-markdown",
          fileName: "ARCHIVE.md"
        }),
        expect.objectContaining({
          kind: "unexpected-sidecar",
          fileName: "retrieval-index.backup.json"
        }),
        expect.objectContaining({
          kind: "index-drift",
          fileName: "MEMORY.md"
        })
      ])
    );
  });

  it("rebuilds retrieval sidecars explicitly from canonical Markdown memory", async () => {
    const homeDir = await tempDir("cam-memory-reindex-home-");
    const projectDir = await tempDir("cam-memory-reindex-project-");
    const memoryRoot = await tempDir("cam-memory-reindex-root-");
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
    await store.remember(
      "project",
      "workflow",
      "historical-note",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical", { archive: true });

    const activeTopicPath = store.getTopicFile("project", "workflow");
    const archivedTopicPath = store.getArchiveTopicFile("project", "workflow");
    const activeContentsBefore = await fs.readFile(activeTopicPath, "utf8");
    const archivedContentsBefore = await fs.readFile(archivedTopicPath, "utf8");

    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{bad-json", "utf8");
    await fs.rm(store.getRetrievalIndexFile("project", "archived"), { force: true });

    const output = JSON.parse(
      await runMemoryReindex({
        cwd: projectDir,
        json: true,
        scope: "project",
        state: "all"
      })
    ) as {
      projectRoot: string;
      requestedScope: string;
      requestedState: string;
      rebuilt: Array<{
        scope: string;
        state: string;
        status: string;
        indexPath: string;
        generatedAt: string;
        topicFileCount: number;
        topicFiles: string[];
      }>;
      summary: string;
    };

    expect(output).toMatchObject({
      projectRoot: project.projectRoot,
      requestedScope: "project",
      requestedState: "all",
      summary: "Rebuilt 2 retrieval sidecar(s) from Markdown canonical memory."
    });
    expect(output.rebuilt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          status: "ok",
          indexPath: store.getRetrievalIndexFile("project", "active"),
          generatedAt: expect.any(String),
          topicFileCount: 1,
          topicFiles: ["workflow.md"]
        }),
        expect.objectContaining({
          scope: "project",
          state: "archived",
          status: "ok",
          indexPath: store.getRetrievalIndexFile("project", "archived"),
          generatedAt: expect.any(String),
          topicFileCount: 1,
          topicFiles: ["workflow.md"]
        })
      ])
    );
    expect(await fs.readFile(activeTopicPath, "utf8")).toBe(activeContentsBefore);
    expect(await fs.readFile(archivedTopicPath, "utf8")).toBe(archivedContentsBefore);

    const cliResult = runCli(
      projectDir,
      ["memory", "reindex", "--scope", "project", "--state", "active", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(cliResult.exitCode, cliResult.stderr).toBe(0);
    expect(JSON.parse(cliResult.stdout)).toMatchObject({
      requestedScope: "project",
      requestedState: "active",
      rebuilt: [
        expect.objectContaining({
          scope: "project",
          state: "active",
          status: "ok"
        })
      ]
    });
  });

  it("surfaces unsafe topic diagnostics during memory reindex", async () => {
    const homeDir = await tempDir("cam-memory-reindex-unsafe-home-");
    const projectDir = await tempDir("cam-memory-reindex-unsafe-project-");
    const memoryRoot = await tempDir("cam-memory-reindex-unsafe-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      [
        "# Workflow",
        "",
        "<!-- cam:topic workflow -->",
        "",
        "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
        "",
        "Manual notes outside managed entries"
      ].join("\n"),
      "utf8"
    );

    const output = JSON.parse(
      await runMemoryReindex({
        cwd: projectDir,
        json: true
      })
    ) as {
      rebuilt: Array<{
        scope: string;
        state: string;
        topicFileCount: number;
      }>;
      topicDiagnostics: Array<{ topic: string; safeToRewrite: boolean }>;
    };

    expect(output.topicDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "workflow",
          safeToRewrite: false
        })
      ])
    );
    expect(output.rebuilt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          topicFileCount: 0
        })
      ])
    );
  });

  it("supports --cwd so memory inspection and reindex can target another project directory", async () => {
    const homeDir = await tempDir("cam-memory-cwd-home-");
    const projectParentDir = await tempDir("cam-memory-cwd-project-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const callerDir = await tempDir("cam-memory-cwd-caller-");
    const memoryRoot = await tempDir("cam-memory-cwd-root-");
    process.env.HOME = homeDir;

    await fs.mkdir(projectDir, { recursive: true });
    const realProjectDir = await fs.realpath(projectDir);

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{bad-json", "utf8");

    const memoryResult = runCli(callerDir, ["memory", "--cwd", projectDir, "--json"], {
      env: { HOME: homeDir }
    });
    expect(memoryResult.exitCode, memoryResult.stderr).toBe(0);
    expect(JSON.parse(memoryResult.stdout)).toMatchObject({
      startupFilesByScope: {
        project: [store.getMemoryFile("project")]
      },
      topicFilesByScope: {
        project: [
          expect.objectContaining({
            path: store.getTopicFile("project", "workflow")
          })
        ]
      },
      editTargets: {
        project: store.getMemoryFile("project")
      }
    });

    const reindexResult = runCli(
      callerDir,
      ["memory", "reindex", "--cwd", projectDir, "--scope", "project", "--state", "active", "--json"],
      {
        env: { HOME: homeDir }
      }
    );
    expect(reindexResult.exitCode, reindexResult.stderr).toBe(0);
    expect(JSON.parse(reindexResult.stdout)).toMatchObject({
      projectRoot: realProjectDir,
      requestedScope: "project",
      requestedState: "active",
      rebuilt: [
        expect.objectContaining({
          scope: "project",
          state: "active",
          indexPath: store.getRetrievalIndexFile("project", "active")
        })
      ]
    });
  });

  it("keeps memory inspection and memory reindex read-only on an uninitialized project", async () => {
    const homeDir = await tempDir("cam-memory-readonly-home-");
    const projectDir = await tempDir("cam-memory-readonly-project-");
    const memoryRootParent = await tempDir("cam-memory-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeProjectConfig(projectDir, buildProjectConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const memoryResult = runCli(projectDir, ["memory", "--json"], {
      env: { HOME: homeDir }
    });
    expect(memoryResult.exitCode, memoryResult.stderr).toBe(0);
    expect(JSON.parse(memoryResult.stdout)).toMatchObject({
      loadedFiles: [],
      startup: {
        sourceFiles: [],
        topicFiles: [],
        sectionsRendered: {
          projectLocal: false,
          project: false,
          global: false
        }
      },
      startupFilesByScope: {
        global: [],
        project: [],
        projectLocal: []
      },
      scopes: [
        expect.objectContaining({ scope: "global", count: 0 }),
        expect.objectContaining({ scope: "project", count: 0 }),
        expect.objectContaining({ scope: "project-local", count: 0 })
      ]
    });

    const reindexResult = runCli(projectDir, ["memory", "reindex", "--json"], {
      env: { HOME: homeDir }
    });
    expect(reindexResult.exitCode, reindexResult.stderr).toBe(0);
    expect(JSON.parse(reindexResult.stdout)).toMatchObject({
      rebuilt: []
    });
    expect(await readFileIfExists(path.join(memoryRoot, "global", "MEMORY.md"))).toBeNull();
    expect(await readFileIfExists(path.join(memoryRoot, "global", "archive", "ARCHIVE.md"))).toBeNull();
    expect(await readFileIfExists(path.join(memoryRoot, "global", "retrieval-index.json"))).toBeNull();
  });

  it("keeps memory reindex repairable when topic files exist but index files are missing", async () => {
    const homeDir = await tempDir("cam-memory-reindex-repair-home-");
    const projectDir = await tempDir("cam-memory-reindex-repair-project-");
    const memoryRoot = await tempDir("cam-memory-reindex-repair-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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

    await fs.rm(store.getMemoryFile("project"), { force: true });
    await fs.rm(store.getRetrievalIndexFile("project", "active"), { force: true });

    const result = runCli(projectDir, ["memory", "reindex", "--scope", "project", "--state", "active", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      rebuilt: [
        expect.objectContaining({
          scope: "project",
          state: "active",
          status: "ok"
        })
      ]
    });
    const workflowTopicContents = await readFileIfExists(store.getTopicFile("project", "workflow"));
    expect(workflowTopicContents).not.toBeNull();
    expect(workflowTopicContents).toContain("prefer-pnpm");
    expect(await readFileIfExists(store.getMemoryFile("project"))).toBeNull();
    expect(await readFileIfExists(store.getRetrievalIndexFile("project", "active"))).toContain(
      "\"prefer-pnpm\""
    );
  });

  it("exposes memory reindex as a dedicated CLI subcommand", async () => {
    const result = runCli(process.cwd(), ["memory", "reindex", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: ");
    expect(result.stdout).toContain("memory reindex");
    expect(result.stdout).toContain("Rebuild retrieval sidecars from canonical Markdown memory");
    expect(result.stdout).not.toContain("--enable");
  });

  it("lets memory reindex subcommand options override parent memory options", async () => {
    const homeDir = await tempDir("cam-memory-reindex-parent-child-home-");
    const projectDir = await tempDir("cam-memory-reindex-parent-child-project-");
    const memoryRoot = await tempDir("cam-memory-reindex-parent-child-root-");
    process.env.HOME = homeDir;

    const projectConfig = buildProjectConfig();
    await writeProjectConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

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

    const result = runCli(
      projectDir,
      [
        "memory",
        "--scope",
        "project-local",
        "reindex",
        "--scope",
        "project",
        "--state",
        "active",
        "--json"
      ],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestedScope: "project",
      requestedState: "active",
      rebuilt: [
        expect.objectContaining({
          scope: "project",
          state: "active"
        })
      ]
    });
  });
});
