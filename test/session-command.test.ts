import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSession } from "../src/lib/commands/session.js";
import { runWrappedCodex } from "../src/lib/commands/wrapper.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import type { AppConfig, SessionContinuityAuditEntry } from "../src/lib/types.js";

const tempDirs: string[] = [];
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;
const sourceCliPath = path.resolve("src/cli.ts");
const tsxBinaryPath = path.resolve(
  process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx"
);

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(repoDir: string): Promise<void> {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Codex Auto Memory",
    GIT_AUTHOR_EMAIL: "cam@example.com",
    GIT_COMMITTER_NAME: "Codex Auto Memory",
    GIT_COMMITTER_EMAIL: "cam@example.com"
  };
  runCommandCapture("git", ["init", "-b", "main"], repoDir, gitEnv);
  await fs.writeFile(path.join(repoDir, "README.md"), "seed\n", "utf8");
  runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
  runCommandCapture("git", ["commit", "-m", "init"], repoDir, gitEnv);
}

function configJson(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    autoMemoryEnabled: true,
    extractorMode: "heuristic",
    defaultScope: "project",
    maxStartupLines: 200,
    sessionContinuityAutoLoad: false,
    sessionContinuityAutoSave: false,
    sessionContinuityLocalPathStyle: "codex",
    maxSessionContinuityLines: 60,
    codexBinary: "codex",
    ...overrides
  };
}

function runCli(repoDir: string, args: string[]) {
  return runCommandCapture(tsxBinaryPath, [sourceCliPath, ...args], repoDir);
}

async function writeProjectConfig(
  repoDir: string,
  projectConfig: AppConfig,
  localConfig: Record<string, unknown>
): Promise<void> {
  await fs.writeFile(
    path.join(repoDir, "codex-auto-memory.json"),
    JSON.stringify(projectConfig, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoDir, ".codex-auto-memory.local.json"),
    JSON.stringify(localConfig, null, 2),
    "utf8"
  );
}

function rolloutFixture(projectDir: string, message: string): string {
  return [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: "session-1",
        timestamp: "2026-03-15T00:00:00.000Z",
        cwd: projectDir
      }
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message
      }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: "{\"cmd\":\"pnpm test\"}"
      }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "Process exited with code 0"
      }
    })
  ].join("\n");
}

