import {
  appendCliCwdFlag,
  buildCliDetailsCommand,
  buildPostWorkRecentReviewCommand,
  buildPostWorkSyncCommand,
  buildCliTimelineCommand,
  buildRecommendedCliSearchCommand,
  buildRecommendedMcpSearchInstruction,
  buildSharedWorkflowDisciplineLines,
  buildWorkflowContract,
  DURABLE_MEMORY_SYNC_GUIDANCE,
  formatRecommendedRetrievalPreset
} from "./retrieval-contract.js";
import {
  RETRIEVAL_MCP_DETAILS_TOOL,
  RETRIEVAL_MCP_SEARCH_TOOL,
  RETRIEVAL_MCP_TIMELINE_TOOL
} from "./retrieval-contract.js";

export type CodexIntegrationRoute = "mcp" | "hooks-fallback" | "cli-direct";
export type CodexIntegrationStatus = "ok" | "warning" | "missing";
export type IntegrationInstallAction = "created" | "updated" | "unchanged";
export type CodexAgentsGuidanceInspectionStatus = "ok" | "warning" | "missing";

export interface CodexStackReadiness {
  mcpReady: boolean;
  mcpOperationalReady: boolean;
  camCommandAvailable: boolean;
  hookCaptureReady: boolean;
  hookRecallReady: boolean;
  skillReady: boolean;
  workflowAssetsConsistent: boolean;
  workflowConsistent: boolean;
}

export interface CodexIntegrationSubcheck {
  status: CodexIntegrationStatus;
  summary: string;
}

export interface CodexIntegrationAssetAvailability {
  hasCaptureAssets: boolean;
  hasRecallAssets: boolean;
  hasSkillAssets: boolean;
  hasWorkflowAssets: boolean;
}

export interface CodexIntegrationSubchecks {
  mcp: CodexIntegrationSubcheck;
  hookCapture: CodexIntegrationSubcheck;
  hookRecall: CodexIntegrationSubcheck;
  skill: CodexIntegrationSubcheck;
  workflowConsistency: CodexIntegrationSubcheck;
}

export interface CodexAgentsGuidance {
  targetFileHint: "AGENTS.md";
  snippetFormat: "markdown";
  snippet: string;
  notes: string[];
}

export interface CodexAgentsGuidanceInspection {
  path: string;
  exists: boolean;
  status: CodexAgentsGuidanceInspectionStatus;
  expectedVersion: string;
  detectedVersion: string | null;
  matchedSignatures: string[];
  missingSignatures: string[];
}

export const CODEX_HOOK_CAPTURE_ASSET_IDS = [
  "post-session-sync",
  "startup-doctor"
] as const;

export const CODEX_HOOK_RECALL_ASSET_IDS = [
  "memory-recall",
  "memory-search",
  "memory-timeline",
  "memory-details"
] as const;

export const CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS = [
  "post-work-memory-review",
  ...CODEX_HOOK_RECALL_ASSET_IDS,
  "recall-bridge-guide",
  "codex-memory-skill"
] as const;

export const READ_ONLY_RETRIEVAL_NOTE =
  "Codex Auto Memory exposes a read-only retrieval MCP plane. Markdown remains the canonical memory surface.";
export const LOCAL_BRIDGE_BUNDLE_NOTE =
  "Hook assets in this repository are local bridge and fallback helpers, not an official Codex hook surface.";
export const CODEX_AGENTS_TARGET_FILE_HINT = "AGENTS.md";
export const CODEX_AGENTS_GUIDANCE_VERSION = "codex-agents-guidance-v1";
export const CODEX_AGENTS_GUIDANCE_VERSION_MARKER = "cam:agents-guidance-version";
export const CODEX_AGENTS_MANAGED_BLOCK_START = "<!-- cam:codex-agents-guidance:start -->";
export const CODEX_AGENTS_MANAGED_BLOCK_END = "<!-- cam:codex-agents-guidance:end -->";
export const CODEX_AGENTS_REQUIRED_SIGNATURES = [
  RETRIEVAL_MCP_SEARCH_TOOL,
  RETRIEVAL_MCP_TIMELINE_TOOL,
  RETRIEVAL_MCP_DETAILS_TOOL,
  "cam recall search",
  "post-work-memory-review.sh",
  "cam memory",
  "cam session",
  LOCAL_BRIDGE_BUNDLE_NOTE
] as const;

interface GuidanceLine {
  lineStart: number;
  lineEnd: number;
  raw: string;
  content: string;
}

interface GuidanceFenceState {
  marker: "`" | "~";
  length: number;
}

