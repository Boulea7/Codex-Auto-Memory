import {
  findLatestProjectRollout,
  parseRolloutEvidence
} from "../domain/rollout.js";
import { openPath } from "../util/open.js";
import {
  buildSessionContinuityAuditEntry,
  formatSessionContinuityAuditDrillDown,
  formatSessionContinuityDiagnostics,
  normalizeContinuityRecoveryRecord,
  normalizeSessionContinuityAuditTrigger,
  normalizeSessionContinuityWriteMode,
  toSessionContinuityDiagnostics
} from "../domain/session-continuity-diagnostics.js";
import {
  buildContinuityRecoveryRecord,
  matchesContinuityRecoveryRecord
} from "../domain/recovery-records.js";
import { buildCompactHistoryPreview } from "../domain/reviewer-history.js";
import {
  compileSessionContinuity,
  createEmptySessionContinuityState
} from "../domain/session-continuity.js";
import type {
  ContinuityRecoveryRecord,
  SessionContinuityAuditTrigger,
  SessionContinuityAuditEntry,
  SessionContinuityScope,
  SessionContinuityWriteMode
} from "../types.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";
import { buildRuntimeContext } from "./common.js";

type SessionAction = "status" | "save" | "refresh" | "load" | "clear" | "open";
type SessionRuntime = Awaited<ReturnType<typeof buildRuntimeContext>>;
type RolloutSelectionKind =
  | "explicit-rollout"
  | "pending-recovery-marker"
  | "latest-audit-entry"
  | "latest-primary-rollout";

interface RolloutSelection {
  kind: RolloutSelectionKind;
  rolloutPath: string;
}

interface SessionOptions {
  cwd?: string;
  json?: boolean;
  printStartup?: boolean;
  rollout?: string;
  scope?: SessionContinuityScope | "both";
}

const recentContinuityAuditLimit = 5;
const recentContinuityPreviewReadLimit = 10;
const recentContinuityPreviewGroupLimit = 3;

interface PersistSessionContinuityOptions {
  runtime: SessionRuntime;
  rolloutPath: string;
  scope: SessionContinuityScope | "both";
  trigger: SessionContinuityAuditTrigger;
  writeMode: SessionContinuityWriteMode;
}

