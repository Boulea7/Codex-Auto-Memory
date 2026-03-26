import type {
  MemoryDetailsResult,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
  MemorySearchResponse,
  MemoryTimelineEvent
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
      const activeResults = await this.memoryStore.searchEntries(query, {
        scope,
        state: "active",
        limit
      });

      if (activeResults.length > 0) {
        return buildMemorySearchResponse(query, scope, state, "active", false, activeResults);
      }

      const archivedResults = await this.memoryStore.searchEntries(query, {
        scope,
        state: "archived",
        limit
      });

      return buildMemorySearchResponse(query, scope, state, "archived", true, archivedResults);
    }

    const results = await this.memoryStore.searchEntries(query, {
      scope,
      state,
      limit
    });

    return buildMemorySearchResponse(query, scope, state, state, false, results);
  }

  public async timelineMemories(ref: string): Promise<MemoryTimelineEvent[]> {
    return this.memoryStore.readTimeline(ref);
  }

  public async getMemoryDetails(ref: string): Promise<MemoryDetailsResult | null> {
    return this.memoryStore.getEntryByRef(ref);
  }
}
