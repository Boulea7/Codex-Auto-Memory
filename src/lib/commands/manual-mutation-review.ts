import { buildMemoryRef } from "../domain/memory-lifecycle.js";
import type { MemoryStore } from "../domain/memory-store.js";
import {
  buildResolvedCliCommand,
  buildResolvedCliDetailsCommand,
  buildResolvedCliTimelineCommand,
  buildResolvedPostWorkRecentReviewCommand
} from "../integration/retrieval-contract.js";
import type {
  MemoryApplyRecord,
  MemoryOperationRejectionReason,
  ManualMutationForgetPayload,
  ManualMutationPrimaryEntry,
  ManualMutationRememberPayload,
  ManualMutationReviewEntry,
  ManualMutationSummary,
  MemoryScope,
  RolloutReviewerSummary
} from "../types.js";

function resolveReviewState(record: MemoryApplyRecord): "active" | "archived" {
  if (record.nextState === "active" || record.nextState === "archived") {
    return record.nextState;
  }

  if (record.previousState === "archived") {
    return "archived";
  }

  return "active";
}

function buildFallbackPath(
  store: MemoryStore,
  scope: MemoryScope,
  state: "active" | "archived",
  topic: string
): string {
  return state === "active"
    ? store.getTopicFile(scope, topic)
    : store.getArchiveTopicFile(scope, topic);
}

function buildFallbackDetails(
  store: MemoryStore,
  record: MemoryApplyRecord,
  ref: string,
  state: "active" | "archived"
): Promise<ManualMutationReviewEntry> {
  const { operation } = record;
  return store.readTimelineWithDiagnostics(ref).then((timeline) => ({
    ref,
    timelineRef: ref,
    detailsRef: state === "active" ? null : ref,
    scope: operation.scope,
    state,
    topic: operation.topic,
    id: operation.id,
    path: null,
    historyPath: store.getHistoryPath(operation.scope),
    lifecycleAction: record.lifecycleAction,
    latestLifecycleAction:
      timeline.latestEvent && timeline.latestEvent.action !== "noop"
        ? timeline.latestEvent.action
        : null,
    latestAppliedLifecycle: timeline.latestAppliedLifecycle,
    latestLifecycleAttempt: timeline.latestLifecycleAttempt,
    latestState: timeline.lineageSummary.latestState ?? (record.nextState ?? state),
    latestSessionId: timeline.latestAttempt?.sessionId ?? null,
    latestRolloutPath: timeline.latestAttempt?.rolloutPath ?? null,
    latestAudit: timeline.latestAudit,
    timelineWarningCount: timeline.warnings.length,
    lineageSummary: timeline.lineageSummary,
    warnings: [...timeline.warnings],
    entry: {
      id: operation.id,
      scope: operation.scope,
      topic: operation.topic,
      summary: operation.summary ?? operation.id,
      details:
        operation.details?.length && operation.details.length > 0
          ? operation.details
          : [operation.summary ?? operation.id],
      updatedAt: timeline.latestAttempt?.at ?? new Date(0).toISOString(),
      sources: operation.sources ?? [],
      reason: operation.reason
    }
  }));
}

function buildLatestAuditKey(entry: ManualMutationReviewEntry): string | null {
  if (!entry.latestAudit) {
    return null;
  }

  return JSON.stringify({
    auditPath: entry.latestAudit.auditPath,
    appliedAt: entry.latestAudit.appliedAt,
    rolloutPath: entry.latestAudit.rolloutPath,
    sessionId: entry.latestAudit.sessionId ?? null
  });
}

function buildReviewerSummary(entries: ManualMutationReviewEntry[]): RolloutReviewerSummary {
  const uniqueAudits = new Map<string, NonNullable<ManualMutationReviewEntry["latestAudit"]>>();
  const warningsByEntryRef = Object.fromEntries(
    entries
      .filter((entry) => entry.warnings.length > 0)
      .map((entry) => [entry.ref, entry.warnings.length])
  );
  for (const entry of entries) {
    const auditKey = buildLatestAuditKey(entry);
    if (!auditKey || !entry.latestAudit || uniqueAudits.has(auditKey)) {
      continue;
    }

    uniqueAudits.set(auditKey, entry.latestAudit);
  }

  return {
    matchedAuditOperationCount: entries.reduce(
      (total, entry) => total + entry.lineageSummary.matchedAuditOperationCount,
      0
    ),
    noopOperationCount: entries.reduce(
      (total, entry) => total + entry.lineageSummary.refNoopCount,
      0
    ),
    suppressedOperationCount: [...uniqueAudits.values()].reduce(
      (total, audit) => total + audit.suppressedOperationCount,
      0
    ),
    rejectedOperationCount: [...uniqueAudits.values()].reduce(
      (total, audit) => total + audit.rejectedOperationCount,
      0
    ),
    rejectedReasonCounts: [...uniqueAudits.values()].reduce<RolloutReviewerSummary["rejectedReasonCounts"]>(
      (counts, audit) => {
        for (const [reason, count] of Object.entries(audit.rejectedReasonCounts ?? {})) {
          const typedReason = reason as MemoryOperationRejectionReason;
          counts ??= {};
          counts[typedReason] = (counts[typedReason] ?? 0) + count;
        }
        return counts;
      },
      undefined
    ),
    rolloutConflictCount: [...uniqueAudits.values()].reduce(
      (total, audit) => total + audit.conflicts.length,
      0
    ),
    uniqueAuditCount: uniqueAudits.size,
    auditCountsDeduplicated: true,
    warningCount: entries.reduce((total, entry) => total + entry.warnings.length, 0),
    warningsByEntryRef
  };
}