afterEach(async () => {
  process.env.CAM_CODEX_SESSIONS_DIR = originalSessionsDir;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runSession", () => {
  it("saves, loads, reports, and clears continuity state", async () => {
    const repoDir = await tempDir("cam-session-cmd-repo-");
    const memoryRoot = await tempDir("cam-session-cmd-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Continue the login cookie work and add middleware."),
      "utf8"
    );
    const secondRolloutPath = path.join(repoDir, "rollout-2.jsonl");
    await fs.writeFile(
      secondRolloutPath,
      rolloutFixture(repoDir, "Finish the middleware retry work and document the fallback."),
      "utf8"
    );

    const saveOutput = await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "both"
    });
    expect(saveOutput).toContain("Saved session continuity");
    expect(saveOutput).toContain("Generation: heuristic");
    expect(saveOutput).toContain("Evidence: successful");
    expect(saveOutput).toContain("Written paths:");

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: secondRolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      diagnostics: {
        preferredPath: string;
        actualPath: string;
        fallbackReason?: string;
      };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        fallbackReason?: string;
        evidenceCounts: {
          successfulCommands: number;
          failedCommands: number;
          fileWrites: number;
          nextSteps: number;
          untried: number;
        };
        writtenPaths: string[];
      } | null;
      recentContinuityAuditEntries: Array<{
        rolloutPath: string;
        actualPath: string;
      }>;
      continuityAuditPath: string;
    };
    expect(saveJson.diagnostics.preferredPath).toBe("heuristic");
    expect(saveJson.diagnostics.actualPath).toBe("heuristic");
    expect(saveJson.diagnostics.fallbackReason).toBe("configured-heuristic");
    expect(saveJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(saveJson.latestContinuityAuditEntry?.fallbackReason).toBe("configured-heuristic");
    expect(saveJson.latestContinuityAuditEntry?.evidenceCounts.successfulCommands).toBeGreaterThan(0);
    expect(saveJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(saveJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(saveJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(saveJson.recentContinuityAuditEntries[1]?.rolloutPath).toBe(rolloutPath);
    expect(saveJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const loadJson = JSON.parse(
      await runSession("load", {
        cwd: repoDir,
        json: true,
        printStartup: true
      })
    ) as {
      projectState: { goal: string; confirmedWorking: string[] } | null;
      localState: { incompleteNext: string[]; filesDecisionsEnvironment: string[] } | null;
      mergedState: { goal: string; confirmedWorking: string[]; incompleteNext: string[] };
      startup: { text: string };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        writtenPaths: string[];
        evidenceCounts: {
          successfulCommands: number;
          failedCommands: number;
          fileWrites: number;
          nextSteps: number;
          untried: number;
        };
      } | null;
      latestContinuityDiagnostics: {
        actualPath: string;
        fallbackReason?: string;
      } | null;
      recentContinuityAuditEntries: Array<{
        rolloutPath: string;
        actualPath: string;
      }>;
      continuityAuditPath: string;
    };
    expect(loadJson.mergedState.goal).toContain("Finish the middleware retry work");
    expect(loadJson.mergedState.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(loadJson.localState?.incompleteNext.length).toBeGreaterThan(0);
    expect(loadJson.startup.text).toContain("# Session Continuity");
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(loadJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(loadJson.latestContinuityAuditEntry?.evidenceCounts.successfulCommands).toBeGreaterThan(0);
    expect(loadJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(loadJson.latestContinuityDiagnostics?.fallbackReason).toBe("configured-heuristic");
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(loadJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(loadJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Evidence: successful");
    expect(loadOutput).toContain("Written paths:");
    expect(loadOutput).toContain("Recent generations:");
    expect(loadOutput).toContain(secondRolloutPath);

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      localPathStyle: string;
      latestContinuityAuditEntry: {
        rolloutPath: string;
        writtenPaths: string[];
      } | null;
      latestContinuityDiagnostics: { actualPath: string } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
      continuityAuditPath: string;
    };
    expect(statusJson.localPathStyle).toBe("codex");
    expect(statusJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(statusJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(statusJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(statusJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(statusJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(statusJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Evidence: successful");
    expect(statusOutput).toContain("Written paths:");
    expect(statusOutput).toContain("Recent generations:");
    expect(statusOutput).toContain(secondRolloutPath);

    const clearOutput = await runSession("clear", { cwd: repoDir, scope: "both" });
    expect(clearOutput).toContain("Cleared session continuity files");

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    const latestAudit = await store.readLatestAuditEntry();
    expect(latestAudit?.actualPath).toBe("heuristic");
    expect(latestAudit?.fallbackReason).toBe("configured-heuristic");
    expect(await store.readMergedState()).toBeNull();
  }, 25_000);

  it("supports session save --json from the CLI command surface", async () => {
    const repoDir = await tempDir("cam-session-cli-repo-");
    const memoryRoot = await tempDir("cam-session-cli-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save continuity through the CLI command surface."),
      "utf8"
    );

    const result = runCli(repoDir, ["session", "save", "--json", "--rollout", rolloutPath]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      diagnostics: { actualPath: string };
      latestContinuityAuditEntry: { rolloutPath: string } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(payload.diagnostics.actualPath).toBe("heuristic");
    expect(payload.latestContinuityAuditEntry?.rolloutPath).toBe(rolloutPath);
    expect(payload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);
  }, 15_000);

  it("does not update local ignore when saving shared continuity only", async () => {
    const repoDir = await tempDir("cam-session-project-scope-repo-");
    const memoryRoot = await tempDir("cam-session-project-scope-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save shared continuity only."),
      "utf8"
    );

    const saveOutput = await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "project"
    });
    expect(saveOutput).not.toContain("Local exclude updated:");

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "project",
        json: true
      })
    ) as {
      excludePath: string | null;
      written: string[];
    };
    expect(saveJson.excludePath).toBeNull();
    expect(saveJson.written).toHaveLength(1);

    const excludePath = path.join(repoDir, ".git", "info", "exclude");
    const excludeContents = await fs.readFile(excludePath, "utf8");
    expect(excludeContents).not.toContain(".codex-auto-memory/");
    expect(excludeContents).not.toContain(".claude/sessions/");
  }, 15_000);

  it("keeps recent continuity history readable when the audit log contains a bad line", async () => {
    const repoDir = await tempDir("cam-session-bad-audit-repo-");
    const memoryRoot = await tempDir("cam-session-bad-audit-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-17T00:00:00.000Z",
      projectId: detectProjectContext(repoDir).projectId,
      worktreeId: detectProjectContext(repoDir).worktreeId,
      configuredExtractorMode: "heuristic",
      scope: "both",
      rolloutPath: "/tmp/rollout-good.jsonl",
      sourceSessionId: "session-good",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      writtenPaths: ["/tmp/continuity.md"]
    } satisfies SessionContinuityAuditEntry);
    await fs.appendFile(store.paths.auditFile, "{\"broken\":\n", "utf8");

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string; writtenPaths: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityAuditEntry?.writtenPaths).toEqual(["/tmp/continuity.md"]);
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(1);
    expect(loadJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe("/tmp/rollout-good.jsonl");

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string; writtenPaths: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(statusJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(statusJson.latestContinuityAuditEntry?.writtenPaths).toEqual(["/tmp/continuity.md"]);
    expect(statusJson.recentContinuityAuditEntries).toHaveLength(1);
    expect(statusJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe("/tmp/rollout-good.jsonl");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Evidence: successful 1 | failed 0 | file writes 0 | next steps 1 | untried 0");
    expect(loadOutput).toContain("/tmp/continuity.md");
    expect(loadOutput).toContain("Recent generations:");
    expect(loadOutput).toContain("/tmp/rollout-good.jsonl");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Evidence: successful 1 | failed 0 | file writes 0 | next steps 1 | untried 0");
    expect(statusOutput).toContain("/tmp/continuity.md");
    expect(statusOutput).toContain("Recent generations:");
    expect(statusOutput).toContain("/tmp/rollout-good.jsonl");
  }, 15_000);

  it("skips invalid-shaped continuity audit entries", async () => {
    const repoDir = await tempDir("cam-session-invalid-shape-repo-");
    const memoryRoot = await tempDir("cam-session-invalid-shape-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-17T00:00:00.000Z",
      projectId: detectProjectContext(repoDir).projectId,
      worktreeId: detectProjectContext(repoDir).worktreeId,
      configuredExtractorMode: "heuristic",
      scope: "both",
      rolloutPath: "/tmp/rollout-good.jsonl",
      sourceSessionId: "session-good",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      writtenPaths: ["/tmp/continuity.md"]
    } satisfies SessionContinuityAuditEntry);
    await fs.appendFile(
      store.paths.auditFile,
      `${JSON.stringify({
        generatedAt: "2026-03-17T01:00:00.000Z",
        rolloutPath: "/tmp/rollout-invalid.jsonl",
        actualPath: "heuristic"
      })}\n`,
      "utf8"
    );

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string } | null;
      latestContinuityDiagnostics: { rolloutPath: string; actualPath: string } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityDiagnostics?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(1);

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("/tmp/rollout-good.jsonl");
    expect(statusOutput).not.toContain("/tmp/rollout-invalid.jsonl");
  }, 15_000);

  it("writes and surfaces a continuity recovery marker when audit persistence fails", async () => {
    const repoDir = await tempDir("cam-session-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Persist continuity even if audit append fails."),
      "utf8"
    );

    const appendAuditSpy = vi
      .spyOn(SessionContinuityStore.prototype, "appendAuditLog")
      .mockRejectedValueOnce(new Error("continuity audit write failed"));

    await expect(
      runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both"
      })
    ).rejects.toThrow("continuity audit write failed");
    appendAuditSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath,
      failedStage: "audit-write",
      failureMessage: "continuity audit write failed",
      scope: "both"
    });

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: { rolloutPath: string; failedStage: string; failureMessage: string } | null;
      continuityRecoveryPath: string;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.pendingContinuityRecovery).toMatchObject({
      rolloutPath,
      failedStage: "audit-write",
      failureMessage: "continuity audit write failed"
    });
    expect(loadJson.continuityRecoveryPath).toContain("session-continuity-recovery.json");
    expect(loadJson.recentContinuityAuditEntries).toEqual([]);

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: { rolloutPath: string } | null;
      continuityRecoveryPath: string;
    };
    expect(statusJson.pendingContinuityRecovery?.rolloutPath).toBe(rolloutPath);
    expect(statusJson.continuityRecoveryPath).toContain("session-continuity-recovery.json");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Pending continuity recovery:");
    expect(loadOutput).toContain("continuity audit write failed");
    expect(loadOutput).toContain(rolloutPath);

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(saveJson.pendingContinuityRecovery).toBeNull();
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 15_000);

  it("does not clear an unrelated continuity recovery marker after a successful save", async () => {
    const repoDir = await tempDir("cam-session-stale-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-stale-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save continuity while preserving an unrelated marker."),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session",
      scope: "both",
      writtenPaths: ["/tmp/stale-continuity.md"],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      failedStage: "audit-write",
      failureMessage: "stale marker"
    });

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      pendingContinuityRecovery: { rolloutPath: string; sourceSessionId: string } | null;
    };

    expect(saveJson.pendingContinuityRecovery).toMatchObject({
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session"
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session"
    });
  }, 15_000);

  it("ignores a corrupted continuity recovery marker instead of crashing load or status", async () => {
    const repoDir = await tempDir("cam-session-bad-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-bad-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await fs.mkdir(path.dirname(store.getRecoveryPath()), { recursive: true });
    await fs.writeFile(store.getRecoveryPath(), "{\"broken\":\n", "utf8");

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(loadJson.pendingContinuityRecovery).toBeNull();

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(statusJson.pendingContinuityRecovery).toBeNull();

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).not.toContain("Pending continuity recovery:");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).not.toContain("Pending continuity recovery:");
  }, 15_000);
});

