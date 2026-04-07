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
export const DURABLE_MEMORY_SYNC_COMMAND = "cam sync";
export const DURABLE_MEMORY_RECENT_REVIEW_COMMAND = "cam memory --recent";
export const POST_WORK_SYNC_REVIEW_HELPER = "post-work-memory-review.sh";

export const RECALL_FIRST_GUIDANCE =
  "Before repeating prior work or repo-specific decisions, recall durable memory first.";
export const PROGRESSIVE_DISCLOSURE_GUIDANCE =
  "Use progressive disclosure: search -> timeline -> details.";
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
  `After finishing work that should affect durable memory, run ${DURABLE_MEMORY_SYNC_COMMAND} or review ${DURABLE_MEMORY_RECENT_REVIEW_COMMAND} instead of assuming temporary continuity already updated Markdown memory.`;

export interface WorkflowRoutePreference {
  preferredRoute: "mcp-first";
  mcpFirst: string;
  cliFallback: string;
  doctor: string;
  serve: string;
}

export interface WorkflowRecallWorkflow {
  recallFirst: string;
  progressiveDisclosure: string;
}

export interface WorkflowContract {
  version: string;
  preferredRoute: "mcp-first";
  recommendedPreset: string;
  recallFirst: string;
  progressiveDisclosure: string;
  routePreference: WorkflowRoutePreference;
  recallWorkflow: WorkflowRecallWorkflow;
  mcpTools: {
    search: string;
    timeline: string;
    details: string;
  };
  cliFallback: {
    searchCommand: string;
    timelineCommand: string;
    detailsCommand: string;
  };
  postWorkSyncReview: {
    helperScript: string;
    syncCommand: string;
    reviewCommand: string;
    guidance: string;
  };
  boundaries: {
    memoryAudit: string;
    sessionContinuity: string;
    archive: string;
  };
}

export function buildSharedWorkflowDisciplineLines(): string[] {
  const workflowContract = buildWorkflowContract();
  return [
    workflowContract.recallWorkflow.recallFirst,
    workflowContract.recallWorkflow.progressiveDisclosure,
    workflowContract.postWorkSyncReview.guidance,
    workflowContract.boundaries.memoryAudit,
    workflowContract.boundaries.sessionContinuity,
    workflowContract.boundaries.archive
  ];
}

export function formatRecommendedRetrievalPreset(): string {
  return `state=${RECOMMENDED_RETRIEVAL_STATE}, limit=${RECOMMENDED_RETRIEVAL_LIMIT}`;
}

