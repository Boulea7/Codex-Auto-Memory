import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCommandAvailableInPath } from "./command-path.js";
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
export const LOCAL_BRIDGE_RECALL_WORKFLOW =
  "If the retrieval MCP server is unavailable, fall back to the local recall bridge bundle through memory-recall.sh search|timeline|details.";
export const RESOLVED_CLI_RECALL_WORKFLOW =
  "If the local bridge bundle is unavailable, fall back to the resolved CLI recall commands.";
export const CLI_FALLBACK_RECALL_WORKFLOW = `${LOCAL_BRIDGE_RECALL_WORKFLOW} ${RESOLVED_CLI_RECALL_WORKFLOW}`;
export const MCP_SERVE_GUIDANCE =
  "cam mcp serve exposes the same retrieval contract over stdio MCP when a host can consume it.";
export function buildMcpDoctorGuidance(
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  const fallbackCommand = buildResolvedCliCommand("mcp doctor --host codex", options);
  return `Run ${fallbackCommand} if you are unsure whether the recommended project-scoped retrieval MCP wiring is already in place.`;
}
export const MEMORY_AUDIT_BOUNDARY =
  "Use cam memory for inspect/audit surfaces and startup payload review.";
export const SESSION_CONTINUITY_BOUNDARY =
  "Use cam session only for temporary continuity, not durable memory retrieval.";
export const ARCHIVE_BOUNDARY =
  "Treat archived memory as historical context that does not participate in default startup recall.";
export function buildDurableMemorySyncGuidance(
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  const syncCommand = buildResolvedPostWorkSyncCommand(options);
  const reviewCommand = buildResolvedPostWorkRecentReviewCommand(options);
  return `After finishing work that should affect durable memory, run ${syncCommand} or review ${reviewCommand} instead of assuming temporary continuity already updated Markdown memory.`;
}

export interface WorkflowRoutePreference {
  preferredRoute: "mcp-first";
  mcpFirst: string;
  localBridge: string;
  resolvedCli: string;
  cliFallback: string;
  doctor: string;
  serve: string;
}

export interface WorkflowRecallWorkflow {
  recallFirst: string;
  progressiveDisclosure: string;
}

export interface WorkflowExecutionContract {
  preferredRoute: "mcp-first";
  recommendedPreset: string;
  fallbackOrder: ["mcp", "local-bridge", "resolved-cli"];
  mcpTools: WorkflowContract["mcpTools"];
  hookFallback: WorkflowContract["hookFallback"];
  cliFallback: WorkflowContract["cliFallback"];
  resolvedCliFallback: WorkflowContract["resolvedCliFallback"];
  postWorkSyncReview: WorkflowContract["postWorkSyncReview"];
  resolvedPostWorkSyncReview: WorkflowContract["resolvedPostWorkSyncReview"];
  boundaries: WorkflowContract["boundaries"];
}

export interface WorkflowModelGuidanceContract {
  recallFirst: string;
  progressiveDisclosure: string;
  routePreference: WorkflowRoutePreference;
  recallWorkflow: WorkflowRecallWorkflow;
}

export interface WorkflowHostWiringContract {
  launcher: WorkflowContract["launcher"];
  doctorCommand: string;
  serveGuidance: string;
}

