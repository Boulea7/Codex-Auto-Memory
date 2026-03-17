import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import type { AppConfig, MemoryOperation, ProcessedRolloutIdentity } from "../src/lib/types.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function baseConfig(memoryRoot: string): AppConfig {
  return {
    autoMemoryEnabled: true,
    autoMemoryDirectory: memoryRoot,
    extractorMode: "heuristic",
    defaultScope: "project",
    maxStartupLines: 200,
    sessionContinuityAutoLoad: false,
    sessionContinuityAutoSave: false,
    sessionContinuityLocalPathStyle: "codex",
    maxSessionContinuityLines: 60,
    codexBinary: "codex"
  };
}

async function processedIdentity(
  service: SyncService,
  rolloutPath: string,
  sessionId: string
): Promise<ProcessedRolloutIdentity> {
  const stats = await fs.stat(rolloutPath);
  const project = detectProjectContext(path.dirname(rolloutPath));
  return {
    projectId: project.projectId,
    worktreeId: project.worktreeId,
    sessionId,
    rolloutPath,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

function rolloutFixture(projectDir: string, sessionId = "session-1"): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-14T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-03-14T00:00:00.000Z",
        cwd: projectDir
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "remember that we always use pnpm in this repo"
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: "{\"cmd\":\"pnpm test\",\"workdir\":\"" + projectDir.replace(/\\/g, "\\\\") + "\"}"
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "Process exited with code 0"
      }
    })
  ].join("\n");
}

