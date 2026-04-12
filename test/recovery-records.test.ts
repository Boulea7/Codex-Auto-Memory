import { describe, expect, it } from "vitest";
import {
  buildContinuityRecoveryRecord,
  buildSyncRecoveryRecord,
  isContinuityRecoveryRecord,
  isSyncRecoveryRecord,
  matchesContinuityRecoveryRecord,
  matchesSyncRecoveryRecord
} from "../src/lib/domain/recovery-records.js";

describe("recovery-records", () => {
  it("accepts a valid sync recovery record built by the helper", () => {
    const record = buildSyncRecoveryRecord({
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "applied",
      appliedCount: 2,
      scopesTouched: ["project", "project-local"],
      failedStage: "processed-state-write",
      failureMessage: "state write failed",
      auditEntryWritten: true
    });

    expect(isSyncRecoveryRecord(record)).toBe(true);
  });

  it("rejects an invalid sync recovery record shape", () => {
    expect(
      isSyncRecoveryRecord({
        recordedAt: "2026-03-18T00:00:00.000Z",
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        configuredExtractorMode: "codex",
        configuredExtractorName: "codex-ephemeral",
        actualExtractorMode: "heuristic",
        actualExtractorName: "heuristic",
        status: "skipped",
        appliedCount: 1,
        scopesTouched: ["project"],
        failedStage: "audit-write",
        failureMessage: "bad status",
        auditEntryWritten: false
      })
    ).toBe(false);
  });

  it("rejects malformed noopOperationCount values", () => {
    expect(
      isSyncRecoveryRecord({
        recordedAt: "2026-03-18T00:00:00.000Z",
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        configuredExtractorMode: "codex",
        configuredExtractorName: "codex-ephemeral",
        actualExtractorMode: "heuristic",
        actualExtractorName: "heuristic",
        status: "applied",
        appliedCount: 1,
        noopOperationCount: "1",
        scopesTouched: ["project"],
        failedStage: "audit-write",
        failureMessage: "bad noop count",
        auditEntryWritten: false
      })
    ).toBe(false);
  });

  it("matches sync recovery records by logical identity fields only", () => {
    const record = buildSyncRecoveryRecord({
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      status: "no-op",
      appliedCount: 0,
      scopesTouched: [],
      failedStage: "audit-write",
      failureMessage: "audit failed",
      auditEntryWritten: false
    });

    expect(
      matchesSyncRecoveryRecord(record, {
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        sessionId: "session-1"
      })
    ).toBe(true);
    expect(
      matchesSyncRecoveryRecord(record, {
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        sessionId: "session-2"
      })
    ).toBe(false);
  });

  it("accepts a valid continuity recovery record with scope both", () => {
    const record = buildContinuityRecoveryRecord({
      projectId: "project-1",
      worktreeId: "worktree-1",
      diagnostics: {
        generatedAt: "2026-03-18T00:00:00.000Z",
        rolloutPath: "/tmp/rollout.jsonl",
        sourceSessionId: "session-1",
        preferredPath: "codex",
        actualPath: "heuristic",
        confidence: "low",
        warnings: ["Low-signal continuity fallback."],
        fallbackReason: "low-signal",
        codexExitCode: 17,
        evidenceCounts: {
          successfulCommands: 1,
          failedCommands: 2,
          fileWrites: 3,
          nextSteps: 4,
          untried: 5
        }
      },
      scope: "both",
      writtenPaths: ["/tmp/shared.md", "/tmp/local.md"],
      failedStage: "audit-write",
      failureMessage: "audit append failed"
    });

    expect(isContinuityRecoveryRecord(record)).toBe(true);
  });

  it("rejects an invalid continuity recovery record shape", () => {
    expect(
      isContinuityRecoveryRecord({
        recordedAt: "2026-03-18T00:00:00.000Z",
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        sourceSessionId: "session-1",
        scope: "invalid",
        writtenPaths: ["/tmp/shared.md"],
        preferredPath: "heuristic",
        actualPath: "heuristic",
        evidenceCounts: {
          successfulCommands: 1,
          failedCommands: 0,
          fileWrites: 0,
          nextSteps: 1,
          untried: 0
        },
        failedStage: "audit-write",
        failureMessage: "bad scope"
      })
    ).toBe(false);
  });

  it("matches continuity recovery records by full logical identity including scope", () => {
    const record = buildContinuityRecoveryRecord({
      projectId: "project-1",
      worktreeId: "worktree-1",
      diagnostics: {
        generatedAt: "2026-03-18T00:00:00.000Z",
        rolloutPath: "/tmp/rollout.jsonl",
        sourceSessionId: "session-1",
        preferredPath: "heuristic",
        actualPath: "heuristic",
        confidence: "low",
        warnings: [],
        fallbackReason: "configured-heuristic",
        evidenceCounts: {
          successfulCommands: 1,
          failedCommands: 0,
          fileWrites: 0,
          nextSteps: 1,
          untried: 0
        }
      },
      scope: "both",
      writtenPaths: ["/tmp/shared.md", "/tmp/local.md"],
      failedStage: "audit-write",
      failureMessage: "audit append failed"
    });

    expect(
      matchesContinuityRecoveryRecord(record, {
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        sourceSessionId: "session-1",
        scope: "both"
      })
    ).toBe(true);
    expect(
      matchesContinuityRecoveryRecord(record, {
        projectId: "project-1",
        worktreeId: "worktree-1",
        rolloutPath: "/tmp/rollout.jsonl",
        sourceSessionId: "session-1",
        scope: "project"
      })
    ).toBe(true);
  });
});
