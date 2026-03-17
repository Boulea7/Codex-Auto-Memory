import type {
  AppConfig,
  ContinuityRecoveryRecord,
  ContinuityRecoveryFailedStage,
  MemoryScope,
  SessionContinuityDiagnostics,
  SessionContinuityEvidenceCounts,
  SessionContinuityFallbackReason,
  SessionContinuityScope,
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
  return value === "audit-write";
}

export function isSyncRecoveryRecord(value: unknown): value is SyncRecoveryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
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
    Array.isArray(record.scopesTouched) &&
    record.scopesTouched.every((scope) => isMemoryScope(scope)) &&
    isSyncRecoveryFailedStage(record.failedStage) &&
    typeof record.failureMessage === "string" &&
    typeof record.auditEntryWritten === "boolean"
  );
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
    (record.scope === "project" || record.scope === "project-local" || record.scope === "both") &&
    isStringArray(record.writtenPaths) &&
    isExtractorPath(record.preferredPath) &&
    isExtractorPath(record.actualPath) &&
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
  scopesTouched: MemoryScope[];
  failedStage: SyncRecoveryFailedStage;
  failureMessage: string;
  auditEntryWritten: boolean;
}

export function buildSyncRecoveryRecord(
  options: BuildSyncRecoveryRecordOptions
): SyncRecoveryRecord {
  return {
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
    scopesTouched: options.scopesTouched,
    failedStage: options.failedStage,
    failureMessage: options.failureMessage,
    auditEntryWritten: options.auditEntryWritten
  };
}

interface BuildContinuityRecoveryRecordOptions {
  projectId: string;
  worktreeId: string;
  diagnostics: SessionContinuityDiagnostics;
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
    scope: options.scope,
    writtenPaths: options.writtenPaths,
    preferredPath: options.diagnostics.preferredPath,
    actualPath: options.diagnostics.actualPath,
    fallbackReason: options.diagnostics.fallbackReason,
    codexExitCode: options.diagnostics.codexExitCode,
    evidenceCounts: options.diagnostics.evidenceCounts,
    failedStage: options.failedStage,
    failureMessage: options.failureMessage
  };
}