interface PersistSessionContinuityResult {
  rolloutPath: string;
  written: string[];
  excludePath: string | null;
  summary: Awaited<ReturnType<SessionContinuitySummarizer["summarizeWithDiagnostics"]>>["summary"];
  diagnostics: Awaited<ReturnType<SessionContinuitySummarizer["summarizeWithDiagnostics"]>>["diagnostics"];
  latestContinuityAuditEntry: SessionContinuityAuditEntry | null;
  recentContinuityAuditEntries: SessionContinuityAuditEntry[];
  pendingContinuityRecovery: ContinuityRecoveryRecord | null;
  continuityAuditPath: string;
  continuityRecoveryPath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedScope(scope?: SessionContinuityScope | "both"): SessionContinuityScope | "both" {
  if (!scope) {
    return "both";
  }
  if (scope === "project" || scope === "project-local" || scope === "both") {
    return scope;
  }

  throw new Error("Scope must be one of: project, project-local, both.");
}

function formatRecentGenerationLines(entries: SessionContinuityAuditEntry[]): string[] {
  if (entries.length === 0) {
    return ["- none recorded yet"];
  }

  const preview = buildCompactHistoryPreview(entries, {
    excludeLeadingCount: 1,
    maxGroups: recentContinuityPreviewGroupLimit,
    getSignature: (entry) =>
      JSON.stringify({
        rolloutPath: entry.rolloutPath,
        sourceSessionId: entry.sourceSessionId,
        scope: entry.scope,
        trigger: normalizeSessionContinuityAuditTrigger(entry.trigger),
        writeMode: normalizeSessionContinuityWriteMode(entry.writeMode),
        preferredPath: entry.preferredPath,
        actualPath: entry.actualPath,
        confidence: entry.confidence ?? "high",
        warnings: entry.warnings ?? [],
        fallbackReason: entry.fallbackReason ?? null,
        codexExitCode: entry.codexExitCode ?? null,
        evidenceCounts: {
          successfulCommands: entry.evidenceCounts.successfulCommands,
          failedCommands: entry.evidenceCounts.failedCommands,
          fileWrites: entry.evidenceCounts.fileWrites,
          nextSteps: entry.evidenceCounts.nextSteps,
          untried: entry.evidenceCounts.untried
        },
        writtenPaths: entry.writtenPaths
      })
  });

  if (preview.totalRawCount === 0) {
    return ["- none beyond latest"];
  }

  const lines = preview.groups.flatMap((group) => [
    `- ${group.latest.generatedAt}: ${formatSessionContinuityDiagnostics(toSessionContinuityDiagnostics(group.latest))}`,
    `  Rollout: ${group.latest.rolloutPath}`,
    ...(group.rawCount > 1
      ? [`  Repeated similar generations hidden: ${group.rawCount - 1}`]
      : [])
  ]);

  if (preview.omittedRawCount > 0) {
    lines.push(`- older generations omitted: ${preview.omittedRawCount}`);
  }

  return lines.length > 0 ? lines : ["- none beyond latest"];
}

function formatPendingContinuityRecovery(
  record: ContinuityRecoveryRecord,
  recoveryPath: string
): string[] {
  const normalized = normalizeContinuityRecoveryRecord(record);
  const warnings = normalized.warnings ?? [];
  const lines = [
    "Pending continuity recovery:",
    `- Recovery file: ${recoveryPath}`,
    `- Failed stage: ${normalized.failedStage}`,
    `- Rollout: ${normalized.rolloutPath}`,
    ...(normalized.trigger ? [`- Trigger: ${normalized.trigger}`] : []),
    ...(normalized.writeMode ? [`- Write mode: ${normalized.writeMode}`] : []),
    `- Scope: ${normalized.scope}`,
    `- Generation: ${normalized.actualPath} | preferred ${normalized.preferredPath}${normalized.confidence ? ` | confidence ${normalized.confidence}` : ""}`,
    `- Failure: ${normalized.failureMessage}`
  ];

  if (warnings.length > 0) {
    lines.push(...warnings.map((warning) => `- Warning: ${warning}`));
  }

  if (normalized.writtenPaths.length > 0) {
    lines.push(...normalized.writtenPaths.map((filePath) => `- Written: ${filePath}`));
  }

  return lines;
}

function existingContinuitySourceFiles(
  ...locations: Array<{ path: string; exists: boolean }>
): string[] {
  return locations.filter((location) => location.exists).map((location) => location.path);
}

async function selectRefreshRollout(
  runtime: SessionRuntime,
  scope: SessionContinuityScope | "both",
  explicitRollout?: string
): Promise<RolloutSelection> {
  if (explicitRollout) {
    return {
      kind: "explicit-rollout",
      rolloutPath: explicitRollout
    };
  }

  const recoveryRecord = await runtime.sessionContinuityStore.readRecoveryRecord();
  if (recoveryRecord?.scope === scope) {
    return {
      kind: "pending-recovery-marker",
      rolloutPath: recoveryRecord.rolloutPath
    };
  }

  const latestAuditEntry =
    await runtime.sessionContinuityStore.readLatestAuditEntryMatchingScope(scope);
  if (latestAuditEntry) {
    return {
      kind: "latest-audit-entry",
      rolloutPath: latestAuditEntry.rolloutPath
    };
  }

  const latestPrimaryRollout = await findLatestProjectRollout(runtime.project);
  if (latestPrimaryRollout) {
    return {
      kind: "latest-primary-rollout",
      rolloutPath: latestPrimaryRollout
    };
  }

  throw new Error("No relevant rollout found for this project.");
}

async function persistSessionContinuity(
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

  const recentContinuityAuditPreviewEntries =
    await options.runtime.sessionContinuityStore.readRecentAuditEntries(
      recentContinuityPreviewReadLimit
    );
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
    recentContinuityAuditEntries: recentContinuityAuditPreviewEntries.slice(
      0,
      recentContinuityAuditLimit
    ),
    pendingContinuityRecovery: pendingContinuityRecoveryRecord
      ? normalizeContinuityRecoveryRecord(pendingContinuityRecoveryRecord)
      : null,
    continuityAuditPath: options.runtime.sessionContinuityStore.paths.auditFile,
    continuityRecoveryPath: options.runtime.sessionContinuityStore.getRecoveryPath()
  };
}

