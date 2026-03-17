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

function isExtractorMode(value: unknown): value is AppConfig["extractorMode"] {
  return value === "codex" || value === "heuristic";
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

export function parseMemorySyncAuditEntry(value: unknown): MemorySyncAuditEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const actualExtractorMode = entry.actualExtractorMode ?? entry.extractorMode;
  const actualExtractorName = entry.actualExtractorName ?? entry.extractorName;
  const configuredExtractorMode = entry.configuredExtractorMode ?? actualExtractorMode;
  const configuredExtractorName = entry.configuredExtractorName ?? actualExtractorName;

  if (
    typeof entry.appliedAt !== "string" ||
    typeof entry.projectId !== "string" ||
    typeof entry.worktreeId !== "string" ||
    typeof entry.rolloutPath !== "string" ||
    (entry.sessionId !== undefined && typeof entry.sessionId !== "string") ||
    !isExtractorMode(actualExtractorMode) ||
    typeof actualExtractorName !== "string" ||
    !isExtractorMode(configuredExtractorMode) ||
    typeof configuredExtractorName !== "string" ||
    typeof entry.sessionSource !== "string" ||
    !isMemorySyncAuditStatus(entry.status) ||
    !isMemorySyncAuditSkipReason(entry.skipReason) ||
    typeof entry.appliedCount !== "number" ||
    !Array.isArray(entry.scopesTouched) ||
    !entry.scopesTouched.every((scope) => isMemoryScope(scope)) ||
    typeof entry.resultSummary !== "string" ||
    !Array.isArray(entry.operations) ||
    !entry.operations.every((operation) => isMemoryOperation(operation))
  ) {
    return null;
  }

  return {
    appliedAt: entry.appliedAt,
    projectId: entry.projectId,
    worktreeId: entry.worktreeId,
    rolloutPath: entry.rolloutPath,
    sessionId: entry.sessionId,
    configuredExtractorMode,
    configuredExtractorName,
    actualExtractorMode,
    actualExtractorName,
    extractorMode: actualExtractorMode,
    extractorName: actualExtractorName,
    sessionSource: entry.sessionSource,
    status: entry.status,
    skipReason: entry.status === "skipped" ? entry.skipReason : undefined,
    appliedCount: entry.appliedCount,
    scopesTouched: entry.scopesTouched,
    resultSummary: entry.resultSummary,
    operations: entry.operations
  };
}

export function isMemorySyncAuditEntry(value: unknown): value is MemorySyncAuditEntry {
  return parseMemorySyncAuditEntry(value) !== null;
}

interface BuildMemorySyncAuditEntryOptions {
  project: ProjectContext;
  config: AppConfig;
  rolloutPath: string;
  configuredExtractorName: string;
  actualExtractorMode: AppConfig["extractorMode"];
  actualExtractorName: string;
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
    configuredExtractorMode: options.config.extractorMode,
    configuredExtractorName: options.configuredExtractorName,
    actualExtractorMode: options.actualExtractorMode,
    actualExtractorName: options.actualExtractorName,
    extractorMode: options.actualExtractorMode,
    extractorName: options.actualExtractorName,
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
    `  Session: ${entry.sessionId ?? "unknown"} | Extractor: ${entry.actualExtractorName || entry.actualExtractorMode}`,
    `  Applied: ${entry.appliedCount} | Scopes: ${entry.scopesTouched.length ? entry.scopesTouched.join(", ") : "none"}`
  ];

  if (
    entry.configuredExtractorMode !== entry.actualExtractorMode ||
    entry.configuredExtractorName !== entry.actualExtractorName
  ) {
    lines.push(
      `  Configured: ${entry.configuredExtractorName} (${entry.configuredExtractorMode}) -> Actual: ${entry.actualExtractorName} (${entry.actualExtractorMode})`
    );
  }

  if (entry.skipReason) {
    lines.push(`  Skip reason: ${entry.skipReason}`);
  }

  lines.push(`  Rollout: ${entry.rolloutPath}`);
  return lines;
}
