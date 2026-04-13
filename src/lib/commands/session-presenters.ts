import { buildCompactHistoryPreview } from "../domain/reviewer-history.js";
import {
  compileSessionContinuity,
  createEmptySessionContinuityState
} from "../domain/session-continuity.js";
import {
  formatSessionContinuityAuditDrillDown,
  formatSessionContinuityDiagnostics,
  normalizeContinuityRecoveryRecord,
  normalizeSessionContinuityAuditTrigger,
  normalizeSessionContinuityWriteMode,
  toSessionContinuityDiagnostics
} from "../domain/session-continuity-diagnostics.js";
import {
  defaultRecentContinuityAuditLimit,
  defaultRecentContinuityPreviewReadLimit
} from "../domain/session-continuity-persistence.js";
import { buildSessionResumeContext } from "../domain/resume-context.js";
import type { PersistSessionContinuityResult } from "../domain/session-continuity-persistence.js";
import type { RuntimeContext } from "../runtime/runtime-context.js";
import type {
  CompiledSessionContinuity,
  ContinuityRecoveryRecord,
  DreamSidecarInspection,
  SessionResumeContext,
  SessionContinuityAuditEntry,
  SessionContinuityDiagnostics,
  SessionContinuityLocation,
  SessionContinuityState,
  SessionContinuityWriteMode
} from "../types.js";

const recentContinuityPreviewGroupLimit = 3;

interface RolloutSelectionSummary {
  kind: string;
}

export interface SessionInspectionView {
  autoLoad: boolean;
  autoSave: boolean;
  localPathStyle: RuntimeContext["loadedConfig"]["config"]["sessionContinuityLocalPathStyle"];
  maxLines: number;
  projectLocation: SessionContinuityLocation;
  localLocation: SessionContinuityLocation;
  projectState: SessionContinuityState | null;
  localState: SessionContinuityState | null;
  mergedState: SessionContinuityState;
  startup: CompiledSessionContinuity;
  latestContinuityAuditEntry: SessionContinuityAuditEntry | null;
  latestContinuityDiagnostics: SessionContinuityDiagnostics | null;
  recentContinuityAuditEntries: SessionContinuityAuditEntry[];
  recentContinuityAuditPreviewEntries: SessionContinuityAuditEntry[];
  continuityAuditPath: string;
  pendingContinuityRecovery: ContinuityRecoveryRecord | null;
  continuityRecoveryPath: string;
  dreamSidecar: DreamSidecarInspection["snapshots"]["project"];
  resumeContext: SessionResumeContext;
}

