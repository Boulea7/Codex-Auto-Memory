import {
  buildSessionContinuityAuditEntry,
  normalizeContinuityRecoveryRecord
} from "./session-continuity-diagnostics.js";
import {
  buildContinuityRecoveryRecord,
  matchesContinuityRecoveryRecord
} from "./recovery-records.js";
import { parseRolloutEvidence } from "./rollout.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";
import type { RuntimeContext } from "../runtime/runtime-context.js";
import type {
  ContinuityRecoveryRecord,
  SessionContinuityAuditEntry,
  SessionContinuityAuditTrigger,
  SessionContinuitySummary,
  SessionContinuityWriteMode,
  SessionContinuityScope,
  SessionContinuityDiagnostics
} from "../types.js";

const defaultRecentContinuityAuditLimit = 5;
const defaultRecentContinuityPreviewReadLimit = 10;

export interface PersistSessionContinuityOptions {
  runtime: RuntimeContext;
  rolloutPath: string;
  scope: SessionContinuityScope | "both";
  trigger: SessionContinuityAuditTrigger;
  writeMode: SessionContinuityWriteMode;
  recentAuditLimit?: number;
  recentAuditPreviewReadLimit?: number;
}

export interface PersistSessionContinuityResult {
  rolloutPath: string;
  written: string[];
  excludePath: string | null;
  summary: SessionContinuitySummary;
  diagnostics: SessionContinuityDiagnostics;
  latestContinuityAuditEntry: SessionContinuityAuditEntry | null;
  recentContinuityAuditEntries: SessionContinuityAuditEntry[];
  pendingContinuityRecovery: ContinuityRecoveryRecord | null;
  continuityAuditPath: string;
  continuityRecoveryPath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeContinuityRecoveryRecordBestEffort(
  runtime: RuntimeContext,
  diagnostics: SessionContinuityDiagnostics,
  scope: SessionContinuityScope | "both",
  writtenPaths: string[],
  failureMessage: string,
  trigger: SessionContinuityAuditTrigger,
  writeMode: SessionContinuityWriteMode
): Promise<void> {
  try {
    await runtime.sessionContinuityStore.writeRecoveryRecord(
      buildContinuityRecoveryRecord({
        projectId: runtime.project.projectId,
        worktreeId: runtime.project.worktreeId,
        diagnostics,
        trigger,
        writeMode,
        scope,
        writtenPaths,
        failedStage: "audit-write",
        failureMessage
      })
    );
  } catch {
    // Best-effort marker persistence should not overwrite the original failure.
  }
}

async function clearContinuityRecoveryRecordBestEffort(
  runtime: RuntimeContext,
  diagnostics: SessionContinuityDiagnostics,
  scope: SessionContinuityScope | "both"
): Promise<void> {
  try {
    const record = await runtime.sessionContinuityStore.readRecoveryRecord();
    if (!record) {
      return;
    }

    if (
      !matchesContinuityRecoveryRecord(record, {
        projectId: runtime.project.projectId,
        worktreeId: runtime.project.worktreeId,
        rolloutPath: diagnostics.rolloutPath,
        sourceSessionId: diagnostics.sourceSessionId,
        scope
      })
    ) {
      return;
    }

    await runtime.sessionContinuityStore.clearRecoveryRecord();
  } catch {
    // Best-effort cleanup should not fail an otherwise successful save.
  }
}

export async function persistSessionContinuity(
  options: PersistSessionContinuityOptions
): Promise<PersistSessionContinuityResult> {
  const parsedEvidence = await parseRolloutEvidence(options.rolloutPath);
  if (!parsedEvidence) {
    throw new Error(`Could not parse rollout evidence from ${options.rolloutPath}.`);
  }

  const existing =
    options.writeMode === "merge"
      ? {
          project: await options.runtime.sessionContinuityStore.readState("project"),
          projectLocal: await options.runtime.sessionContinuityStore.readState("project-local")
        }
      : undefined;

  const summarizer = new SessionContinuitySummarizer(options.runtime.loadedConfig.config);
  const generation = await summarizer.summarizeWithDiagnostics(parsedEvidence, existing);
  const written =
    options.writeMode === "replace"
      ? await options.runtime.sessionContinuityStore.replaceSummary(
          generation.summary,
          options.scope
        )
      : await options.runtime.sessionContinuityStore.saveSummary(
          generation.summary,
          options.scope
        );
  const auditEntry = buildSessionContinuityAuditEntry(
    options.runtime.project,
    options.runtime.loadedConfig.config,
    generation.diagnostics,
    written,
    options.scope,
    {
      trigger: options.trigger,
      writeMode: options.writeMode
    }
  );

  try {
    await options.runtime.sessionContinuityStore.appendAuditLog(auditEntry);
  } catch (error) {
    await writeContinuityRecoveryRecordBestEffort(
      options.runtime,
      generation.diagnostics,
      options.scope,
      written,
      errorMessage(error),
      options.trigger,
      options.writeMode
    );
    throw error;
  }

  await clearContinuityRecoveryRecordBestEffort(
    options.runtime,
    generation.diagnostics,
    options.scope
  );

  const recentAuditPreviewReadLimit =
    options.recentAuditPreviewReadLimit ?? defaultRecentContinuityPreviewReadLimit;
  const recentAuditLimit = options.recentAuditLimit ?? defaultRecentContinuityAuditLimit;
  const recentContinuityAuditPreviewEntries =
    await options.runtime.sessionContinuityStore.readRecentAuditEntries(recentAuditPreviewReadLimit);
  const pendingContinuityRecoveryRecord =
    await options.runtime.sessionContinuityStore.readRecoveryRecord();

  return {
    rolloutPath: options.rolloutPath,
    written,
    excludePath:
      options.scope === "project"
        ? null
        : options.runtime.sessionContinuityStore.getLocalIgnorePath(),
    summary: generation.summary,
    diagnostics: generation.diagnostics,
    latestContinuityAuditEntry: recentContinuityAuditPreviewEntries[0] ?? null,
    recentContinuityAuditEntries: recentContinuityAuditPreviewEntries.slice(0, recentAuditLimit),
    pendingContinuityRecovery: pendingContinuityRecoveryRecord
      ? normalizeContinuityRecoveryRecord(pendingContinuityRecoveryRecord)
      : null,
    continuityAuditPath: options.runtime.sessionContinuityStore.paths.auditFile,
    continuityRecoveryPath: options.runtime.sessionContinuityStore.getRecoveryPath()
  };
}
