import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import type { AppConfig } from "../src/lib/types.js";

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

    expect(result.skipped).toBe(false);
    expect(projectEntries.map((entry) => entry.summary).join("\n")).toContain("pnpm");
    expect(await service.memoryStore.hasProcessedRollout(rolloutPath)).toBe(true);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-1",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      scopesTouched: ["project"],
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

    expect(result.skipped).toBe(false);
    expect(result.applied).toEqual([]);
    expect(await service.memoryStore.hasProcessedRollout(rolloutPath)).toBe(true);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      sessionId: "session-2",
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
    expect(await service.memoryStore.hasProcessedRollout(rolloutPath)).toBe(false);
  });
});
