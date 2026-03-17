import type {
  AppConfig,
  MemoryOperation,
  MemoryScope,
  MemorySyncAuditEntry,
  MemorySyncAuditSkipReason,
  MemorySyncAuditStatus,
  ProjectContext
} from "../types.js";

function isMemoryScope(value: unknown): value is MemoryScope {
  return value === "global" || value === "project" || value === "project-local";
}

function isMemorySyncAuditStatus(value: unknown): value is MemorySyncAuditStatus {
  return value === "applied" || value === "no-op" || value === "skipped";
}

function isMemorySyncAuditSkipReason(value: unknown): value is MemorySyncAuditSkipReason {
  return value === undefined || value === "already-processed" || value === "no-rollout-evidence";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMemoryOperation(value: unknown): value is MemoryOperation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const operation = value as Record<string, unknown>;
  return (
    (operation.action === "upsert" || operation.action === "delete") &&
    isMemoryScope(operation.scope) &&
    typeof operation.topic === "string" &&
    typeof operation.id === "string" &&
    (operation.summary === undefined || typeof operation.summary === "string") &&
    (operation.details === undefined || isStringArray(operation.details)) &&
    (operation.sources === undefined || isStringArray(operation.sources)) &&
    (operation.reason === undefined || typeof operation.reason === "string")
  );
}

function summaryForStatus(
  status: MemorySyncAuditStatus,
  appliedCount: number,
  skipReason?: MemorySyncAuditSkipReason
): string {
  switch (status) {
    case "applied":
      return `${appliedCount} operation(s) applied`;
    case "no-op":
      return "0 operations applied";
    case "skipped":
      return skipReason === "already-processed"
        ? "Skipped rollout; it was already processed"
        : "Skipped rollout; no rollout evidence could be parsed";
  }
}

export function isMemorySyncAuditEntry(value: unknown): value is MemorySyncAuditEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.appliedAt === "string" &&
    typeof entry.projectId === "string" &&
    typeof entry.worktreeId === "string" &&
    typeof entry.rolloutPath === "string" &&
    (entry.sessionId === undefined || typeof entry.sessionId === "string") &&
    (entry.extractorMode === "codex" || entry.extractorMode === "heuristic") &&
    typeof entry.extractorName === "string" &&
    typeof entry.sessionSource === "string" &&
    isMemorySyncAuditStatus(entry.status) &&
    isMemorySyncAuditSkipReason(entry.skipReason) &&
    typeof entry.appliedCount === "number" &&
    Array.isArray(entry.scopesTouched) &&
    entry.scopesTouched.every((scope) => isMemoryScope(scope)) &&
    typeof entry.resultSummary === "string" &&
    Array.isArray(entry.operations) &&
    entry.operations.every((operation) => isMemoryOperation(operation))
  );
}

interface BuildMemorySyncAuditEntryOptions {
  project: ProjectContext;
  config: AppConfig;
  rolloutPath: string;
  extractorName: string;
  sessionSource: string;
  status: MemorySyncAuditStatus;
  appliedAt?: string;
  sessionId?: string;
  skipReason?: MemorySyncAuditSkipReason;
  operations?: MemoryOperation[];
}

export function buildMemorySyncAuditEntry(
  options: BuildMemorySyncAuditEntryOptions
): MemorySyncAuditEntry {
  const operations = options.operations ?? [];
  const scopesTouched = Array.from(new Set(operations.map((operation) => operation.scope)));
  const appliedCount = operations.length;

  return {
    appliedAt: options.appliedAt ?? new Date().toISOString(),
    projectId: options.project.projectId,
    worktreeId: options.project.worktreeId,
    rolloutPath: options.rolloutPath,
    sessionId: options.sessionId,
    extractorMode: options.config.extractorMode,
    extractorName: options.extractorName,
    sessionSource: options.sessionSource,
    status: options.status,
    skipReason: options.status === "skipped" ? options.skipReason : undefined,
    appliedCount,
    scopesTouched,
    resultSummary: summaryForStatus(options.status, appliedCount, options.skipReason),
    operations
  };
}

export function formatMemorySyncAuditEntry(entry: MemorySyncAuditEntry): string[] {
  const lines = [
    `- ${entry.appliedAt}: [${entry.status}] ${entry.resultSummary}`,
    `  Session: ${entry.sessionId ?? "unknown"} | Extractor: ${entry.extractorName || entry.extractorMode}`,
    `  Applied: ${entry.appliedCount} | Scopes: ${entry.scopesTouched.length ? entry.scopesTouched.join(", ") : "none"}`
  ];

  if (entry.skipReason) {
    lines.push(`  Skip reason: ${entry.skipReason}`);
  }

  lines.push(`  Rollout: ${entry.rolloutPath}`);
  return lines;
}
