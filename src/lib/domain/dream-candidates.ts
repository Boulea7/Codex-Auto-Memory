import path from "node:path";
import { createHash } from "node:crypto";
import type { RuntimeContext } from "../runtime/runtime-context.js";
import type {
  DreamCandidateAuditAction,
  DreamCandidateAuditEntry,
  DreamCandidateOriginKind,
  DreamCandidateRecord,
  DreamCandidateRecoveryRecord,
  DreamCandidateStatus,
  DreamCandidateTargetSurface,
  DreamPromotionCandidate,
  DreamQueueSummary,
  DreamSidecarSnapshot,
  DreamCandidateRegistry
} from "../types.js";
import { appendJsonl, readJsonFile, writeJsonFileAtomic } from "../util/fs.js";
import { getDefaultMemoryDirectory } from "./project-context.js";
import { slugify } from "../util/text.js";
import { rankInstructionProposalTargets } from "./instruction-memory.js";
import {
  buildInstructionProposalArtifact,
  buildInstructionProposalDigests
} from "./instruction-proposal.js";

interface DreamCandidatePaths {
  reviewDir: string;
  registryFile: string;
  candidateAuditFile: string;
  candidateRecoveryFile: string;
}

interface DreamCandidateFilters {
  status?: DreamCandidateStatus;
  targetSurface?: DreamCandidateTargetSurface;
  originKind?: DreamCandidateOriginKind;
}

interface ReviewDreamCandidateOptions {
  runtime: RuntimeContext;
  candidateId: string;
  decision: "approved" | "rejected" | "pending";
  note?: string;
}

const nonTerminalDreamStatuses: DreamCandidateStatus[] = ["pending", "approved", "blocked"];

function buildDreamCandidatePaths(runtime: RuntimeContext): DreamCandidatePaths {
  const baseDir = runtime.loadedConfig.config.autoMemoryDirectory ?? getDefaultMemoryDirectory();
  const dreamBaseDir = path.join(baseDir, "projects", runtime.project.projectId, "dream");
  const auditDir = path.join(baseDir, "projects", runtime.project.projectId, "audit");

  return {
    reviewDir: path.join(dreamBaseDir, "review"),
    registryFile: path.join(dreamBaseDir, "review", "registry.json"),
    candidateAuditFile: path.join(auditDir, "dream-candidate-log.jsonl"),
    candidateRecoveryFile: path.join(auditDir, "dream-candidate-recovery.json")
  };
}

function buildProposalArtifactPath(paths: DreamCandidatePaths, candidateId: string): string {
  return path.join(paths.reviewDir, "proposals", `${candidateId}.json`);
}

function candidateTargetSurface(
  targetSurface: DreamCandidateTargetSurface,
  originKind: DreamCandidateOriginKind,
  candidate: DreamPromotionCandidate
): string {
  return JSON.stringify({
    targetSurface,
    originKind,
    sourceSection: candidate.sourceSection,
    continuityScopeHint: candidate.continuityScopeHint,
    summary: candidate.summary.trim(),
    details: candidate.details.map((detail) => detail.trim())
  });
}

function inferTopicHint(text: string): string {
  if (
    /(https?:\/\/|runbook|playbook|wiki|dashboard|docs?\b|tracked in|board\b|channel\b)/iu.test(
      text
    )
  ) {
    return "reference";
  }

  if (/(pnpm|npm|bun|yarn|format|style|indent|naming|comment|typescript|prefer|always)/iu.test(text)) {
    return "preferences";
  }

  if (/(architecture|module|api|route|entity|service|controller|schema|markdown-first|canonical)/iu.test(text)) {
    return "architecture";
  }

  if (/(debug|error|fix|fails|failing|timeout|requires|must start)/iu.test(text)) {
    return "debugging";
  }

  return "workflow";
}

