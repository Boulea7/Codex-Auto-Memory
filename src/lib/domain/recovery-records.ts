import type {
  AppConfig,
  ContinuityRecoveryRecord,
  ContinuityRecoveryFailedStage,
  MemoryConflictCandidate,
  MemoryOperationRejectionReason,
  MemoryScope,
  RejectedMemoryOperationSummary,
  SessionContinuityConfidence,
  SessionContinuityAuditTrigger,
  SessionContinuityDiagnostics,
  SessionContinuityEvidenceCounts,
  SessionContinuityFallbackReason,
  SessionContinuityScope,
  SessionContinuityWriteMode,
  SyncRecoveryFailedStage,
  SyncRecoveryRecord
} from "../types.js";

function isMemoryScope(value: unknown): value is MemoryScope {
  return value === "global" || value === "project" || value === "project-local";
}

function isExtractorMode(value: unknown): value is AppConfig["extractorMode"] {
  return value === "codex" || value === "heuristic";
}

function isExtractorPath(value: unknown): value is "codex" | "heuristic" {
  return value === "codex" || value === "heuristic";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isConflictSource(value: unknown): value is MemoryConflictCandidate["source"] {
  return value === "within-rollout" || value === "existing-memory";
}

function isConflictResolution(value: unknown): value is MemoryConflictCandidate["resolution"] {
  return value === "suppressed";
}

function isMemoryConflictCandidate(value: unknown): value is MemoryConflictCandidate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isMemoryScope(candidate.scope) &&
    typeof candidate.topic === "string" &&
    typeof candidate.candidateSummary === "string" &&
    isStringArray(candidate.conflictsWith) &&
    isConflictSource(candidate.source) &&
    isConflictResolution(candidate.resolution)
  );
}

function isMemoryOperationRejectionReason(
  value: unknown
): value is MemoryOperationRejectionReason {
  return (
    value === "unknown-topic" ||
    value === "sensitive" ||
    value === "volatile" ||
    value === "empty-summary" ||
    value === "operation-cap"
  );
}

function isLegacyMemoryOperationRejectionReason(value: unknown): value is "detail-truncated" {
  return value === "detail-truncated";
}

function isRejectedReasonCounts(
  value: unknown
): value is Partial<Record<MemoryOperationRejectionReason, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, count]) =>
      (isMemoryOperationRejectionReason(key) || isLegacyMemoryOperationRejectionReason(key)) &&
      typeof count === "number" &&
      count >= 0
  );
}

function isRejectedMemoryOperationSummary(
  value: unknown
): value is RejectedMemoryOperationSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const summary = value as Record<string, unknown>;
  return (
    (summary.action === "upsert" ||
      summary.action === "delete" ||
      summary.action === "archive") &&
    isMemoryScope(summary.scope) &&
    typeof summary.topic === "string" &&
    typeof summary.id === "string" &&
    (isMemoryOperationRejectionReason(summary.reason) ||
      isLegacyMemoryOperationRejectionReason(summary.reason))
  );
}

function isContinuityTrigger(value: unknown): value is SessionContinuityAuditTrigger {
  return (
    value === undefined ||
    value === "manual-save" ||
    value === "manual-refresh" ||
    value === "wrapper-auto-save"
  );
}

function isWriteMode(value: unknown): value is SessionContinuityWriteMode {
  return value === undefined || value === "merge" || value === "replace";
}

function isContinuityConfidence(value: unknown): value is SessionContinuityConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isEvidenceCounts(value: unknown): value is SessionContinuityEvidenceCounts {
  if (!value || typeof value !== "object") {
    return false;
  }

  const counts = value as Record<string, unknown>;
  return (
    typeof counts.successfulCommands === "number" &&
    typeof counts.failedCommands === "number" &&
    typeof counts.fileWrites === "number" &&
    typeof counts.nextSteps === "number" &&
    typeof counts.untried === "number"
  );
}

function isContinuityFallbackReason(value: unknown): value is SessionContinuityFallbackReason {
  return (
    value === undefined ||
    value === "codex-command-failed" ||
    value === "invalid-json" ||
    value === "invalid-structure" ||
    value === "low-signal" ||
    value === "configured-heuristic"
  );
}

function isSyncRecoveryFailedStage(value: unknown): value is SyncRecoveryFailedStage {
  return value === "audit-write" || value === "processed-state-write";
}

function isContinuityRecoveryFailedStage(
  value: unknown
): value is ContinuityRecoveryFailedStage {
  return value === "summary-write" || value === "audit-write";
}

function isOptionalNonNegativeNumberField(
  record: Record<string, unknown>,
  key: "noopOperationCount" | "suppressedOperationCount" | "rejectedOperationCount"
): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "number" && value >= 0);
}

