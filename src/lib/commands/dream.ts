import { buildRuntimeContext } from "../runtime/runtime-context.js";
import {
  buildDreamSnapshot,
  inspectDreamSidecar,
  persistDreamSnapshot
} from "../domain/dream-sidecar.js";
import {
  buildInstructionProposal,
  getDreamCandidate,
  listDreamCandidates,
  markDreamCandidatePromoted,
  recordDreamCandidateRecovery,
  reconcileDreamCandidates,
  reviewDreamCandidate
} from "../domain/dream-candidates.js";
import { findLatestProjectRollout } from "../domain/rollout.js";
import { discoverInstructionFiles } from "../domain/instruction-memory.js";
import { buildManualMutationReviewEntry } from "./manual-mutation-review.js";
import type {
  DreamCandidateOriginKind,
  DreamCandidateStatus,
  DreamCandidateTargetSurface,
  SessionContinuityScope
} from "../types.js";

type DreamAction = "build" | "inspect" | "candidates" | "review" | "promote";

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
}

const dreamCandidateStatuses = [
  "pending",
  "approved",
  "rejected",
  "promoted",
  "stale",
  "blocked"
] as const;

const dreamCandidateTargetSurfaces = ["durable-memory", "instruction-memory"] as const;

const dreamCandidateOriginKinds = ["primary", "subagent"] as const;

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

export async function runDream(
  action: DreamAction,
  options: DreamOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd ?? process.cwd(), {}, {
    ensureMemoryLayout: false
  });

  if (action === "inspect") {
    const inspection = await inspectDreamSidecar(runtime);
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
          candidateRecoveryPath: inspection.candidateRecoveryPath
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
    if (options.json) {
      return JSON.stringify(
        {
          action: "candidates",
          entries: candidates.entries,
          summary: candidates.summary,
          registryPath: candidates.registryPath,
          auditPath: candidates.auditPath,
          recoveryPath: candidates.recoveryPath
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
          `- ${entry.candidateId} [${entry.status}] ${entry.targetSurface}/${entry.originKind}: ${entry.summary}`
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
    if (options.json) {
      return JSON.stringify(
        {
          action: "review",
          entry: result.entry,
          registryPath: result.registryPath,
          auditPath: result.auditPath,
          recoveryPath: result.recoveryPath
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

  if (action === "promote") {
    if (!options.candidateId) {
      throw new Error("Dream promote requires --candidate-id.");
    }

    const candidate = await getDreamCandidate(runtime, options.candidateId);
    if (candidate.entry.status === "blocked") {
      throw new Error(`Dream candidate "${options.candidateId}" is blocked and cannot be promoted.`);
    }
    if (candidate.entry.status !== "approved") {
      throw new Error(`Dream candidate "${options.candidateId}" must be approved before promote.`);
    }

    if (candidate.entry.targetSurface === "instruction-memory") {
      const instructionFiles = await discoverInstructionFiles(runtime.project.projectRoot);
      const instructionProposal = buildInstructionProposal(candidate.entry, instructionFiles);
      const nextEntry = await markDreamCandidatePromoted(runtime, options.candidateId, {
        outcome: "proposal-only"
      });
      if (options.json) {
        return JSON.stringify(
          {
            action: "promote",
            promotionOutcome: "proposal-only",
            entry: nextEntry,
            instructionProposal,
            auditPath: candidate.auditPath,
            recoveryPath: candidate.recoveryPath
          },
          null,
          2
        );
      }

      return [
        `Prepared instruction proposal for ${nextEntry.candidateId}`,
        `Suggested target: ${instructionProposal.suggestedTargetFile ?? "none detected"}`,
        instructionProposal.suggestedBlock
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
          recoveryPath: candidate.recoveryPath
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
  const candidates = await reconcileDreamCandidates(runtime, snapshot, persisted.snapshotPaths);

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
        candidateRecoveryPath: candidates.recoveryPath
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