export interface WorkflowContract {
  version: string;
  preferredRoute: "mcp-first";
  recommendedPreset: string;
  fallbackOrder: ["mcp", "local-bridge", "resolved-cli"];
  recallFirst: string;
  progressiveDisclosure: string;
  launcher: {
    commandName: "cam";
    requiresPathResolution: true;
    hookHelpersShellOnly: true;
    resolution: "cam-path" | "node-dist" | "cam-unverified";
    verified: boolean;
    resolvedCommand: string;
    appliesTo: "direct-cli-and-installed-helper-assets";
    canonicalMcpServerCommand: "cam mcp serve";
  };
  routePreference: WorkflowRoutePreference;
  recallWorkflow: WorkflowRecallWorkflow;
  mcpTools: {
    search: string;
    timeline: string;
    details: string;
  };
  hookFallback: {
    helperScript: "memory-recall.sh";
    helperPath: string;
    searchCommand: string;
    timelineCommand: string;
    detailsCommand: string;
    shellOnly: true;
  };
  cliFallback: {
    searchCommand: string;
    timelineCommand: string;
    detailsCommand: string;
    requiresCamOnPath: true;
  };
  resolvedCliFallback: {
    searchCommand: string;
    timelineCommand: string;
    detailsCommand: string;
  };
  postWorkSyncReview: {
    helperScript: string;
    syncCommand: string;
    reviewCommand: string;
    guidance: string;
    shellOnly: true;
    requiresCamOnPath: true;
  };
  resolvedPostWorkSyncReview: {
    syncCommand: string;
    reviewCommand: string;
  };
  boundaries: {
    memoryAudit: string;
    sessionContinuity: string;
    archive: string;
  };
  executionContract: WorkflowExecutionContract;
  modelGuidanceContract: WorkflowModelGuidanceContract;
  hostWiringContract: WorkflowHostWiringContract;
}

export function buildSharedWorkflowDisciplineLines(
  options: {
    cwd?: string;
  } = {}
): string[] {
  const workflowContract = buildWorkflowContract(options);
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

function getPackagedDistCliPath(): string {
  const overriddenPath = process.env.CODEX_AUTO_MEMORY_DIST_CLI_PATH?.trim();
  if (overriddenPath) {
    return path.resolve(overriddenPath);
  }

  const thisFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFilePath), "../../../dist/cli.js");
}

export function resolveCliLauncher(
  options: {
    pathValue?: string;
    distCliPath?: string;
    distCliPathExists?: boolean;
  } = {}
): WorkflowContract["launcher"] {
  if (isCommandAvailableInPath("cam", options.pathValue)) {
    return {
      commandName: "cam",
      requiresPathResolution: true,
      hookHelpersShellOnly: true,
      resolution: "cam-path",
      verified: true,
      resolvedCommand: "cam",
      appliesTo: "direct-cli-and-installed-helper-assets",
      canonicalMcpServerCommand: "cam mcp serve"
    };
  }

  const distCliPath = options.distCliPath ?? getPackagedDistCliPath();
  const distCliPathExists = options.distCliPathExists ?? fs.existsSync(distCliPath);
  if (distCliPathExists) {
    return {
      commandName: "cam",
      requiresPathResolution: true,
      hookHelpersShellOnly: true,
      resolution: "node-dist",
      verified: true,
      resolvedCommand: `node ${JSON.stringify(distCliPath)}`,
      appliesTo: "direct-cli-and-installed-helper-assets",
      canonicalMcpServerCommand: "cam mcp serve"
    };
  }

  return {
    commandName: "cam",
    requiresPathResolution: true,
    hookHelpersShellOnly: true,
    resolution: "cam-unverified",
    verified: false,
    resolvedCommand: "cam",
    appliesTo: "direct-cli-and-installed-helper-assets",
    canonicalMcpServerCommand: "cam mcp serve"
  };
}