function createCandidateRecord(
  snapshot: DreamSidecarSnapshot,
  targetSurface: DreamCandidateTargetSurface,
  candidate: DreamPromotionCandidate,
  snapshotPath: string | null
): DreamCandidateRecord {
  const originKind = snapshot.sourceProvenanceKind ?? "primary";
  const candidateId = createHash("sha256")
    .update(candidateTargetSurface(targetSurface, originKind, candidate))
    .digest("hex")
    .slice(0, 16);
  const observationFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        rolloutPath: snapshot.rolloutPath,
        targetSurface,
        sourceSection: candidate.sourceSection,
        summary: candidate.summary,
        details: candidate.details,
        continuityScopeHint: candidate.continuityScopeHint
      })
    )
    .digest("hex")
    .slice(0, 16);
  const blockedReason =
    originKind === "subagent"
      ? "Subagent-derived candidates stay in the reviewer lane until a primary/manual adoption step."
      : undefined;
  const status: DreamCandidateStatus = originKind === "subagent" ? "blocked" : "pending";

  return {
    candidateId,
    observationFingerprint,
    targetSurface,
    originKind,
    targetScopeHint: candidate.continuityScopeHint,
    topicHint: inferTopicHint(candidate.summary),
    idHint: slugify(candidate.summary),
    status,
    summary: candidate.summary,
    details: [...candidate.details],
    reason: candidate.reason,
    sourceSection: candidate.sourceSection,
    firstSeenAt: snapshot.generatedAt,
    lastSeenAt: snapshot.generatedAt,
    lastSeenRolloutPath: snapshot.rolloutPath,
    lastSeenSnapshotPath: snapshotPath,
    promotion: {
      eligible: originKind !== "subagent",
      eligibleReason:
        originKind === "subagent"
          ? "Subagent candidates require an explicit reviewer adoption step first."
          : "Eligible for explicit review and promote."
    },
    ...(blockedReason ? { blockedReason } : {})
  };
}

function isAdoptedSubagentCandidate(entry: DreamCandidateRecord): boolean {
  return entry.originKind === "subagent" && entry.adoption !== undefined;
}

function isCandidatePromotionEligible(entry: DreamCandidateRecord): boolean {
  if (entry.status === "rejected" || entry.status === "stale" || entry.status === "promoted") {
    return false;
  }

  return entry.originKind !== "subagent" || isAdoptedSubagentCandidate(entry);
}

function mergeCandidateRecord(
  current: DreamCandidateRecord,
  observed: DreamCandidateRecord
): DreamCandidateRecord {
  return {
    ...current,
    observationFingerprint: observed.observationFingerprint,
    targetScopeHint:
      current.targetScopeHint === "unknown" ? observed.targetScopeHint : current.targetScopeHint,
    topicHint: current.topicHint || observed.topicHint,
    idHint: current.idHint || observed.idHint,
    summary: observed.summary,
    details: [...observed.details],
    reason: observed.reason,
    sourceSection: observed.sourceSection,
    lastSeenAt: observed.lastSeenAt,
    lastSeenRolloutPath: observed.lastSeenRolloutPath,
    lastSeenSnapshotPath: observed.lastSeenSnapshotPath
  };
}