function buildNextRecommendedActions(
  entries: ManualMutationReviewEntry[],
  options: {
    cwd?: string;
  } = {}
): string[] {
  if (entries.length === 0) {
    return [];
  }

  const timelineRefs = entries.map((entry) => entry.timelineRef);
  const detailsRefs = entries.flatMap((entry) => (entry.detailsRef ? [entry.detailsRef] : []));
  const steps = timelineRefs.map(
    (timelineRef) =>
      `Review lifecycle history with ${buildResolvedCliTimelineCommand(
        JSON.stringify(timelineRef),
        options
      )}.`
  );

  if (detailsRefs.length > 0) {
    steps.push(
      ...detailsRefs.map(
        (detailsRef) =>
          `Inspect current memory details with ${buildResolvedCliDetailsCommand(
            JSON.stringify(detailsRef),
            options
          )}.`
      )
    );
  } else {
    steps.push("Details are unavailable for deleted refs; use cam recall timeline to review the deletion trail.");
  }

  steps.push(
    `Run ${buildResolvedPostWorkRecentReviewCommand(options)} after manual corrections to review durable-memory changes.`,
    `Run ${buildResolvedCliCommand("memory reindex", options)} if retrieval sidecars need an explicit rebuild after larger manual edits.`
  );

  return steps;
}

function toPrimaryEntry(entry: ManualMutationReviewEntry): ManualMutationPrimaryEntry {
  return {
    ref: entry.ref,
    timelineRef: entry.timelineRef,
    detailsRef: entry.detailsRef,
    lifecycleAction: entry.lifecycleAction
  };
}

export async function buildManualMutationReviewEntry(
  store: MemoryStore,
  record: MemoryApplyRecord
): Promise<ManualMutationReviewEntry> {
  const { operation } = record;
  const state = resolveReviewState(record);
  const ref = buildMemoryRef(operation.scope, state, operation.topic, operation.id);
  const details = await store.getEntryByRef(ref);
  if (details) {
    return {
      ref,
      timelineRef: details.ref,
      detailsRef: details.ref,
      scope: details.scope,
      state: details.state,
      topic: details.topic,
      id: details.id,
      path: details.path,
      historyPath: details.historyPath,
      lifecycleAction: record.lifecycleAction,
      latestLifecycleAction: details.latestLifecycleAction,
      latestAppliedLifecycle: details.latestAppliedLifecycle,
      latestLifecycleAttempt: details.latestLifecycleAttempt,
      latestState: details.latestState,
      latestSessionId: details.latestLifecycleAttempt?.sessionId ?? details.latestSessionId,
      latestRolloutPath: details.latestLifecycleAttempt?.rolloutPath ?? details.latestRolloutPath,
      latestAudit: details.latestAudit,
      timelineWarningCount: details.timelineWarningCount,
      lineageSummary: details.lineageSummary,
      warnings: [...details.warnings],
      entry: details.entry
    };
  }

  const fallback = await buildFallbackDetails(store, record, ref, state);
  return {
    ...fallback,
    path: buildFallbackPath(store, operation.scope, state, operation.topic)
  };
}

export function toManualMutationRememberPayload(
  text: string,
  entry: ManualMutationReviewEntry,
  options: {
    cwd?: string;
  } = {}
): ManualMutationRememberPayload {
  const reviewerSummary = buildReviewerSummary([entry]);
  const summary: ManualMutationSummary = {
    matchedCount: 1,
    appliedCount: entry.lifecycleAction === "noop" ? 0 : 1,
    noopCount: entry.lifecycleAction === "noop" ? 1 : 0,
    affectedCount: 1
  };

  return {
    action: "remember",
    mutationKind: "remember",
    entryCount: 1,
    warningCount: entry.warnings.length,
    uniqueAuditCount: reviewerSummary.uniqueAuditCount,
    auditCountsDeduplicated: reviewerSummary.auditCountsDeduplicated,
    warningsByEntryRef: reviewerSummary.warningsByEntryRef ?? {},
    leadEntryRef: entry.ref,
    leadEntryIndex: 0,
    detailsAvailable: entry.detailsRef !== null,
    reviewRefState: entry.detailsRef === null ? "active" : entry.latestState === "archived" ? "archived" : "active",
    matchedCount: summary.matchedCount,
    appliedCount: summary.appliedCount,
    noopCount: summary.noopCount,
    affectedCount: summary.affectedCount,
    affectedRefs: [entry.ref],
    summary,
    reviewerSummary,
    primaryEntry: toPrimaryEntry(entry),
    followUp: {
      timelineRefs: [entry.timelineRef],
      detailsRefs: entry.detailsRef ? [entry.detailsRef] : []
    },
    nextRecommendedActions: buildNextRecommendedActions([entry], options),
    entries: [entry],
    text,
    scope: entry.scope,
    topic: entry.topic,
    id: entry.id,
    ref: entry.ref,
    timelineRef: entry.timelineRef,
    detailsRef: entry.detailsRef,
    path: entry.path,
    historyPath: entry.historyPath,
    lifecycleAction: entry.lifecycleAction,
    latestLifecycleAction: entry.latestLifecycleAction,
    latestAppliedLifecycle: entry.latestAppliedLifecycle,
    latestLifecycleAttempt: entry.latestLifecycleAttempt,
    latestState: entry.latestState,
    latestSessionId: entry.latestSessionId,
    latestRolloutPath: entry.latestRolloutPath,
    latestAudit: entry.latestAudit,
    timelineWarningCount: entry.timelineWarningCount,
    lineageSummary: entry.lineageSummary,
    warnings: entry.warnings,
    entry: entry.entry
  };
}

