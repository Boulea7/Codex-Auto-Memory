import { buildMemoryRef } from "../domain/memory-lifecycle.js";
import type { MemoryStore } from "../domain/memory-store.js";
import type {
  MemoryApplyRecord,
  MemoryDetailsResult,
  MemoryEntry,
  MemoryHistoryRecordState,
  MemoryLifecycleAttempt,
  MemoryLifecycleAction,
  MemoryLineageSummary,
  MemoryScope,
  MemorySyncAuditSummary
} from "../types.js";

export interface ManualMutationReviewEntry {
  ref: string;
  scope: MemoryScope;
  state: "active" | "archived";
  topic: string;
  id: string;
  path: string | null;
  historyPath: string;
  lifecycleAction: MemoryLifecycleAction;
  latestLifecycleAction: Exclude<MemoryLifecycleAction, "noop"> | null;
  latestLifecycleAttempt: MemoryLifecycleAttempt | null;
  latestState: MemoryHistoryRecordState;
  latestSessionId: string | null;
  latestRolloutPath: string | null;
  latestAudit: MemorySyncAuditSummary | null;
  timelineWarningCount: number;
  lineageSummary: MemoryLineageSummary;
  warnings: string[];
  entry: MemoryEntry;
}

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
      scope: details.scope,
      state: details.state,
      topic: details.topic,
      id: details.id,
      path: details.path,
      historyPath: details.historyPath,
      lifecycleAction: record.lifecycleAction,
      latestLifecycleAction: details.latestLifecycleAction,
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
  entry: ManualMutationReviewEntry
): Record<string, unknown> {
  return {
    action: "remember",
    text,
    scope: entry.scope,
    topic: entry.topic,
    id: entry.id,
    ref: entry.ref,
    path: entry.path,
    historyPath: entry.historyPath,
    lifecycleAction: entry.lifecycleAction,
    latestLifecycleAction: entry.latestLifecycleAction,
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

export function toManualMutationForgetPayload(
  query: string,
  scope: MemoryScope | "all",
  archive: boolean,
  entries: ManualMutationReviewEntry[]
): Record<string, unknown> {
  return {
    action: "forget",
    query,
    scope,
    archive,
    affectedCount: entries.length,
    entries
  };
}
