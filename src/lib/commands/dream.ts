import { createHash } from "node:crypto";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import {
  buildDreamSnapshot,
  ensureDreamSidecarFresh,
  inspectDreamSidecar,
  persistDreamSnapshot
} from "../domain/dream-sidecar.js";
import {
  adoptDreamCandidate,
  buildInstructionProposal,
  getDreamCandidate,
  getDreamCandidateProposalArtifactPath,
  getLatestDreamProposalCandidate,
  listDreamCandidates,
  markDreamCandidateManualApplied,
  markDreamCandidateApplyPrepared,
  markDreamCandidatePrepared,
  markDreamCandidatePromoted,
  readInstructionProposalArtifact,
  recordDreamCandidateRecovery,
  reconcileDreamCandidates,
  reviewDreamCandidate
} from "../domain/dream-candidates.js";
import { findLatestProjectRollout } from "../domain/rollout.js";
import { buildManualMutationReviewEntry } from "./manual-mutation-review.js";
import { fileExists, readTextFile, writeJsonFileAtomic } from "../util/fs.js";
import { buildResolvedCliCommand } from "../integration/retrieval-contract.js";
import type {
  DreamCandidateOriginKind,
  DreamCandidateStatus,
  DreamCandidateTargetSurface,
  InstructionTargetHost,
  SessionContinuityScope
} from "../types.js";

type DreamAction =
  | "build"
  | "inspect"
  | "candidates"
  | "review"
  | "adopt"
  | "proposal"
  | "promote"
  | "promote-prep"
  | "apply-prep"
  | "verify-apply";

interface DreamOptions {
  cwd?: string;
  json?: boolean;
  rollout?: string;
  scope?: SessionContinuityScope | "both";
  candidateId?: string;
  status?: DreamCandidateStatus;
  targetSurface?: DreamCandidateTargetSurface;
  originKind?: DreamCandidateOriginKind;
  approve?: boolean;
  reject?: boolean;
  defer?: boolean;
  note?: string;
  topic?: string;
  id?: string;
  targetFile?: string;
  targetHost?: InstructionTargetHost;
}

const dreamCandidateStatuses = [
  "pending",
  "approved",
  "manual-apply-pending",
  "manual-applied",
  "rejected",
  "promoted",
  "stale",
  "blocked"
] as const;

const dreamCandidateTargetSurfaces = ["durable-memory", "instruction-memory"] as const;

const dreamCandidateOriginKinds = ["primary", "subagent"] as const;
const instructionTargetHosts = ["codex", "claude", "gemini", "shared"] as const;

function selectedScope(scope?: SessionContinuityScope | "both"): SessionContinuityScope | "both" {
  if (!scope) {
    return "both";
  }

  if (scope === "project" || scope === "project-local" || scope === "both") {
    return scope;
  }

  throw new Error("Scope must be one of: project, project-local, both.");
}

async function resolveRollout(runtime: Awaited<ReturnType<typeof buildRuntimeContext>>, rollout?: string): Promise<string> {
  if (rollout) {
    return rollout;
  }

  const latestPrimaryRollout = await findLatestProjectRollout(runtime.project);
  if (!latestPrimaryRollout) {
    throw new Error("No relevant rollout found for this project.");
  }

  return latestPrimaryRollout;
}

function normalizeDreamStatus(value?: string): DreamCandidateStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (dreamCandidateStatuses.includes(value as DreamCandidateStatus)) {
    return value as DreamCandidateStatus;
  }
  throw new Error(`Dream status must be one of: ${dreamCandidateStatuses.join(", ")}.`);
}

function normalizeDreamTargetSurface(value?: string): DreamCandidateTargetSurface | undefined {
  if (!value) {
    return undefined;
  }
  if (dreamCandidateTargetSurfaces.includes(value as DreamCandidateTargetSurface)) {
    return value as DreamCandidateTargetSurface;
  }
  throw new Error(
    `Dream target surface must be one of: ${dreamCandidateTargetSurfaces.join(", ")}.`
  );
}

