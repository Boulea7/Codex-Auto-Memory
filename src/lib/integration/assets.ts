import os from "node:os";
import path from "node:path";
import {
  buildDurableMemorySyncGuidance,
  buildMarkdownAssetVersionComment,
  buildMcpDoctorGuidance,
  buildRecommendedSearchPresetGuidance,
  buildRecommendedMcpSearchInstruction,
  buildRecommendedRetrievalSummaryLines,
  buildResolvedCliCommand,
  buildResolvedCliDetailsCommand,
  buildResolvedCliSearchCommand,
  buildResolvedCliTimelineCommand,
  buildResolvedPostWorkRecentReviewCommand,
  buildResolvedPostWorkSyncCommand,
  buildSharedWorkflowDisciplineLines,
  buildShellAssetVersionComment,
  CLI_FALLBACK_RECALL_WORKFLOW,
  MCP_FIRST_RECALL_WORKFLOW,
  MCP_SERVE_GUIDANCE,
  POST_WORK_SYNC_REVIEW_HELPER,
  RECOMMENDED_RETRIEVAL_LIMIT,
  RECOMMENDED_RETRIEVAL_STATE,
  RETRIEVAL_INTEGRATION_ASSET_VERSION,
  RETRIEVAL_MCP_DETAILS_TOOL,
  RETRIEVAL_MCP_SEARCH_TOOL,
  RETRIEVAL_MCP_TIMELINE_TOOL
} from "./retrieval-contract.js";
import { LOCAL_BRIDGE_BUNDLE_NOTE } from "./codex-stack.js";
import {
  CODEX_MEMORY_SKILL_NAME,
  type CodexSkillInstallSurface,
  resolveCodexSkillInstallDir,
  resolveCodexSkillPaths
} from "./skills-paths.js";

export interface GeneratedAsset {
  relativePath: string;
  contents: string;
  executable?: boolean;
}

export type IntegrationAssetInstallSurface = "hooks" | "skills";
export type IntegrationAssetRole = "capture-helper" | "recall-helper" | "guidance";

export interface InstalledIntegrationAssetDescriptor {
  id: string;
  name: string;
  path: string;
  installSurface: IntegrationAssetInstallSurface;
  role: IntegrationAssetRole;
  expectedVersion: string;
  expectedSignatures: string[];
  executableExpected: boolean;
  doctorVisible: boolean;
  relativePath: string;
  contents: string;
}

interface IntegrationAssetContext {
  projectRoot?: string;
  hookDir: string;
  skillDir: string;
  skillSurface: CodexSkillInstallSurface;
}

interface IntegrationAssetDefinition {
  id: string;
  name: string;
  installSurface: IntegrationAssetInstallSurface;
  relativePath: string;
  executable?: boolean;
  role: IntegrationAssetRole;
  doctorVisible: boolean;
  doctorSignatures?: string[];
  renderContents: (context: IntegrationAssetContext) => string;
}

function buildDoctorSignatures(
  asset: IntegrationAssetDefinition,
  contents: string
): string[] {
  if (asset.id !== "codex-memory-skill") {
    return [...(asset.doctorSignatures ?? [])];
  }

  return [
    "name: codex-auto-memory-recall",
    "search_memories",
    "post-work-memory-review.sh",
    contents.includes('node "') ? 'node "' : "cam sync",
    "memory --recent"
  ];
}

function buildIntegrationAssetContext(
  homeDir = os.homedir(),
  projectRoot = process.cwd(),
  skillSurface: CodexSkillInstallSurface = "runtime",
  installSurface?: IntegrationAssetInstallSurface
): IntegrationAssetContext {
  const skillPaths =
    installSurface === "hooks"
      ? null
      : resolveCodexSkillPaths(projectRoot, homeDir);
  return {
    projectRoot: skillSurface === "official-project" ? projectRoot : undefined,
    hookDir: hookAssetDir(homeDir),
    skillDir:
      skillPaths === null
        ? path.join(homeDir, ".codex", "skills", CODEX_MEMORY_SKILL_NAME)
        : resolveCodexSkillInstallDir(skillPaths, skillSurface),
    skillSurface
  };
}

