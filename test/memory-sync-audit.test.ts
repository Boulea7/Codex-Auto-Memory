import { describe, expect, it } from "vitest";
import {
  buildMemorySyncAuditEntry,
  formatMemorySyncAuditEntry,
  parseMemorySyncAuditEntry
} from "../src/lib/domain/memory-sync-audit.js";

describe("memory-sync-audit", () => {
  it("parses legacy extractor fields into configured and actual values", () => {
    const parsed = parseMemorySyncAuditEntry({
      appliedAt: "2026-03-18T00:00:00.000Z",
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "no-op",
      appliedCount: 0,
      noopOperationCount: 0,
      scopesTouched: [],
      resultSummary: "0 operations applied",
      operations: []
    });

    expect(parsed).toMatchObject({
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic"
    });
  });

  it("builds applied entries without skipReason and dedupes touched scopes", () => {
    const entry = buildMemorySyncAuditEntry({
      project: {
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
        projectId: "project-1",
        worktreeId: "worktree-1"
      },
      config: {
        autoMemoryEnabled: true,
        extractorMode: "codex",
        defaultScope: "project",
        maxStartupLines: 200,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: false,
        sessionContinuityLocalPathStyle: "codex",
        maxSessionContinuityLines: 60,
        codexBinary: "codex"
      },
      rolloutPath: "/tmp/rollout.jsonl",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      noopOperationCount: 1,
      operations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "first"
        },
        {
          action: "delete",
          scope: "project",
          topic: "workflow",
          id: "second"
        }
      ]
    });

    expect(entry.skipReason).toBeUndefined();
    expect(entry.appliedCount).toBe(2);
    expect(entry.noopOperationCount).toBe(1);
    expect(entry.scopesTouched).toEqual(["project"]);
    expect(entry.resultSummary).toBe("2 operation(s) applied, 1 no-op");
  });

  it("formats reviewer text with recovery badge, unknown session, and configured extractor diff", () => {
    const lines = formatMemorySyncAuditEntry({
      appliedAt: "2026-03-18T00:00:00.000Z",
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      configuredExtractorMode: "codex",
      configuredExtractorName: "codex-ephemeral",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "skipped",
      skipReason: "already-processed",
      isRecovery: true,
      appliedCount: 0,
      noopOperationCount: 0,
      scopesTouched: [],
      resultSummary: "Skipped rollout; it was already processed",
      operations: []
    });

    expect(lines[0]).toContain("[skipped] [recovery]");
    expect(lines[1]).toContain("Session: unknown");
    expect(lines[2]).toContain(
      "Applied: 0 | No-op: 0 | Suppressed: 0 | Rejected: 0 | Scopes: none"
    );
    expect(lines).toContain(
      "  Configured: codex-ephemeral (codex) -> Actual: heuristic (heuristic)"
    );
    expect(lines).toContain("  Skip reason: already-processed");
    expect(lines).toContain("  Rollout: /tmp/rollout.jsonl");
  });

  it("omits configured extractor line when configured and actual match", () => {
    const lines = formatMemorySyncAuditEntry({
      appliedAt: "2026-03-18T00:00:00.000Z",
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "no-op",
      appliedCount: 0,
      noopOperationCount: 0,
      scopesTouched: [],
      resultSummary: "0 operations applied",
      operations: []
    });

    expect(lines.some((line) => line.includes("Configured:"))).toBe(false);
    expect(lines.some((line) => line.includes("Skip reason:"))).toBe(false);
  });

  it("round-trips rejected reviewer fields and prints them in text output", () => {
    const parsed = parseMemorySyncAuditEntry({
      appliedAt: "2026-03-18T00:00:00.000Z",
      projectId: "project-1",
      worktreeId: "worktree-1",
      rolloutPath: "/tmp/rollout.jsonl",
      sessionId: "session-1",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "no-op",
      appliedCount: 0,
      noopOperationCount: 0,
      suppressedOperationCount: 0,
      rejectedOperationCount: 1,
      rejectedReasonCounts: {
        "unknown-topic": 1
      },
      rejectedOperations: [
        {
          action: "archive",
          scope: "project",
          topic: "workflow",
          id: "dropped-topic",
          reason: "unknown-topic"
        }
      ],
      scopesTouched: [],
      resultSummary: "0 operations applied, 1 rejected",
      operations: []
    });

    expect(parsed).toMatchObject({
      rejectedOperationCount: 1,
      rejectedReasonCounts: {
        "unknown-topic": 1
      },
      rejectedOperations: [
        {
          action: "archive",
          scope: "project",
          topic: "workflow",
          id: "dropped-topic",
          reason: "unknown-topic"
        }
      ]
    });

    const lines = formatMemorySyncAuditEntry(parsed!);
    expect(lines[2]).toContain("Rejected: 1");
    expect(lines).toContain("  Rejected reasons: unknown-topic=1");
    expect(lines).toContain("  Rejected operations:");
    expect(lines).toContain("    - [unknown-topic] project/workflow/dropped-topic");
  });
});