function existingContinuitySourceFiles(
  ...locations: SessionContinuityLocation[]
): string[] {
  return locations.filter((location) => location.exists).map((location) => location.path);
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

function formatLayerSection(
  title: string,
  state: SessionContinuityState | null,
  nextLabel = "Incomplete / next:"
): string[] {
  return [
    title,
    `Goal: ${state?.goal || "No active goal recorded."}`,
    "",
    "Confirmed working:",
    ...(state?.confirmedWorking.length
      ? state.confirmedWorking.map((item) => `- ${item}`)
      : ["- Nothing confirmed yet."]),
    "",
    "Tried and failed:",
    ...(state?.triedAndFailed.length
      ? state.triedAndFailed.map((item) => `- ${item}`)
      : ["- No failed approaches recorded."]),
    "",
    nextLabel,
    ...(state?.incompleteNext.length
      ? state.incompleteNext.map((item) => `- ${item}`)
      : ["- No next step recorded."])
  ];
}

function buildSessionInspectionPayload(view: SessionInspectionView): Record<string, unknown> {
  return {
    projectLocation: view.projectLocation,
    localLocation: view.localLocation,
    projectState: view.projectState,
    localState: view.localState,
    mergedState: view.mergedState,
    latestContinuityAuditEntry: view.latestContinuityAuditEntry,
    latestContinuityDiagnostics: view.latestContinuityDiagnostics,
    recentContinuityAuditEntries: view.recentContinuityAuditEntries,
    continuityAuditPath: view.continuityAuditPath,
    pendingContinuityRecovery: view.pendingContinuityRecovery,
    continuityRecoveryPath: view.continuityRecoveryPath,
    dreamSidecar: view.dreamSidecar,
    resumeContext: view.resumeContext
  };
}

function buildSessionOverviewLines(
  view: SessionInspectionView,
  headingLines: string[]
): string[] {
  return [
    ...headingLines,
    `Latest generation: ${view.latestContinuityDiagnostics ? formatSessionContinuityDiagnostics(view.latestContinuityDiagnostics) : "none recorded yet"}`,
    ...(view.latestContinuityAuditEntry ? [`Latest rollout: ${view.latestContinuityAuditEntry.rolloutPath}`] : []),
    `Continuity audit: ${view.continuityAuditPath}`,
    "Merged resume brief combines shared continuity with any project-local overrides.",
    "Recent prior generations below are compact audit previews, not startup-injected history.",
    ...(view.latestContinuityAuditEntry
      ? formatSessionContinuityAuditDrillDown(view.latestContinuityAuditEntry)
      : []),
    ...(view.pendingContinuityRecovery
      ? formatPendingContinuityRecovery(
          view.pendingContinuityRecovery,
          view.continuityRecoveryPath
        )
      : []),
    "Recent prior generations:",
    ...formatRecentGenerationLines(view.recentContinuityAuditPreviewEntries)
  ];
}

export async function loadSessionInspectionView(
  runtime: RuntimeContext
): Promise<SessionInspectionView> {
  const projectLocation = await runtime.sessionContinuityStore.getLocation("project");
  const localLocation = await runtime.sessionContinuityStore.getLocation("project-local");
  const projectState = await runtime.sessionContinuityStore.readState("project");
  const localState = await runtime.sessionContinuityStore.readState("project-local");
  const recentContinuityAuditPreviewEntries =
    await runtime.sessionContinuityStore.readRecentAuditEntries(
      defaultRecentContinuityPreviewReadLimit
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
  const pendingContinuityRecoveryRecord =
    await runtime.sessionContinuityStore.readRecoveryRecord();
  const pendingContinuityRecovery = pendingContinuityRecoveryRecord
    ? normalizeContinuityRecoveryRecord(pendingContinuityRecoveryRecord)
    : null;
  const startup = compileSessionContinuity(
    mergedState,
    existingContinuitySourceFiles(projectLocation, localLocation),
    runtime.loadedConfig.config.maxSessionContinuityLines
  );
  const continuitySourceFiles = existingContinuitySourceFiles(projectLocation, localLocation);
  const resumeContext = await buildSessionResumeContext(runtime, {
    mergedState,
    suggestedRefLimit: 5,
    continuitySourceFiles,
    allowDreamAutoBuild: false
  });

  return {
    autoLoad: runtime.loadedConfig.config.sessionContinuityAutoLoad,
    autoSave: runtime.loadedConfig.config.sessionContinuityAutoSave,
    localPathStyle: runtime.loadedConfig.config.sessionContinuityLocalPathStyle,
    maxLines: runtime.loadedConfig.config.maxSessionContinuityLines,
    projectLocation,
    localLocation,
    projectState,
    localState,
    mergedState,
    startup,
    latestContinuityAuditEntry,
    latestContinuityDiagnostics,
    recentContinuityAuditEntries: recentContinuityAuditPreviewEntries.slice(
      0,
      defaultRecentContinuityAuditLimit
    ),
    recentContinuityAuditPreviewEntries,
    continuityAuditPath: runtime.sessionContinuityStore.paths.auditFile,
    pendingContinuityRecovery,
    continuityRecoveryPath: runtime.sessionContinuityStore.getRecoveryPath(),
    dreamSidecar: resumeContext.dreamInspection.snapshots.project,
    resumeContext: resumeContext.resumeContext
  };
}

export function formatPersistedSessionText(
  action: "save" | "refresh",
  persisted: PersistSessionContinuityResult,
  rolloutSelection?: RolloutSelectionSummary
): string {
  return [
    action === "refresh"
      ? `Refreshed session continuity from ${persisted.rolloutPath}`
      : `Saved session continuity from ${persisted.rolloutPath}`,
    ...(action === "refresh" && rolloutSelection
      ? [`Selection: ${rolloutSelection.kind} | write mode: replace`]
      : []),
    formatSessionContinuityDiagnostics(persisted.diagnostics),
    ...(persisted.latestContinuityAuditEntry
      ? formatSessionContinuityAuditDrillDown(persisted.latestContinuityAuditEntry)
      : []),
    ...(persisted.excludePath ? [`Local exclude updated: ${persisted.excludePath}`] : [])
  ].join("\n");
}

export function buildPersistedSessionJson(
  action: "save" | "refresh",
  persisted: PersistSessionContinuityResult,
  rolloutSelection?: RolloutSelectionSummary & { rolloutPath: string }
): string {
  return JSON.stringify(
    {
      ...(rolloutSelection
        ? {
            action,
            writeMode:
              (action === "refresh" ? "replace" : "merge") satisfies SessionContinuityWriteMode,
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

export function buildSessionLoadJson(view: SessionInspectionView): string {
  return JSON.stringify(
    {
      ...buildSessionInspectionPayload(view),
      startup: view.startup,
    },
    null,
    2
  );
}

export function formatSessionLoadText(
  view: SessionInspectionView,
  printStartup = false
): string {
  const lines = [
    ...buildSessionOverviewLines(view, [
      "Session Continuity",
      `Project continuity: ${view.projectLocation.exists ? "active" : "missing"} (${view.projectLocation.path})`,
      `Project-local continuity: ${view.localLocation.exists ? "active" : "missing"} (${view.localLocation.path})`
    ]),
    "",
    "Shared project continuity:",
    `Goal: ${view.projectState?.goal || "No active goal recorded."}`,
    "",
    "Confirmed working:",
    ...(view.projectState?.confirmedWorking.length
      ? view.projectState.confirmedWorking.map((item) => `- ${item}`)
      : ["- Nothing confirmed yet."]),
    "",
    "Tried and failed:",
    ...(view.projectState?.triedAndFailed.length
      ? view.projectState.triedAndFailed.map((item) => `- ${item}`)
      : ["- No failed approaches recorded."]),
    "",
    "Not yet tried:",
    ...(view.projectState?.notYetTried.length
      ? view.projectState.notYetTried.map((item) => `- ${item}`)
      : ["- No untried approaches recorded."]),
    "",
    "Files / decisions / environment:",
    ...(view.projectState?.filesDecisionsEnvironment.length
      ? view.projectState.filesDecisionsEnvironment.map((item) => `- ${item}`)
      : ["- No additional file, decision, or environment notes."]),
    "",
    ...formatLayerSection("Project-local continuity:", view.localState),
    "",
    "Project-local not yet tried:",
    ...(view.localState?.notYetTried.length
      ? view.localState.notYetTried.map((item) => `- ${item}`)
      : ["- No untried local approaches recorded."]),
    "",
    "Project-local files / decisions / environment:",
    ...(view.localState?.filesDecisionsEnvironment.length
      ? view.localState.filesDecisionsEnvironment.map((item) => `- ${item}`)
      : ["- No additional local file, decision, or environment notes."]),
    "",
    "Effective merged resume brief:",
    `Goal: ${view.mergedState.goal || "No active goal recorded."}`,
    "Confirmed working:",
    ...(view.mergedState.confirmedWorking.length > 0
      ? view.mergedState.confirmedWorking.map((item) => `- ${item}`)
      : ["- Nothing confirmed yet."]),
    "Tried and failed:",
    ...(view.mergedState.triedAndFailed.length > 0
      ? view.mergedState.triedAndFailed.map((item) => `- ${item}`)
      : ["- No failed approaches recorded."]),
    "Not yet tried:",
    ...(view.mergedState.notYetTried.length > 0
      ? view.mergedState.notYetTried.map((item) => `- ${item}`)
      : ["- No untried approaches recorded."]),
    "Incomplete / next:",
    ...(view.mergedState.incompleteNext.length > 0
      ? view.mergedState.incompleteNext.map((item) => `- ${item}`)
      : ["- No next step recorded."]),
    "Files / decisions / environment:",
    ...(view.mergedState.filesDecisionsEnvironment.length > 0
      ? view.mergedState.filesDecisionsEnvironment.map((item) => `- ${item}`)
      : ["- No additional file, decision, or environment notes."]),
    "",
    "Resume context:",
    ...(view.resumeContext.instructionFiles.length > 0
      ? ["Instruction files:", ...view.resumeContext.instructionFiles.map((filePath) => `- ${filePath}`)]
      : ["Instruction files:", "- None detected."]),
    ...(view.resumeContext.suggestedDurableRefs.length > 0
      ? [
          "Dream refs:",
          ...view.resumeContext.suggestedDurableRefs.map(
            (ref) => `- ${ref.ref}: ${ref.reason}`
          )
        ]
      : ["Dream refs:", "- None suggested."]),
    ...((view.resumeContext.topDurableRefs ?? []).length > 0
      ? [
          "Top durable refs:",
          ...(view.resumeContext.topDurableRefs ?? []).map(
            (ref) => `- ${ref.ref}: ${ref.reason}`
          )
        ]
      : ["Top durable refs:", "- None suggested."]),
    ...((view.resumeContext.suggestedTeamEntries ?? []).length > 0
      ? [
          "Read-only team memory hints (non-canonical):",
          ...(view.resumeContext.suggestedTeamEntries ?? []).map(
            (entry) => `- ${entry.key}: ${entry.summary}`
          )
        ]
      : ["Read-only team memory hints (non-canonical):", "- None suggested."])
  ];

  if (printStartup) {
    lines.push(
      "",
      "Startup continuity:",
      `- Rendered source files: ${view.startup.sourceFiles.length}/${view.startup.candidateSourceFiles.length}`,
      `- Rendered sections: ${view.startup.continuitySectionKinds.join(", ") || "none"}`,
      `- Startup omissions: ${view.startup.omissions.length}`,
      view.startup.omissions.length > 0
        ? `- Omission counts: ${Object.entries(view.startup.omissionCounts)
            .map(([reason, count]) => `${reason}=${count}`)
            .join(", ")}`
        : "- Omission counts: none",
      view.startup.text.trimEnd()
    );
  }

  return lines.join("\n");
}

export function buildSessionStatusJson(view: SessionInspectionView): string {
  return JSON.stringify(
    {
      autoLoad: view.autoLoad,
      autoSave: view.autoSave,
      localPathStyle: view.localPathStyle,
      maxLines: view.maxLines,
      ...buildSessionInspectionPayload(view),
      startup: view.startup
    },
    null,
    2
  );
}

export function formatSessionStatusText(view: SessionInspectionView): string {
  return [
    ...buildSessionOverviewLines(view, [
      "Codex Auto Memory Session Continuity",
      `Auto-load: ${view.autoLoad}`,
      `Auto-save: ${view.autoSave}`,
      `Local path style: ${view.localPathStyle}`,
      `Shared continuity: ${view.projectLocation.exists ? "active" : "missing"} (${view.projectLocation.path})`,
      `Project-local continuity: ${view.localLocation.exists ? "active" : "missing"} (${view.localLocation.path})`
    ]),
    "",
    `Shared updated at: ${view.projectState?.updatedAt ?? "n/a"}`,
    `Project-local updated at: ${view.localState?.updatedAt ?? "n/a"}`,
    `Merged continuity layers: ${[view.projectState, view.localState].filter(Boolean).length}`,
    `Startup continuity line budget: ${view.maxLines}`
  ].join("\n");
}