function resolveInstallDir(
  surface: IntegrationAssetInstallSurface,
  context: IntegrationAssetContext
): string {
  return surface === "hooks" ? context.hookDir : context.skillDir;
}

function buildProjectRootResolutionBlock(projectRoot?: string): string {
  if (projectRoot) {
    const escapedProjectRoot = projectRoot.replace(/'/g, "'\"'\"'");
    return `PROJECT_ROOT='${escapedProjectRoot}'
`;
  }

  return 'PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"\n';
}

function buildRecallDispatcherScript(projectRoot?: string): string {
  return `#!/bin/sh
${buildShellAssetVersionComment()}
# Dispatch recall lookups through a single host-agnostic bridge helper.

${buildProjectRootResolutionBlock(projectRoot)}
ACTION="$1"
if [ "$#" -gt 0 ]; then
  shift
fi

contains_flag() {
  FLAG="$1"
  shift
  for ARG in "$@"; do
    case "$ARG" in
      "$FLAG"|"$FLAG"=*)
      return 0
      ;;
    esac
  done
  return 1
}

case "$ACTION" in
  search)
    if ! contains_flag "--cwd" "$@"; then
      set -- "$@" "--cwd" "$PROJECT_ROOT"
    fi
    if ! contains_flag "--state" "$@"; then
      set -- "$@" "--state" "${RECOMMENDED_RETRIEVAL_STATE}"
    fi
    if ! contains_flag "--limit" "$@"; then
      set -- "$@" "--limit" "${RECOMMENDED_RETRIEVAL_LIMIT}"
    fi
    exec ${buildResolvedCliCommand("recall search")} "$@"
    ;;
  timeline)
    if ! contains_flag "--cwd" "$@"; then
      set -- "$@" "--cwd" "$PROJECT_ROOT"
    fi
    exec ${buildResolvedCliCommand("recall timeline")} "$@"
    ;;
  details)
    if ! contains_flag "--cwd" "$@"; then
      set -- "$@" "--cwd" "$PROJECT_ROOT"
    fi
    exec ${buildResolvedCliCommand("recall details")} "$@"
    ;;
  *)
    echo "Usage: memory-recall.sh <search|timeline|details> <args...>" >&2
    exit 1
    ;;
esac
`;
}

function buildRecallWrapperScript(action: "search" | "timeline" | "details"): string {
  return `#!/bin/sh
${buildShellAssetVersionComment()}
# Compatibility wrapper around memory-recall.sh for hosts that already expect this file name.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SCRIPT_DIR/memory-recall.sh" ${action} "$@"
`;
}

function buildRecallBridgeGuideMarkdown(projectRoot?: string): string {
  const resolvedSearchCommand = buildResolvedCliSearchCommand(
    "\"pnpm\"",
    projectRoot ? { cwd: projectRoot } : {}
  );
  return `# Codex Auto Memory Recall Bridge

${buildMarkdownAssetVersionComment()}

This bundle keeps durable-memory recall host-agnostic.

- ${LOCAL_BRIDGE_BUNDLE_NOTE}

## Preferred path

- ${MCP_FIRST_RECALL_WORKFLOW}
- ${buildRecommendedMcpSearchInstruction()}
- ${MCP_SERVE_GUIDANCE}
- ${buildMcpDoctorGuidance(projectRoot ? { cwd: projectRoot } : {})}

## CLI fallback bundle

- ${CLI_FALLBACK_RECALL_WORKFLOW}
- Search example: \`memory-recall.sh search "pnpm"\`
- CLI equivalent: \`${resolvedSearchCommand}\`
- Timeline example: \`memory-recall.sh timeline "project:active:workflow:prefer-pnpm"\`
- Details example: \`memory-recall.sh details "project:active:workflow:prefer-pnpm"\`
- Compatibility wrappers \`memory-search.sh\`, \`memory-timeline.sh\`, and \`memory-details.sh\` call the same dispatcher.
- ${buildRecommendedSearchPresetGuidance()}

## Boundaries

${buildSharedWorkflowDisciplineLines(projectRoot ? { cwd: projectRoot } : {})
  .slice(2)
  .map((line) => `- ${line}`)
  .join("\n")}

## Workflow discipline

1. Search first.
2. Inspect timeline only for promising refs.
3. Fetch full details only when you still need the full Markdown body.
4. ${buildSharedWorkflowDisciplineLines(projectRoot ? { cwd: projectRoot } : {})[2]}
`;
}