export async function runSession(
  action: SessionAction,
  options: SessionOptions = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await buildRuntimeContext(cwd);
  const scope = selectedScope(options.scope);

  if (action === "save" || action === "refresh") {
    const rolloutSelection =
      action === "refresh"
        ? await selectRefreshRollout(runtime, scope, options.rollout)
        : {
            kind: options.rollout ? "explicit-rollout" : "latest-primary-rollout",
            rolloutPath: options.rollout ?? (await findLatestProjectRollout(runtime.project)) ?? ""
          };
    if (!rolloutSelection.rolloutPath) {
      throw new Error("No relevant rollout found for this project.");
    }

    const persisted = await persistSessionContinuity({
      runtime,
      rolloutPath: rolloutSelection.rolloutPath,
      scope,
      trigger: action === "refresh" ? "manual-refresh" : "manual-save",
      writeMode: action === "refresh" ? "replace" : "merge"
    });

    if (options.json) {
      return JSON.stringify(
        {
          ...(action === "refresh"
            ? {
                action: "refresh",
                writeMode: "replace",
                rolloutSelection
              }
            : {}),
          rolloutPath: persisted.rolloutPath,
          written: persisted.written,
          excludePath: persisted.excludePath,
          summary: persisted.summary,
          diagnostics: persisted.diagnostics,
          latestContinuityAuditEntry: persisted.latestContinuityAuditEntry,
          recentContinuityAuditEntries: persisted.recentContinuityAuditEntries,
          continuityAuditPath: persisted.continuityAuditPath,
          pendingContinuityRecovery: persisted.pendingContinuityRecovery,
          continuityRecoveryPath: persisted.continuityRecoveryPath
        },
        null,
        2
      );
    }

    return [
      action === "refresh"
        ? `Refreshed session continuity from ${persisted.rolloutPath}`
        : `Saved session continuity from ${persisted.rolloutPath}`,
      ...(action === "refresh"
        ? [`Selection: ${rolloutSelection.kind} | write mode: replace`]
        : []),
      formatSessionContinuityDiagnostics(persisted.diagnostics),
      ...(persisted.latestContinuityAuditEntry
        ? formatSessionContinuityAuditDrillDown(persisted.latestContinuityAuditEntry)
        : []),
      ...(persisted.excludePath ? [`Local exclude updated: ${persisted.excludePath}`] : [])
    ].join("\n");
  }

  if (action === "clear") {
    const cleared = await runtime.sessionContinuityStore.clear(scope);
    if (options.json) {
      return JSON.stringify({ cleared }, null, 2);
    }

    return cleared.length > 0
      ? [`Cleared session continuity files:`, ...cleared.map((filePath) => `- ${filePath}`)].join(
          "\n"
        )
      : "No session continuity files were active.";
  }

  if (action === "open") {
    await runtime.sessionContinuityStore.ensureLocalLayout();
    openPath(runtime.sessionContinuityStore.paths.localDir);
    return [
      `Opened local continuity directory: ${runtime.sessionContinuityStore.paths.localDir}`,
      `Shared continuity directory: ${runtime.sessionContinuityStore.paths.sharedDir}`
    ].join("\n");
  }

  const projectLocation = await runtime.sessionContinuityStore.getLocation("project");
  const localLocation = await runtime.sessionContinuityStore.getLocation("project-local");
  const projectState = await runtime.sessionContinuityStore.readState("project");
  const localState = await runtime.sessionContinuityStore.readState("project-local");
  const recentContinuityAuditPreviewEntries =
    await runtime.sessionContinuityStore.readRecentAuditEntries(recentContinuityPreviewReadLimit);
  const recentContinuityAuditEntries = recentContinuityAuditPreviewEntries.slice(
    0,
    recentContinuityAuditLimit
  );
  const latestContinuityAuditEntry = recentContinuityAuditPreviewEntries[0] ?? null;
  const latestContinuityDiagnostics = latestContinuityAuditEntry
    ? toSessionContinuityDiagnostics(latestContinuityAuditEntry)
    : null;
  const mergedState =
    (await runtime.sessionContinuityStore.readMergedState()) ??
    createEmptySessionContinuityState(
      "project-local",
      runtime.project.projectId,
      runtime.project.worktreeId
    );
  const pendingContinuityRecoveryRecord = await runtime.sessionContinuityStore.readRecoveryRecord();
  const pendingContinuityRecovery = pendingContinuityRecoveryRecord
    ? normalizeContinuityRecoveryRecord(pendingContinuityRecoveryRecord)
    : null;
  const startup = compileSessionContinuity(
    mergedState,
    existingContinuitySourceFiles(projectLocation, localLocation),
    runtime.loadedConfig.config.maxSessionContinuityLines
  );

  if (action === "load") {
    if (options.json) {
      return JSON.stringify(
        {
          projectLocation,
          localLocation,
          projectState,
          localState,
          mergedState,
          startup,
          latestContinuityAuditEntry,
          latestContinuityDiagnostics,
          recentContinuityAuditEntries,
          continuityAuditPath: runtime.sessionContinuityStore.paths.auditFile,
          pendingContinuityRecovery,
          continuityRecoveryPath: runtime.sessionContinuityStore.getRecoveryPath()
        },
        null,
        2
      );
    }

    const lines = [
      "Session Continuity",
      `Project continuity: ${projectLocation.exists ? "active" : "missing"} (${projectLocation.path})`,
      `Project-local continuity: ${localLocation.exists ? "active" : "missing"} (${localLocation.path})`,
      `Latest generation: ${latestContinuityDiagnostics ? formatSessionContinuityDiagnostics(latestContinuityDiagnostics) : "none recorded yet"}`,
      ...(latestContinuityAuditEntry ? [`Latest rollout: ${latestContinuityAuditEntry.rolloutPath}`] : []),
      `Continuity audit: ${runtime.sessionContinuityStore.paths.auditFile}`,
      "Merged resume brief combines shared continuity with any project-local overrides.",
      "Recent prior generations below are compact audit previews, not startup-injected history.",
      ...(latestContinuityAuditEntry
        ? formatSessionContinuityAuditDrillDown(latestContinuityAuditEntry)
        : []),
      ...(pendingContinuityRecovery
        ? formatPendingContinuityRecovery(
            pendingContinuityRecovery,
            runtime.sessionContinuityStore.getRecoveryPath()
          )
        : []),
      "Recent prior generations:",
      ...formatRecentGenerationLines(recentContinuityAuditPreviewEntries),
      "",
      "Shared project continuity:",
      `Goal: ${projectState?.goal || "No active goal recorded."}`,
      "",
      "Confirmed working:",
      ...(projectState?.confirmedWorking.length
        ? projectState.confirmedWorking.map((item) => `- ${item}`)
        : ["- Nothing confirmed yet."]),
      "",
      "Tried and failed:",
      ...(projectState?.triedAndFailed.length
        ? projectState.triedAndFailed.map((item) => `- ${item}`)
        : ["- No failed approaches recorded."]),
      "",
      "Not yet tried:",
      ...(projectState?.notYetTried.length
        ? projectState.notYetTried.map((item) => `- ${item}`)
        : ["- No untried approaches recorded."]),
      "",
      "Files / decisions / environment:",
      ...(projectState?.filesDecisionsEnvironment.length
        ? projectState.filesDecisionsEnvironment.map((item) => `- ${item}`)
        : ["- No additional file, decision, or environment notes."]),
      "",
      "Project-local continuity:",
      `Goal: ${localState?.goal || "No active goal recorded."}`,
      "",
      "Confirmed working:",
      ...(localState?.confirmedWorking.length
        ? localState.confirmedWorking.map((item) => `- ${item}`)
        : ["- Nothing confirmed yet."]),
      "",
      "Tried and failed:",
      ...(localState?.triedAndFailed.length
        ? localState.triedAndFailed.map((item) => `- ${item}`)
        : ["- No failed approaches recorded."]),
      "",
      "Incomplete / next:",
      ...(localState?.incompleteNext.length
        ? localState.incompleteNext.map((item) => `- ${item}`)
        : ["- No next step recorded."])
    ];

    lines.push(
      "",
      "Project-local not yet tried:",
      ...(localState?.notYetTried.length
        ? localState.notYetTried.map((item) => `- ${item}`)
        : ["- No untried local approaches recorded."]),
      "",
      "Project-local files / decisions / environment:",
      ...(localState?.filesDecisionsEnvironment.length
        ? localState.filesDecisionsEnvironment.map((item) => `- ${item}`)
        : ["- No additional local file, decision, or environment notes."]),
      "",
      "Effective merged resume brief:",
      `Goal: ${mergedState.goal || "No active goal recorded."}`,
      "Confirmed working:",
      ...(mergedState.confirmedWorking.length > 0
        ? mergedState.confirmedWorking.map((item) => `- ${item}`)
        : ["- Nothing confirmed yet."]),
      "Tried and failed:",
      ...(mergedState.triedAndFailed.length > 0
        ? mergedState.triedAndFailed.map((item) => `- ${item}`)
        : ["- No failed approaches recorded."]),
      "Not yet tried:",
      ...(mergedState.notYetTried.length > 0
        ? mergedState.notYetTried.map((item) => `- ${item}`)
        : ["- No untried approaches recorded."]),
      "Incomplete / next:",
      ...(mergedState.incompleteNext.length > 0
        ? mergedState.incompleteNext.map((item) => `- ${item}`)
        : ["- No next step recorded."]),
      "Files / decisions / environment:",
      ...(mergedState.filesDecisionsEnvironment.length > 0
        ? mergedState.filesDecisionsEnvironment.map((item) => `- ${item}`)
        : ["- No additional file, decision, or environment notes."])
    );

    if (options.printStartup) {
      lines.push("", "Startup continuity:", startup.text.trimEnd());
    }

    return lines.join("\n");
  }

  if (options.json) {
    return JSON.stringify(
      {
        autoLoad: runtime.loadedConfig.config.sessionContinuityAutoLoad,
        autoSave: runtime.loadedConfig.config.sessionContinuityAutoSave,
        localPathStyle: runtime.loadedConfig.config.sessionContinuityLocalPathStyle,
        maxLines: runtime.loadedConfig.config.maxSessionContinuityLines,
        projectLocation,
        localLocation,
        projectState,
        localState,
        mergedState,
        latestContinuityAuditEntry,
        latestContinuityDiagnostics,
        recentContinuityAuditEntries,
        continuityAuditPath: runtime.sessionContinuityStore.paths.auditFile,
        pendingContinuityRecovery,
        continuityRecoveryPath: runtime.sessionContinuityStore.getRecoveryPath()
      },
      null,
      2
    );
  }

  return [
    "Codex Auto Memory Session Continuity",
    `Auto-load: ${runtime.loadedConfig.config.sessionContinuityAutoLoad}`,
    `Auto-save: ${runtime.loadedConfig.config.sessionContinuityAutoSave}`,
    `Local path style: ${runtime.loadedConfig.config.sessionContinuityLocalPathStyle}`,
    `Shared continuity: ${projectLocation.exists ? "active" : "missing"} (${projectLocation.path})`,
    `Project-local continuity: ${localLocation.exists ? "active" : "missing"} (${localLocation.path})`,
    `Latest generation: ${latestContinuityDiagnostics ? formatSessionContinuityDiagnostics(latestContinuityDiagnostics) : "none recorded yet"}`,
    ...(latestContinuityAuditEntry ? [`Latest rollout: ${latestContinuityAuditEntry.rolloutPath}`] : []),
    `Continuity audit: ${runtime.sessionContinuityStore.paths.auditFile}`,
    "Merged resume brief combines shared continuity with any project-local overrides.",
    "Recent prior generations below are compact audit previews, not startup-injected history.",
    ...(latestContinuityAuditEntry
      ? formatSessionContinuityAuditDrillDown(latestContinuityAuditEntry)
      : []),
    ...(pendingContinuityRecovery
      ? formatPendingContinuityRecovery(
          pendingContinuityRecovery,
          runtime.sessionContinuityStore.getRecoveryPath()
        )
      : []),
    "Recent prior generations:",
    ...formatRecentGenerationLines(recentContinuityAuditPreviewEntries),
    "",
    `Shared updated at: ${projectState?.updatedAt ?? "n/a"}`,
    `Project-local updated at: ${localState?.updatedAt ?? "n/a"}`,
    `Merged continuity layers: ${[projectState, localState].filter(Boolean).length}`,
    `Startup continuity line budget: ${runtime.loadedConfig.config.maxSessionContinuityLines}`
  ].join("\n");
}

async function writeContinuityRecoveryRecordBestEffort(
  runtime: SessionRuntime,
  diagnostics: Parameters<typeof buildContinuityRecoveryRecord>[0]["diagnostics"],
  scope: SessionContinuityScope | "both",
  writtenPaths: string[],
  failureMessage: string,
  trigger?: SessionContinuityAuditTrigger,
  writeMode?: SessionContinuityWriteMode
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
  runtime: SessionRuntime,
  diagnostics: Parameters<typeof buildContinuityRecoveryRecord>[0]["diagnostics"],
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
