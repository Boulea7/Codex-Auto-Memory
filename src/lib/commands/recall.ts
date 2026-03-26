import { buildReadOnlyMemoryRetrievalService } from "../runtime/runtime-context.js";
import type {
  MemoryDetailsResult,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
  MemorySearchResponse,
  MemoryTimelineEvent
} from "../types.js";
import {
  buildMemoryTimelineResponse,
  normalizeMemoryRetrievalScope,
  normalizeMemoryRetrievalState,
  parseMemoryRetrievalLimit
} from "../domain/memory-retrieval-contract.js";
import { assertValidMemoryRef } from "../domain/memory-lifecycle.js";

type RecallAction = "search" | "timeline" | "details";

interface RecallOptions {
  cwd?: string;
  json?: boolean;
  scope?: MemoryRetrievalScope;
  state?: MemoryRetrievalStateFilter;
  limit?: string | number;
}

function formatSearchResults(response: MemorySearchResponse): string {
  const lines = [
    "Codex Auto Memory Recall Search",
    `Query: ${response.query}`,
    `Scope: ${response.scope} | Requested state: ${response.state} | Resolved state: ${response.resolvedState} | Results: ${response.results.length}`,
    `Archived fallback used: ${response.fallbackUsed ? "yes" : "no"}`,
    `Retrieval mode: ${response.retrievalMode}${response.retrievalFallbackReason ? ` (${response.retrievalFallbackReason})` : ""}`
  ];

  if (response.results.length === 0) {
    lines.push("", "No memory results matched this query.");
    return lines.join("\n");
  }

  lines.push("");
  for (const result of response.results) {
    lines.push(
      `- ${result.ref}`,
      `  ${result.scope}/${result.state}/${result.topic} | Updated: ${result.updatedAt}`,
      `  Summary: ${result.summary}`,
      `  Matched: ${result.matchedFields.join(", ")} | Approx read cost: ${result.approxReadCost}`
    );
  }

  return lines.join("\n");
}

function formatTimeline(ref: string, timeline: MemoryTimelineEvent[]): string {
  const lines = [
    "Codex Auto Memory Recall Timeline",
    `Ref: ${ref}`,
    `Events: ${timeline.length}`
  ];

  if (timeline.length === 0) {
    lines.push("", "No timeline events were recorded for this memory ref.");
    return lines.join("\n");
  }

  lines.push("");
  for (const event of timeline) {
    lines.push(`- ${event.at}: [${event.action}] ${event.summary}`);
    lines.push(`  Scope: ${event.scope} | State: ${event.state} | Topic: ${event.topic}`);
    if (event.reason) {
      lines.push(`  Reason: ${event.reason}`);
    }
    if (event.source) {
      lines.push(`  Source: ${event.source}`);
    }
    if (event.sessionId) {
      lines.push(`  Session: ${event.sessionId}`);
    }
    if (event.rolloutPath) {
      lines.push(`  Rollout: ${event.rolloutPath}`);
    }
  }

  return lines.join("\n");
}

function formatDetails(details: MemoryDetailsResult): string {
  const lines = [
    "Codex Auto Memory Recall Details",
    `Ref: ${details.ref}`,
    `Path: ${details.path}`,
    `History: ${details.historyPath}`,
    `Scope: ${details.scope} | State: ${details.state} | Topic: ${details.topic}`,
    `Updated: ${details.entry.updatedAt}`,
    `Latest lifecycle action: ${details.latestLifecycleAction ?? "unknown"}`,
    `Summary: ${details.entry.summary}`,
    "Details:",
    ...details.entry.details.map((detail) => `- ${detail}`)
  ];

  if (details.latestSessionId) {
    lines.push(`Latest session: ${details.latestSessionId}`);
  }

  if (details.latestRolloutPath) {
    lines.push(`Latest rollout: ${details.latestRolloutPath}`);
  }

  if (details.entry.sources.length > 0) {
    lines.push("Sources:", ...details.entry.sources.map((source) => `- ${source}`));
  }

  if (details.entry.reason) {
    lines.push(`Reason: ${details.entry.reason}`);
  }

  return lines.join("\n");
}

export async function runRecall(
  action: RecallAction,
  target: string,
  options: RecallOptions = {}
): Promise<string> {
  const retrieval = await buildReadOnlyMemoryRetrievalService(options.cwd);
  const scope = normalizeMemoryRetrievalScope(options.scope);
  const state = normalizeMemoryRetrievalState(options.state);

  switch (action) {
    case "search": {
      const response = await retrieval.searchMemories(target, {
        scope,
        state,
        limit: parseMemoryRetrievalLimit(options.limit)
      });
      if (options.json) {
        return JSON.stringify(response, null, 2);
      }
      return formatSearchResults(response);
    }
    case "timeline": {
      assertValidMemoryRef(target);
      const timeline = await retrieval.timelineMemories(target);
      if (options.json) {
        return JSON.stringify(buildMemoryTimelineResponse(target, timeline), null, 2);
      }
      return formatTimeline(target, timeline);
    }
    case "details": {
      assertValidMemoryRef(target);
      const details = await retrieval.getMemoryDetails(target);
      if (!details) {
        throw new Error(`No memory details were found for ref "${target}".`);
      }
      if (options.json) {
        return JSON.stringify(details, null, 2);
      }
      return formatDetails(details);
    }
  }
}