export function isSyncRecoveryRecord(value: unknown): value is SyncRecoveryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const conflicts = Array.isArray(record.conflicts)
    ? record.conflicts.filter((candidate): candidate is MemoryConflictCandidate =>
        isMemoryConflictCandidate(candidate)
      )
    : [];
  const noopOperationCount =
    typeof record.noopOperationCount === "number" ? record.noopOperationCount : 0;
  const suppressedOperationCount =
    typeof record.suppressedOperationCount === "number" ? record.suppressedOperationCount : 0;
  const rejectedOperationCount =
    typeof record.rejectedOperationCount === "number" ? record.rejectedOperationCount : 0;
  const rejectedOperations = Array.isArray(record.rejectedOperations)
    ? record.rejectedOperations.filter((operation): operation is RejectedMemoryOperationSummary =>
        isRejectedMemoryOperationSummary(operation) &&
        isMemoryOperationRejectionReason(operation.reason)
      )
    : [];
  return (
    typeof record.recordedAt === "string" &&
    typeof record.projectId === "string" &&
    typeof record.worktreeId === "string" &&
    typeof record.rolloutPath === "string" &&
    (record.sessionId === undefined || typeof record.sessionId === "string") &&
    isExtractorMode(record.configuredExtractorMode) &&
    typeof record.configuredExtractorName === "string" &&
    isExtractorMode(record.actualExtractorMode) &&
    typeof record.actualExtractorName === "string" &&
    (record.status === "applied" || record.status === "no-op") &&
    typeof record.appliedCount === "number" &&
    isOptionalNonNegativeNumberField(record, "noopOperationCount") &&
    isOptionalNonNegativeNumberField(record, "suppressedOperationCount") &&
    isOptionalNonNegativeNumberField(record, "rejectedOperationCount") &&
    noopOperationCount >= 0 &&
    suppressedOperationCount >= 0 &&
    rejectedOperationCount >= 0 &&
    (record.rejectedReasonCounts === undefined || isRejectedReasonCounts(record.rejectedReasonCounts)) &&
    rejectedOperations.length === (Array.isArray(record.rejectedOperations) ? record.rejectedOperations.length : 0) &&
    Array.isArray(record.scopesTouched) &&
    record.scopesTouched.every((scope) => isMemoryScope(scope)) &&
    conflicts.length === (Array.isArray(record.conflicts) ? record.conflicts.length : 0) &&
    isSyncRecoveryFailedStage(record.failedStage) &&
    typeof record.failureMessage === "string" &&
    typeof record.auditEntryWritten === "boolean"
  );
}

export function normalizeSyncRecoveryRecord(record: SyncRecoveryRecord): SyncRecoveryRecord {
  return {
    ...record,
    noopOperationCount: record.noopOperationCount ?? 0,
    suppressedOperationCount: record.suppressedOperationCount ?? 0,
    rejectedOperationCount: record.rejectedOperationCount ?? 0,
    rejectedReasonCounts: Object.fromEntries(
      Object.entries(record.rejectedReasonCounts ?? {}).filter(([reason]) =>
        isMemoryOperationRejectionReason(reason)
      )
    ),
    rejectedOperations: record.rejectedOperations ?? [],
    conflicts: record.conflicts ?? []
  };
}

export function isContinuityRecoveryRecord(
  value: unknown
): value is ContinuityRecoveryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.recordedAt === "string" &&
    typeof record.projectId === "string" &&
    typeof record.worktreeId === "string" &&
    typeof record.rolloutPath === "string" &&
    typeof record.sourceSessionId === "string" &&
    isContinuityTrigger(record.trigger) &&
    isWriteMode(record.writeMode) &&
    (record.scope === "project" || record.scope === "project-local" || record.scope === "both") &&
    isStringArray(record.writtenPaths) &&
    isExtractorPath(record.preferredPath) &&
    isExtractorPath(record.actualPath) &&
    (record.confidence === undefined || isContinuityConfidence(record.confidence)) &&
    (record.warnings === undefined || isStringArray(record.warnings)) &&
    isContinuityFallbackReason(record.fallbackReason) &&
    (record.codexExitCode === undefined || typeof record.codexExitCode === "number") &&
    isEvidenceCounts(record.evidenceCounts) &&
    isContinuityRecoveryFailedStage(record.failedStage) &&
    typeof record.failureMessage === "string"
  );
}