function buildPostWorkMemoryReviewScript(projectRoot?: string): string {
  return `#!/bin/sh
${buildShellAssetVersionComment()}
# Sync the latest durable memory updates, then show the recent audit surface for review.
${buildProjectRootResolutionBlock(projectRoot)}${buildResolvedPostWorkSyncCommand()} --cwd "$PROJECT_ROOT" "$@" || exit $?
exec ${buildResolvedPostWorkRecentReviewCommand()} --cwd "$PROJECT_ROOT"
`;
}

function buildCodexSkillMarkdown(projectRoot?: string): string {
  const commandOptions = projectRoot ? { cwd: projectRoot } : {};
  return `---
name: codex-auto-memory-recall
description: Search Codex Auto Memory before repeating work. Use when the user asks whether we solved something before, asks for prior repo-specific decisions, or wants past fixes, preferences, or architecture context.
---

${buildMarkdownAssetVersionComment()}

# Codex Auto Memory Recall

Use this skill when the question is about durable memory from previous sessions, not just the current thread.

## When to Use

- "Did we already solve this?"
- "What did we decide last time?"
- "What are this repo's standing preferences or commands?"
- Before risky edits in an unfamiliar part of the repository, when prior durable memory could narrow the search space.

## Workflow

Always use progressive disclosure.

Prefer the host's retrieval MCP tools when Codex Auto Memory has been wired in as an MCP server:

- \`${RETRIEVAL_MCP_SEARCH_TOOL}\`
- \`${RETRIEVAL_MCP_TIMELINE_TOOL}\`
- \`${RETRIEVAL_MCP_DETAILS_TOOL}\`

Recommended MCP-first search preset:

- \`${buildRecommendedMcpSearchInstruction()}\`

Otherwise fall back to the local bridge bundle first:

1. Search first:
   \`memory-recall.sh search "<query>"\`
2. Inspect timeline for promising refs:
   \`memory-recall.sh timeline "<ref>"\`
3. Fetch full details only for the refs that still look relevant:
   \`memory-recall.sh details "<ref>"\`

If the local bridge bundle is unavailable, fall back to the resolved CLI workflow:

1. Search first:
   \`${buildResolvedCliSearchCommand("\"<query>\"", commandOptions)}\`
2. Inspect timeline for promising refs:
   \`${buildResolvedCliTimelineCommand("\"<ref>\"", commandOptions)}\`
3. Fetch full details only for the refs that still look relevant:
   \`${buildResolvedCliDetailsCommand("\"<ref>\"", commandOptions)}\`

If you need both active and archived results in one pass instead of active-first fallback:

- \`${buildResolvedCliSearchCommand("\"<query>\"", projectRoot ? { state: "all", cwd: projectRoot } : { state: "all" })}\`

## Guardrails

- Do not jump straight to \`cam recall details\` for every result.
- ${LOCAL_BRIDGE_BUNDLE_NOTE}
- \`cam mcp serve\` exposes the same retrieval contract over stdio MCP when the host can consume it.
- If you are unsure whether retrieval MCP is wired into the current host, run \`${buildResolvedCliCommand("mcp doctor --host codex", commandOptions)}\`.
- If a host needs shell-based fallback assets, run \`${buildResolvedCliCommand("hooks install", commandOptions)}\` and use the generated recall bridge bundle.
- If available, run \`${POST_WORK_SYNC_REVIEW_HELPER}\` to combine \`${buildResolvedPostWorkSyncCommand(commandOptions)}\` with \`${buildResolvedPostWorkRecentReviewCommand(commandOptions)}\`.
- ${buildDurableMemorySyncGuidance(commandOptions)}
- Use \`cam memory\` for inspect/audit surfaces, startup payload, and recent sync review.
- Use \`cam session\` only for temporary continuity, not durable memory retrieval.
- If the task is about resuming current work rather than retrieving stable durable memory, inspect \`${buildResolvedCliCommand("session status --json", commandOptions)}\` or \`${buildResolvedCliCommand("session load --json", commandOptions)}\` and treat resume context as additive reviewer guidance.
- Treat archived memory as historical context that does not participate in default startup recall.
- If recall finds nothing useful, continue with normal repository inspection instead of forcing a memory answer.
`;
}

