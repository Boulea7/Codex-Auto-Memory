import type {
  AppConfig,
  ProjectContext,
  SessionContinuityAuditEntry,
  SessionContinuityAuditTrigger,
  SessionContinuityConfidence,
  SessionContinuityDiagnostics,
  SessionContinuityFallbackReason,
  SessionContinuityScope,
  SessionContinuityWriteMode
} from "../types.js";

function describeFallbackReason(reason?: SessionContinuityDiagnostics["fallbackReason"]): string {
  switch (reason) {
    case "codex-command-failed":
      return "codex command failed";
    case "invalid-json":
      return "invalid json";
    case "invalid-structure":
      return "invalid structure";
    case "low-signal":
      return "low signal";
    case "configured-heuristic":
      return "configured heuristic";
    default:
      return "none";
  }
}

function isExtractorPath(value: unknown): value is "codex" | "heuristic" {
  return value === "codex" || value === "heuristic";
}

function isAuditTrigger(value: unknown): value is SessionContinuityAuditTrigger {
  return (
    value === undefined ||
    value === "manual-save" ||
    value === "manual-refresh" ||
    value === "wrapper-auto-save"
  );
}

function isConfidence(value: unknown): value is SessionContinuityConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isWriteMode(value: unknown): value is SessionContinuityWriteMode {
  return value === undefined || value === "merge" || value === "replace";
}

function isFallbackReason(value: unknown): value is SessionContinuityFallbackReason {
  return (
    value === undefined ||
    value === "codex-command-failed" ||
    value === "invalid-json" ||
    value === "invalid-structure" ||
    value === "low-signal" ||
    value === "configured-heuristic"
  );
}

function isEvidenceCounts(
  value: unknown
): value is SessionContinuityAuditEntry["evidenceCounts"] {
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

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function normalizeConfidence(
  confidence: unknown,
  warnings: string[],
  fallbackReason?: SessionContinuityFallbackReason
): SessionContinuityConfidence {
  if (isConfidence(confidence)) {
    return confidence;
  }

  if (fallbackReason) {
    return "low";
  }

  return warnings.length > 0 ? "medium" : "high";
}

export function isSessionContinuityAuditEntry(value: unknown): value is SessionContinuityAuditEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  const warnings = normalizeWarnings(entry.warnings);
  return (
    typeof entry.generatedAt === "string" &&
    typeof entry.projectId === "string" &&
    typeof entry.worktreeId === "string" &&
    isExtractorPath(entry.configuredExtractorMode) &&
    isAuditTrigger(entry.trigger) &&
    isWriteMode(entry.writeMode) &&
    (entry.scope === "project" || entry.scope === "project-local" || entry.scope === "both") &&
    typeof entry.rolloutPath === "string" &&
    typeof entry.sourceSessionId === "string" &&
    isExtractorPath(entry.preferredPath) &&
    isExtractorPath(entry.actualPath) &&
    (entry.confidence === undefined || isConfidence(entry.confidence)) &&
    warnings.length === (Array.isArray(entry.warnings) ? entry.warnings.length : 0) &&
    isFallbackReason(entry.fallbackReason) &&
    (entry.codexExitCode === undefined || typeof entry.codexExitCode === "number") &&
    isEvidenceCounts(entry.evidenceCounts) &&
    Array.isArray(entry.writtenPaths) &&
    entry.writtenPaths.every((item) => typeof item === "string")
  );
}

export function formatSessionContinuityDiagnostics(
  diagnostics: SessionContinuityDiagnostics
): string {
  const parts = [
    `Generation: ${diagnostics.actualPath}`,
    `preferred ${diagnostics.preferredPath}`,
    `confidence ${diagnostics.confidence}`
  ];

  if (diagnostics.fallbackReason) {
    parts.push(`reason ${describeFallbackReason(diagnostics.fallbackReason)}`);
  }

  return parts.join(" | ");
}

function formatEvidenceCounts(entry: SessionContinuityAuditEntry): string {
  const { evidenceCounts } = entry;

  return [
    `successful ${evidenceCounts.successfulCommands}`,
    `failed ${evidenceCounts.failedCommands}`,
    `file writes ${evidenceCounts.fileWrites}`,
    `next steps ${evidenceCounts.nextSteps}`,
    `untried ${evidenceCounts.untried}`
  ].join(" | ");
}

export function formatSessionContinuityAuditDrillDown(
  entry: SessionContinuityAuditEntry
): string[] {
  const warnings = normalizeWarnings(entry.warnings);
  const lines = [
    `Confidence: ${normalizeConfidence(entry.confidence, warnings, entry.fallbackReason)}`,
    `Evidence: ${formatEvidenceCounts(entry)}`
  ];

  if (warnings.length > 0) {
    lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`));
  }

  if (entry.writtenPaths.length === 0) {
    lines.push("Written paths: none");
    return lines;
  }

  lines.push("Written paths:", ...entry.writtenPaths.map((filePath) => `- ${filePath}`));
  return lines;
}

export function toSessionContinuityDiagnostics(
  entry: SessionContinuityAuditEntry
): SessionContinuityDiagnostics {
  const warnings = normalizeWarnings(entry.warnings);
  return {
    generatedAt: entry.generatedAt,
    rolloutPath: entry.rolloutPath,
    sourceSessionId: entry.sourceSessionId,
    preferredPath: entry.preferredPath,
    actualPath: entry.actualPath,
    confidence: normalizeConfidence(entry.confidence, warnings, entry.fallbackReason),
    warnings,
    fallbackReason: entry.fallbackReason,
    codexExitCode: entry.codexExitCode,
    evidenceCounts: entry.evidenceCounts
  };
}

export function normalizeSessionContinuityAuditTrigger(
  trigger?: SessionContinuityAuditTrigger
): SessionContinuityAuditTrigger | "legacy" {
  return trigger ?? "legacy";
}

export function normalizeSessionContinuityWriteMode(
  writeMode?: SessionContinuityWriteMode
): SessionContinuityWriteMode {
  return writeMode === "replace" ? "replace" : "merge";
}

interface BuildSessionContinuityAuditEntryOptions {
  trigger?: SessionContinuityAuditTrigger;
  writeMode?: SessionContinuityWriteMode;
}

export function buildSessionContinuityAuditEntry(
  project: ProjectContext,
  config: AppConfig,
  diagnostics: SessionContinuityDiagnostics,
  writtenPaths: string[],
  scope: SessionContinuityScope | "both",
  options: BuildSessionContinuityAuditEntryOptions = {}
): SessionContinuityAuditEntry {
  return {
    generatedAt: diagnostics.generatedAt,
    projectId: project.projectId,
    worktreeId: project.worktreeId,
    configuredExtractorMode: config.extractorMode,
    trigger: options.trigger ?? "manual-save",
    writeMode: options.writeMode ?? "merge",
    scope,
    rolloutPath: diagnostics.rolloutPath,
    sourceSessionId: diagnostics.sourceSessionId,
    preferredPath: diagnostics.preferredPath,
    actualPath: diagnostics.actualPath,
    confidence: diagnostics.confidence,
    warnings: diagnostics.warnings,
    fallbackReason: diagnostics.fallbackReason,
    codexExitCode: diagnostics.codexExitCode,
    evidenceCounts: diagnostics.evidenceCounts,
    writtenPaths
  };
}