interface BuildSyncRecoveryRecordOptions {
  projectId: string;
  worktreeId: string;
  rolloutPath: string;
  sessionId?: string;
  configuredExtractorMode: AppConfig["extractorMode"];
  configuredExtractorName: string;
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
  status: "applied" | "no-op";
  appliedCount: number;
  noopOperationCount?: number;
  suppressedOperationCount?: number;
  rejectedOperationCount?: number;
  rejectedReasonCounts?: Partial<Record<MemoryOperationRejectionReason, number>>;
  rejectedOperations?: RejectedMemoryOperationSummary[];
  scopesTouched: MemoryScope[];
  conflicts?: MemoryConflictCandidate[];
  failedStage: SyncRecoveryFailedStage;
  failureMessage: string;
  auditEntryWritten: boolean;
}

export function buildSyncRecoveryRecord(
  options: BuildSyncRecoveryRecordOptions
): SyncRecoveryRecord {
  return normalizeSyncRecoveryRecord({
    recordedAt: new Date().toISOString(),
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    rolloutPath: options.rolloutPath,
    sessionId: options.sessionId,
    configuredExtractorMode: options.configuredExtractorMode,
    configuredExtractorName: options.configuredExtractorName,
    actualExtractorMode: options.actualExtractorMode,
    actualExtractorName: options.actualExtractorName,
    status: options.status,
    appliedCount: options.appliedCount,
    noopOperationCount: options.noopOperationCount ?? 0,
    suppressedOperationCount: options.suppressedOperationCount ?? 0,
    rejectedOperationCount: options.rejectedOperationCount ?? 0,
    ...(options.rejectedReasonCounts ? { rejectedReasonCounts: options.rejectedReasonCounts } : {}),
    ...(options.rejectedOperations && options.rejectedOperations.length > 0
      ? { rejectedOperations: options.rejectedOperations }
      : {}),
    scopesTouched: options.scopesTouched,
    conflicts: options.conflicts ?? [],
    failedStage: options.failedStage,
    failureMessage: options.failureMessage,
    auditEntryWritten: options.auditEntryWritten
  });
}

// Recovery identity uses 4 fields (projectId, worktreeId, rolloutPath, sessionId) rather than
// the 6-field processed-rollout identity (which also includes sizeBytes and mtimeMs).
// This intentional difference ensures that a modified rollout file (changed size/mtime)
// can still clear its recovery marker, since the logical identity is the same rollout.
export function matchesSyncRecoveryRecord(
  record: SyncRecoveryRecord,
  identity: {
    projectId: string;
    worktreeId: string;
    rolloutPath: string;
    sessionId?: string;
  }
): boolean {
  return (
    record.projectId === identity.projectId &&
    record.worktreeId === identity.worktreeId &&
    record.rolloutPath === identity.rolloutPath &&
    record.sessionId === identity.sessionId
  );
}

interface BuildContinuityRecoveryRecordOptions {
  projectId: string;
  worktreeId: string;
  diagnostics: SessionContinuityDiagnostics;
  trigger?: SessionContinuityAuditTrigger;
  writeMode?: SessionContinuityWriteMode;
  scope: SessionContinuityScope | "both";
  writtenPaths: string[];
  failedStage: ContinuityRecoveryFailedStage;
  failureMessage: string;
}

export function buildContinuityRecoveryRecord(
  options: BuildContinuityRecoveryRecordOptions
): ContinuityRecoveryRecord {
  return {
    recordedAt: new Date().toISOString(),
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    rolloutPath: options.diagnostics.rolloutPath,
    sourceSessionId: options.diagnostics.sourceSessionId,
    provenanceKind: options.diagnostics.provenanceKind,
    trigger: options.trigger,
    writeMode: options.writeMode,
    scope: options.scope,
    writtenPaths: options.writtenPaths,
    preferredPath: options.diagnostics.preferredPath,
    actualPath: options.diagnostics.actualPath,
    confidence: options.diagnostics.confidence,
    warnings: options.diagnostics.warnings,
    fallbackReason: options.diagnostics.fallbackReason,
    codexExitCode: options.diagnostics.codexExitCode,
    evidenceCounts: options.diagnostics.evidenceCounts,
    failedStage: options.failedStage,
    failureMessage: options.failureMessage
  };
}

export function matchesContinuityRecoveryRecord(
  record: ContinuityRecoveryRecord,
  identity: {
    projectId: string;
    worktreeId: string;
    rolloutPath: string;
    sourceSessionId: string;
    scope: SessionContinuityScope | "both";
  }
): boolean {
  return (
    record.projectId === identity.projectId &&
    record.worktreeId === identity.worktreeId &&
    record.rolloutPath === identity.rolloutPath &&
    record.sourceSessionId === identity.sourceSessionId &&
    record.scope === identity.scope
  );
}
