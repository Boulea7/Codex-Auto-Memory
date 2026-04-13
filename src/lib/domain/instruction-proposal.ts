import path from "node:path";
import { createHash } from "node:crypto";
import type { DreamCandidateRecord, InstructionProposalArtifact, InstructionProposalTarget } from "../types.js";

const instructionProposalFormatVersion = "cam-dream-instruction-v2" as const;
const instructionProposalStartMarker = "<!-- codex-auto-memory:instruction-proposal:start -->";
const instructionProposalEndMarker = "<!-- codex-auto-memory:instruction-proposal:end -->";

interface ParsedManagedBlock {
  startIndex: number;
  endIndex: number;
  contents: string;
}

interface ManagedBlockInspection {
  lineEnding: "\n" | "\r\n" | "\r";
  managedBlock: ParsedManagedBlock | null;
  unsafeReason?: string;
}

interface GuidanceFenceState {
  quote: "`" | "~";
  length: number;
}

function detectLineEnding(value: string): "\n" | "\r\n" | "\r" {
  const match = value.match(/\r\n|\n|\r/u);
  return match?.[0] as "\n" | "\r\n" | "\r" | undefined ?? "\n";
}

function normalizeForDigest(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matchFenceLine(value: string): GuidanceFenceState | null {
  const match = value.match(/^\s*([`~]{3,})/u);
  if (!match) {
    return null;
  }

  return {
    quote: match[1]![0] as "`" | "~",
    length: match[1]!.length
  };
}

function isClosingFence(value: string, fence: GuidanceFenceState): boolean {
  const match = value.match(/^\s*([`~]{3,})\s*$/u);
  return Boolean(match && match[1]![0] === fence.quote && match[1]!.length >= fence.length);
}

function inspectManagedBlock(contents: string): ManagedBlockInspection {
  const lineEnding = detectLineEnding(contents);
  const lines = contents.split(/(\r\n|\n|\r)/u);
  let offset = 0;
  let fence: GuidanceFenceState | null = null;
  let startLine: { startIndex: number } | null = null;
  let endLine: { endIndex: number } | null = null;
  let unsafeReason: string | undefined;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const delimiter = lines[index + 1] ?? "";
    const lineStart = offset;
    const lineEnd = offset + line.length + delimiter.length;
    offset = lineEnd;

    if (fence) {
      if (isClosingFence(line, fence)) {
        fence = null;
      }
      continue;
    }

    const nextFence = matchFenceLine(line);
    if (nextFence) {
      fence = nextFence;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === instructionProposalStartMarker) {
      if (startLine || endLine) {
        unsafeReason =
          "Could not prepare an instruction proposal safely because the managed proposal block markers are duplicated outside fenced code blocks.";
      } else {
        startLine = { startIndex: lineStart };
      }
      continue;
    }

    if (trimmed === instructionProposalEndMarker) {
      if (!startLine || endLine) {
        unsafeReason =
          "Could not prepare an instruction proposal safely because the managed proposal block markers are missing, duplicated, or unbalanced.";
      } else {
        endLine = { endIndex: lineEnd };
      }
    }
  }

  if ((startLine && !endLine) || (!startLine && endLine)) {
    unsafeReason =
      "Could not prepare an instruction proposal safely because the managed proposal block markers are missing, duplicated, or unbalanced.";
  }

  return {
    lineEnding,
    managedBlock:
      startLine && endLine
        ? {
            startIndex: startLine.startIndex,
            endIndex: endLine.endIndex,
            contents: contents.slice(startLine.startIndex, endLine.endIndex)
          }
        : null,
    unsafeReason
  };
}

function appendManagedBlock(
  contents: string,
  managedBlock: string,
  lineEnding: "\n" | "\r\n" | "\r"
): string {
  if (contents.length === 0) {
    return `${managedBlock}${lineEnding}`;
  }

  if (contents.endsWith(`${lineEnding}${lineEnding}`)) {
    return `${contents}${managedBlock}${lineEnding}`;
  }

  if (contents.endsWith(lineEnding)) {
    return `${contents}${lineEnding}${managedBlock}${lineEnding}`;
  }

  return `${contents}${lineEnding}${lineEnding}${managedBlock}${lineEnding}`;
}

function replaceManagedBlock(
  contents: string,
  range: ParsedManagedBlock,
  managedBlock: string
): string {
  const trailingLineEnding =
    contents.slice(range.startIndex, range.endIndex).match(/(\r\n|\n|\r)$/u)?.[1] ?? "";
  return `${contents.slice(0, range.startIndex)}${managedBlock}${trailingLineEnding}${contents.slice(range.endIndex)}`;
}

function buildManagedBlockBody(entry: DreamCandidateRecord): string {
  return [
    "## Codex Auto Memory Dream Proposal",
    `<!-- codex-auto-memory:instruction-proposal-metadata ${JSON.stringify({
      candidateId: entry.candidateId,
      originKind: entry.originKind,
      sourceSection: entry.sourceSection,
      targetScopeHint: entry.targetScopeHint,
      rolloutPath: entry.lastSeenRolloutPath
    })} -->`,
    entry.summary,
    ...entry.details
      .filter((detail) => detail !== entry.summary)
      .map((detail) => `- ${detail}`)
  ].join("\n");
}

function buildManagedBlock(body: string, lineEnding: "\n" | "\r\n" | "\r"): string {
  return [instructionProposalStartMarker, body, instructionProposalEndMarker]
    .join("\n")
    .replace(/\n/g, lineEnding);
}

function buildPatch(
  targetPath: string,
  previousContents: string,
  nextContents: string,
  lineEnding: "\n" | "\r\n" | "\r",
  operation: "create-file" | "append-block" | "replace-block"
): string {
  const previousLabel = operation === "create-file" ? `${targetPath} (new file)` : targetPath;
  const previousLines =
    previousContents.length === 0 ? [] : normalizeForDigest(previousContents).replace(/\n$/u, "").split("\n");
  const nextLines =
    nextContents.length === 0 ? [] : normalizeForDigest(nextContents).replace(/\n$/u, "").split("\n");

  return [
    `--- ${previousLabel}`,
    `+++ ${targetPath}`,
    "@@",
    ...previousLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`)
  ]
    .join("\n")
    .replace(/\n/g, lineEnding);
}

function normalizeTarget(
  target: InstructionProposalTarget & { currentContents?: string }
): InstructionProposalTarget & { currentContents: string } {
  return {
    ...target,
    currentContents: target.currentContents ?? ""
  };
}

function toPublicTarget(
  target: InstructionProposalTarget & { currentContents?: string }
): InstructionProposalTarget {
  return {
    path: target.path,
    kind: target.kind,
    exists: target.exists,
    ...(target.selectionReason ? { selectionReason: target.selectionReason } : {})
  };
}

export function buildInstructionProposalArtifact(
  entry: DreamCandidateRecord,
  rankedTargets: Array<InstructionProposalTarget & { currentContents?: string }>,
  artifactPath: string
): InstructionProposalArtifact {
  const artifactDir = path.dirname(artifactPath);
  const normalizedTargets = rankedTargets.map(normalizeTarget);
  const selectedTargetByPolicy =
    normalizedTargets.find((target) => target.exists) ??
    normalizedTargets[0] ?? {
      path: "",
      kind: "agents-root" as const,
      exists: false,
      currentContents: ""
    };
  const selectedTarget = {
    ...selectedTargetByPolicy,
    selectionReason: selectedTargetByPolicy.exists
      ? "Selected the first existing instruction file in the preferred Codex-first order."
      : "No instruction file exists yet; recommend AGENTS.md as the shared Codex-first target."
  };
  const lineEnding = detectLineEnding(selectedTarget.currentContents);
  const managedBlockBody = buildManagedBlockBody(entry);
  const managedBlock = buildManagedBlock(managedBlockBody, lineEnding);
  const inspection = inspectManagedBlock(selectedTarget.currentContents);

  let resolvedApplyTarget: InstructionProposalArtifact["resolvedApplyTarget"] = selectedTarget;
  let applyReadiness: InstructionProposalArtifact["applyReadiness"];
  let patchPlan: InstructionProposalArtifact["patchPlan"] = null;
  let nextContents = selectedTarget.currentContents;

  if (inspection.unsafeReason) {
    resolvedApplyTarget = null;
    applyReadiness = {
      status: "blocked",
      recommendedOperation: "blocked",
      blockedReason: inspection.unsafeReason,
      targetSnapshotDigestSha256: digest(normalizeForDigest(selectedTarget.currentContents))
    };
  } else if (!selectedTarget.exists) {
    nextContents = `${managedBlock}${lineEnding}`;
    const unifiedDiff = buildPatch(
      selectedTarget.path,
      "",
      nextContents,
      lineEnding,
      "create-file"
    );
    patchPlan = {
      unifiedDiff,
      diffDigestSha256: digest(normalizeForDigest(unifiedDiff)),
      lineEnding,
      operation: "create-file",
      anchor: "end-of-file"
    };
    applyReadiness = {
      status: "safe",
      recommendedOperation: "create-file",
      targetSnapshotDigestSha256: null,
      existingManagedBlockDigestSha256: null
    };
  } else if (inspection.managedBlock) {
    nextContents = replaceManagedBlock(selectedTarget.currentContents, inspection.managedBlock, managedBlock);
    const unifiedDiff = buildPatch(
      selectedTarget.path,
      selectedTarget.currentContents,
      nextContents,
      lineEnding,
      "replace-block"
    );
    patchPlan = {
      unifiedDiff,
      diffDigestSha256: digest(normalizeForDigest(unifiedDiff)),
      lineEnding,
      operation: "replace-block",
      anchor: "existing-managed-block"
    };
    applyReadiness = {
      status: "safe",
      recommendedOperation: "replace-block",
      targetSnapshotDigestSha256: digest(normalizeForDigest(selectedTarget.currentContents)),
      existingManagedBlockDigestSha256: digest(normalizeForDigest(inspection.managedBlock.contents))
    };
  } else {
    nextContents = appendManagedBlock(selectedTarget.currentContents, managedBlock, lineEnding);
    const unifiedDiff = buildPatch(
      selectedTarget.path,
      selectedTarget.currentContents,
      nextContents,
      lineEnding,
      "append-block"
    );
    patchPlan = {
      unifiedDiff,
      diffDigestSha256: digest(normalizeForDigest(unifiedDiff)),
      lineEnding,
      operation: "append-block",
      anchor: "end-of-file"
    };
    applyReadiness = {
      status: "safe",
      recommendedOperation: "append-block",
      targetSnapshotDigestSha256: digest(normalizeForDigest(selectedTarget.currentContents)),
      existingManagedBlockDigestSha256: null
    };
  }

  const nextRecommendedActions =
    applyReadiness.status === "blocked"
      ? [
          `Inspect ${selectedTarget.path} and remove or repair duplicated/unbalanced managed proposal markers.`,
          `Re-run cam dream promote-prep --candidate-id ${entry.candidateId} after the target file is safe again.`
        ]
      : [
          `Review ${path.join(artifactDir, "summary.md")} before applying any instruction change manually.`,
          `Review ${path.join(artifactDir, "patch.diff")} and confirm the target file still matches the recorded snapshot digest.`,
          `Use cam dream apply-prep --candidate-id ${entry.candidateId} before a manual edit if the target file may have changed.`
        ];

  const artifact: InstructionProposalArtifact = {
    schemaVersion: 2,
    proposalOnly: true,
    neverAutoEditsInstructionFiles: true,
    artifactDir,
    selectedTargetByPolicy: toPublicTarget(selectedTarget),
    resolvedApplyTarget: resolvedApplyTarget ? toPublicTarget(resolvedApplyTarget) : null,
    selectedTarget: toPublicTarget(selectedTarget),
    rankedTargets: rankedTargets.map(toPublicTarget),
    candidate: {
      candidateId: entry.candidateId,
      targetSurface: "instruction-memory",
      originKind: entry.originKind,
      sourceSection: entry.sourceSection,
      targetScopeHint: entry.targetScopeHint,
      rolloutPath: entry.lastSeenRolloutPath,
      summary: entry.summary,
      details: [...entry.details]
    },
    normalizedInstruction: {
      summary: entry.summary,
      details: [...entry.details],
      sourceSection: entry.sourceSection,
      continuityScopeHint:
        entry.targetScopeHint === "unknown" ? "project" : entry.targetScopeHint
    },
    managedBlock: {
      formatVersion: instructionProposalFormatVersion,
      startMarker: instructionProposalStartMarker,
      endMarker: instructionProposalEndMarker,
      body: managedBlockBody,
      digestSha256: digest(normalizeForDigest(managedBlockBody))
    },
    applyReadiness,
    patchPlan,
    manualWorkflow: {
      summaryPath: path.join(artifactDir, "summary.md"),
      diffPath: path.join(artifactDir, "patch.diff"),
      applyPrepPath: path.join(artifactDir, "apply-prep.json"),
      nextRecommendedActions
    },
    guidanceBlock: managedBlock,
    patchPreview: patchPlan?.unifiedDiff ?? "",
    artifactPath,
    sourceContext: {
      candidateId: entry.candidateId,
      rolloutPath: entry.lastSeenRolloutPath,
      sourceSection: entry.sourceSection,
      continuityScopeHint: entry.targetScopeHint
    }
  };

  return artifact;
}

export function buildInstructionProposalDigests(artifact: InstructionProposalArtifact): {
  guidanceDigest: string;
  patchDigest: string;
} {
  return {
    guidanceDigest: digest(normalizeForDigest(artifact.guidanceBlock)),
    patchDigest: digest(normalizeForDigest(artifact.patchPlan?.unifiedDiff ?? artifact.patchPreview))
  };
}