function noOpRolloutFixture(projectDir: string, sessionId = "session-2"): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-14T00:10:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-03-14T00:10:00.000Z",
        cwd: projectDir
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:10:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "thanks"
      }
    })
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SyncService", () => {
  it("constructs without throwing when no explicit schemaRoot is provided", async () => {
    const projectDir = await tempDir("cam-sync-schema-");
    const memoryRoot = await tempDir("cam-sync-schema-mem-");
    const config = baseConfig(memoryRoot);
    expect(() => new SyncService(detectProjectContext(projectDir), config)).not.toThrow();
  });

  it("extracts memory updates from rollout evidence and writes a typed applied audit entry", async () => {
    const projectDir = await tempDir("cam-sync-project-");
    const memoryRoot = await tempDir("cam-sync-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir), "utf8");

    const config = baseConfig(memoryRoot);
    const service = new SyncService(
      detectProjectContext(projectDir),
      config,
      path.resolve("schemas/memory-operations.schema.json")
    );
    const result = await service.syncRollout(rolloutPath, true);
    const projectEntries = await service.memoryStore.listEntries("project");
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(5);
    const identity = await processedIdentity(service, rolloutPath, "session-1");

    expect(result.skipped).toBe(false);
    expect(projectEntries.map((entry) => entry.summary).join("\n")).toContain("pnpm");
    expect(await service.memoryStore.hasProcessedRollout(identity)).toBe(true);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-1",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      scopesTouched: ["project"]
    });
    expect(auditEntries[0]?.appliedCount).toBe(result.applied.length);
    expect(auditEntries[0]?.resultSummary).toBe(`${result.applied.length} operation(s) applied`);
    expect(auditEntries[0]?.operations).toHaveLength(result.applied.length);
  });

  it("records a no-op sync audit entry when rollout evidence yields no durable updates", async () => {
    const projectDir = await tempDir("cam-sync-noop-project-");
    const memoryRoot = await tempDir("cam-sync-noop-memory-");
    const rolloutPath = path.join(projectDir, "noop-rollout.jsonl");
    await fs.writeFile(rolloutPath, noOpRolloutFixture(projectDir), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );

    const result = await service.syncRollout(rolloutPath, true);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(5);
    const identity = await processedIdentity(service, rolloutPath, "session-2");

    expect(result.skipped).toBe(false);
    expect(result.applied).toEqual([]);
    expect(await service.memoryStore.hasProcessedRollout(identity)).toBe(true);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-2",
      configuredExtractorMode: "heuristic",
      actualExtractorMode: "heuristic",
      status: "no-op",
      appliedCount: 0,
      scopesTouched: [],
      resultSummary: "0 operations applied"
    });
    expect(auditEntries[0]?.operations).toEqual([]);
  });

  it("records skipped audit entries for already processed and no-evidence rollouts", async () => {
    const projectDir = await tempDir("cam-sync-skip-project-");
    const memoryRoot = await tempDir("cam-sync-skip-memory-");
    const appliedRolloutPath = path.join(projectDir, "applied-rollout.jsonl");
    const invalidRolloutPath = path.join(projectDir, "invalid-rollout.jsonl");
    await fs.writeFile(appliedRolloutPath, rolloutFixture(projectDir, "session-skip"), "utf8");
    await fs.writeFile(invalidRolloutPath, "{\"type\":\"event_msg\"}\n", "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );

    await service.syncRollout(appliedRolloutPath, false);
    const skippedProcessed = await service.syncRollout(appliedRolloutPath, false);
    const skippedNoEvidence = await service.syncRollout(invalidRolloutPath, false);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(10);

    expect(skippedProcessed.skipped).toBe(true);
    expect(skippedNoEvidence.skipped).toBe(true);
    expect(auditEntries).toHaveLength(3);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath: invalidRolloutPath,
      status: "skipped",
      skipReason: "no-rollout-evidence",
      appliedCount: 0,
      scopesTouched: []
    });
    expect(auditEntries[1]).toMatchObject({
      rolloutPath: appliedRolloutPath,
      status: "skipped",
      skipReason: "already-processed",
      appliedCount: 0,
      scopesTouched: []
    });
    expect(auditEntries[2]).toMatchObject({
      rolloutPath: appliedRolloutPath,
      status: "applied"
    });
  });

  it("does not treat a rewritten rollout at the same path as already processed", async () => {
    const projectDir = await tempDir("cam-sync-rewrite-project-");
    const memoryRoot = await tempDir("cam-sync-rewrite-memory-");
    const rolloutPath = path.join(projectDir, "reused-rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-old"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );

    await service.syncRollout(rolloutPath, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(rolloutPath, noOpRolloutFixture(projectDir, "session-new"), "utf8");

    const result = await service.syncRollout(rolloutPath, false);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(10);

    expect(result.skipped).toBe(false);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-new",
      status: "no-op"
    });
    expect(auditEntries.some((entry) => entry.sessionId === "session-old" && entry.status === "applied")).toBe(true);
  });

  it("allows a legacy path-only processed state entry to re-sync once under the new identity rules", async () => {
    const projectDir = await tempDir("cam-sync-legacy-project-");
    const memoryRoot = await tempDir("cam-sync-legacy-memory-");
    const rolloutPath = path.join(projectDir, "legacy-rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-legacy"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    await service.memoryStore.ensureLayout();
    await fs.writeFile(
      service.memoryStore.paths.stateFile,
      JSON.stringify({
        processedRollouts: {
          [rolloutPath]: "2026-03-14T00:00:00.000Z"
        }
      }),
      "utf8"
    );

    const result = await service.syncRollout(rolloutPath, false);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(5);
    const syncState = await service.memoryStore.getSyncState();

    expect(result.skipped).toBe(false);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-legacy",
      status: "applied"
    });
    expect(syncState.processedRolloutEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rolloutPath,
          sessionId: "session-legacy"
        })
      ])
    );
  });

  it("records actual heuristic execution when codex mode falls back during durable sync extraction", async () => {
    const projectDir = await tempDir("cam-sync-codex-fallback-project-");
    const memoryRoot = await tempDir("cam-sync-codex-fallback-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-codex-fallback"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      {
        ...baseConfig(memoryRoot),
        extractorMode: "codex"
      },
      path.resolve("schemas/memory-operations.schema.json")
    );
    const primaryExtractor = (service as unknown as {
      primaryExtractor: { extract: () => Promise<MemoryOperation[] | null> };
    }).primaryExtractor;
    vi.spyOn(primaryExtractor, "extract").mockResolvedValueOnce(null);

    const result = await service.syncRollout(rolloutPath, true);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(5);

    expect(result.skipped).toBe(false);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-codex-fallback",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic"
    });
  });

  it("records actual codex execution when codex mode succeeds during durable sync extraction", async () => {
    const projectDir = await tempDir("cam-sync-codex-success-project-");
    const memoryRoot = await tempDir("cam-sync-codex-success-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-codex-success"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      {
        ...baseConfig(memoryRoot),
        extractorMode: "codex"
      },
      path.resolve("schemas/memory-operations.schema.json")
    );
    const primaryExtractor = (service as unknown as {
      primaryExtractor: { extract: () => Promise<MemoryOperation[] | null> };
    }).primaryExtractor;
    vi.spyOn(primaryExtractor, "extract").mockResolvedValueOnce([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "codex-note",
        summary: "Codex-derived durable memory.",
        details: ["Remember the codex result."],
        sources: ["codex"]
      }
    ]);

    const result = await service.syncRollout(rolloutPath, true);
    const auditEntries = await service.memoryStore.readRecentSyncAuditEntries(5);

    expect(result.skipped).toBe(false);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-codex-success",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "codex",
      actualExtractorName: "codex-ephemeral",
      extractorMode: "codex",
      extractorName: "codex-ephemeral",
      appliedCount: 1
    });
  });

  it("does not mark a rollout as processed when sync audit persistence fails", async () => {
    const projectDir = await tempDir("cam-sync-audit-fail-project-");
    const memoryRoot = await tempDir("cam-sync-audit-fail-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-fail"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    vi.spyOn(service.memoryStore, "appendSyncAuditEntry").mockRejectedValueOnce(
      new Error("audit write failed")
    );

    await expect(service.syncRollout(rolloutPath, true)).rejects.toThrow("audit write failed");
    expect((await service.memoryStore.getSyncState()).processedRolloutEntries).toEqual([]);
    expect(await service.memoryStore.readRecentSyncAuditEntries(5)).toEqual([]);
    const auditFailureRecovery = await service.memoryStore.readSyncRecoveryRecord();
    expect(auditFailureRecovery).toMatchObject({
      rolloutPath,
      sessionId: "session-fail",
      status: "applied",
      failedStage: "audit-write",
      auditEntryWritten: false,
      scopesTouched: ["project"],
      failureMessage: "audit write failed"
    });
    expect(auditFailureRecovery?.appliedCount).toBeGreaterThan(0);
  });

  it("preserves the original audit failure when sync recovery marker persistence also fails", async () => {
    const projectDir = await tempDir("cam-sync-audit-fail-recovery-fail-project-");
    const memoryRoot = await tempDir("cam-sync-audit-fail-recovery-fail-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-fail-both"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    vi.spyOn(service.memoryStore, "appendSyncAuditEntry").mockRejectedValueOnce(
      new Error("audit write failed")
    );
    vi.spyOn(service.memoryStore, "writeSyncRecoveryRecord").mockRejectedValueOnce(
      new Error("recovery write failed")
    );

    await expect(service.syncRollout(rolloutPath, true)).rejects.toThrow("audit write failed");
  });

  it("writes a recovery marker when processed-state persistence fails after audit write", async () => {
    const projectDir = await tempDir("cam-sync-state-fail-project-");
    const memoryRoot = await tempDir("cam-sync-state-fail-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-state-fail"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    vi.spyOn(service.memoryStore, "markRolloutProcessed").mockRejectedValueOnce(
      new Error("state write failed")
    );

    await expect(service.syncRollout(rolloutPath, true)).rejects.toThrow("state write failed");
    expect(await service.memoryStore.readRecentSyncAuditEntries(5)).toHaveLength(1);
    expect((await service.memoryStore.getSyncState()).processedRolloutEntries).toEqual([]);
    const stateFailureRecovery = await service.memoryStore.readSyncRecoveryRecord();
    expect(stateFailureRecovery).toMatchObject({
      rolloutPath,
      sessionId: "session-state-fail",
      status: "applied",
      failedStage: "processed-state-write",
      auditEntryWritten: true,
      scopesTouched: ["project"],
      failureMessage: "state write failed"
    });
    expect(stateFailureRecovery?.appliedCount).toBeGreaterThan(0);
  });

  it("does not clear an unrelated sync recovery marker after a successful sync", async () => {
    const projectDir = await tempDir("cam-sync-recovery-clear-project-");
    const memoryRoot = await tempDir("cam-sync-recovery-clear-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-recovery-clear"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    await service.memoryStore.writeSyncRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: detectProjectContext(projectDir).projectId,
      worktreeId: detectProjectContext(projectDir).worktreeId,
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sessionId: "stale-session",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      failedStage: "audit-write",
      failureMessage: "stale marker",
      auditEntryWritten: false
    });

    const result = await service.syncRollout(rolloutPath, true);

    expect(result.skipped).toBe(false);
    expect(await service.memoryStore.readSyncRecoveryRecord()).toMatchObject({
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sessionId: "stale-session"
    });
  });

  it("clears a matching sync recovery marker after the same rollout succeeds", async () => {
    const projectDir = await tempDir("cam-sync-recovery-match-project-");
    const memoryRoot = await tempDir("cam-sync-recovery-match-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir, "session-recovery-clear"), "utf8");

    const service = new SyncService(
      detectProjectContext(projectDir),
      baseConfig(memoryRoot),
      path.resolve("schemas/memory-operations.schema.json")
    );
    await service.memoryStore.writeSyncRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: detectProjectContext(projectDir).projectId,
      worktreeId: detectProjectContext(projectDir).worktreeId,
      rolloutPath,
      sessionId: "session-recovery-clear",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      failedStage: "audit-write",
      failureMessage: "matching marker",
      auditEntryWritten: false
    });

    const result = await service.syncRollout(rolloutPath, true);

    expect(result.skipped).toBe(false);
    expect(await service.memoryStore.readSyncRecoveryRecord()).toBeNull();
  });
});