function normalizeDreamOriginKind(value?: string): DreamCandidateOriginKind | undefined {
  if (!value) {
    return undefined;
  }
  if (dreamCandidateOriginKinds.includes(value as DreamCandidateOriginKind)) {
    return value as DreamCandidateOriginKind;
  }
  throw new Error(`Dream origin kind must be one of: ${dreamCandidateOriginKinds.join(", ")}.`);
}

function normalizeInstructionTargetHost(value?: string): InstructionTargetHost | undefined {
  if (!value) {
    return undefined;
  }
  if (instructionTargetHosts.includes(value as InstructionTargetHost)) {
    return value as InstructionTargetHost;
  }
  throw new Error(`Dream target host must be one of: ${instructionTargetHosts.join(", ")}.`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildInstructionReviewerActions(
  runtime: Awaited<ReturnType<typeof buildRuntimeContext>>,
  entry: NonNullable<Awaited<ReturnType<typeof getDreamCandidate>>["entry"]>,
  options: {
    applyReadinessStatus?: "safe" | "blocked" | "stale";
  } = {}
): string[] {
  const actions: string[] = [];
  const artifactPath = getDreamCandidateProposalArtifactPath(entry);
  const applyReadinessStatus = options.applyReadinessStatus ?? entry.promotion.applyReadinessStatus;

  if (entry.status === "approved") {
    actions.push(
      buildResolvedCliCommand(`dream promote-prep --candidate-id ${entry.candidateId} --json`, {
        cwd: runtime.project.projectRoot
      }),
      buildResolvedCliCommand(`dream promote --candidate-id ${entry.candidateId} --json`, {
        cwd: runtime.project.projectRoot
      })
    );
  }

  if (!artifactPath) {
    return actions;
  }

  actions.push(
    buildResolvedCliCommand(`dream proposal --candidate-id ${entry.candidateId} --json`, {
      cwd: runtime.project.projectRoot
    })
  );

  if (applyReadinessStatus !== "stale") {
    actions.push(
      buildResolvedCliCommand(`dream apply-prep --candidate-id ${entry.candidateId} --json`, {
        cwd: runtime.project.projectRoot
      })
    );
  }

  if (entry.status === "manual-apply-pending" && applyReadinessStatus === "safe") {
    actions.push(
      buildResolvedCliCommand(`dream verify-apply --candidate-id ${entry.candidateId} --json`, {
        cwd: runtime.project.projectRoot
      })
    );
  }

  return actions;
}

async function buildDreamReviewerPayload(
  runtime: Awaited<ReturnType<typeof buildRuntimeContext>>,
  entry?: Awaited<ReturnType<typeof getDreamCandidate>>["entry"]
): Promise<{
  reviewerSummary: {
    queueSummary: Awaited<ReturnType<typeof listDreamCandidates>>["summary"];
    blockedCount: number;
    approvedCount: number;
    proposalArtifactCount: number;
  };
  nextRecommendedActions: string[];
  helperCommands: string[];
}> {
  const queue = await listDreamCandidates(runtime);
  const latestProposalCandidate = getLatestDreamProposalCandidate(queue.entries);
  const latestProposalArtifact =
    latestProposalCandidate !== null
      ? await readInstructionProposalArtifact(runtime, latestProposalCandidate.candidateId).catch(() => null)
      : null;
  const latestProposalReadinessStatus =
    latestProposalCandidate?.promotion.applyReadinessStatus ??
    latestProposalArtifact?.applyReadiness.status;
  const reviewerSummary = {
    queueSummary: queue.summary,
    blockedCount: queue.entries.filter((candidate) => candidate.status === "blocked").length,
    approvedCount: queue.entries.filter((candidate) => candidate.status === "approved").length,
    proposalArtifactCount: queue.entries.filter(
      (candidate) => getDreamCandidateProposalArtifactPath(candidate) !== null
    ).length
  };

  const helperCommands = [
    buildResolvedCliCommand("dream candidates --json", {
      cwd: runtime.project.projectRoot
    }),
    buildResolvedCliCommand("memory --recent --json", {
      cwd: runtime.project.projectRoot
    })
  ];

  const nextRecommendedActions =
    !entry
      ? latestProposalCandidate
        ? [
            ...buildInstructionReviewerActions(runtime, latestProposalCandidate, {
              applyReadinessStatus: latestProposalReadinessStatus
            }),
            ...helperCommands
          ]
        : helperCommands
      : entry.status === "blocked"
      ? [
          buildResolvedCliCommand(`dream adopt --candidate-id ${entry.candidateId} --json`, {
            cwd: runtime.project.projectRoot
          }),
          ...helperCommands
        ]
      : (entry.status === "approved" || entry.status === "manual-apply-pending") &&
          entry.targetSurface === "instruction-memory"
        ? buildInstructionReviewerActions(runtime, entry)
      : entry.status === "approved"
          ? [
              buildResolvedCliCommand(`dream promote-prep --candidate-id ${entry.candidateId} --json`, {
                cwd: runtime.project.projectRoot
              }),
              buildResolvedCliCommand(`dream promote --candidate-id ${entry.candidateId} --json`, {
                cwd: runtime.project.projectRoot
              })
            ]
          : entry.status === "pending"
            ? [
                buildResolvedCliCommand(`dream review --candidate-id ${entry.candidateId} --approve --json`, {
                  cwd: runtime.project.projectRoot
                }),
                buildResolvedCliCommand(`dream review --candidate-id ${entry.candidateId} --reject --json`, {
                  cwd: runtime.project.projectRoot
                })
              ]
            : helperCommands;

  return {
    reviewerSummary,
    nextRecommendedActions: nextRecommendedActions.length > 0 ? nextRecommendedActions : helperCommands,
    helperCommands
  };
}

export async function runDream(
  action: DreamAction,
  options: DreamOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd ?? process.cwd(), {}, {
    ensureMemoryLayout: false
  });

  if (action === "inspect") {
    const inspection = await inspectDreamSidecar(runtime);
    const reviewerPayload = await buildDreamReviewerPayload(runtime);
    if (options.json) {
      return JSON.stringify(
        {
          enabled: inspection.enabled,
          autoBuild: inspection.autoBuild,
          snapshots: inspection.snapshots,
          auditPath: inspection.auditPath,
          recoveryPath: inspection.recoveryPath,
          queueSummary: inspection.queueSummary,
          candidateRegistryPath: inspection.candidateRegistryPath,
          candidateAuditPath: inspection.candidateAuditPath,
          candidateRecoveryPath: inspection.candidateRecoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      "Codex Auto Memory Dream Sidecar",
      `Enabled: ${inspection.enabled}`,
      `Auto-build: ${inspection.autoBuild}`,
      `Project snapshot: ${inspection.snapshots.project.status} (${inspection.snapshots.project.latestPath ?? "none"})`,
      `Project-local snapshot: ${inspection.snapshots.projectLocal.status} (${inspection.snapshots.projectLocal.latestPath ?? "none"})`,
      `Candidate queue: ${inspection.queueSummary.totalCount} total`,
      `Audit: ${inspection.auditPath}`,
      `Recovery: ${inspection.recoveryPath}`,
      `Candidate registry: ${inspection.candidateRegistryPath}`,
      `Candidate audit: ${inspection.candidateAuditPath}`
    ].join("\n");
  }

  if (action === "candidates") {
    const candidates = await listDreamCandidates(runtime, {
      ...(normalizeDreamStatus(options.status) ? { status: normalizeDreamStatus(options.status) } : {}),
      ...(normalizeDreamTargetSurface(options.targetSurface)
        ? { targetSurface: normalizeDreamTargetSurface(options.targetSurface) }
        : {}),
      ...(normalizeDreamOriginKind(options.originKind)
        ? { originKind: normalizeDreamOriginKind(options.originKind) }
        : {})
    });
    const reviewerPayload = await buildDreamReviewerPayload(runtime);
    if (options.json) {
      return JSON.stringify(
        {
          action: "candidates",
          entries: candidates.entries,
          summary: candidates.summary,
          registryPath: candidates.registryPath,
          auditPath: candidates.auditPath,
          recoveryPath: candidates.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    if (candidates.entries.length === 0) {
      return [
        "Dream candidate queue",
        "No dream candidates matched the current filters.",
        `Registry: ${candidates.registryPath}`
      ].join("\n");
    }

    return [
      "Dream candidate queue",
      `Entries: ${candidates.entries.length}`,
      ...candidates.entries.map(
        (entry) =>
          `- ${entry.candidateId} [${entry.status}${entry.promotion.promotionOutcome ? ` | ${entry.promotion.promotionOutcome}` : ""}] ${entry.targetSurface}/${entry.originKind}: ${entry.summary}`
      )
    ].join("\n");
  }

  if (action === "review") {
    if (!options.candidateId) {
      throw new Error("Dream review requires --candidate-id.");
    }
    const decisions = [options.approve === true, options.reject === true, options.defer === true].filter(Boolean);
    if (decisions.length !== 1) {
      throw new Error("Dream review requires exactly one of --approve, --reject, or --defer.");
    }

    const result = await reviewDreamCandidate({
      runtime,
      candidateId: options.candidateId,
      decision: options.approve ? "approved" : options.reject ? "rejected" : "pending",
      note: options.note
    });
    const reviewerPayload = await buildDreamReviewerPayload(runtime, result.entry);
    if (options.json) {
      return JSON.stringify(
        {
          action: "review",
          entry: result.entry,
          registryPath: result.registryPath,
          auditPath: result.auditPath,
          recoveryPath: result.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Reviewed dream candidate ${result.entry.candidateId}`,
      `Status: ${result.entry.status}`,
      ...(result.entry.review?.note ? [`Note: ${result.entry.review.note}`] : []),
      `Registry: ${result.registryPath}`
    ].join("\n");
  }

  if (action === "adopt") {
    if (!options.candidateId) {
      throw new Error("Dream adopt requires --candidate-id.");
    }

    const result = await adoptDreamCandidate(runtime, options.candidateId, options.note);
    const reviewerPayload = await buildDreamReviewerPayload(runtime, result.entry);
    if (options.json) {
      return JSON.stringify(
        {
          action: "adopt",
          entry: result.entry,
          registryPath: result.registryPath,
          auditPath: result.auditPath,
          recoveryPath: result.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Adopted dream candidate ${result.entry.candidateId}`,
      `Status: ${result.entry.status}`,
      `Registry: ${result.registryPath}`
    ].join("\n");
  }

  if (action === "proposal") {
    if (!options.candidateId) {
      throw new Error("Dream proposal requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (candidate.entry.targetSurface !== "instruction-memory") {
      throw new Error(`Dream candidate "${options.candidateId}" does not target instruction memory.`);
    }

    const instructionProposal = await readInstructionProposalArtifact(runtime, options.candidateId);
    const reviewerPayload = await buildDreamReviewerPayload(runtime, candidate.entry);
    if (options.json) {
      return JSON.stringify(
        {
          action: "proposal",
          entry: candidate.entry,
          instructionProposal,
          registryPath: candidate.registryPath,
          auditPath: candidate.auditPath,
          recoveryPath: candidate.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Instruction proposal for ${candidate.entry.candidateId}`,
      `Target: ${instructionProposal.selectedTarget.path}`,
      `Readiness: ${instructionProposal.applyReadiness.status}`,
      `Artifact: ${instructionProposal.artifactPath}`
    ].join("\n");
  }

  if (action === "promote-prep") {
    if (!options.candidateId) {
      throw new Error("Dream promote-prep requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (
      candidate.entry.targetSurface === "instruction-memory"
        ? candidate.entry.status !== "approved" && candidate.entry.status !== "manual-apply-pending"
        : candidate.entry.status !== "approved"
    ) {
      throw new Error(`Dream candidate "${options.candidateId}" must be approved before promote-prep.`);
    }

    if (candidate.entry.targetSurface === "instruction-memory") {
      const instructionProposal = await buildInstructionProposal(runtime, candidate.entry, {
        targetFile: options.targetFile,
        targetHost: normalizeInstructionTargetHost(options.targetHost) ?? "shared"
      });
      const preparedEntry = await markDreamCandidatePrepared(runtime, options.candidateId, {
        previewDigest: instructionProposal.artifact.patchPlan?.diffDigestSha256 ?? instructionProposal.patchDigest,
        artifactPath: instructionProposal.artifact.artifactPath,
        applyReadinessStatus: instructionProposal.artifact.applyReadiness.status
      });
      const reviewerPayload = await buildDreamReviewerPayload(runtime, preparedEntry);
      if (options.json) {
        return JSON.stringify(
          {
            action: "promote-prep",
            entry: preparedEntry,
            resolvedTarget: {
              targetSurface: "instruction-memory",
              path: instructionProposal.artifact.selectedTarget.path,
              kind: instructionProposal.artifact.selectedTarget.kind
            },
            preview: instructionProposal.artifact,
            reviewerSummary: reviewerPayload.reviewerSummary,
            nextRecommendedActions: reviewerPayload.nextRecommendedActions,
            helperCommands: reviewerPayload.helperCommands
          },
          null,
          2
        );
      }

      return [
        `Prepared instruction promote preview for ${candidate.entry.candidateId}`,
        `Target: ${instructionProposal.artifact.selectedTarget.path}`,
        instructionProposal.artifact.guidanceBlock
      ].join("\n");
    }

    const scope = options.scope === "project" || options.scope === "project-local"
      ? options.scope
      : candidate.entry.targetScopeHint === "project" || candidate.entry.targetScopeHint === "project-local"
        ? candidate.entry.targetScopeHint
        : "project";
    const topic = options.topic ?? candidate.entry.topicHint;
    const id = options.id ?? candidate.entry.idHint;
    const preview = await runtime.syncService.memoryStore.previewRemember(
      scope,
      topic,
      id,
      candidate.entry.summary,
      candidate.entry.details,
      `Dream promote prep request from ${candidate.entry.candidateId}.`
    );
    if (!preview.record) {
      throw new Error("Dream promote-prep did not produce a preview record.");
    }
    const preparedEntry = await markDreamCandidatePrepared(runtime, options.candidateId, {
      previewDigest: digest(
        JSON.stringify({
          lifecycleAction: preview.record.lifecycleAction,
          wouldWrite: preview.wouldWrite,
          ref: preview.ref,
          targetPath: preview.targetPath
        })
      )
    });
    const reviewerPayload = await buildDreamReviewerPayload(runtime, preparedEntry);

    if (options.json) {
      return JSON.stringify(
        {
          action: "promote-prep",
          entry: preparedEntry,
          resolvedTarget: {
            targetSurface: "durable-memory",
            scope,
            topic,
            id
          },
          preview: {
            lifecycleAction: preview.record.lifecycleAction,
            wouldWrite: preview.wouldWrite,
            ref: preview.ref,
            targetPath: preview.targetPath
          },
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Prepared durable promote preview for ${candidate.entry.candidateId}`,
      `Lifecycle: ${preview.record.lifecycleAction}`,
      `Ref: ${preview.ref}`,
      `Target path: ${preview.targetPath}`
    ].join("\n");
  }

  if (action === "apply-prep") {
    if (!options.candidateId) {
      throw new Error("Dream apply-prep requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (candidate.entry.targetSurface !== "instruction-memory") {
      throw new Error(`Dream candidate "${options.candidateId}" does not target instruction memory.`);
    }
    if (
      candidate.entry.status !== "approved" &&
      candidate.entry.status !== "manual-apply-pending"
    ) {
      throw new Error(
        `Dream candidate "${options.candidateId}" must stay approved or manual-apply-pending before apply-prep.`
      );
    }
    const instructionProposal = await readInstructionProposalArtifact(runtime, options.candidateId);
    const targetPath = instructionProposal.selectedTarget.path;
    const targetExists = await fileExists(targetPath);
    const currentContents = targetExists ? await readTextFile(targetPath) : "";
    const currentDigest = targetExists
      ? digest(currentContents.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
      : null;
    const expectedDigest = instructionProposal.applyReadiness.targetSnapshotDigestSha256 ?? null;
    const isStale = expectedDigest !== currentDigest;
    const applyReadiness = {
      ...instructionProposal.applyReadiness,
      ...(isStale
        ? {
            status: "stale" as const,
            staleReason:
              "The target instruction file changed after the proposal artifact was prepared. Re-run promote-prep or promote before any manual edit.",
            targetSnapshotDigestSha256: currentDigest
          }
        : {})
    };
    const updatedInstructionProposal = {
      ...instructionProposal,
      applyReadiness
    };
    const updatedEntry = await markDreamCandidateApplyPrepared(runtime, options.candidateId, {
      applyReadinessStatus: applyReadiness.status
    });
    const reviewerPayload = await buildDreamReviewerPayload(runtime, updatedEntry);
    await writeJsonFileAtomic(instructionProposal.manualWorkflow.applyPrepPath, {
      action: "apply-prep",
      candidateId: options.candidateId,
      targetPath,
      applyReadiness,
      artifactPath: instructionProposal.artifactPath
    });
    await writeJsonFileAtomic(instructionProposal.artifactPath, updatedInstructionProposal);

    if (options.json) {
      return JSON.stringify(
        {
          action: "apply-prep",
          entry: updatedEntry,
          applyReadiness,
          instructionProposal: updatedInstructionProposal,
          registryPath: candidate.registryPath,
          auditPath: candidate.auditPath,
          recoveryPath: candidate.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Prepared instruction apply preview for ${candidate.entry.candidateId}`,
      `Target: ${targetPath}`,
      `Readiness: ${applyReadiness.status}`
    ].join("\n");
  }

  if (action === "verify-apply") {
    if (!options.candidateId) {
      throw new Error("Dream verify-apply requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (candidate.entry.targetSurface !== "instruction-memory") {
      throw new Error(`Dream candidate "${options.candidateId}" does not target instruction memory.`);
    }
    if (candidate.entry.status !== "manual-apply-pending") {
      throw new Error(
        `Dream candidate "${options.candidateId}" must be manual-apply-pending before verify-apply.`
      );
    }

    const instructionProposal = await readInstructionProposalArtifact(runtime, options.candidateId);
    const targetPath = instructionProposal.selectedTarget.path;
    const targetExists = await fileExists(targetPath);
    if (!targetExists) {
      throw new Error(`Dream verify-apply could not find target file "${targetPath}".`);
    }
    const currentContents = await readTextFile(targetPath);
    const normalizedCurrentContents = currentContents.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const normalizedGuidanceBlock = instructionProposal.guidanceBlock
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!normalizedCurrentContents.includes(normalizedGuidanceBlock)) {
      throw new Error(
        `Dream verify-apply could not confirm that "${targetPath}" contains the current proposal artifact block.`
      );
    }

    const updatedEntry = await markDreamCandidateManualApplied(runtime, options.candidateId, {
      applyReadinessStatus: "safe"
    });
    const reviewerPayload = await buildDreamReviewerPayload(runtime, updatedEntry);
    if (options.json) {
      return JSON.stringify(
        {
          action: "verify-apply",
          entry: updatedEntry,
          instructionProposal,
          registryPath: candidate.registryPath,
          auditPath: candidate.auditPath,
          recoveryPath: candidate.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Verified manual apply for ${updatedEntry.candidateId}`,
      `Target: ${targetPath}`,
      `Status: ${updatedEntry.status}`
    ].join("\n");
  }

  if (action === "promote") {
    if (!options.candidateId) {
      throw new Error("Dream promote requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (candidate.entry.status === "blocked") {
      throw new Error(`Dream candidate "${options.candidateId}" is blocked and cannot be promoted.`);
    }
    if (
      candidate.entry.targetSurface === "instruction-memory"
        ? candidate.entry.status !== "approved" && candidate.entry.status !== "manual-apply-pending"
        : candidate.entry.status !== "approved"
    ) {
      throw new Error(`Dream candidate "${options.candidateId}" must be approved before promote.`);
    }

    if (candidate.entry.targetSurface === "instruction-memory") {
      const instructionProposal = await buildInstructionProposal(runtime, candidate.entry, {
        targetFile: options.targetFile,
        targetHost: normalizeInstructionTargetHost(options.targetHost) ?? "shared"
      });
      const nextEntry = await markDreamCandidatePromoted(runtime, options.candidateId, {
        outcome: "proposal-only",
        proposalArtifactPath: instructionProposal.artifact.artifactPath,
        selectedTargetFile: instructionProposal.artifact.selectedTarget.path,
        selectedTargetKind: instructionProposal.artifact.selectedTarget.kind,
        targetHost: instructionProposal.artifact.targetHost,
        guidanceDigest: instructionProposal.guidanceDigest,
        patchDigest: instructionProposal.patchDigest
      });
      const reviewerPayload = await buildDreamReviewerPayload(runtime, nextEntry);
      if (options.json) {
        return JSON.stringify(
          {
            action: "promote",
            promotionOutcome: "proposal-only",
            entry: nextEntry,
            instructionProposal: instructionProposal.artifact,
            auditPath: candidate.auditPath,
            recoveryPath: candidate.recoveryPath,
            reviewerSummary: reviewerPayload.reviewerSummary,
            nextRecommendedActions: reviewerPayload.nextRecommendedActions,
            helperCommands: reviewerPayload.helperCommands
          },
          null,
          2
        );
      }

      return [
        `Prepared instruction proposal for ${nextEntry.candidateId}`,
        `Suggested target: ${instructionProposal.artifact.selectedTarget.path}`,
        instructionProposal.artifact.guidanceBlock
      ].join("\n");
    }

    const scope = options.scope === "project" || options.scope === "project-local"
      ? options.scope
      : candidate.entry.targetScopeHint === "project" || candidate.entry.targetScopeHint === "project-local"
        ? candidate.entry.targetScopeHint
        : "project";
    const topic = options.topic ?? candidate.entry.topicHint;
    const id = options.id ?? candidate.entry.idHint;
    const record = await runtime.syncService.memoryStore.remember(
      scope,
      topic,
      id,
      candidate.entry.summary,
      candidate.entry.details,
      `Dream promote request from ${candidate.entry.candidateId}.`
    );
    if (!record) {
      throw new Error("Dream promote did not produce a mutation record.");
    }
    const reviewEntry = await buildManualMutationReviewEntry(runtime.syncService.memoryStore, record);
    let nextEntry;
    try {
      nextEntry = await markDreamCandidatePromoted(runtime, options.candidateId, {
        outcome: record.lifecycleAction === "noop" ? "noop" : "applied",
        resultRef: reviewEntry.ref,
        resultAuditPath: reviewEntry.latestAudit?.auditPath
      });
    } catch (error) {
      await recordDreamCandidateRecovery(runtime, {
        recordedAt: new Date().toISOString(),
        candidateId: options.candidateId,
        failedStage: "promotion-bridge",
        failureMessage: error instanceof Error ? error.message : String(error),
        registryPath: candidate.registryPath
      });
      throw error;
    }
    const reviewerPayload = await buildDreamReviewerPayload(runtime, nextEntry);

    if (options.json) {
      return JSON.stringify(
        {
          action: "promote",
          promotionOutcome: record.lifecycleAction === "noop" ? "noop" : "applied",
          entry: nextEntry,
          durableMemory: {
            ref: reviewEntry.ref,
            reviewRefState: reviewEntry.state,
            latestAuditPath: reviewEntry.latestAudit?.auditPath ?? null
          },
          registryPath: candidate.registryPath,
          auditPath: candidate.auditPath,
          recoveryPath: candidate.recoveryPath,
          reviewerSummary: reviewerPayload.reviewerSummary,
          nextRecommendedActions: reviewerPayload.nextRecommendedActions,
          helperCommands: reviewerPayload.helperCommands
        },
        null,
        2
      );
    }

    return [
      `Promoted dream candidate ${nextEntry.candidateId}`,
      `Outcome: ${record.lifecycleAction === "noop" ? "noop" : "applied"}`,
      `Ref: ${reviewEntry.ref}`
    ].join("\n");
  }

  const scope = selectedScope(options.scope);
  const rolloutPath = await resolveRollout(runtime, options.rollout);
  const snapshot = await buildDreamSnapshot({
    runtime,
    rolloutPath
  });
  const persisted = await persistDreamSnapshot({
    runtime,
    snapshot,
    scope
  });
  const inspection = await inspectDreamSidecar(runtime);
  const candidates = await reconcileDreamCandidates(runtime, [
    ...(inspection.projectSnapshot && inspection.snapshots.project.latestPath
      ? [
          {
            snapshot: inspection.projectSnapshot,
            snapshotPath: inspection.snapshots.project.latestPath
          }
        ]
      : []),
    ...(inspection.projectLocalSnapshot && inspection.snapshots.projectLocal.latestPath
      ? [
          {
            snapshot: inspection.projectLocalSnapshot,
            snapshotPath: inspection.snapshots.projectLocal.latestPath
          }
        ]
      : [])
  ]);
  const reviewerPayload = await buildDreamReviewerPayload(runtime);

  if (options.json) {
    return JSON.stringify(
      {
        action: "build",
        enabled: runtime.loadedConfig.config.dreamSidecarEnabled === true,
        autoBuild: runtime.loadedConfig.config.dreamSidecarAutoBuild === true,
        snapshot: persisted.snapshot,
        snapshotPaths: persisted.snapshotPaths,
        auditPath: persisted.auditPath,
        recoveryPath: persisted.recoveryPath,
        queueSummary: candidates.summary,
        candidateRegistryPath: candidates.registryPath,
        candidateAuditPath: candidates.auditPath,
        candidateRecoveryPath: candidates.recoveryPath,
        reviewerSummary: reviewerPayload.reviewerSummary,
        nextRecommendedActions: reviewerPayload.nextRecommendedActions,
        helperCommands: reviewerPayload.helperCommands
      },
      null,
      2
    );
  }

  return [
    `Built dream sidecar snapshot from ${rolloutPath}`,
    `Snapshot paths: ${persisted.snapshotPaths.join(", ")}`,
    `Relevant refs: ${persisted.snapshot.relevantMemoryRefs.length}`,
    `Pending promotions: ${
      persisted.snapshot.promotionCandidates.instructionLikeCandidates.length +
      persisted.snapshot.promotionCandidates.durableMemoryCandidates.length
    }`,
    `Audit: ${persisted.auditPath}`,
    `Candidate queue: ${candidates.summary.totalCount} total`
  ].join("\n");
}
