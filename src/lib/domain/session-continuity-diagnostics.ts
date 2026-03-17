import type {
  AppConfig,
  ProjectContext,
  SessionContinuityAuditEntry,
  SessionContinuityDiagnostics,
  SessionContinuityFallbackReason,
  SessionContinuityScope
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

export function isSessionContinuityAuditEntry(value: unknown): value is SessionContinuityAuditEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.generatedAt === "string" &&
    typeof entry.projectId === "string" &&
    typeof entry.worktreeId === "string" &&
    isExtractorPath(entry.configuredExtractorMode) &&
    (entry.scope === "project" || entry.scope === "project-local" || entry.scope === "both") &&
    typeof entry.rolloutPath === "string" &&
    typeof entry.sourceSessionId === "string" &&
    isExtractorPath(entry.preferredPath) &&
    isExtractorPath(entry.actualPath) &&
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
    `preferred ${diagnostics.preferredPath}`
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
  const lines = [`Evidence: ${formatEvidenceCounts(entry)}`];

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
  return {
    generatedAt: entry.generatedAt,
    rolloutPath: entry.rolloutPath,
    sourceSessionId: entry.sourceSessionId,
    preferredPath: entry.preferredPath,
    actualPath: entry.actualPath,
    fallbackReason: entry.fallbackReason,
    codexExitCode: entry.codexExitCode,
    evidenceCounts: entry.evidenceCounts
  };
}

export function buildSessionContinuityAuditEntry(
  project: ProjectContext,
  config: AppConfig,
  diagnostics: SessionContinuityDiagnostics,
  writtenPaths: string[],
  scope: SessionContinuityScope | "both"
): SessionContinuityAuditEntry {
  return {
    generatedAt: diagnostics.generatedAt,
    projectId: project.projectId,
    worktreeId: project.worktreeId,
    configuredExtractorMode: config.extractorMode,
    scope,
    rolloutPath: diagnostics.rolloutPath,
    sourceSessionId: diagnostics.sourceSessionId,
    preferredPath: diagnostics.preferredPath,
    actualPath: diagnostics.actualPath,
    fallbackReason: diagnostics.fallbackReason,
    codexExitCode: diagnostics.codexExitCode,
    evidenceCounts: diagnostics.evidenceCounts,
    writtenPaths
  };
}