export function formatManualMutationTextFollowUp(
  entries: ManualMutationReviewEntry[],
  options: {
    cwd?: string;
  } = {}
): string[] {
  const steps = buildNextRecommendedActions(entries, options);
  if (steps.length === 0) {
    return [];
  }

  return ["", "Next steps:", ...steps.map((step) => `- ${step}`)];
}

export function toManualMutationForgetPayload(
  query: string,
  scope: MemoryScope | "all",
  archive: boolean,
  entries: ManualMutationReviewEntry[],
  options: {
    cwd?: string;
  } = {}
): ManualMutationForgetPayload {
  const reviewerSummary = buildReviewerSummary(entries);
  const primaryEntry = entries[0] ? toPrimaryEntry(entries[0]) : null;
  const leadEntry = entries[0] ?? null;
  const summary: ManualMutationSummary = {
    matchedCount: entries.length,
    appliedCount: entries.filter((entry) => entry.lifecycleAction !== "noop").length,
    noopCount: entries.filter((entry) => entry.lifecycleAction === "noop").length,
    affectedCount: entries.length
  };

  return {
    action: "forget",
    mutationKind: "forget",
    entryCount: entries.length,
    warningCount: entries.reduce((total, entry) => total + entry.warnings.length, 0),
    uniqueAuditCount: reviewerSummary.uniqueAuditCount,
    auditCountsDeduplicated: reviewerSummary.auditCountsDeduplicated,
    warningsByEntryRef: reviewerSummary.warningsByEntryRef ?? {},
    leadEntryRef: leadEntry?.ref ?? null,
    leadEntryIndex: leadEntry ? 0 : null,
    detailsAvailable: Boolean(leadEntry && leadEntry.detailsRef !== null),
    reviewRefState:
      leadEntry?.detailsRef === null
        ? leadEntry
          ? "active"
          : null
        : leadEntry?.latestState === "archived"
          ? "archived"
          : leadEntry
            ? "active"
            : null,
    detailsUsableEntryCount: entries.filter((entry) => entry.detailsRef !== null).length,
    timelineOnlyEntryCount: entries.filter((entry) => entry.detailsRef === null).length,
    query,
    scope,
    archive,
    matchedCount: summary.matchedCount,
    appliedCount: summary.appliedCount,
    noopCount: summary.noopCount,
    affectedCount: summary.affectedCount,
    affectedRefs: entries.map((entry) => entry.ref),
    summary,
    reviewerSummary,
    primaryEntry,
    followUp: {
      timelineRefs: entries.map((entry) => entry.timelineRef),
      detailsRefs: entries.flatMap((entry) => (entry.detailsRef ? [entry.detailsRef] : []))
    },
    nextRecommendedActions: buildNextRecommendedActions(entries, options),
    entries,
    ref: leadEntry?.ref ?? null,
    timelineRef: leadEntry?.timelineRef ?? null,
    detailsRef: leadEntry?.detailsRef ?? null,
    path: leadEntry?.path ?? null,
    historyPath: leadEntry?.historyPath ?? null,
    lifecycleAction: leadEntry?.lifecycleAction ?? null,
    latestLifecycleAction: leadEntry?.latestLifecycleAction ?? null,
    latestAppliedLifecycle: leadEntry?.latestAppliedLifecycle ?? null,
    latestLifecycleAttempt: leadEntry?.latestLifecycleAttempt ?? null,
    latestState: leadEntry?.latestState ?? null,
    latestSessionId: leadEntry?.latestSessionId ?? null,
    latestRolloutPath: leadEntry?.latestRolloutPath ?? null,
    latestAudit: leadEntry?.latestAudit ?? null,
    timelineWarningCount: leadEntry?.timelineWarningCount ?? 0,
    lineageSummary: leadEntry?.lineageSummary ?? null,
    warnings: leadEntry?.warnings ?? [],
    entry: leadEntry?.entry ?? null
  };
}
