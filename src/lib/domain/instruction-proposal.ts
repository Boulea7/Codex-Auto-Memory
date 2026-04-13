import { createHash } from "node:crypto";
import type { DreamCandidateRecord, InstructionProposalArtifact, InstructionProposalTarget } from "../types.js";

function buildManagedGuidanceBlock(entry: DreamCandidateRecord): string {
  return [
    `<!-- codex-auto-memory:dream-proposal:${entry.candidateId}:start -->`,
    "## Codex Auto Memory Dream Proposal",
    `- ${entry.summary}`,
    ...entry.details
      .filter((detail) => detail !== entry.summary)
      .map((detail) => `- ${detail}`),
    `<!-- codex-auto-memory:dream-proposal:${entry.candidateId}:end -->`
  ].join("\n");
}

function buildPatchPreview(target: InstructionProposalTarget, guidanceBlock: string): string {
  const nextContents = `${guidanceBlock}\n`;
  const previousMarker = target.exists ? "(existing file content omitted)" : "";
  return [
    `--- ${target.path}${target.exists ? "" : " (new file)"}`,
    `+++ ${target.path}`,
    "@@",
    ...(previousMarker ? [`-${previousMarker}`] : []),
    ...nextContents.trimEnd().split("\n").map((line) => `+${line}`)
  ].join("\n");
}

export function buildInstructionProposalArtifact(
  entry: DreamCandidateRecord,
  rankedTargets: InstructionProposalTarget[],
  artifactPath: string
): InstructionProposalArtifact {
  const selectedTarget =
    rankedTargets.find((target) => target.exists) ?? rankedTargets[0] ?? {
      path: "",
      kind: "agents-root" as const,
      exists: false
    };
  const selectionReason = selectedTarget.exists
    ? "Selected the first existing instruction file in the preferred Codex-first order."
    : "No instruction file exists yet; recommend AGENTS.md as the shared Codex-first target.";
  const guidanceBlock = buildManagedGuidanceBlock(entry);
  const patchPreview = buildPatchPreview(
    {
      ...selectedTarget,
      selectionReason
    },
    guidanceBlock
  );

  return {
    proposalOnly: true,
    selectedTarget: {
      ...selectedTarget,
      selectionReason
    },
    rankedTargets,
    normalizedInstruction: {
      summary: entry.summary,
      details: [...entry.details],
      sourceSection: entry.sourceSection,
      continuityScopeHint:
        entry.targetScopeHint === "unknown" ? "project" : entry.targetScopeHint
    },
    guidanceBlock,
    patchPreview,
    artifactPath,
    sourceContext: {
      candidateId: entry.candidateId,
      rolloutPath: entry.lastSeenRolloutPath,
      sourceSection: entry.sourceSection,
      continuityScopeHint: entry.targetScopeHint
    }
  };
}

export function buildInstructionProposalDigests(artifact: InstructionProposalArtifact): {
  guidanceDigest: string;
  patchDigest: string;
} {
  return {
    guidanceDigest: createHash("sha256").update(artifact.guidanceBlock).digest("hex"),
    patchDigest: createHash("sha256").update(artifact.patchPreview).digest("hex")
  };
}