const INTEGRATION_ASSET_DEFINITIONS: readonly IntegrationAssetDefinition[] = [
  {
    id: "post-session-sync",
    name: "post-session-sync.sh",
    installSurface: "hooks",
    relativePath: "post-session-sync.sh",
    executable: true,
    role: "capture-helper",
    doctorVisible: true,
    doctorSignatures: ['PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"', ' sync --cwd "$PROJECT_ROOT"'],
    renderContents: (context) =>
      `#!/bin/sh
${buildShellAssetVersionComment()}
# Sync the latest rollout for the current project.
${buildProjectRootResolutionBlock(context.projectRoot)}${buildResolvedCliCommand("sync")} --cwd "$PROJECT_ROOT" "$@"
`
  },
  {
    id: "startup-doctor",
    name: "startup-doctor.sh",
    installSurface: "hooks",
    relativePath: "startup-doctor.sh",
    executable: true,
    role: "capture-helper",
    doctorVisible: true,
    doctorSignatures: ['PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"', ' doctor --cwd "$PROJECT_ROOT"'],
    renderContents: (context) =>
      `#!/bin/sh
${buildShellAssetVersionComment()}
# Print diagnostic information at session start.
${buildProjectRootResolutionBlock(context.projectRoot)}${buildResolvedCliCommand("doctor")} --cwd "$PROJECT_ROOT" "$@"
`
  },
  {
    id: "post-work-memory-review",
    name: POST_WORK_SYNC_REVIEW_HELPER,
    installSurface: "hooks",
    relativePath: POST_WORK_SYNC_REVIEW_HELPER,
    executable: true,
    role: "capture-helper",
    doctorVisible: true,
    doctorSignatures: ['PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"', ' sync --cwd "$PROJECT_ROOT"', ' memory --recent --cwd "$PROJECT_ROOT"'],
    renderContents: (context) => buildPostWorkMemoryReviewScript(context.projectRoot)
  },
  {
    id: "memory-recall",
    name: "memory-recall.sh",
    installSurface: "hooks",
    relativePath: "memory-recall.sh",
    executable: true,
    role: "recall-helper",
    doctorVisible: true,
    doctorSignatures: [
      'PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"',
      ' recall search "$@"',
      ' recall timeline "$@"',
      ' recall details "$@"'
    ],
    renderContents: (context) => buildRecallDispatcherScript(context.projectRoot)
  },
  {
    id: "memory-search",
    name: "memory-search.sh",
    installSurface: "hooks",
    relativePath: "memory-search.sh",
    executable: true,
    role: "recall-helper",
    doctorVisible: true,
    doctorSignatures: ['exec "$SCRIPT_DIR/memory-recall.sh" search "$@"'],
    renderContents: () => buildRecallWrapperScript("search")
  },
  {
    id: "memory-timeline",
    name: "memory-timeline.sh",
    installSurface: "hooks",
    relativePath: "memory-timeline.sh",
    executable: true,
    role: "recall-helper",
    doctorVisible: true,
    doctorSignatures: ['exec "$SCRIPT_DIR/memory-recall.sh" timeline "$@"'],
    renderContents: () => buildRecallWrapperScript("timeline")
  },
  {
    id: "memory-details",
    name: "memory-details.sh",
    installSurface: "hooks",
    relativePath: "memory-details.sh",
    executable: true,
    role: "recall-helper",
    doctorVisible: true,
    doctorSignatures: ['exec "$SCRIPT_DIR/memory-recall.sh" details "$@"'],
    renderContents: () => buildRecallWrapperScript("details")
  },
  {
    id: "recall-bridge-guide",
    name: "recall-bridge.md",
    installSurface: "hooks",
    relativePath: "recall-bridge.md",
    role: "guidance",
    doctorVisible: true,
    doctorSignatures: [
      "search_memories",
      'memory-recall.sh search "pnpm"',
      "Workflow discipline"
    ],
    renderContents: (context) => buildRecallBridgeGuideMarkdown(context.projectRoot)
  },
  {
    id: "codex-memory-skill",
    name: `${CODEX_MEMORY_SKILL_NAME} SKILL.md`,
    installSurface: "skills",
    relativePath: "SKILL.md",
    role: "guidance",
    doctorVisible: true,
    doctorSignatures: [
      "name: codex-auto-memory-recall",
      "search_memories",
      "post-work-memory-review.sh",
      "node \"",
      "memory --recent"
    ],
    renderContents: (context) => buildCodexSkillMarkdown(context.projectRoot)
  }
] as const;

