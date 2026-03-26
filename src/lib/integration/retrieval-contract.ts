import {
  DEFAULT_MEMORY_RETRIEVAL_LIMIT,
  DEFAULT_MEMORY_RETRIEVAL_STATE
} from "../domain/memory-retrieval-contract.js";
import type { MemoryRetrievalStateFilter } from "../types.js";

export const RECOMMENDED_RETRIEVAL_STATE: Extract<MemoryRetrievalStateFilter, "auto"> =
  DEFAULT_MEMORY_RETRIEVAL_STATE;
export const RECOMMENDED_RETRIEVAL_LIMIT = DEFAULT_MEMORY_RETRIEVAL_LIMIT;
export const RETRIEVAL_INTEGRATION_ASSET_VERSION = "retrieval-contract-v1";

export const RETRIEVAL_MCP_SEARCH_TOOL = "search_memories";
export const RETRIEVAL_MCP_TIMELINE_TOOL = "timeline_memories";
export const RETRIEVAL_MCP_DETAILS_TOOL = "get_memory_details";

export const RETRIEVAL_CLI_SEARCH_COMMAND = "cam recall search";
export const RETRIEVAL_CLI_TIMELINE_COMMAND = "cam recall timeline";
export const RETRIEVAL_CLI_DETAILS_COMMAND = "cam recall details";

export const MCP_FIRST_RECALL_WORKFLOW =
  `Prefer retrieval MCP when it is already wired in: ${RETRIEVAL_MCP_SEARCH_TOOL} -> ${RETRIEVAL_MCP_TIMELINE_TOOL} -> ${RETRIEVAL_MCP_DETAILS_TOOL}.`;
export const CLI_FALLBACK_RECALL_WORKFLOW =
  "Otherwise fall back to the local recall bridge bundle through memory-recall.sh search|timeline|details.";
export const MCP_SERVE_GUIDANCE =
  "cam mcp serve exposes the same retrieval contract over stdio MCP when a host can consume it.";
export const MCP_DOCTOR_GUIDANCE =
  "Run cam mcp doctor if you are unsure whether the recommended project-scoped retrieval MCP wiring is already in place.";
export const MEMORY_AUDIT_BOUNDARY =
  "Use cam memory for inspect/audit surfaces and startup payload review.";
export const SESSION_CONTINUITY_BOUNDARY =
  "Use cam session only for temporary continuity, not durable memory retrieval.";
export const ARCHIVE_BOUNDARY =
  "Treat archived memory as historical context that does not participate in default startup recall.";
export const DURABLE_MEMORY_SYNC_GUIDANCE =
  "After finishing work that should affect durable memory, run cam sync or review cam memory --recent instead of assuming temporary continuity already updated Markdown memory.";

export function formatRecommendedRetrievalPreset(): string {
  return `state=${RECOMMENDED_RETRIEVAL_STATE}, limit=${RECOMMENDED_RETRIEVAL_LIMIT}`;
}

export function buildRecommendedCliSearchCommand(query = "\"<query>\""): string {
  return buildCliSearchCommand(query);
}

export function buildCliSearchCommand(
  query = "\"<query>\"",
  options: {
    state?: MemoryRetrievalStateFilter;
    limit?: number;
  } = {}
): string {
  const state = options.state ?? RECOMMENDED_RETRIEVAL_STATE;
  const limit = options.limit ?? RECOMMENDED_RETRIEVAL_LIMIT;
  return `${RETRIEVAL_CLI_SEARCH_COMMAND} ${query} --state ${state} --limit ${limit}`;
}

export function buildRecommendedMcpSearchInstruction(): string {
  return `When using ${RETRIEVAL_MCP_SEARCH_TOOL}, pass state: "${RECOMMENDED_RETRIEVAL_STATE}" and limit: ${RECOMMENDED_RETRIEVAL_LIMIT}.`;
}

export function buildRecommendedSearchPresetGuidance(): string {
  return `The recommended search preset is --state ${RECOMMENDED_RETRIEVAL_STATE} --limit ${RECOMMENDED_RETRIEVAL_LIMIT} unless you override those flags explicitly.`;
}

export function buildRecommendedRetrievalSummaryLines(): string[] {
  return [
    "Before repeating prior work or repo-specific decisions, recall durable memory first.",
    "Use progressive disclosure: search -> timeline -> details.",
    "Use this workflow when a host or skill needs read-only retrieval without reading full topic files up front.",
    MCP_FIRST_RECALL_WORKFLOW,
    buildRecommendedMcpSearchInstruction(),
    MCP_SERVE_GUIDANCE,
    CLI_FALLBACK_RECALL_WORKFLOW,
    buildRecommendedSearchPresetGuidance(),
    MCP_DOCTOR_GUIDANCE,
    DURABLE_MEMORY_SYNC_GUIDANCE,
    MEMORY_AUDIT_BOUNDARY,
    SESSION_CONTINUITY_BOUNDARY,
    ARCHIVE_BOUNDARY
  ];
}

export function buildShellAssetVersionComment(): string {
  return `# cam:asset-version ${RETRIEVAL_INTEGRATION_ASSET_VERSION}`;
}

export function buildMarkdownAssetVersionComment(): string {
  return `<!-- cam:asset-version ${RETRIEVAL_INTEGRATION_ASSET_VERSION} -->`;
}

export function detectIntegrationAssetVersion(contents: string): string | null {
  const match = contents.match(/cam:asset-version\s+([A-Za-z0-9._-]+)/u);
  return match?.[1] ?? null;
}
