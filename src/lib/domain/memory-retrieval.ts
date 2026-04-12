import type {
  MemoryDetailsResult,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
  MemorySearchResponse,
  MemoryTimelineResponse
} from "../types.js";
import {
  buildMemorySearchResponse,
  DEFAULT_MEMORY_RETRIEVAL_LIMIT,
  DEFAULT_MEMORY_RETRIEVAL_STATE,
  normalizeMemorySearchDiagnostics
} from "./memory-retrieval-contract.js";
import { MemoryStore } from "./memory-store.js";

export class MemoryRetrievalService {
  public constructor(private readonly memoryStore: MemoryStore) {}

  public async searchMemories(
    query: string,
    options: {
      scope?: MemoryRetrievalScope;
      state?: MemoryRetrievalStateFilter;
      limit?: number;
    } = {}
  ): Promise<MemorySearchResponse> {
    const scope = options.scope ?? "all";
    const state = options.state ?? DEFAULT_MEMORY_RETRIEVAL_STATE;
    const limit = options.limit ?? DEFAULT_MEMORY_RETRIEVAL_LIMIT;

    if (state === "auto") {
      const activeSearch = await this.memoryStore.searchEntriesWithDiagnostics(query, {
        scope,
        state: "active",
        limit
      });

      if (activeSearch.results.length > 0) {
        return buildMemorySearchResponse(
          query,
          scope,
          state,
          "active",
          activeSearch.searchOrder,
          activeSearch.totalMatchedCount,
          activeSearch.returnedCount,
          activeSearch.globalLimitApplied,
          activeSearch.truncatedCount,
          activeSearch.resultWindow,
          false,
          activeSearch.retrievalMode,
          activeSearch.retrievalFallbackReason,
          {
            outcome: "active-hit",
            searchedStates: ["active"],
            resolutionReason: "active-match-found"
          },
          activeSearch.diagnostics,
          activeSearch.results
        );
      }

      const archivedSearch = await this.memoryStore.searchEntriesWithDiagnostics(query, {
        scope,
        state: "archived",
        limit
      });

      return buildMemorySearchResponse(
        query,
        scope,
        state,
        "archived",
        [...activeSearch.searchOrder, ...archivedSearch.searchOrder],
        activeSearch.totalMatchedCount + archivedSearch.totalMatchedCount,
        archivedSearch.returnedCount,
        activeSearch.globalLimitApplied || archivedSearch.globalLimitApplied,
        activeSearch.truncatedCount + archivedSearch.truncatedCount,
        archivedSearch.resultWindow,
        true,
        archivedSearch.retrievalMode,
        archivedSearch.retrievalFallbackReason,
        {
          outcome: archivedSearch.results.length > 0 ? "archived-hit" : "miss-after-both",
          searchedStates: ["active", "archived"],
          resolutionReason:
            archivedSearch.results.length > 0
              ? "active-empty-archived-match-found"
              : "no-match-after-auto-search"
        },
        normalizeMemorySearchDiagnostics([
          ...activeSearch.diagnostics.checkedPaths,
          ...archivedSearch.diagnostics.checkedPaths
        ], [
          ...(activeSearch.diagnostics.topicDiagnostics ?? []),
          ...(archivedSearch.diagnostics.topicDiagnostics ?? [])
        ]),
        archivedSearch.results
      );
    }

    const search = await this.memoryStore.searchEntriesWithDiagnostics(query, {
      scope,
      state,
      limit
    });

    return buildMemorySearchResponse(
      query,
      scope,
      state,
      state,
      search.searchOrder,
      search.totalMatchedCount,
      search.returnedCount,
      search.globalLimitApplied,
      search.truncatedCount,
      search.resultWindow,
      false,
      search.retrievalMode,
      search.retrievalFallbackReason,
      {
        outcome: "explicit-state",
        searchedStates: state === "all" ? ["active", "archived"] : [state],
        resolutionReason:
          state === "all" ? "explicit-all-state-requested" : `explicit-${state}-state-requested`
      },
      search.diagnostics,
      search.results
    );
  }

  public async timelineMemories(ref: string): Promise<MemoryTimelineResponse> {
    return this.memoryStore.readTimelineWithDiagnostics(ref);
  }

  public async getMemoryDetails(ref: string): Promise<MemoryDetailsResult | null> {
    return this.memoryStore.getEntryByRef(ref);
  }
}