interface ManagedBlockRange {
  startIndex: number;
  endIndex: number;
  contents: string;
  body: string;
}

export interface CodexAgentsGuidanceParseResult {
  lineEnding: "\n" | "\r\n" | "\r";
  visibleText: string;
  managedBlock: ManagedBlockRange | null;
  unsafeManagedBlock: boolean;
  unsafeReason?: string;
}

function capitalizeFirstLetter(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function detectLineEnding(contents: string): "\n" | "\r\n" | "\r" {
  if (contents.includes("\r\n")) {
    return "\r\n";
  }

  if (contents.includes("\r")) {
    return "\r";
  }

  return "\n";
}

function readLines(contents: string): GuidanceLine[] {
  if (contents.length === 0) {
    return [];
  }

  const lines: GuidanceLine[] = [];
  let offset = 0;
  while (offset < contents.length) {
    const lineStart = offset;
    while (
      offset < contents.length &&
      contents[offset] !== "\n" &&
      contents[offset] !== "\r"
    ) {
      offset += 1;
    }

    let lineEnd = offset;
    if (contents[offset] === "\r" && contents[offset + 1] === "\n") {
      offset += 2;
      lineEnd = offset;
    } else if (contents[offset] === "\n" || contents[offset] === "\r") {
      offset += 1;
      lineEnd = offset;
    }

    lines.push({
      lineStart,
      lineEnd,
      raw: contents.slice(lineStart, lineEnd),
      content: contents.slice(lineStart, lineEnd).replace(/(?:\r\n|\n|\r)$/u, "")
    });
  }

  return lines;
}

function matchFenceLine(line: string): GuidanceFenceState | null {
  const match = line.match(/^[ \t]*([`~])\1{2,}.*$/u);
  if (!match) {
    return null;
  }

  const marker = match[1] as "`" | "~";
  const sequence = line.trimStart().match(/^([`~]+)/u)?.[1] ?? marker.repeat(3);
  return {
    marker,
    length: sequence.length
  };
}

function isClosingFence(line: string, fence: GuidanceFenceState): boolean {
  const trimmed = line.trimStart();
  const match = trimmed.match(/^([`~]+)/u);
  return Boolean(
    match &&
      match[1]?.[0] === fence.marker &&
      match[1].length >= fence.length
  );
}

export function buildCodexAgentsManagedBlock(
  lineEnding: "\n" | "\r\n" | "\r" = "\n"
): string {
  return [
    CODEX_AGENTS_MANAGED_BLOCK_START,
    buildCodexAgentsGuidance().snippet,
    CODEX_AGENTS_MANAGED_BLOCK_END
  ].join("\n").replace(/\n/g, lineEnding);
}

export function parseCodexAgentsGuidanceContents(
  contents: string
): CodexAgentsGuidanceParseResult {
  const lineEnding = detectLineEnding(contents);
  const lines = readLines(contents);
  let fence: GuidanceFenceState | null = null;
  let managedBlockStart: GuidanceLine | null = null;
  let managedBlockEnd: GuidanceLine | null = null;
  let managedBlockCount = 0;
  let unsafeReason: string | undefined;
  const visibleLines: string[] = [];

  for (const line of lines) {
    if (fence) {
      if (isClosingFence(line.content, fence)) {
        fence = null;
      }
      continue;
    }

    const nextFence = matchFenceLine(line.content);
    if (nextFence) {
      fence = nextFence;
      continue;
    }

    visibleLines.push(line.raw);
    const trimmed = line.content.trim();

    if (trimmed === CODEX_AGENTS_MANAGED_BLOCK_START) {
      managedBlockCount += 1;
      if (managedBlockCount > 1 || managedBlockStart) {
        unsafeReason =
          "Could not update AGENTS.md safely because the managed guidance block markers are duplicated outside fenced code blocks.";
        continue;
      }

      managedBlockStart = line;
      continue;
    }

    if (trimmed === CODEX_AGENTS_MANAGED_BLOCK_END) {
      if (!managedBlockStart || managedBlockEnd) {
        unsafeReason =
          "Could not update AGENTS.md safely because the managed guidance block markers are missing, duplicated, or unbalanced.";
        continue;
      }

      managedBlockEnd = line;
    }
  }

  if ((managedBlockStart && !managedBlockEnd) || (!managedBlockStart && managedBlockEnd)) {
    unsafeReason =
      "Could not update AGENTS.md safely because the managed guidance block markers are missing, duplicated, or unbalanced.";
  }

  const managedBlock =
    managedBlockStart && managedBlockEnd
      ? {
          startIndex: managedBlockStart.lineStart,
          endIndex: managedBlockEnd.lineEnd,
          contents: contents.slice(managedBlockStart.lineStart, managedBlockEnd.lineEnd),
          body: contents
            .slice(managedBlockStart.lineEnd, managedBlockEnd.lineStart)
            .replace(/^(?:\r\n|\n|\r)/u, "")
            .replace(/(?:\r\n|\n|\r)$/u, "")
        }
      : null;

  return {
    lineEnding,
    visibleText: visibleLines.join(""),
    managedBlock,
    unsafeManagedBlock: Boolean(unsafeReason),
    unsafeReason
  };
}

export function formatIntegrationActionHeadline(
  action: IntegrationInstallAction,
  subject: string
): string {
  switch (action) {
    case "created":
      return `Installed ${subject}.`;
    case "updated":
      return `Updated ${subject}.`;
    case "unchanged":
      return `${capitalizeFirstLetter(subject)} is already up to date.`;
  }
}

export function resolveCodexIntegrationRoute(
  readiness: Pick<CodexStackReadiness, "mcpOperationalReady" | "hookRecallReady">
): CodexIntegrationRoute {
  if (readiness.mcpOperationalReady) {
    return "mcp";
  }

  if (readiness.hookRecallReady) {
    return "hooks-fallback";
  }

  return "cli-direct";
}

export function summarizeCodexIntegrationStatus(
  statuses: CodexIntegrationStatus[]
): CodexIntegrationStatus {
  if (statuses.length === 0) {
    return "missing";
  }

  const hasOk = statuses.includes("ok");
  const hasWarning = statuses.includes("warning");
  const hasMissing = statuses.includes("missing");

  if (hasWarning || (hasOk && hasMissing)) {
    return "warning";
  }

  return hasOk ? "ok" : "missing";
}

export function buildCodexStackNotes(): string[] {
  const workflowContract = buildWorkflowContract();
  return [
    READ_ONLY_RETRIEVAL_NOTE,
    LOCAL_BRIDGE_BUNDLE_NOTE,
    "Recommended route prefers project-scoped MCP, then local bridge recall helpers, then direct cam recall CLI usage.",
    `Recommended retrieval preset: ${workflowContract.recommendedPreset}.`,
    ...buildSharedWorkflowDisciplineLines().slice(2),
    `When the local bridge bundle is installed, prefer \`${workflowContract.postWorkSyncReview.helperScript}\` to combine \`${buildPostWorkSyncCommand()}\` with \`${buildPostWorkRecentReviewCommand()}\`.`,
    "Run `cam mcp print-config --host codex` to inspect the recommended project-scoped MCP wiring together with an AGENTS.md snippet for Codex agents.",
    "Run `cam mcp apply-guidance --host codex` to create or update the managed Codex Auto Memory block inside the repository-level AGENTS.md.",
    "Codex skill readiness is guidance-only and does not replace executable hook fallback helpers.",
    "Workflow consistency expects AGENTS guidance, hooks, and skills to stay aligned on the shared search -> timeline -> details contract and recommended preset."
  ];
}

export function buildCodexAgentsGuidance(): CodexAgentsGuidance {
  const workflowContract = buildWorkflowContract();
  const sharedLines = buildSharedWorkflowDisciplineLines();
  const snippet = [
    "## Codex Auto Memory",
    "",
    `<!-- ${CODEX_AGENTS_GUIDANCE_VERSION_MARKER} ${CODEX_AGENTS_GUIDANCE_VERSION} -->`,
    `- ${sharedLines[0]}`,
    `- ${sharedLines[1]}`,
    `- ${workflowContract.routePreference.mcpFirst}`,
    `- ${buildRecommendedMcpSearchInstruction()}`,
    `- If the retrieval MCP server is unavailable, fall back to \`${workflowContract.cliFallback.searchCommand}\`, then \`${workflowContract.cliFallback.timelineCommand}\`, then \`${workflowContract.cliFallback.detailsCommand}\`.`,
    ...sharedLines.slice(2).map((line) => `- ${line}`),
    `- When the local bridge bundle is installed, \`${workflowContract.postWorkSyncReview.helperScript}\` combines \`${workflowContract.postWorkSyncReview.syncCommand}\` with \`${workflowContract.postWorkSyncReview.reviewCommand}\`.`,
    `- ${LOCAL_BRIDGE_BUNDLE_NOTE}`
  ].join("\n");

  return {
    targetFileHint: CODEX_AGENTS_TARGET_FILE_HINT,
    snippetFormat: "markdown",
    snippet,
    notes: [
      "Paste this snippet into the repository-level AGENTS.md so future Codex agents can discover the durable-memory workflow without extra setup.",
      "Keep the snippet additive; do not overwrite existing project-specific AGENTS guidance.",
      LOCAL_BRIDGE_BUNDLE_NOTE
    ]
  };
}

export function detectCodexAgentsGuidanceVersion(contents: string): string | null {
  const match = contents.match(
    new RegExp(`${CODEX_AGENTS_GUIDANCE_VERSION_MARKER}\\s+([A-Za-z0-9._-]+)`, "u")
  );
  return match?.[1] ?? null;
}

export function inspectCodexAgentsGuidance(
  path: string,
  contents: string | null
): CodexAgentsGuidanceInspection {
  if (contents === null) {
    return {
      path,
      exists: false,
      status: "missing",
      expectedVersion: CODEX_AGENTS_GUIDANCE_VERSION,
      detectedVersion: null,
      matchedSignatures: [],
      missingSignatures: [...CODEX_AGENTS_REQUIRED_SIGNATURES]
    };
  }

  const parsed = parseCodexAgentsGuidanceContents(contents);
  const inspectionTarget = parsed.managedBlock?.body ?? parsed.visibleText;
  const normalizedTarget = normalizeLineEndings(inspectionTarget);
  const expectedSnippet = normalizeLineEndings(buildCodexAgentsGuidance().snippet);
  const detectedVersion = detectCodexAgentsGuidanceVersion(normalizedTarget);
  const matchedSignatures = CODEX_AGENTS_REQUIRED_SIGNATURES.filter((signature) =>
    normalizedTarget.includes(signature)
  );
  const missingSignatures = CODEX_AGENTS_REQUIRED_SIGNATURES.filter(
    (signature) => !matchedSignatures.includes(signature)
  );
  const hasCurrentGuidance = parsed.managedBlock
    ? normalizeLineEndings(parsed.managedBlock.body) === expectedSnippet
    : normalizeLineEndings(parsed.visibleText).includes(expectedSnippet);

  return {
    path,
    exists: true,
    status: hasCurrentGuidance ? "ok" : "warning",
    expectedVersion: CODEX_AGENTS_GUIDANCE_VERSION,
    detectedVersion,
    matchedSignatures: [...matchedSignatures],
    missingSignatures: [...missingSignatures]
  };
}

export function buildCodexIntegrationSubchecks(
  readiness: CodexStackReadiness,
  assetAvailability: CodexIntegrationAssetAvailability,
  mcpFallback: CodexIntegrationSubcheck
): CodexIntegrationSubchecks {
  return {
    mcp: !readiness.mcpReady
      ? mcpFallback
      : readiness.mcpOperationalReady
        ? {
            status: "ok",
            summary:
              "Project-scoped retrieval MCP wiring is present and the `cam` command is available."
          }
        : {
            status: "warning",
            summary:
              "Project-scoped retrieval MCP wiring is present, but the current shell could not resolve `cam` on PATH."
          },
    hookCapture: readiness.hookCaptureReady
      ? {
          status: "ok",
          summary: "Capture helpers are ready for post-session sync and startup diagnostics."
        }
      : assetAvailability.hasCaptureAssets
        ? {
            status: "warning",
            summary: "Some capture helpers exist, but the bundle is incomplete or stale."
          }
        : {
            status: "missing",
            summary: "No capture helper bundle is installed yet."
          },
    hookRecall: readiness.hookRecallReady
      ? {
          status: "ok",
          summary: "Recall helpers are ready for shell-based search -> timeline -> details fallback."
        }
      : assetAvailability.hasRecallAssets
        ? {
            status: "warning",
            summary: "Some recall helper assets exist, but the bundle is incomplete or stale."
          }
        : {
            status: "missing",
            summary: "No hook recall helper bundle is installed yet."
          },
    skill: readiness.skillReady
      ? {
          status: "ok",
          summary: "Codex skill guidance is installed for MCP-first, CLI-fallback retrieval."
        }
      : assetAvailability.hasSkillAssets
        ? {
            status: "warning",
            summary: "Skill assets exist, but the installed guidance is stale."
          }
        : {
            status: "missing",
            summary: "No Codex durable-memory skill is installed yet."
          },
    workflowConsistency: readiness.workflowConsistent
      ? {
          status: "ok",
          summary:
            "AGENTS guidance, hooks, and skills agree on the shared search -> timeline -> details workflow and preset."
        }
      : assetAvailability.hasWorkflowAssets
        ? {
            status: "warning",
            summary:
              "Some AGENTS, hook, or skill assets exist, but they do not fully agree on the shared retrieval workflow yet."
          }
        : {
            status: "missing",
            summary: "Shared AGENTS, hook, and skill workflow assets have not been installed yet."
          }
  };
}

export function buildCodexRouteSummary(route: CodexIntegrationRoute): string {
  switch (route) {
    case "mcp":
      return "Project-scoped retrieval MCP is ready and should be the default route.";
    case "hooks-fallback":
      return "Use the hook recall bundle for now; MCP is not fully operational yet.";
    case "cli-direct":
      return "Use cam recall directly until either MCP or hook recall helpers become ready.";
  }
}

function appendProjectRootFlag(command: string, projectRoot?: string): string {
  return appendCliCwdFlag(command, projectRoot);
}

export function buildCodexIntegrationNextSteps(
  readiness: CodexStackReadiness,
  options: {
    skillInstallCommand?: string;
    projectRoot?: string;
  } = {}
): string[] {
  const route = resolveCodexIntegrationRoute(readiness);
  const skillInstallCommand = appendProjectRootFlag(
    options.skillInstallCommand ?? "cam skills install",
    options.projectRoot
  );
  const integrationsInstallCommand = appendProjectRootFlag(
    "cam integrations install --host codex",
    options.projectRoot
  );
  const mcpInstallCommand = appendProjectRootFlag(
    "cam mcp install --host codex",
    options.projectRoot
  );
  const mcpPrintConfigCommand = appendProjectRootFlag(
    "cam mcp print-config --host codex",
    options.projectRoot
  );
  const hooksInstallCommand = appendProjectRootFlag("cam hooks install", options.projectRoot);
  const nextSteps: string[] = [];

  if (
    !readiness.mcpReady &&
    !readiness.hookCaptureReady &&
    !readiness.hookRecallReady &&
    !readiness.skillReady
  ) {
    return [
      `Run \`${integrationsInstallCommand}\` to install the recommended Codex integration stack in one step.`,
      `Until the stack is installed, use \`${buildRecommendedCliSearchCommand("\"<query>\"", { cwd: options.projectRoot })}\` directly.`,
      `Run \`${mcpPrintConfigCommand}\` to print the recommended project-scoped MCP wiring and AGENTS.md snippet.`
    ];
  }

  if (!readiness.mcpReady) {
    nextSteps.push(
      `Run \`${mcpInstallCommand}\` to write the recommended project-scoped retrieval MCP wiring.`
    );
  } else if (!readiness.camCommandAvailable) {
    nextSteps.push(
      "Make sure the host process can resolve `cam` on PATH before relying on the MCP route."
    );
  }

  if (!readiness.hookCaptureReady || !readiness.hookRecallReady) {
    nextSteps.push(
      `Run \`${hooksInstallCommand}\` to refresh the shared hook helper bundle for capture and recall.`
    );
  }

  if (!readiness.skillReady) {
    nextSteps.push(
      `Run \`${skillInstallCommand}\` to install the Codex retrieval skill guidance.`
    );
  }

  if (
    !readiness.workflowAssetsConsistent &&
    (readiness.hookRecallReady || readiness.skillReady)
  ) {
    nextSteps.push(
      `Re-run \`${hooksInstallCommand}\` and \`${skillInstallCommand}\` to realign retrieval guidance and fallback assets.`
    );
  }

  if (route === "mcp") {
    nextSteps.push(
      `Prefer retrieval MCP with the recommended preset \`${formatRecommendedRetrievalPreset()}\`; keep \`cam recall\` as a direct fallback.`
    );
  } else if (route === "hooks-fallback") {
    nextSteps.push(
      "Use `memory-recall.sh search|timeline|details` for the current local bridge fallback path while MCP is being finished."
    );
  } else {
    nextSteps.push(
      `Use \`${buildRecommendedCliSearchCommand("\"<query>\"", { cwd: options.projectRoot })}\` directly until a richer integration route becomes ready.`
    );
  }

  if (route !== "mcp") {
    nextSteps.push(
      `Follow progressive disclosure when using the CLI fallback: \`${buildRecommendedCliSearchCommand("\"<query>\"", { cwd: options.projectRoot })}\`, then \`${buildCliTimelineCommand("\"<ref>\"", { cwd: options.projectRoot })}\`, then \`${buildCliDetailsCommand("\"<ref>\"", { cwd: options.projectRoot })}\`.`
    );
  }

  nextSteps.push(
    `Run \`${mcpPrintConfigCommand}\` to print the recommended project-scoped MCP wiring and AGENTS.md snippet.`
  );
  nextSteps.push(DURABLE_MEMORY_SYNC_GUIDANCE);

  return [...new Set(nextSteps)];
}
