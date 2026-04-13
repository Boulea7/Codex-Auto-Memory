import { describe, expect, it } from "vitest";
import { buildInstructionProposalArtifact } from "../src/lib/domain/instruction-proposal.js";
import type { DreamCandidateRecord, InstructionProposalTarget } from "../src/lib/types.js";

function makeCandidate(overrides: Partial<DreamCandidateRecord> = {}): DreamCandidateRecord {
  return {
    candidateId: "cand-1234",
    observationFingerprint: "obs-1234",
    targetSurface: "instruction-memory",
    originKind: "primary",
    targetScopeHint: "project",
    topicHint: "workflow",
    idHint: "prefer-pnpm",
    status: "approved",
    summary: "Always run pnpm test before build.",
    details: ["Use pnpm test before pnpm build in this repository."],
    reason: "Detected an instruction-like continuity statement.",
    sourceSection: "confirmedWorking",
    firstSeenAt: "2026-04-13T10:00:00.000Z",
    lastSeenAt: "2026-04-13T10:00:00.000Z",
    lastSeenRolloutPath: "/tmp/rollout.jsonl",
    lastSeenSnapshotPath: "/tmp/latest.json",
    promotion: {
      eligible: true,
      eligibleReason: "Eligible for explicit review and promote."
    },
    ...overrides
  };
}

describe("instruction proposal artifact", () => {
  it("builds a safe create-file bundle for a missing instruction target", () => {
    const artifact = buildInstructionProposalArtifact(
      makeCandidate(),
      [
        {
          path: "/repo/AGENTS.md",
          kind: "agents-root",
          exists: false
        }
      ],
      "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/manifest.json"
    );

    expect(artifact).toMatchObject({
      schemaVersion: 2,
      proposalOnly: true,
      neverAutoEditsInstructionFiles: true,
      selectedTargetByPolicy: {
        path: "/repo/AGENTS.md",
        kind: "agents-root",
        exists: false
      },
      resolvedApplyTarget: {
        path: "/repo/AGENTS.md",
        kind: "agents-root",
        exists: false
      },
      applyReadiness: {
        status: "safe",
        recommendedOperation: "create-file"
      },
      patchPlan: {
        operation: "create-file",
        anchor: "end-of-file"
      },
      manualWorkflow: {
        summaryPath: "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/summary.md",
        diffPath: "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/patch.diff",
        applyPrepPath: "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/apply-prep.json"
      }
    });
    expect(artifact.managedBlock.startMarker).toBe(
      "<!-- codex-auto-memory:instruction-proposal:start -->"
    );
    expect(artifact.managedBlock.endMarker).toBe(
      "<!-- codex-auto-memory:instruction-proposal:end -->"
    );
    expect(artifact.managedBlock.body).toContain("Always run pnpm test before build.");
    expect(artifact.patchPlan).not.toBeNull();
    expect(artifact.patchPlan!.unifiedDiff).toContain("--- /repo/AGENTS.md (new file)");
    expect(artifact.patchPlan!.unifiedDiff).toContain("+++ /repo/AGENTS.md");
  });

  it("blocks unsafe targets instead of silently switching to another target", () => {
    const unsafeTarget = {
      path: "/repo/AGENTS.md",
      kind: "agents-root",
      exists: true,
      currentContents: [
        "# Repo guidance",
        "",
        "<!-- codex-auto-memory:instruction-proposal:start -->",
        "duplicate one",
        "<!-- codex-auto-memory:instruction-proposal:end -->",
        "",
        "<!-- codex-auto-memory:instruction-proposal:start -->",
        "duplicate two",
        "<!-- codex-auto-memory:instruction-proposal:end -->",
        ""
      ].join("\n")
    } satisfies InstructionProposalTarget & { currentContents: string };
    const backupTarget = {
      path: "/repo/CLAUDE.md",
      kind: "claude-project",
      exists: true,
      currentContents: "# Claude rules\n"
    } satisfies InstructionProposalTarget & { currentContents: string };

    const artifact = buildInstructionProposalArtifact(
      makeCandidate(),
      [unsafeTarget, backupTarget],
      "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/manifest.json"
    );

    expect(artifact.selectedTargetByPolicy.path).toBe("/repo/AGENTS.md");
    expect(artifact.resolvedApplyTarget).toBeNull();
    expect(artifact.applyReadiness).toMatchObject({
      status: "blocked",
      recommendedOperation: "blocked"
    });
    expect(artifact.applyReadiness.blockedReason).toContain("duplicated");
    expect(artifact.patchPlan).toBeNull();
  });

  it("builds a replace-block diff when the target contains one safe managed block", () => {
    const currentContents = [
      "# Repo guidance",
      "",
      "<!-- codex-auto-memory:instruction-proposal:start -->",
      "## Codex Auto Memory Dream Proposal",
      "- Old instruction",
      "<!-- codex-auto-memory:instruction-proposal:end -->",
      ""
    ].join("\n");

    const artifact = buildInstructionProposalArtifact(
      makeCandidate(),
      [
        {
          path: "/repo/AGENTS.md",
          kind: "agents-root",
          exists: true,
          currentContents
        } satisfies InstructionProposalTarget & { currentContents: string }
      ],
      "/repo/.codex-auto-memory/dream/review/proposals/cand-1234/manifest.json"
    );

    expect(artifact.applyReadiness).toMatchObject({
      status: "safe",
      recommendedOperation: "replace-block"
    });
    expect(artifact.patchPlan).not.toBeNull();
    expect(artifact.patchPlan).toMatchObject({
      operation: "replace-block",
      anchor: "existing-managed-block"
    });
    expect(artifact.patchPlan!.unifiedDiff).toContain("-## Codex Auto Memory Dream Proposal");
    expect(artifact.patchPlan!.unifiedDiff).toContain("+Always run pnpm test before build.");
  });
});