function incrementCounter<Key extends string>(
  counts: Partial<Record<Key, number>>,
  key: Key
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildDreamQueueSummary(entries: DreamCandidateRecord[]): DreamQueueSummary {
  const summary: DreamQueueSummary = {
    totalCount: entries.length,
    statusCounts: {},
    surfaceCounts: {},
    originCounts: {}
  };

  for (const entry of entries) {
    incrementCounter(summary.statusCounts, entry.status);
    incrementCounter(summary.surfaceCounts, entry.targetSurface);
    incrementCounter(summary.originCounts, entry.originKind);
  }

  return summary;
}

async function readRegistryOrDefault(
  runtime: RuntimeContext
): Promise<{ paths: DreamCandidatePaths; registry: DreamCandidateRegistry }> {
  const paths = buildDreamCandidatePaths(runtime);
  const registry =
    (await readJsonFile<DreamCandidateRegistry>(paths.registryFile)) ?? {
      version: 1,
      updatedAt: new Date(0).toISOString(),
      entries: []
    };

  return { paths, registry };
}

async function writeCandidateRecoveryRecord(
  paths: DreamCandidatePaths,
  record: DreamCandidateRecoveryRecord
): Promise<void> {
  await writeJsonFileAtomic(paths.candidateRecoveryFile, record);
}

export async function recordDreamCandidateRecovery(
  runtime: RuntimeContext,
  record: DreamCandidateRecoveryRecord
): Promise<void> {
  const paths = buildDreamCandidatePaths(runtime);
  await writeCandidateRecoveryRecord(paths, record);
}

async function appendCandidateAuditEntry(
  paths: DreamCandidatePaths,
  entry: DreamCandidateAuditEntry
): Promise<void> {
  await appendJsonl(paths.candidateAuditFile, entry);
}

function buildAuditEntry(
  action: DreamCandidateAuditAction,
  entry: DreamCandidateRecord,
  note?: string,
  resultRef?: string,
  resultAuditPath?: string
): DreamCandidateAuditEntry {
  return {
    recordedAt: new Date().toISOString(),
    candidateId: entry.candidateId,
    action,
    status: entry.status,
    targetSurface: entry.targetSurface,
    originKind: entry.originKind,
    rolloutPath: entry.lastSeenRolloutPath,
    ...(note ? { note } : {}),
    ...(resultRef ? { resultRef } : {}),
    ...(resultAuditPath ? { resultAuditPath } : {})
  };
}

export async function reconcileDreamCandidates(
  runtime: RuntimeContext,
  snapshot: DreamSidecarSnapshot,
  snapshotPaths: string[] = []
): Promise<{ entries: DreamCandidateRecord[]; summary: DreamQueueSummary; registryPath: string; auditPath: string; recoveryPath: string }> {
  const { paths, registry } = await readRegistryOrDefault(runtime);
  const entryById = new Map(
    registry.entries.map((entry) => [entry.candidateId, entry] as const)
  );
  const observedEntries: DreamCandidateRecord[] = [];
  const staleEntries: DreamCandidateRecord[] = [];
  const observedCandidateIds = new Set<string>();
  const snapshotPath = snapshotPaths[0] ?? null;

  const observe = (
    candidates: DreamPromotionCandidate[],
    targetSurface: DreamCandidateTargetSurface
  ): void => {
    for (const candidate of candidates) {
      const observed = createCandidateRecord(snapshot, targetSurface, candidate, snapshotPath);
      const current = entryById.get(observed.candidateId);
      const next = current ? mergeCandidateRecord(current, observed) : observed;
      entryById.set(observed.candidateId, next);
      observedEntries.push(next);
      observedCandidateIds.add(next.candidateId);
    }
  };

  observe(snapshot.promotionCandidates.durableMemoryCandidates, "durable-memory");
  observe(snapshot.promotionCandidates.instructionLikeCandidates, "instruction-memory");

  for (const current of registry.entries) {
    if (observedCandidateIds.has(current.candidateId)) {
      continue;
    }
    if (!nonTerminalDreamStatuses.includes(current.status)) {
      continue;
    }

    const staleEntry: DreamCandidateRecord = {
      ...current,
      status: "stale",
      promotion: {
        ...current.promotion,
        eligible: false,
        eligibleReason: "The candidate no longer appears in the latest dream snapshot."
      }
    };
    entryById.set(staleEntry.candidateId, staleEntry);
    staleEntries.push(staleEntry);
  }

  const nextRegistry: DreamCandidateRegistry = {
    version: 1,
    updatedAt: snapshot.generatedAt,
    entries: [...entryById.values()].sort((left, right) =>
      left.lastSeenAt === right.lastSeenAt
        ? left.candidateId.localeCompare(right.candidateId)
        : right.lastSeenAt.localeCompare(left.lastSeenAt)
    )
  };

  try {
    await writeJsonFileAtomic(paths.registryFile, nextRegistry);
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: new Date().toISOString(),
      failedStage: "registry-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  try {
    for (const entry of observedEntries) {
      await appendCandidateAuditEntry(paths, buildAuditEntry("observed", entry));
    }
    for (const entry of staleEntries) {
      await appendCandidateAuditEntry(paths, buildAuditEntry("marked-stale", entry));
    }
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: new Date().toISOString(),
      failedStage: "candidate-audit-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  return {
    entries: nextRegistry.entries,
    summary: buildDreamQueueSummary(nextRegistry.entries),
    registryPath: paths.registryFile,
    auditPath: paths.candidateAuditFile,
    recoveryPath: paths.candidateRecoveryFile
  };
}

export async function listDreamCandidates(
  runtime: RuntimeContext,
  filters: DreamCandidateFilters = {}
): Promise<{ entries: DreamCandidateRecord[]; summary: DreamQueueSummary; registryPath: string; auditPath: string; recoveryPath: string }> {
  const { paths, registry } = await readRegistryOrDefault(runtime);
  const entries = registry.entries.filter((entry) => {
    if (filters.status && entry.status !== filters.status) {
      return false;
    }
    if (filters.targetSurface && entry.targetSurface !== filters.targetSurface) {
      return false;
    }
    if (filters.originKind && entry.originKind !== filters.originKind) {
      return false;
    }
    return true;
  });

  return {
    entries,
    summary: buildDreamQueueSummary(entries),
    registryPath: paths.registryFile,
    auditPath: paths.candidateAuditFile,
    recoveryPath: paths.candidateRecoveryFile
  };
}

export async function getDreamCandidate(
  runtime: RuntimeContext,
  candidateId: string
): Promise<{ entry: DreamCandidateRecord; registryPath: string; auditPath: string; recoveryPath: string }> {
  const { paths, registry } = await readRegistryOrDefault(runtime);
  const entry = registry.entries.find((candidate) => candidate.candidateId === candidateId);
  if (!entry) {
    throw new Error(`Dream candidate "${candidateId}" was not found.`);
  }

  return {
    entry,
    registryPath: paths.registryFile,
    auditPath: paths.candidateAuditFile,
    recoveryPath: paths.candidateRecoveryFile
  };
}

export async function reviewDreamCandidate(
  options: ReviewDreamCandidateOptions
): Promise<{ entry: DreamCandidateRecord; registryPath: string; auditPath: string; recoveryPath: string }> {
  const { paths, registry } = await readRegistryOrDefault(options.runtime);
  const currentEntry = registry.entries.find((entry) => entry.candidateId === options.candidateId);
  if (!currentEntry) {
    throw new Error(`Dream candidate "${options.candidateId}" was not found.`);
  }
  if (
    currentEntry.originKind === "subagent" &&
    currentEntry.adoption === undefined &&
    options.decision === "approved"
  ) {
    throw new Error(
      `Dream candidate "${options.candidateId}" comes from a subagent rollout and cannot be approved directly.`
    );
  }

  const nextStatus: DreamCandidateStatus =
    options.decision === "approved"
      ? "approved"
      : options.decision === "rejected"
        ? "rejected"
        : currentEntry.originKind === "subagent" && currentEntry.adoption === undefined
          ? "blocked"
          : "pending";
  const decisionAt = new Date().toISOString();
  const nextEntry: DreamCandidateRecord = {
    ...currentEntry,
    status: nextStatus,
    review: {
      decisionAt,
      decision: options.decision,
      ...(options.note ? { note: options.note } : {})
    }
  };
  const nextRegistry: DreamCandidateRegistry = {
    version: registry.version,
    updatedAt: decisionAt,
    entries: registry.entries.map((entry) =>
      entry.candidateId === nextEntry.candidateId ? nextEntry : entry
    )
  };

  await writeJsonFileAtomic(paths.registryFile, nextRegistry);
  try {
    await appendCandidateAuditEntry(
      paths,
      buildAuditEntry(
        options.decision === "approved"
          ? "review-approved"
          : options.decision === "rejected"
            ? "review-rejected"
            : "review-deferred",
        nextEntry,
        options.note
      )
    );
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: decisionAt,
      candidateId: nextEntry.candidateId,
      failedStage: "candidate-audit-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  return {
    entry: nextEntry,
    registryPath: paths.registryFile,
    auditPath: paths.candidateAuditFile,
    recoveryPath: paths.candidateRecoveryFile
  };
}

export async function adoptDreamCandidate(
  runtime: RuntimeContext,
  candidateId: string,
  note?: string
): Promise<{ entry: DreamCandidateRecord; registryPath: string; auditPath: string; recoveryPath: string }> {
  const { paths, registry } = await readRegistryOrDefault(runtime);
  const currentEntry = registry.entries.find((entry) => entry.candidateId === candidateId);
  if (!currentEntry) {
    throw new Error(`Dream candidate "${candidateId}" was not found.`);
  }
  if (currentEntry.originKind !== "subagent" || currentEntry.status !== "blocked") {
    throw new Error(`Dream candidate "${candidateId}" is not a blocked subagent candidate.`);
  }

  const adoptedAt = new Date().toISOString();
  const nextEntry: DreamCandidateRecord = {
    ...currentEntry,
    status: "pending",
    blockedReason: undefined,
    adoption: {
      adoptedAt,
      adoptionKind: "manual",
      adoptedFromBlockedSubagent: true,
      ...(note ? { note } : {})
    },
    promotion: {
      ...currentEntry.promotion,
      eligible: true,
      eligibleReason: "Adopted into the primary review lane; explicit review is still required."
    }
  };
  const nextRegistry: DreamCandidateRegistry = {
    version: registry.version,
    updatedAt: adoptedAt,
    entries: registry.entries.map((entry) =>
      entry.candidateId === nextEntry.candidateId ? nextEntry : entry
    )
  };

  await writeJsonFileAtomic(paths.registryFile, nextRegistry);
  try {
    await appendCandidateAuditEntry(paths, buildAuditEntry("adopted", nextEntry, note));
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: adoptedAt,
      candidateId: nextEntry.candidateId,
      failedStage: "adoption-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  return {
    entry: nextEntry,
    registryPath: paths.registryFile,
    auditPath: paths.candidateAuditFile,
    recoveryPath: paths.candidateRecoveryFile
  };
}

export async function markDreamCandidatePromoted(
  runtime: RuntimeContext,
  candidateId: string,
  options: {
    outcome: "applied" | "noop" | "proposal-only";
    resultRef?: string;
    resultAuditPath?: string;
    proposalArtifactPath?: string;
    selectedTargetFile?: string;
    selectedTargetKind?: DreamCandidateRecord["promotion"]["selectedTargetKind"];
    guidanceDigest?: string;
    patchDigest?: string;
  }
): Promise<DreamCandidateRecord> {
  const { paths, registry } = await readRegistryOrDefault(runtime);
  const currentEntry = registry.entries.find((entry) => entry.candidateId === candidateId);
  if (!currentEntry) {
    throw new Error(`Dream candidate "${candidateId}" was not found.`);
  }

  const promotedAt = new Date().toISOString();
  const nextEntry: DreamCandidateRecord = {
    ...currentEntry,
    ...(options.outcome === "proposal-only" ? {} : { status: "promoted" as const }),
    promotion: {
      ...currentEntry.promotion,
      promotedAt,
      promotionOutcome: options.outcome,
      ...(options.resultRef ? { resultRef: options.resultRef } : {}),
      ...(options.resultAuditPath ? { resultAuditPath: options.resultAuditPath } : {}),
      ...(options.proposalArtifactPath ? { proposalArtifactPath: options.proposalArtifactPath } : {}),
      ...(options.selectedTargetFile ? { selectedTargetFile: options.selectedTargetFile } : {}),
      ...(options.selectedTargetKind ? { selectedTargetKind: options.selectedTargetKind } : {}),
      ...(options.guidanceDigest ? { guidanceDigest: options.guidanceDigest } : {}),
      ...(options.patchDigest ? { patchDigest: options.patchDigest } : {})
    }
  };
  const nextRegistry: DreamCandidateRegistry = {
    version: registry.version,
    updatedAt: promotedAt,
    entries: registry.entries.map((entry) =>
      entry.candidateId === nextEntry.candidateId ? nextEntry : entry
    )
  };
  await writeJsonFileAtomic(paths.registryFile, nextRegistry);
  try {
    await appendCandidateAuditEntry(
      paths,
      buildAuditEntry(
        options.outcome === "applied"
          ? "promotion-applied"
          : options.outcome === "noop"
            ? "promotion-noop"
            : "promotion-proposal-only",
        nextEntry,
        undefined,
        options.resultRef,
        options.resultAuditPath
      )
    );
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: promotedAt,
      candidateId: nextEntry.candidateId,
      failedStage: "candidate-audit-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  return nextEntry;
}

export async function buildInstructionProposal(
  runtime: RuntimeContext,
  entry: DreamCandidateRecord
) {
  const paths = buildDreamCandidatePaths(runtime);
  const artifactPath = buildProposalArtifactPath(paths, entry.candidateId);
  const rankedTargets = await rankInstructionProposalTargets(runtime.project.projectRoot);
  const artifact = buildInstructionProposalArtifact(entry, rankedTargets, artifactPath);

  try {
    await writeJsonFileAtomic(artifactPath, artifact);
  } catch (error) {
    await writeCandidateRecoveryRecord(paths, {
      recordedAt: new Date().toISOString(),
      candidateId: entry.candidateId,
      failedStage: "proposal-artifact-write",
      failureMessage: error instanceof Error ? error.message : String(error),
      registryPath: paths.registryFile
    });
    throw error;
  }

  return {
    artifact,
    ...buildInstructionProposalDigests(artifact)
  };
}
