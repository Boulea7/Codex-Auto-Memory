import type {
  AppConfig,
  ProjectContext,
  SessionContinuityAuditEntry,
  SessionContinuityDiagnostics,
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
