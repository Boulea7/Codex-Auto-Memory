import type {
  MemoryDetailsResult,
  MemorySearchDiagnosticPath,
  MemorySearchDiagnostics,
  MemorySearchExecutionSummary,
  MemoryRetrievalFallbackReason,
  MemoryRetrievalMode,
  MemoryRecordState,
  MemoryRetrievalResolvedState,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
  MemorySearchResultWindow,
  MemorySearchStateResolution,
  MemoryScope,
  MemorySearchResponse,
  MemorySearchResult,
  MemoryTimelineEvent,
  MemoryTimelineResponse
} from "../types.js";

export const DEFAULT_MEMORY_RETRIEVAL_STATE: Extract<MemoryRetrievalStateFilter, "auto"> = "auto";
export const DEFAULT_MEMORY_RETRIEVAL_LIMIT = 8;

export function parseMemoryRetrievalLimit(limit: string | number | undefined): number {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return Math.min(100, Math.max(1, Math.trunc(limit)));
  }

  if (typeof limit === "string") {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(100, Math.max(1, parsed));
    }
  }

  return DEFAULT_MEMORY_RETRIEVAL_LIMIT;
}

export function normalizeMemoryRetrievalScope(
  scope: MemoryRetrievalScope | undefined
): MemoryRetrievalScope {
  if (!scope || scope === "all") {
    return "all";
  }

  if (scope === "global" || scope === "project" || scope === "project-local") {
    return scope;
  }

  throw new Error(`Unsupported recall scope "${scope}".`);
}

export function normalizeMemoryRetrievalState(
  state: MemoryRetrievalStateFilter | undefined
): MemoryRetrievalStateFilter {
  if (!state) {
    return DEFAULT_MEMORY_RETRIEVAL_STATE;
  }

  if (state === "auto") {
    return "auto";
  }

  if (state === "all") {
    return "all";
  }

  if (state === "active" || state === "archived") {
    return state;
  }

  throw new Error(`Unsupported recall state "${state}".`);
}

export function buildMemorySearchResponse(
  query: string,
  scope: MemoryRetrievalScope,
  state: MemoryRetrievalStateFilter,
  resolvedState: MemoryRetrievalResolvedState,
  searchOrder: string[],
  totalMatchedCount: number,
  returnedCount: number,
  globalLimitApplied: boolean,
  truncatedCount: number,
  resultWindow: MemorySearchResultWindow,
  fallbackUsed: boolean,
  retrievalMode: MemoryRetrievalMode,
  retrievalFallbackReason: MemoryRetrievalFallbackReason | undefined,
  stateResolution: MemorySearchStateResolution,
  diagnostics: MemorySearchDiagnostics,
  results: MemorySearchResult[]
): MemorySearchResponse {
  const normalizedDiagnostics = normalizeMemorySearchDiagnostics(
    diagnostics.checkedPaths,
    diagnostics.topicDiagnostics
  );
  return {
    query,
    scope,
    state,
    resolvedState,
    searchOrder: [...searchOrder],
    totalMatchedCount,
    returnedCount,
    globalLimitApplied,
    truncatedCount,
    resultWindow: { ...resultWindow },
    fallbackUsed,
    stateFallbackUsed: fallbackUsed,
    markdownFallbackUsed: normalizedDiagnostics.anyMarkdownFallback,
    finalRetrievalMode: retrievalMode,
    retrievalMode,
    retrievalFallbackReason,
    stateResolution,
    executionSummary: buildMemorySearchExecutionSummary(normalizedDiagnostics),
    diagnostics: normalizedDiagnostics,
    results
  };
}

export function normalizeMemorySearchDiagnostics(
  checkedPaths: MemorySearchDiagnosticPath[],
  topicDiagnostics: MemorySearchDiagnostics["topicDiagnostics"] = []
): MemorySearchDiagnostics {
  const fallbackReasons = Array.from(
    new Set(
      checkedPaths
        .map((check) => check.retrievalFallbackReason)
        .filter((reason): reason is MemoryRetrievalFallbackReason => reason !== undefined)
    )
  );

  return {
    anyMarkdownFallback: checkedPaths.some(
      (check) => check.retrievalMode === "markdown-fallback"
    ),
    fallbackReasons,
    executionModes: Array.from(new Set(checkedPaths.map((check) => check.retrievalMode))),
    checkedPaths,
    ...(topicDiagnostics && topicDiagnostics.length > 0
      ? {
          topicDiagnostics: topicDiagnostics.map((diagnostic) => ({
            ...diagnostic
          }))
        }
      : {})
  };
}