export function hookAssetDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codex-auto-memory", "hooks");
}

export function codexSkillAssetDir(homeDir = os.homedir()): string {
  return resolveCodexSkillPaths(process.cwd(), homeDir).runtimeAssetDir;
}

export function codexSkillAssetDirForSurface(
  surface: CodexSkillInstallSurface,
  projectRoot = process.cwd(),
  homeDir = os.homedir()
): string {
  return resolveCodexSkillInstallDir(
    resolveCodexSkillPaths(projectRoot, homeDir),
    surface
  );
}

export function codexOfficialUserSkillAssetDir(homeDir = os.homedir()): string {
  return resolveCodexSkillPaths(process.cwd(), homeDir).officialUserSkillDir;
}

export function codexOfficialProjectSkillAssetDir(projectRoot: string): string {
  return resolveCodexSkillPaths(projectRoot).officialProjectSkillDir;
}

export function buildHookAssets(
  homeDir = os.homedir(),
  projectRoot = process.cwd()
): GeneratedAsset[] {
  return listIntegrationAssets(homeDir, "hooks", { projectRoot }).map((asset) => ({
    relativePath: asset.relativePath,
    contents: asset.contents,
    executable: asset.executableExpected
  }));
}

export function buildCodexSkillAssets(homeDir = os.homedir()): GeneratedAsset[] {
  return listIntegrationAssets(homeDir, "skills").map((asset) => ({
    relativePath: asset.relativePath,
    contents: asset.contents,
    executable: asset.executableExpected
  }));
}

export function listIntegrationAssets(
  homeDir = os.homedir(),
  installSurface?: IntegrationAssetInstallSurface,
  options: {
    projectRoot?: string;
    skillSurface?: CodexSkillInstallSurface;
  } = {}
): InstalledIntegrationAssetDescriptor[] {
  const context = buildIntegrationAssetContext(
    homeDir,
    options.projectRoot,
    options.skillSurface,
    installSurface
  );
  return INTEGRATION_ASSET_DEFINITIONS.filter(
    (asset) => installSurface === undefined || asset.installSurface === installSurface
  ).map((asset) => ({
    id: asset.id,
    name: asset.name,
    path: path.join(resolveInstallDir(asset.installSurface, context), asset.relativePath),
    installSurface: asset.installSurface,
    role: asset.role,
    expectedVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    expectedSignatures: buildDoctorSignatures(asset, asset.renderContents(context)),
    executableExpected: Boolean(asset.executable),
    doctorVisible: asset.doctorVisible,
    relativePath: asset.relativePath,
    contents: asset.renderContents(context)
  }));
}

export function listDoctorVisibleIntegrationAssets(
  homeDir = os.homedir(),
  options: {
    projectRoot?: string;
    skillSurface?: CodexSkillInstallSurface;
  } = {}
): InstalledIntegrationAssetDescriptor[] {
  return listIntegrationAssets(homeDir, undefined, options).filter((asset) => asset.doctorVisible);
}

export function buildRecallBridgeSummaryLines(
  options: {
    cwd?: string;
  } = {}
): string[] {
  return buildRecommendedRetrievalSummaryLines(options);
}
