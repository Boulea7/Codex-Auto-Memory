import { buildReadOnlyMemoryRetrievalService } from "../runtime/runtime-context.js";
import type {
  MemoryDetailsResult,
  MemoryRetrievalScope,
  MemoryRetrievalStateFilter,
  MemorySearchResponse,
  MemoryTimelineResponse
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
  const diagnosticsSummary =
    response.diagnostics.checkedPaths.length === 0
      ? "none"
      : response.diagnostics.checkedPaths
          .map(
            (check) =>
              `${check.scope}/${check.state}=${check.retrievalMode}${check.retrievalFallbackReason ? `(${check.retrievalFallbackReason})` : ""}:${check.matchedCount}/${check.returnedCount}`
          )
          .join("; ");
  const lines = [
    "Codex Auto Memory Recall Search",
    `Query: ${response.query}`,
    `Scope: ${response.scope} | Requested state: ${response.state} | Resolved state: ${response.resolvedState} | Results: ${response.results.length}`,
    `Archived fallback used: ${response.fallbackUsed ? "yes" : "no"}`,
    `State resolution: ${response.stateResolution.outcome} (${response.stateResolution.resolutionReason}) [${response.stateResolution.searchedStates.join(" -> ")}]`,
    `Markdown fallback used: ${response.markdownFallbackUsed ? "yes" : "no"}`,
    `Retrieval mode: ${response.retrievalMode}${response.retrievalFallbackReason ? ` (${response.retrievalFallbackReason})` : ""}`,
    `Execution summary: ${response.executionSummary.mode} [${response.executionSummary.retrievalModes.join(", ")}]${response.executionSummary.fallbackReasons.length > 0 ? ` fallback=${response.executionSummary.fallbackReasons.join(",")}` : ""}`,
    `Diagnostics: ${diagnosticsSummary}`
  ];

  if (response.diagnostics.fallbackReasons.length > 0) {
    lines.push(`Fallback reasons: ${response.diagnostics.fallbackReasons.join(", ")}`);
  }

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

function formatTimeline(timeline: MemoryTimelineResponse): string {
  const lines = [
    "Codex Auto Memory Recall Timeline",
    `Ref: ${timeline.ref}`,
    `Events: ${timeline.events.length}`
  ];

  if (timeline.warnings.length > 0) {
    lines.push("", "Warnings:", ...timeline.warnings.map((warning) => `- ${warning}`));
  }

  lines.push(
    "",
    "Lineage:",
    `- Latest action: ${timeline.lineageSummary.latestAction ?? "unknown"}`,
    `- Latest state: ${timeline.lineageSummary.latestState ?? "unknown"}`,
    `- Latest attempted action: ${timeline.lineageSummary.latestAttemptedAction ?? "unknown"}`,
    `- Latest attempted outcome: ${timeline.lineageSummary.latestAttemptedOutcome ?? "unknown"}`,
    `- Latest update kind: ${timeline.lineageSummary.latestUpdateKind ?? "n/a"}`,
    `- Latest audit status: ${timeline.lineageSummary.latestAuditStatus ?? "unknown"}`,
    `- First seen: ${timeline.lineageSummary.firstSeenAt ?? "unknown"}`,
    `- Latest event at: ${timeline.lineageSummary.latestAt ?? "unknown"}`,
    `- Archived at: ${timeline.lineageSummary.archivedAt ?? "n/a"}`,
    `- Deleted at: ${timeline.lineageSummary.deletedAt ?? "n/a"}`,
    `- Ref no-op count: ${timeline.lineageSummary.refNoopCount}`,
    `- Matched audit operations: ${timeline.lineageSummary.matchedAuditOperationCount}`,
    `- Rollout no-op count: ${timeline.lineageSummary.rolloutNoopOperationCount}`,
    `- Rollout suppressed count: ${timeline.lineageSummary.rolloutSuppressedOperationCount}`,
    `- Rollout conflict count: ${timeline.lineageSummary.rolloutConflictCount}`
  );

  if (timeline.latestLifecycleAttempt) {
    lines.push(
      "",
      "Latest attempt:",
      `- ${timeline.latestLifecycleAttempt.at}: [${timeline.latestLifecycleAttempt.action}] ${timeline.latestLifecycleAttempt.summary}`,
      `- Outcome: ${timeline.latestLifecycleAttempt.outcome} | State: ${timeline.latestLifecycleAttempt.state ?? "unknown"} | Previous: ${timeline.latestLifecycleAttempt.previousState ?? "n/a"} | Next: ${timeline.latestLifecycleAttempt.nextState ?? "n/a"} | Update kind: ${timeline.latestLifecycleAttempt.updateKind ?? "n/a"}`
    );
  }

  if (timeline.events.length === 0) {
    lines.push("", "No timeline events were recorded for this memory ref.");
    return lines.join("\n");
  }

  lines.push("");
  for (const event of timeline.events) {
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
    `Latest state: ${details.latestState}`,
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

  if (details.latestAudit) {
    lines.push(
      `Latest audit: ${details.latestAudit.status} at ${details.latestAudit.appliedAt}`,
      `Latest audit path: ${details.latestAudit.auditPath}`,
      `Latest audit summary: ${details.latestAudit.resultSummary}`,
      `Latest audit matched operations for this ref: ${details.latestAudit.matchedOperationCount}`
    );
  }

  lines.push(
    "Lineage:",
    `- Latest action: ${details.lineageSummary.latestAction ?? "unknown"}`,
    `- Latest state: ${details.lineageSummary.latestState ?? details.latestState}`,
    `- Latest attempted action: ${details.lineageSummary.latestAttemptedAction ?? "unknown"}`,
    `- Latest attempted outcome: ${details.lineageSummary.latestAttemptedOutcome ?? "unknown"}`,
    `- Latest update kind: ${details.lineageSummary.latestUpdateKind ?? "n/a"}`,
    `- Latest audit status: ${details.lineageSummary.latestAuditStatus ?? "unknown"}`,
    `- First seen: ${details.lineageSummary.firstSeenAt ?? "unknown"}`,
    `- Latest event at: ${details.lineageSummary.latestAt ?? "unknown"}`,
    `- Archived at: ${details.lineageSummary.archivedAt ?? "n/a"}`,
    `- Deleted at: ${details.lineageSummary.deletedAt ?? "n/a"}`,
    `- Ref no-op count: ${details.lineageSummary.refNoopCount}`,
    `- Matched audit operations: ${details.lineageSummary.matchedAuditOperationCount}`,
    `- Rollout no-op count: ${details.lineageSummary.rolloutNoopOperationCount}`,
    `- Rollout suppressed count: ${details.lineageSummary.rolloutSuppressedOperationCount}`,
    `- Rollout conflict count: ${details.lineageSummary.rolloutConflictCount}`,
    `- Timeline warning count: ${details.timelineWarningCount}`
  );

  if (details.latestLifecycleAttempt) {
    lines.push(
      "Latest attempt:",
      `- ${details.latestLifecycleAttempt.at}: [${details.latestLifecycleAttempt.action}] ${details.latestLifecycleAttempt.summary}`,
      `- Outcome: ${details.latestLifecycleAttempt.outcome} | State: ${details.latestLifecycleAttempt.state ?? "unknown"} | Previous: ${details.latestLifecycleAttempt.previousState ?? "n/a"} | Next: ${details.latestLifecycleAttempt.nextState ?? "n/a"} | Update kind: ${details.latestLifecycleAttempt.updateKind ?? "n/a"}`
    );
  }

  if (details.warnings.length > 0) {
    lines.push("Warnings:", ...details.warnings.map((warning) => `- ${warning}`));
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
      return formatTimeline(timeline);
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
