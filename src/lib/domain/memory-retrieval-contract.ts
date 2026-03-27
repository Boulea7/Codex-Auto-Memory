import type {
  MemoryDetailsResult,
  MemorySearchDiagnostics,
  MemoryRetrievalFallbackReason,
  MemoryRetrievalMode,
  MemoryRecordState,
  MemoryRetrievalResolvedState,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
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
  fallbackUsed: boolean,
  retrievalMode: MemoryRetrievalMode,
  retrievalFallbackReason: MemoryRetrievalFallbackReason | undefined,
  diagnostics: MemorySearchDiagnostics,
  results: MemorySearchResult[]
): MemorySearchResponse {
  return {
    query,
    scope,
    state,
    resolvedState,
    fallbackUsed,
    retrievalMode,
    retrievalFallbackReason,
    diagnostics,
    results
  };
}

export function buildMemoryTimelineResponse(
  ref: string,
  events: MemoryTimelineEvent[]
): MemoryTimelineResponse {
  return {
    ref,
    events
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
    approxReadCost: result.approxReadCost
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
    latestAudit: details.latestAudit
      ? {
          ...details.latestAudit,
          conflicts: [...details.latestAudit.conflicts]
        }
      : null,
    entry: {
      ...details.entry,
      details: [...details.entry.details],
      sources: [...details.entry.sources]
    }
  };
}
