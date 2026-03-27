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
  DEFAULT_MEMORY_RETRIEVAL_STATE
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
          false,
          activeSearch.retrievalMode,
          activeSearch.retrievalFallbackReason,
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
        true,
        archivedSearch.retrievalMode,
        archivedSearch.retrievalFallbackReason,
        {
          checkedPaths: [
            ...activeSearch.diagnostics.checkedPaths,
            ...archivedSearch.diagnostics.checkedPaths
          ]
        },
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
      false,
      search.retrievalMode,
      search.retrievalFallbackReason,
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