export function buildMemorySearchExecutionSummary(
  diagnostics: MemorySearchDiagnostics
): MemorySearchExecutionSummary {
  const retrievalModes = [...diagnostics.executionModes];
  return {
    mode:
      retrievalModes.length <= 1
        ? retrievalModes[0] === "markdown-fallback"
          ? "markdown-fallback-only"
          : "index-only"
        : "mixed",
    retrievalModes,
    fallbackReasons: [...diagnostics.fallbackReasons]
  };
}

export function buildMemoryTimelineResponse(
  ref: string,
  timeline:
    | MemoryTimelineResponse
    | {
        events: MemoryTimelineEvent[];
        warnings?: string[];
        latestAudit?: MemoryTimelineResponse["latestAudit"];
        lineageSummary?: MemoryTimelineResponse["lineageSummary"];
      }
): MemoryTimelineResponse {
  return {
    ref,
    events: [...timeline.events],
    warnings: [...(timeline.warnings ?? [])],
    latestAudit:
      timeline.latestAudit !== undefined && timeline.latestAudit !== null
        ? {
            ...timeline.latestAudit,
            conflicts: [...timeline.latestAudit.conflicts],
            rejectedOperations: [...(timeline.latestAudit.rejectedOperations ?? [])]
          }
        : null,
    latestAppliedLifecycle:
      "latestAppliedLifecycle" in timeline && timeline.latestAppliedLifecycle
        ? { ...timeline.latestAppliedLifecycle }
        : null,
    latestLifecycleAttempt:
      "latestLifecycleAttempt" in timeline && timeline.latestLifecycleAttempt
        ? { ...timeline.latestLifecycleAttempt }
        : null,
    lineageSummary:
      timeline.lineageSummary !== undefined
        ? { ...timeline.lineageSummary }
        : {
            eventCount: timeline.events.length,
            firstSeenAt: null,
            latestAt: null,
            latestAction: null,
            latestState: null,
            latestAttemptedAction: null,
            latestAttemptedState: null,
            latestAttemptedOutcome: null,
            latestUpdateKind: null,
            archivedAt: null,
            deletedAt: null,
            latestAuditStatus: null,
            refNoopCount: 0,
            matchedAuditOperationCount: 0,
            rolloutNoopOperationCount: 0,
            rolloutSuppressedOperationCount: 0,
            rolloutConflictCount: 0,
            noopOperationCount: 0,
            suppressedOperationCount: 0,
            conflictCount: 0,
            rejectedOperationCount: 0
          }
  };
}

export interface MemorySearchRequest {
  query: string;
  scope: MemoryRetrievalScope;
  state: MemoryRetrievalStateFilter;
  limit: number;
}

export interface MemorySearchResultShape {
  ref: string;
  scope: MemoryScope;
  state: MemoryRecordState;
  topic: string;
  id: string;
  summary: string;
  updatedAt: string;
  matchedFields: string[];
  approxReadCost: number;
  globalRank: number;
}

export function toMemorySearchRequest(options: {
  query: string;
  scope?: MemoryRetrievalScope;
  state?: MemoryRetrievalStateFilter;
  limit?: string | number;
}): MemorySearchRequest {
  return {
    query: options.query,
    scope: normalizeMemoryRetrievalScope(options.scope),
    state: normalizeMemoryRetrievalState(options.state),
    limit: parseMemoryRetrievalLimit(options.limit)
  };
}

export function toMemorySearchResultShape(result: MemorySearchResult): MemorySearchResultShape {
  return {
    ref: result.ref,
    scope: result.scope,
    state: result.state,
    topic: result.topic,
    id: result.id,
    summary: result.summary,
    updatedAt: result.updatedAt,
    matchedFields: [...result.matchedFields],
    approxReadCost: result.approxReadCost,
    globalRank: result.globalRank
  };
}

export function toMemorySearchResultShapes(
  results: MemorySearchResult[]
): MemorySearchResultShape[] {
  return results.map(toMemorySearchResultShape);
}

export function toMemoryDetailsResultShape(details: MemoryDetailsResult): MemoryDetailsResult {
  return {
    ...details,
    lineageSummary: {
      ...details.lineageSummary
    },
    latestAppliedLifecycle: details.latestAppliedLifecycle
      ? { ...details.latestAppliedLifecycle }
      : null,
    latestLifecycleAttempt: details.latestLifecycleAttempt
      ? { ...details.latestLifecycleAttempt }
      : null,
    warnings: [...details.warnings],
    latestAudit: details.latestAudit
      ? {
          ...details.latestAudit,
          conflicts: [...details.latestAudit.conflicts],
          rejectedOperations: [...(details.latestAudit.rejectedOperations ?? [])]
        }
      : null,
    entry: {
      ...details.entry,
      details: [...details.entry.details],
      sources: [...details.entry.sources]
    }
  };
}