export function hasCliCwdFlag(command: string): boolean {
  return /(?:^|\s)--cwd(?:\s|=)/u.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function appendCliCwdFlag(command: string, cwd?: string): string {
  if (!cwd || hasCliCwdFlag(command)) {
    return command;
  }

  return `${command} --cwd ${shellQuote(cwd)}`;
}

export function buildResolvedCliCommand(
  command: string,
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  const launcher = options.launcherOverride ?? resolveCliLauncher();
  return appendCliCwdFlag(`${launcher.resolvedCommand} ${command}`, options.cwd);
}

function getInstalledHookHelperPath(helperScript: string): string {
  return path.join(os.homedir(), ".codex-auto-memory", "hooks", helperScript);
}

function buildHookFallbackCommand(
  action: "search" | "timeline" | "details",
  argumentPlaceholder: string,
  options: {
    cwd?: string;
  } = {}
): string {
  const helperPath = shellQuote(getInstalledHookHelperPath("memory-recall.sh"));
  const invocation = `${helperPath} ${action} ${argumentPlaceholder}`;
  return options.cwd
    ? `CAM_PROJECT_ROOT=${shellQuote(options.cwd)} ${invocation}`
    : invocation;
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

export function buildResolvedCliSearchCommand(
  query = "\"<query>\"",
  options: {
    state?: MemoryRetrievalStateFilter;
    limit?: number;
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  const state = options.state ?? RECOMMENDED_RETRIEVAL_STATE;
  const limit = options.limit ?? RECOMMENDED_RETRIEVAL_LIMIT;
  return buildResolvedCliCommand(
    `recall search ${query} --state ${state} --limit ${limit}`,
    options
  );
}

export function buildResolvedCliTimelineCommand(
  ref = "\"<ref>\"",
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  return buildResolvedCliCommand(`recall timeline ${ref}`, options);
}

export function buildResolvedCliDetailsCommand(
  ref = "\"<ref>\"",
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  return buildResolvedCliCommand(`recall details ${ref}`, options);
}

export function buildResolvedPostWorkSyncCommand(
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  return buildResolvedCliCommand("sync", options);
}

export function buildResolvedPostWorkRecentReviewCommand(
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): string {
  return buildResolvedCliCommand("memory --recent", options);
}

export function buildWorkflowContract(
  options: {
    cwd?: string;
    launcherOverride?: WorkflowContract["launcher"];
  } = {}
): WorkflowContract {
  const launcher = options.launcherOverride ?? resolveCliLauncher();
  const routePreference: WorkflowRoutePreference = {
    preferredRoute: "mcp-first",
    mcpFirst: MCP_FIRST_RECALL_WORKFLOW,
    localBridge: LOCAL_BRIDGE_RECALL_WORKFLOW,
    resolvedCli: RESOLVED_CLI_RECALL_WORKFLOW,
    cliFallback: CLI_FALLBACK_RECALL_WORKFLOW,
    doctor: buildMcpDoctorGuidance({ ...options, launcherOverride: launcher }),
    serve: MCP_SERVE_GUIDANCE
  };
  const recallWorkflow: WorkflowRecallWorkflow = {
    recallFirst: RECALL_FIRST_GUIDANCE,
    progressiveDisclosure: PROGRESSIVE_DISCLOSURE_GUIDANCE
  };
  const recommendedPreset = formatRecommendedRetrievalPreset();
  const fallbackOrder: WorkflowContract["fallbackOrder"] = ["mcp", "local-bridge", "resolved-cli"];
  const mcpTools: WorkflowContract["mcpTools"] = {
    search: RETRIEVAL_MCP_SEARCH_TOOL,
    timeline: RETRIEVAL_MCP_TIMELINE_TOOL,
    details: RETRIEVAL_MCP_DETAILS_TOOL
  };
  const hookFallback: WorkflowContract["hookFallback"] = {
    helperScript: "memory-recall.sh",
    helperPath: getInstalledHookHelperPath("memory-recall.sh"),
    searchCommand: buildHookFallbackCommand("search", "\"<query>\"", options),
    timelineCommand: buildHookFallbackCommand("timeline", "\"<ref>\"", options),
    detailsCommand: buildHookFallbackCommand("details", "\"<ref>\"", options),
    shellOnly: true
  };
  const cliFallback: WorkflowContract["cliFallback"] = {
    searchCommand: buildRecommendedCliSearchCommand("\"<query>\"", options),
    timelineCommand: buildCliTimelineCommand("\"<ref>\"", options),
    detailsCommand: buildCliDetailsCommand("\"<ref>\"", options),
    requiresCamOnPath: true
  };
  const resolvedCliFallback: WorkflowContract["resolvedCliFallback"] = {
    searchCommand: buildResolvedCliSearchCommand("\"<query>\"", {
      ...options,
      launcherOverride: launcher
    }),
    timelineCommand: buildResolvedCliTimelineCommand("\"<ref>\"", {
      ...options,
      launcherOverride: launcher
    }),
    detailsCommand: buildResolvedCliDetailsCommand("\"<ref>\"", {
      ...options,
      launcherOverride: launcher
    })
  };
  const postWorkSyncReview: WorkflowContract["postWorkSyncReview"] = {
    helperScript: POST_WORK_SYNC_REVIEW_HELPER,
    syncCommand: buildPostWorkSyncCommand(options),
    reviewCommand: buildPostWorkRecentReviewCommand(options),
    guidance: buildDurableMemorySyncGuidance({ ...options, launcherOverride: launcher }),
    shellOnly: true,
    requiresCamOnPath: true
  };
  const resolvedPostWorkSyncReview: WorkflowContract["resolvedPostWorkSyncReview"] = {
    syncCommand: buildResolvedPostWorkSyncCommand({ ...options, launcherOverride: launcher }),
    reviewCommand: buildResolvedPostWorkRecentReviewCommand({
      ...options,
      launcherOverride: launcher
    })
  };
  const boundaries: WorkflowContract["boundaries"] = {
    memoryAudit: MEMORY_AUDIT_BOUNDARY,
    sessionContinuity: SESSION_CONTINUITY_BOUNDARY,
    archive: ARCHIVE_BOUNDARY
  };

  return {
    version: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    preferredRoute: routePreference.preferredRoute,
    recommendedPreset,
    fallbackOrder,
    recallFirst: recallWorkflow.recallFirst,
    progressiveDisclosure: recallWorkflow.progressiveDisclosure,
    launcher,
    routePreference,
    recallWorkflow,
    mcpTools,
    hookFallback,
    cliFallback,
    resolvedCliFallback,
    postWorkSyncReview,
    resolvedPostWorkSyncReview,
    boundaries,
    executionContract: {
      preferredRoute: routePreference.preferredRoute,
      recommendedPreset,
      fallbackOrder,
      mcpTools,
      hookFallback,
      cliFallback,
      resolvedCliFallback,
      postWorkSyncReview,
      resolvedPostWorkSyncReview,
      boundaries
    },
    modelGuidanceContract: {
      recallFirst: recallWorkflow.recallFirst,
      progressiveDisclosure: recallWorkflow.progressiveDisclosure,
      routePreference,
      recallWorkflow
    },
    hostWiringContract: {
      launcher,
      doctorCommand: routePreference.doctor,
      serveGuidance: routePreference.serve
    }
  };
}

export function buildRecommendedMcpSearchInstruction(): string {
  return `When using ${RETRIEVAL_MCP_SEARCH_TOOL}, pass state: "${RECOMMENDED_RETRIEVAL_STATE}" and limit: ${RECOMMENDED_RETRIEVAL_LIMIT}.`;
}

export function buildRecommendedSearchPresetGuidance(): string {
  return `The recommended search preset is --state ${RECOMMENDED_RETRIEVAL_STATE} --limit ${RECOMMENDED_RETRIEVAL_LIMIT} unless you override those flags explicitly.`;
}

export function buildRecommendedRetrievalSummaryLines(
  options: {
    cwd?: string;
  } = {}
): string[] {
  const workflowContract = buildWorkflowContract(options);
  return [
    workflowContract.recallWorkflow.recallFirst,
    workflowContract.recallWorkflow.progressiveDisclosure,
    "Use this workflow when a host or skill needs read-only retrieval without reading full topic files up front.",
    workflowContract.routePreference.mcpFirst,
    buildRecommendedMcpSearchInstruction(),
    workflowContract.routePreference.serve,
    workflowContract.routePreference.localBridge,
    workflowContract.routePreference.resolvedCli,
    buildRecommendedSearchPresetGuidance(),
    workflowContract.routePreference.doctor,
    ...buildSharedWorkflowDisciplineLines(options).slice(2)
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