describe("runWrappedCodex with session continuity", () => {
  it("injects continuity on startup and auto-saves it after the run", async () => {
    const repoDir = await tempDir("cam-wrapper-session-repo-");
    const memoryRoot = await tempDir("cam-wrapper-session-memory-");
    const sessionsDir = await tempDir("cam-wrapper-session-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const capturedArgsPath = path.join(repoDir, "captured-args.json");
    const mockCodexPath = path.join(repoDir, "mock-codex");
    const todayDir = path.join(sessionsDir, "2026", "03", "15");
    await fs.mkdir(todayDir, { recursive: true });
    await fs.writeFile(
      mockCodexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const sessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;
fs.writeFileSync(path.join(cwd, "captured-args.json"), JSON.stringify(process.argv.slice(2), null, 2));
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue the wrapper continuity migration." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: true
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    await continuityStore.saveSummary(
      {
        project: {
          goal: "Resume the wrapper test continuity.",
          confirmedWorking: ["Previous startup block exists."],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: [],
          filesDecisionsEnvironment: []
        },
        projectLocal: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: ["Run wrapper auto-save."],
          filesDecisionsEnvironment: []
        }
      },
      "both"
    );

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];
    const baseInstructionsArg = capturedArgs.find((arg) => arg.startsWith("base_instructions="));
    expect(baseInstructionsArg).toContain("# Session Continuity");
    expect(baseInstructionsArg).toContain("# Codex Auto Memory");

    const merged = await continuityStore.readMergedState();
    expect(merged?.goal).toContain("Continue the wrapper continuity migration");
    expect(merged?.confirmedWorking.join("\n")).toContain("pnpm test");

    const latestAudit = await continuityStore.readLatestAuditEntry();
    expect(latestAudit?.actualPath).toBe("heuristic");
    expect(latestAudit?.fallbackReason).toBe("configured-heuristic");
    expect(latestAudit?.writtenPaths.length).toBeGreaterThan(0);
  }, 15_000);

  it("writes a continuity recovery marker when wrapper auto-save cannot append audit", async () => {
    const repoDir = await tempDir("cam-wrapper-recovery-repo-");
    const memoryRoot = await tempDir("cam-wrapper-recovery-memory-");
    const sessionsDir = await tempDir("cam-wrapper-recovery-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const mockCodexPath = path.join(repoDir, "mock-codex");
    const todayDir = path.join(sessionsDir, "2026", "03", "15");
    await fs.mkdir(todayDir, { recursive: true });
    await fs.writeFile(
      mockCodexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const sessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-recovery", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue wrapper recovery handling." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoSave: true
      }
    );

    const appendAuditSpy = vi
      .spyOn(SessionContinuityStore.prototype, "appendAuditLog")
      .mockRejectedValueOnce(new Error("wrapper continuity audit write failed"));

    await expect(runWrappedCodex(repoDir, "exec", ["continue"])).rejects.toThrow(
      "wrapper continuity audit write failed"
    );
    appendAuditSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      failedStage: "audit-write",
      failureMessage: "wrapper continuity audit write failed",
      scope: "both"
    });
  }, 15_000);

  it("still saves continuity when wrapper durable sync fails", async () => {
    const repoDir = await tempDir("cam-wrapper-sync-fail-repo-");
    const memoryRoot = await tempDir("cam-wrapper-sync-fail-memory-");
    const sessionsDir = await tempDir("cam-wrapper-sync-fail-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const mockCodexPath = path.join(repoDir, "mock-codex");
    const todayDir = path.join(sessionsDir, "2026", "03", "15");
    await fs.mkdir(todayDir, { recursive: true });
    await fs.writeFile(
      mockCodexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const sessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-sync-fail", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue after durable sync sidecar failure." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoSave: true
      }
    );

    const syncSpy = vi
      .spyOn(SyncService.prototype, "syncRollout")
      .mockRejectedValueOnce(new Error("sync audit write failed"));

    await expect(runWrappedCodex(repoDir, "exec", ["continue"])).rejects.toThrow(
      "sync audit write failed"
    );
    syncSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    const latestAudit = await store.readLatestAuditEntry();
    expect(latestAudit?.rolloutPath).toContain("rollout-2026-03-15T00-00-00-000Z-session.jsonl");
    expect(latestAudit?.writtenPaths.length).toBeGreaterThan(0);
    expect((await store.readMergedState())?.confirmedWorking.join("\n")).toContain("pnpm test");
  }, 15_000);
});