export function hasCliCwdFlag(command: string): boolean {
  return /(?:^|\s)--cwd(?:\s|=)/u.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function appendCliCwdFlag(command: string, cwd?: string): string {
  if (!cwd || hasCliCwdFlag(command)) {
    return command;
  }

  return `${command} --cwd ${shellQuote(cwd)}`;
}

export function buildRecommendedCliSearchCommand(
  query = "\"<query>\"",
  options: {
    cwd?: string;
  } = {}
): string {
  return buildCliSearchCommand(query, options);
}

export function buildCliSearchCommand(
  query = "\"<query>\"",
  options: {
    state?: MemoryRetrievalStateFilter;
    limit?: number;
    cwd?: string;
  } = {}
): string {
  const state = options.state ?? RECOMMENDED_RETRIEVAL_STATE;
  const limit = options.limit ?? RECOMMENDED_RETRIEVAL_LIMIT;
  return appendCliCwdFlag(
    `${RETRIEVAL_CLI_SEARCH_COMMAND} ${query} --state ${state} --limit ${limit}`,
    options.cwd
  );
}

export function buildCliTimelineCommand(
  ref = "\"<ref>\"",
  options: {
    cwd?: string;
  } = {}
): string {
  return appendCliCwdFlag(`${RETRIEVAL_CLI_TIMELINE_COMMAND} ${ref}`, options.cwd);
}

export function buildCliDetailsCommand(
  ref = "\"<ref>\"",
  options: {
    cwd?: string;
  } = {}
): string {
  return appendCliCwdFlag(`${RETRIEVAL_CLI_DETAILS_COMMAND} ${ref}`, options.cwd);
}

export function buildPostWorkSyncCommand(
  options: {
    cwd?: string;
  } = {}
): string {
  return appendCliCwdFlag(DURABLE_MEMORY_SYNC_COMMAND, options.cwd);
}

export function buildPostWorkRecentReviewCommand(
  options: {
    cwd?: string;
  } = {}
): string {
  return appendCliCwdFlag(DURABLE_MEMORY_RECENT_REVIEW_COMMAND, options.cwd);
}

export function buildWorkflowContract(
  options: {
    cwd?: string;
  } = {}
): WorkflowContract {
  const routePreference: WorkflowRoutePreference = {
    preferredRoute: "mcp-first",
    mcpFirst: MCP_FIRST_RECALL_WORKFLOW,
    cliFallback: CLI_FALLBACK_RECALL_WORKFLOW,
    doctor: MCP_DOCTOR_GUIDANCE,
    serve: MCP_SERVE_GUIDANCE
  };
  const recallWorkflow: WorkflowRecallWorkflow = {
    recallFirst: RECALL_FIRST_GUIDANCE,
    progressiveDisclosure: PROGRESSIVE_DISCLOSURE_GUIDANCE
  };

  return {
    version: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    preferredRoute: routePreference.preferredRoute,
    recommendedPreset: formatRecommendedRetrievalPreset(),
    recallFirst: recallWorkflow.recallFirst,
    progressiveDisclosure: recallWorkflow.progressiveDisclosure,
    routePreference,
    recallWorkflow,
    mcpTools: {
      search: RETRIEVAL_MCP_SEARCH_TOOL,
      timeline: RETRIEVAL_MCP_TIMELINE_TOOL,
      details: RETRIEVAL_MCP_DETAILS_TOOL
    },
    cliFallback: {
      searchCommand: buildRecommendedCliSearchCommand("\"<query>\"", options),
      timelineCommand: buildCliTimelineCommand("\"<ref>\"", options),
      detailsCommand: buildCliDetailsCommand("\"<ref>\"", options)
    },
    postWorkSyncReview: {
      helperScript: POST_WORK_SYNC_REVIEW_HELPER,
      syncCommand: buildPostWorkSyncCommand(options),
      reviewCommand: buildPostWorkRecentReviewCommand(options),
      guidance: DURABLE_MEMORY_SYNC_GUIDANCE
    },
    boundaries: {
      memoryAudit: MEMORY_AUDIT_BOUNDARY,
      sessionContinuity: SESSION_CONTINUITY_BOUNDARY,
      archive: ARCHIVE_BOUNDARY
    }
  };
}

export function buildRecommendedMcpSearchInstruction(): string {
  return `When using ${RETRIEVAL_MCP_SEARCH_TOOL}, pass state: "${RECOMMENDED_RETRIEVAL_STATE}" and limit: ${RECOMMENDED_RETRIEVAL_LIMIT}.`;
}

export function buildRecommendedSearchPresetGuidance(): string {
  return `The recommended search preset is --state ${RECOMMENDED_RETRIEVAL_STATE} --limit ${RECOMMENDED_RETRIEVAL_LIMIT} unless you override those flags explicitly.`;
}

export function buildRecommendedRetrievalSummaryLines(): string[] {
  const workflowContract = buildWorkflowContract();
  return [
    workflowContract.recallWorkflow.recallFirst,
    workflowContract.recallWorkflow.progressiveDisclosure,
    "Use this workflow when a host or skill needs read-only retrieval without reading full topic files up front.",
    workflowContract.routePreference.mcpFirst,
    buildRecommendedMcpSearchInstruction(),
    workflowContract.routePreference.serve,
    workflowContract.routePreference.cliFallback,
    buildRecommendedSearchPresetGuidance(),
    workflowContract.routePreference.doctor,
    ...buildSharedWorkflowDisciplineLines().slice(2)
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
