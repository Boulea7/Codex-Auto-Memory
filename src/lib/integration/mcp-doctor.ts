import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import * as toml from "smol-toml";
import {
  listIntegrationAssets,
  listDoctorVisibleIntegrationAssets
} from "./assets.js";
import {
  buildCodexStackNotes,
  buildExperimentalCodexHooksGuidance,
  inspectCodexAgentsGuidance,
  CODEX_HOOK_CAPTURE_ASSET_IDS,
  CODEX_HOOK_RECALL_ASSET_IDS,
  CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS,
  resolveCodexIntegrationRoute,
  summarizeCodexIntegrationStatus,
  type CodexAgentsGuidanceInspection,
  type CodexIntegrationRoute,
  type ExperimentalCodexHooksGuidance
} from "./codex-stack.js";
import { inspectCodexAgentsGuidanceApplySafety } from "./agents-guidance.js";
import {
  buildResolvedCliCommand,
  buildWorkflowContract,
  detectIntegrationAssetVersion,
  formatRecommendedRetrievalPreset,
  RETRIEVAL_INTEGRATION_ASSET_VERSION
} from "./retrieval-contract.js";
import { isCommandAvailableInPath } from "./command-path.js";
import {
  buildInstructionReviewLane,
  getDreamCandidateProposalArtifactPath,
  getLatestDreamProposalCandidate,
  listDreamCandidates
} from "../domain/dream-candidates.js";
import { discoverInstructionLayer } from "../domain/instruction-memory.js";
import {
  getMcpHostDefinition,
  inspectCanonicalMcpServerConfig,
  listMcpHosts,
  MEMORY_RETRIEVAL_MCP_SERVER_NAME,
  normalizeMcpDoctorHostSelection,
  resolveMcpHostProjectConfigPath,
  resolveMcpHostUserConfigPath,
  SUPPORTED_MCP_DOCTOR_HOST_SELECTIONS,
  SUPPORTED_MCP_HOSTS,
  SUPPORTED_MCP_INSTALL_HOSTS,
  type McpDoctorHostSelection,
  type McpHost,
  type McpHostPinningMode
} from "./mcp-hosts.js";
import {
  resolveCodexSkillPaths,
  type CodexSkillInstallSurface,
  type CodexSkillPathResolution
} from "./skills-paths.js";
import { fileExists, readTextFile } from "../util/fs.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import { resolveMcpProjectCwd, resolveMcpProjectRoot } from "./mcp-config.js";
import type { RetrievalSidecarCheck } from "../domain/memory-store.js";
import type { MemoryLayoutDiagnostic, TopicFileDiagnostic } from "../types.js";

type McpDoctorStatus = "ok" | "warning" | "missing" | "manual";
type McpDoctorConfigInspection = "ok" | "missing" | "parse-error" | "shape-mismatch";
type McpDoctorConfigScope = "project" | "global";
type McpDoctorRecommendedScope = "project" | "manual";
type McpDoctorWritableHost = Extract<McpHost, "codex">;
type McpDoctorConfigScopeSummary =
  | "manual-only"
  | "project-ready"
  | "project-invalid"
  | "project-shape-mismatch"
  | "project-missing"
  | "project-missing-global-alternate"
  | "project-missing-global-invalid";

interface McpDoctorCommandSurface {
  install: boolean;
  serve: true;
  printConfig: true;
  applyGuidance: boolean;
  doctor: true;
  installHosts: readonly McpDoctorWritableHost[];
  applyGuidanceHosts: readonly McpDoctorWritableHost[];
  printConfigHosts: readonly McpHost[];
  doctorHostSelections: readonly McpDoctorHostSelection[];
}

interface McpDoctorConfigCheck {
  scope: McpDoctorConfigScope;
  path: string;
  exists: boolean;
  hasServerName: boolean;
  hasCamCommand: boolean;
  hasServeInvocation: boolean;
  projectPinned: boolean;
}

interface McpDoctorConfigIssue {
  scope: McpDoctorConfigScope;
  path: string;
  inspection: Exclude<McpDoctorConfigInspection, "ok" | "missing">;
}

interface McpDoctorAlternateWiring {
  detected: boolean;
  valid: boolean;
  scopes: McpDoctorConfigScope[];
  issues: McpDoctorConfigIssue[];
}

interface McpDoctorConfigInspectionResult {
  inspection: McpDoctorConfigInspection;
  configCheck?: McpDoctorConfigCheck;
}

interface McpDoctorHostReport {
  host: McpHost;
  status: McpDoctorStatus;
  targetFileHint: string;
  pinning: McpHostPinningMode;
  recommendedScope: McpDoctorRecommendedScope;
  configScopeSummary: McpDoctorConfigScopeSummary;
  detectedScopes: McpDoctorConfigScope[];
  alternateWiring: McpDoctorAlternateWiring;
  summary: string;
  notes: string[];
  configCheck?: McpDoctorConfigCheck;
  alternateConfigChecks?: McpDoctorConfigCheck[];
}

interface McpDoctorAssetCheck {
  id: string;
  name: string;
  path: string;
  installed: boolean;
  status: "ok" | "missing" | "stale";
  expectedVersion: string;
  detectedVersion: string | null;
  installSurface: "hooks" | "skills";
  role: "capture-helper" | "recall-helper" | "guidance";
  executableExpected: boolean;
  executableOk: boolean | null;
  launcher?: {
    resolution: "cam-path" | "node-dist" | "shell-wrapper" | "none" | "mixed";
    operational: boolean;
    commandCount: number;
    missingPaths: string[];
  };
}

function hasExpectedAssetSignatures(contents: string, expectedSignatures: string[]): boolean {
  return expectedSignatures.every((signature) => contents.includes(signature));
}

interface SkillSurfaceInspection {
  installed: boolean;
  contents: string | null;
  matchesCanonical: boolean;
  ready: boolean;
}

interface SkillSurfaceState {
  installed: boolean;
  discoverable: boolean;
  listed: boolean;
  executable: boolean;
  matchesCanonical: boolean;
  preferred: boolean;
}

async function inspectSkillSurfaceFile(
  skillDir: string,
  canonicalContents: string
): Promise<SkillSurfaceInspection> {
  const skillFilePath = path.join(skillDir, "SKILL.md");
  const installed = await fileExists(skillFilePath);
  if (!installed) {
    return {
      installed,
      contents: null,
      matchesCanonical: false,
      ready: false
    };
  }

  const contents = await readTextFile(skillFilePath);
  const matchesCanonical = contents === canonicalContents;
  return {
    installed,
    contents,
    matchesCanonical,
    ready:
      matchesCanonical &&
      detectIntegrationAssetVersion(contents) === RETRIEVAL_INTEGRATION_ASSET_VERSION
  };
}

interface McpDoctorFallbackAssets {
  hooksDir: string;
  skillDir: string;
  runtimeSkillDir: string;
  runtimeAssetDir: string;
  runtimeSource: CodexSkillPathResolution["runtimeSource"];
  preferredInstallSurface: CodexSkillInstallSurface;
  recommendedSkillInstallCommand: string;
  officialUserSkillDir: string;
  officialProjectSkillDir: string;
  runtimeSkillPresent: boolean;
  runtimeSkillInstalled: boolean;
  officialUserSkillInstalled: boolean;
  officialProjectSkillInstalled: boolean;
  runtimeSkillMatchesCanonical: boolean;
  officialUserSkillMatchesCanonical: boolean;
  officialProjectSkillMatchesCanonical: boolean;
  officialUserSkillMatchesRuntime: boolean;
  officialProjectSkillMatchesRuntime: boolean;
  runtimeSkillReady: boolean;
  officialUserSkillReady: boolean;
  officialProjectSkillReady: boolean;
  anySkillSurfaceInstalled: boolean;
  anySkillSurfaceReady: boolean;
  preferredSkillSurfaceReady: boolean;
  installedSkillSurfaces: CodexSkillInstallSurface[];
  readySkillSurfaces: CodexSkillInstallSurface[];
  skillSurfaces: Record<CodexSkillInstallSurface, SkillSurfaceState>;
  skillPathDrift: boolean;
  postSessionSyncInstalled: boolean;
  postWorkReviewInstalled: boolean;
  captureHelpersInstalled: boolean;
  hookHelpersInstalled: boolean;
  startupDoctorInstalled: boolean;
  skillInstalled: boolean;
  shellFallbackAvailable: boolean;
  guidanceAvailable: boolean;
  fallbackAvailable: boolean;
  assets: McpDoctorAssetCheck[];
}

function inspectExecutableAssetLauncher(
  contents: string,
  camCommandAvailable: boolean
): McpDoctorAssetCheck["launcher"] {
  if (contents.includes('exec "$SCRIPT_DIR/memory-recall.sh"')) {
    return {
      resolution: "shell-wrapper",
      operational: true,
      commandCount: 1,
      missingPaths: []
    };
  }

  const camMatches = contents.match(/(?:^|\s)(?:exec\s+)?cam(?:\s|$)/gmu) ?? [];
  const nodeMatches = [...contents.matchAll(/(?:^|\s)(?:exec\s+)?node\s+"([^"]+cli\.js)"/gmu)];
  const nodePaths = nodeMatches.map((match) => match[1]).filter((value): value is string => Boolean(value));
  const missingPaths = nodePaths.filter((launcherPath) => !fssync.existsSync(launcherPath));
  const commandCount = camMatches.length + nodePaths.length;

  if (camMatches.length > 0 && nodePaths.length > 0) {
    return {
      resolution: "mixed",
      operational: camCommandAvailable && missingPaths.length === 0,
      commandCount,
      missingPaths
    };
  }

  if (nodePaths.length > 0) {
    return {
      resolution: "node-dist",
      operational: missingPaths.length === 0,
      commandCount,
      missingPaths
    };
  }

  if (camMatches.length > 0) {
    return {
      resolution: "cam-path",
      operational: camCommandAvailable,
      commandCount,
      missingPaths: []
    };
  }

  return {
    resolution: "none",
    operational: true,
    commandCount: 0,
    missingPaths: []
  };
}

function isAssetOperational(
  assets: McpDoctorAssetCheck[],
  ids: string[]
): boolean {
  return ids.every((id) => {
    const asset = assets.find((candidate) => candidate.id === id);
    if (!asset || asset.status !== "ok") {
      return false;
    }

    return asset.launcher?.operational ?? true;
  });
}

interface McpDoctorRetrievalSidecarReport {
  status: "ok" | "warning";
  summary: string;
  repairCommand: string;
  checks: RetrievalSidecarCheck[];
}

interface McpDoctorTopicDiagnosticsReport {
  status: "ok" | "warning";
  summary: string;
  diagnostics: TopicFileDiagnostic[];
}

interface McpDoctorLayoutDiagnosticsReport {
  status: "ok" | "warning";
  summary: string;
  diagnostics: MemoryLayoutDiagnostic[];
}

interface McpDoctorInstructionProposalLaneReport {
  status: "ok" | "warning";
  summary: string;
  detectedTargets: string[];
  latestProposalArtifactPath: string | null;
  latestCandidateId: string | null;
  selectedTargetFile: string | null;
  selectedTargetKind: string | null;
  targetHost: string | null;
  applyReadinessStatus: string | null;
  recommendedInspectCommand: string;
  recommendedReviewCommand: string;
  recommendedApplyPrepCommand: string;
  recommendedVerifyApplyCommand: string;
}

export interface McpDoctorReport {
  cwd: string;
  projectRoot: string;
  cwdWithinProjectRoot: boolean;
  serverName: string;
  readOnlyRetrieval: true;
  commandSurface: McpDoctorCommandSurface;
  agentsGuidance: CodexAgentsGuidanceInspection | null;
  applySafety: Awaited<ReturnType<typeof inspectCodexAgentsGuidanceApplySafety>> | null;
  fallbackAssets: McpDoctorFallbackAssets;
  retrievalSidecar: McpDoctorRetrievalSidecarReport;
  topicDiagnostics: McpDoctorTopicDiagnosticsReport;
  layoutDiagnostics: McpDoctorLayoutDiagnosticsReport;
  instructionProposalLane: McpDoctorInstructionProposalLaneReport;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  experimentalHooks: ExperimentalCodexHooksGuidance | null;
  hosts: McpDoctorHostReport[];
  codexStack: {
    status: McpDoctorStatus;
    recommendedRoute: CodexIntegrationRoute;
    currentlyOperationalRoute: CodexIntegrationRoute;
    routeKind: "preferred-mcp" | "fallback-hooks" | "fallback-cli";
    routeEvidence: string[];
    shellDependencyLevel: "required" | "partial";
    hostMutationRequired: boolean;
    preferredRouteBlockers: string[];
    currentOperationalBlockers: string[];
    preset: string;
    assetVersion: string;
    mcpReady: boolean;
    mcpOperationalReady: boolean;
    camCommandAvailable: boolean;
    hookCaptureReady: boolean;
    hookCaptureOperationalReady: boolean;
    hookRecallReady: boolean;
    hookRecallOperationalReady: boolean;
    skillReady: boolean;
    workflowAssetsConsistent: boolean;
    workflowConsistent: boolean;
    notes: string[];
  } | null;
}

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function normalizeComparablePath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}

function formatPinning(pinning: McpHostPinningMode): string {
  switch (pinning) {
    case "cwd-field":
      return "cwd field";
    case "cwd-arg":
      return "--cwd argument";
    case "manual":
      return "manual";
  }
}

function selectionIncludesCodex(selection: McpDoctorHostSelection): boolean {
  return selection === "all" || selection === "codex";
}

function buildCommandSurface(
  selection: McpDoctorHostSelection
): McpDoctorCommandSurface {
  const codexSelected = selectionIncludesCodex(selection);
  return {
    install: codexSelected,
    serve: true,
    printConfig: true,
    applyGuidance: codexSelected,
    doctor: true,
    installHosts: [...SUPPORTED_MCP_INSTALL_HOSTS],
    applyGuidanceHosts: [...SUPPORTED_MCP_INSTALL_HOSTS],
    printConfigHosts: [...SUPPORTED_MCP_HOSTS],
    doctorHostSelections: [...SUPPORTED_MCP_DOCTOR_HOST_SELECTIONS]
  };
}

async function inspectHostConfig(
  host: McpHost,
  projectRoot: string,
  configPath: string | null,
  scope: McpDoctorConfigScope
): Promise<McpDoctorConfigInspectionResult> {
  if (!configPath) {
    return {
      inspection: "missing"
    };
  }

  const exists = await fileExists(configPath);
  if (!exists) {
    return {
      inspection: "missing",
      configCheck: {
        scope,
        path: configPath,
        exists: false,
        hasServerName: false,
        hasCamCommand: false,
        hasServeInvocation: false,
        projectPinned: false
      }
    };
  }

  const rawConfig = await readTextFile(configPath);
  if (host === "codex") {
    let parsedConfig: unknown;
    try {
      parsedConfig = toml.parse(rawConfig);
    } catch {
      return {
        inspection: "parse-error",
        configCheck: {
          scope,
          path: configPath,
          exists: true,
          hasServerName: false,
          hasCamCommand: false,
          hasServeInvocation: false,
          projectPinned: false
        }
      };
    }

    const mcpServers = isRecordLike(parsedConfig) && isRecordLike(parsedConfig.mcp_servers)
      ? parsedConfig.mcp_servers
      : null;
    const serverConfig = mcpServers?.[MEMORY_RETRIEVAL_MCP_SERVER_NAME];
    const configCheck = await inspectCanonicalMcpServerConfig("codex", serverConfig, projectRoot);

    return {
      inspection:
        configCheck.hasServerName &&
        configCheck.hasCamCommand &&
        configCheck.hasServeInvocation &&
        configCheck.projectPinned
        ? "ok"
        : "shape-mismatch",
      configCheck: {
        scope,
        path: configPath,
        exists: true,
        ...configCheck
      }
    };
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig) as unknown;
  } catch {
    return {
      inspection: "parse-error",
      configCheck: {
        scope,
        path: configPath,
        exists: true,
        hasServerName: false,
        hasCamCommand: false,
        hasServeInvocation: false,
        projectPinned: false
      }
    };
  }

  const structuredHost = host === "claude" ? "claude" : "gemini";
  const mcpServers = isRecordLike(parsedConfig) && isRecordLike(parsedConfig.mcpServers)
    ? parsedConfig.mcpServers
    : null;
  const serverConfig = mcpServers?.[MEMORY_RETRIEVAL_MCP_SERVER_NAME];
  const configCheck = await inspectCanonicalMcpServerConfig(
    structuredHost,
    serverConfig,
    projectRoot
  );

  return {
    inspection:
      configCheck.hasServerName &&
      configCheck.hasCamCommand &&
      configCheck.hasServeInvocation &&
      configCheck.projectPinned
      ? "ok"
      : "shape-mismatch",
    configCheck: {
      scope,
      path: configPath,
      exists: true,
      ...configCheck
    }
  };
}

function hasDetectedWiring(inspectionResult: McpDoctorConfigInspectionResult): boolean {
  return inspectionResult.inspection === "ok";
}

function buildConfigIssue(
  inspectionResult: McpDoctorConfigInspectionResult
): McpDoctorConfigIssue | null {
  const configCheck = inspectionResult.configCheck;
  if (
    !configCheck ||
    inspectionResult.inspection === "ok" ||
    inspectionResult.inspection === "missing"
  ) {
    return null;
  }

  return {
    scope: configCheck.scope,
    path: configCheck.path,
    inspection: inspectionResult.inspection
  };
}

function summarizeHostReport(
  host: McpHost,
  inspectionResult: McpDoctorConfigInspectionResult,
  alternateWiring: McpDoctorAlternateWiring
): Pick<McpDoctorHostReport, "status" | "summary" | "configScopeSummary" | "recommendedScope"> {
  const { inspection, configCheck } = inspectionResult;
  const hasValidGlobalAlternative = alternateWiring.valid;
  const hasGlobalIssues = alternateWiring.issues.length > 0;

  if (!configCheck) {
    return {
      status: "manual",
      configScopeSummary: "manual-only",
      recommendedScope: "manual",
      summary:
        "This host has no single project-scoped config file to inspect. Use the printed snippet and verify the wiring manually."
    };
  }

  if (inspection === "missing" || !configCheck.exists) {
    if (hasValidGlobalAlternative) {
      return {
        status: "warning",
        configScopeSummary: "project-missing-global-alternate",
        recommendedScope: "project",
        summary:
          "The recommended project-scoped config file does not exist yet, but alternate global wiring was detected."
      };
    }

    if (hasGlobalIssues) {
      return {
        status: "warning",
        configScopeSummary: "project-missing-global-invalid",
        recommendedScope: "project",
        summary:
          "The recommended project-scoped config file does not exist yet, and the detected global host config could not be parsed or did not match the expected codex_auto_memory wiring."
      };
    }

    return {
      status: "missing",
      configScopeSummary: "project-missing",
      recommendedScope: "project",
      summary: "The recommended project-scoped config file does not exist yet."
    };
  }

  if (inspection === "parse-error") {
    return {
      status: "warning",
      configScopeSummary: "project-invalid",
      recommendedScope: "project",
      summary:
        "A project-scoped config file exists, but it could not be parsed as valid host configuration."
    };
  }

  if (
    inspection === "shape-mismatch" &&
    !(configCheck.hasServerName && configCheck.hasCamCommand && configCheck.hasServeInvocation)
  ) {
    return {
      status: "warning",
      configScopeSummary: "project-shape-mismatch",
      recommendedScope: "project",
      summary:
        "A project-scoped config file exists, but the expected codex_auto_memory stdio wiring was not detected completely."
    };
  }

  if (!configCheck.projectPinned) {
    return {
      status: "warning",
      configScopeSummary: "project-shape-mismatch",
      recommendedScope: "project",
      summary:
        "The config looks wired, but the retrieval server is not clearly pinned to this project root yet."
    };
  }

  if (host !== "codex") {
    return {
      status: "manual",
      configScopeSummary: "project-ready",
      recommendedScope: "project",
      summary:
        "The host config snippet looks present and pinned to this repository, but this host remains manual-only and requires host-side verification."
    };
  }

  return {
    status: "ok",
    configScopeSummary: "project-ready",
    recommendedScope: "project",
    summary: "The recommended project-scoped wiring looks present and pinned to this repository."
  };
}

async function inspectHost(host: McpHost, projectRoot: string): Promise<McpDoctorHostReport> {
  const definition = getMcpHostDefinition(host);
  const inspectionResult = await inspectHostConfig(
    host,
    projectRoot,
    resolveMcpHostProjectConfigPath(host, projectRoot),
    "project"
  );
  const alternateInspectionResults = await Promise.all(
    [resolveMcpHostUserConfigPath(host)]
      .filter((configPath): configPath is string => Boolean(configPath))
      .map((configPath) => inspectHostConfig(host, projectRoot, configPath, "global"))
  );
  const alternateConfigChecks = alternateInspectionResults
    .filter((result) => result.inspection === "ok")
    .flatMap((result) => (result.configCheck ? [result.configCheck] : []));
  const alternateWiring: McpDoctorAlternateWiring = {
    detected: alternateConfigChecks.length > 0,
    valid: alternateConfigChecks.length > 0,
    scopes: [...new Set(alternateConfigChecks.map((check) => check.scope))],
    issues: alternateInspectionResults
      .map((result) => buildConfigIssue(result))
      .filter((issue): issue is McpDoctorConfigIssue => issue !== null)
  };
  const detectedScopes: McpDoctorConfigScope[] = [];
  if (hasDetectedWiring(inspectionResult)) {
    detectedScopes.push("project");
  }
  for (const scope of alternateWiring.scopes) {
    if (!detectedScopes.includes(scope)) {
      detectedScopes.push(scope);
    }
  }
  const summary = summarizeHostReport(host, inspectionResult, alternateWiring);

  return {
    host,
    status: summary.status,
    targetFileHint: definition.targetFileHint,
    pinning: definition.pinning,
    recommendedScope: summary.recommendedScope,
    configScopeSummary: summary.configScopeSummary,
    detectedScopes,
    alternateWiring,
    summary: summary.summary,
    notes: [...definition.notes],
    configCheck: inspectionResult.configCheck,
    alternateConfigChecks
  };
}

async function inspectFallbackAssets(
  projectRoot: string,
  options: {
    explicitCwd?: boolean;
    camCommandAvailable?: boolean;
  } = {}
): Promise<McpDoctorFallbackAssets> {
  const homeDir = os.homedir();
  const descriptors = listDoctorVisibleIntegrationAssets(undefined, {
    projectRoot
  });
  const hooksDir = descriptors.find((asset) => asset.installSurface === "hooks")?.path;
  const skillPaths = resolveCodexSkillPaths(projectRoot);
  const skillDir = skillPaths.runtimeAssetDir;
  const runtimeSkillDir = skillPaths.runtimeSkillDir;
  const officialUserSkillDir = skillPaths.officialUserSkillDir;
  const officialProjectSkillDir = skillPaths.officialProjectSkillDir;
  const assets: McpDoctorAssetCheck[] = descriptors.map((asset) => ({
    id: asset.id,
    name: asset.name,
    path: asset.path,
    installed: false,
    status: "missing",
    expectedVersion: asset.expectedVersion,
    detectedVersion: null,
    installSurface: asset.installSurface,
    role: asset.role,
    executableExpected: asset.executableExpected,
    executableOk: asset.executableExpected ? false : null
  }));

  for (const asset of assets) {
    asset.installed = await fileExists(asset.path);
    if (!asset.installed) {
      asset.status = "missing";
      continue;
    }

    const raw = await readTextFile(asset.path);
    asset.detectedVersion = detectIntegrationAssetVersion(raw);
    if (asset.executableExpected) {
      asset.executableOk = isExecutableMode((await fs.stat(asset.path)).mode);
      asset.launcher = inspectExecutableAssetLauncher(raw, options.camCommandAvailable ?? false);
    }
    asset.status =
      asset.detectedVersion === asset.expectedVersion &&
      hasExpectedAssetSignatures(
        raw,
        descriptors.find((descriptor) => descriptor.name === asset.name)?.expectedSignatures ?? []
      ) &&
      (asset.executableExpected ? asset.executableOk === true : true) &&
      (asset.launcher?.missingPaths.length ?? 0) === 0
        ? "ok"
        : "stale";
  }

  const retrievalHelpers = descriptors
    .filter((asset) => asset.installSurface === "hooks" && asset.role === "recall-helper")
    .map((asset) => asset.name);
  const postSessionSyncInstalled =
    assets.find((asset) => asset.id === "post-session-sync")?.status === "ok";
  const postWorkReviewInstalled =
    assets.find((asset) => asset.id === "post-work-memory-review")?.status === "ok";
  const hookHelpersInstalled =
    retrievalHelpers.length > 0 &&
    retrievalHelpers.every((name) =>
      assets.find((asset) => asset.name === name)?.status === "ok"
    );
  const startupDoctorInstalled =
    assets.find((asset) => asset.name === "startup-doctor.sh")?.status === "ok";
  const runtimeSkillInstalled =
    descriptors
      .filter((asset) => asset.installSurface === "skills")
      .every((asset) => assets.find((candidate) => candidate.name === asset.name)?.installed === true);
  const canonicalSkillContents =
    descriptors.find((asset) => asset.installSurface === "skills")?.contents ?? "";
  const officialUserCanonicalSkillContents =
    listIntegrationAssets(homeDir, "skills", {
      projectRoot,
      skillSurface: "official-user"
    }).find((asset) => asset.installSurface === "skills")?.contents ?? canonicalSkillContents;
  const officialProjectCanonicalSkillContents =
    listIntegrationAssets(homeDir, "skills", {
      projectRoot,
      skillSurface: "official-project"
    }).find((asset) => asset.installSurface === "skills")?.contents ?? canonicalSkillContents;
  const runtimeSkillReady =
    descriptors
      .filter((asset) => asset.installSurface === "skills")
      .every((asset) => assets.find((candidate) => candidate.name === asset.name)?.status === "ok");
  const runtimeSkillContents = runtimeSkillInstalled
    ? await readTextFile(path.join(skillDir, "SKILL.md"))
    : null;
  const runtimeSkillPresent = runtimeSkillContents !== null;
  const runtimeSkillMatchesCanonical =
    runtimeSkillContents !== null && runtimeSkillContents === canonicalSkillContents;
  const officialUserSkillInspection = await inspectSkillSurfaceFile(
    officialUserSkillDir,
    officialUserCanonicalSkillContents
  );
  const officialProjectSkillInspection = await inspectSkillSurfaceFile(
    officialProjectSkillDir,
    officialProjectCanonicalSkillContents
  );
  const installedSkillSurfaces: CodexSkillInstallSurface[] = [];
  if (runtimeSkillInstalled) {
    installedSkillSurfaces.push("runtime");
  }
  if (officialUserSkillInspection.installed) {
    installedSkillSurfaces.push("official-user");
  }
  if (officialProjectSkillInspection.installed) {
    installedSkillSurfaces.push("official-project");
  }
  const readySkillSurfaces: CodexSkillInstallSurface[] = [];
  if (runtimeSkillReady) {
    readySkillSurfaces.push("runtime");
  }
  if (officialUserSkillInspection.ready) {
    readySkillSurfaces.push("official-user");
  }
  if (officialProjectSkillInspection.ready) {
    readySkillSurfaces.push("official-project");
  }
  const anySkillSurfaceInstalled = installedSkillSurfaces.length > 0;
  const anySkillSurfaceReady = readySkillSurfaces.length > 0;
  const preferredSkillSurfaceReady = readySkillSurfaces.includes(skillPaths.preferredInstallSurface);
  const skillSurfaces: Record<CodexSkillInstallSurface, SkillSurfaceState> = {
    runtime: {
      installed: runtimeSkillInstalled,
      discoverable: runtimeSkillInstalled,
      listed: runtimeSkillPresent,
      executable: runtimeSkillReady,
      matchesCanonical: runtimeSkillMatchesCanonical,
      preferred: skillPaths.preferredInstallSurface === "runtime"
    },
    "official-user": {
      installed: officialUserSkillInspection.installed,
      discoverable: officialUserSkillInspection.installed,
      listed: officialUserSkillInspection.installed,
      executable: false,
      matchesCanonical: officialUserSkillInspection.matchesCanonical,
      preferred: skillPaths.preferredInstallSurface === "official-user"
    },
    "official-project": {
      installed: officialProjectSkillInspection.installed,
      discoverable: officialProjectSkillInspection.installed,
      listed: officialProjectSkillInspection.installed,
      executable: false,
      matchesCanonical: officialProjectSkillInspection.matchesCanonical,
      preferred: skillPaths.preferredInstallSurface === "official-project"
    }
  };

  return {
    hooksDir: hooksDir ? path.dirname(hooksDir) : "",
    skillDir,
    runtimeSkillDir,
    runtimeAssetDir: skillDir,
    runtimeSource: skillPaths.runtimeSource,
    preferredInstallSurface: skillPaths.preferredInstallSurface,
    recommendedSkillInstallCommand: buildResolvedCliCommand(
      `skills install --surface ${skillPaths.preferredInstallSurface}`,
      {
        cwd: options.explicitCwd ? projectRoot : undefined
      }
    ),
    runtimeSkillPresent,
    officialUserSkillDir,
    officialProjectSkillDir,
    runtimeSkillInstalled,
    officialUserSkillInstalled: officialUserSkillInspection.installed,
    officialProjectSkillInstalled: officialProjectSkillInspection.installed,
    runtimeSkillMatchesCanonical,
    officialUserSkillMatchesCanonical: officialUserSkillInspection.matchesCanonical,
    officialProjectSkillMatchesCanonical: officialProjectSkillInspection.matchesCanonical,
    officialUserSkillMatchesRuntime:
      runtimeSkillContents !== null && officialUserSkillInspection.contents === runtimeSkillContents,
    officialProjectSkillMatchesRuntime:
      runtimeSkillContents !== null && officialProjectSkillInspection.contents === runtimeSkillContents,
    runtimeSkillReady,
    officialUserSkillReady: officialUserSkillInspection.ready,
    officialProjectSkillReady: officialProjectSkillInspection.ready,
    anySkillSurfaceInstalled,
    anySkillSurfaceReady,
    preferredSkillSurfaceReady,
    installedSkillSurfaces,
    readySkillSurfaces,
    skillSurfaces,
    skillPathDrift:
      runtimeSkillDir.length > 0 &&
      path.resolve(runtimeSkillDir) !== path.resolve(officialUserSkillDir),
    postSessionSyncInstalled,
    postWorkReviewInstalled,
    captureHelpersInstalled: postSessionSyncInstalled && Boolean(startupDoctorInstalled),
    hookHelpersInstalled,
    startupDoctorInstalled,
    skillInstalled: anySkillSurfaceReady,
    shellFallbackAvailable: hookHelpersInstalled,
    guidanceAvailable: anySkillSurfaceReady,
    fallbackAvailable: hookHelpersInstalled,
    assets
  };
}

function buildRetrievalSidecarReport(
  checks: RetrievalSidecarCheck[],
  options: {
    cwd?: string;
  } = {}
): McpDoctorRetrievalSidecarReport {
  const degradedChecks = checks.filter((check) => check.status !== "ok");
  const repairCommand = buildResolvedCliCommand(
    [
      "memory reindex",
      `--scope ${
        new Set(degradedChecks.map((check) => check.scope)).size === 1
          ? degradedChecks[0]?.scope ?? "all"
          : "all"
      }`,
      `--state ${
        new Set(degradedChecks.map((check) => check.state)).size === 1
          ? degradedChecks[0]?.state ?? "all"
          : "all"
      }`
    ].join(" "),
    {
      cwd: options.cwd
    }
  );
  if (degradedChecks.length === 0) {
    return {
      status: "ok",
      summary: "All inspected retrieval sidecars are current.",
      repairCommand,
      checks
    };
  }

  return {
    status: "warning",
    summary:
      "One or more retrieval sidecars are missing, invalid, or stale. Recall still falls back to Markdown canonical memory safely.",
    repairCommand,
    checks
  };
}

function buildTopicDiagnosticsReport(
  diagnostics: TopicFileDiagnostic[]
): McpDoctorTopicDiagnosticsReport {
  const unsafeDiagnostics = diagnostics.filter((entry) => !entry.safeToRewrite);
  if (unsafeDiagnostics.length === 0) {
    return {
      status: "ok",
      summary: "No unsafe topic files were detected.",
      diagnostics: []
    };
  }

  return {
    status: "warning",
    summary: `${unsafeDiagnostics.length} unsafe topic file(s) were detected in the Markdown canonical store.`,
    diagnostics: unsafeDiagnostics
  };
}

function buildLayoutDiagnosticsReport(
  diagnostics: MemoryLayoutDiagnostic[]
): McpDoctorLayoutDiagnosticsReport {
  if (diagnostics.length === 0) {
    return {
      status: "ok",
      summary: "No canonical layout anomalies were detected.",
      diagnostics: []
    };
  }

  return {
    status: "warning",
    summary: `${diagnostics.length} canonical layout anomaly/anomalies were detected in the Markdown memory store.`,
    diagnostics
  };
}

function isAssetReady(
  assets: McpDoctorAssetCheck[],
  ids: string[]
): boolean {
  return ids.every((id) => assets.find((asset) => asset.id === id)?.status === "ok");
}

function buildCodexStackReport(
  codexHost: McpDoctorHostReport,
  fallbackAssets: McpDoctorFallbackAssets,
  camCommandAvailable: boolean,
  agentsGuidance: CodexAgentsGuidanceInspection,
  options: {
    cwd?: string;
  } = {}
): McpDoctorReport["codexStack"] {
  const mcpReady = codexHost.status === "ok";
  const mcpOperationalReady = mcpReady && camCommandAvailable;
  const hookCaptureReady = isAssetReady(
    fallbackAssets.assets,
    [...CODEX_HOOK_CAPTURE_ASSET_IDS]
  );
  const hookCaptureOperationalReady = isAssetOperational(
    fallbackAssets.assets,
    [...CODEX_HOOK_CAPTURE_ASSET_IDS]
  );
  const hookRecallReady = isAssetReady(
    fallbackAssets.assets,
    [...CODEX_HOOK_RECALL_ASSET_IDS]
  );
  const hookRecallOperationalReady = isAssetOperational(
    fallbackAssets.assets,
    [...CODEX_HOOK_RECALL_ASSET_IDS]
  );
  const skillReady = fallbackAssets.preferredSkillSurfaceReady;
  const workflowHelperAssetsReady = isAssetReady(
    fallbackAssets.assets,
    CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS.filter((id) => id !== "codex-memory-skill")
  );
  const workflowAssetsConsistent =
    workflowHelperAssetsReady &&
    fallbackAssets.postWorkReviewInstalled &&
    fallbackAssets.preferredSkillSurfaceReady;
  const workflowConsistent =
    workflowAssetsConsistent &&
    agentsGuidance.status === "ok";
  const status = summarizeCodexIntegrationStatus([
    mcpOperationalReady ? "ok" : mcpReady ? "warning" : "missing",
    hookCaptureOperationalReady ? "ok" : hookCaptureReady ? "warning" : "missing",
    hookRecallOperationalReady ? "ok" : hookRecallReady ? "warning" : "missing",
    skillReady ? "ok" : "missing",
    workflowConsistent
      ? "ok"
      : hookRecallReady || skillReady
        ? "warning"
        : "missing"
  ]) as McpDoctorStatus;
  const notes = buildCodexStackNotes(options);
  if (mcpReady && !camCommandAvailable) {
    notes.push(
      "The current shell could not resolve `cam` on PATH, so MCP wiring may still fail at runtime."
    );
  }
  if (hookRecallReady && !hookRecallOperationalReady) {
    notes.push(
      "Hook recall helpers are installed, but their embedded launcher is not operational in the current environment yet."
    );
  }
  if (hookCaptureReady && !hookCaptureOperationalReady) {
    notes.push(
      "Hook capture helpers are installed, but their embedded launcher is not operational in the current environment yet."
    );
  }
  if (!fallbackAssets.preferredSkillSurfaceReady && fallbackAssets.anySkillSurfaceReady) {
    notes.push(
      `A non-preferred skill surface is ready, but the preferred ${fallbackAssets.preferredInstallSurface} skill surface is not aligned yet.`
    );
  }

  const currentlyOperationalRoute = resolveCodexIntegrationRoute({
    mcpOperationalReady,
    hookRecallOperationalReady
  });
  const routeKind =
    currentlyOperationalRoute === "mcp"
      ? "preferred-mcp"
      : currentlyOperationalRoute === "hooks-fallback"
        ? "fallback-hooks"
        : "fallback-cli";
  const routeEvidence = [
    ...(mcpReady ? ["mcp-config-present"] : []),
    ...(camCommandAvailable ? ["cam-command-available"] : []),
    ...(hookRecallOperationalReady ? ["hook-recall-operational"] : []),
    ...(hookCaptureOperationalReady ? ["hook-capture-operational"] : []),
    ...(buildWorkflowContract(options).launcher.verified ? ["resolved-cli-launcher-verified"] : [])
  ];
  const preferredRouteBlockers = [
    ...(mcpReady && !camCommandAvailable ? ["cam-command-unavailable-for-mcp"] : []),
    ...(!mcpReady ? ["project-scoped-mcp-not-installed"] : [])
  ];
  const currentOperationalBlockers = [
    ...(hookRecallReady && !hookRecallOperationalReady
      ? ["hook-recall-launcher-unavailable"]
      : []),
    ...(!mcpOperationalReady &&
    !hookRecallOperationalReady &&
    !buildWorkflowContract(options).launcher.verified
      ? ["resolved-cli-launcher-unverified"]
      : [])
  ];

  return {
    status,
    recommendedRoute: "mcp",
    currentlyOperationalRoute,
    routeKind,
    routeEvidence,
    shellDependencyLevel: "required",
    hostMutationRequired: !mcpReady,
    preferredRouteBlockers,
    currentOperationalBlockers,
    preset: formatRecommendedRetrievalPreset(),
    assetVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    mcpReady,
    mcpOperationalReady,
    camCommandAvailable,
    hookCaptureReady,
    hookCaptureOperationalReady,
    hookRecallReady,
    hookRecallOperationalReady,
    skillReady,
    workflowAssetsConsistent,
    workflowConsistent,
    notes
  };
}

export async function inspectMcpDoctor(options: {
  cwd?: string;
  host?: string;
  explicitCwd?: boolean;
} = {}): Promise<McpDoctorReport> {
  const cwd = await normalizeComparablePath(
    options.cwd === undefined ? process.cwd() : resolveMcpProjectCwd(options.cwd)
  );
  const projectRoot = resolveMcpProjectRoot(cwd);
  const agentsGuidancePath = path.join(projectRoot, "AGENTS.md");
  const hostSelection: McpDoctorHostSelection = normalizeMcpDoctorHostSelection(options.host);
  const codexSelected = selectionIncludesCodex(hostSelection);
  const hosts = await Promise.all(
    listMcpHosts(hostSelection).map((host) => inspectHost(host, projectRoot))
  );
  const camCommandAvailable = isCommandAvailableInPath("cam");
  const fallbackAssets = await inspectFallbackAssets(projectRoot, {
    explicitCwd: options.explicitCwd ?? false,
    camCommandAvailable
  });
  const runtime = await buildRuntimeContext(cwd, {}, { ensureMemoryLayout: false });
  const retrievalSidecar = buildRetrievalSidecarReport(
    await runtime.syncService.memoryStore.inspectRetrievalSidecars(),
    {
      cwd: options.explicitCwd ? projectRoot : undefined
    }
  );
  const topicDiagnostics = buildTopicDiagnosticsReport(
    await runtime.syncService.memoryStore.inspectTopicFiles({
      scope: "all",
      state: "all"
    })
  );
  const layoutDiagnostics = buildLayoutDiagnosticsReport(
    await runtime.syncService.memoryStore.inspectLayoutDiagnostics({
      scope: "all",
      state: "all"
    })
  );
  const instructionLayer = await discoverInstructionLayer(projectRoot);
  const instructionReviewLane = await buildInstructionReviewLane(runtime, {
    cwd: options.explicitCwd ? projectRoot : undefined
  });
  const dreamCandidates = await listDreamCandidates(runtime);
  const latestInstructionProposalCandidate = getLatestDreamProposalCandidate(dreamCandidates.entries);
  const instructionProposalLane: McpDoctorInstructionProposalLaneReport = {
    status: latestInstructionProposalCandidate ? "warning" : "ok",
    summary: latestInstructionProposalCandidate
      ? "Instruction proposal artifacts are present for reviewer-only follow-up."
      : "No instruction proposal artifacts are waiting for reviewer follow-up.",
    detectedTargets: instructionReviewLane.detectedInstructionTargets,
    latestProposalArtifactPath: instructionReviewLane.latestProposalArtifactPath,
    latestCandidateId: instructionReviewLane.latestCandidateId,
    selectedTargetFile: instructionReviewLane.selectedTargetFile,
    selectedTargetKind: instructionReviewLane.selectedTargetKind,
    targetHost: instructionReviewLane.targetHost,
    applyReadinessStatus: instructionReviewLane.applyReadinessStatus ?? null,
    recommendedInspectCommand: instructionReviewLane.recommendedInspectCommand,
    recommendedReviewCommand: instructionReviewLane.recommendedReviewCommand,
    recommendedApplyPrepCommand: instructionReviewLane.recommendedApplyPrepCommand,
    recommendedVerifyApplyCommand: instructionReviewLane.recommendedVerifyApplyCommand
  };
  const codexHost = codexSelected
    ? hosts.find((host) => host.host === "codex") ?? (await inspectHost("codex", projectRoot))
    : null;
  const agentsGuidance = codexSelected
    ? inspectCodexAgentsGuidance(
        agentsGuidancePath,
        (await fileExists(agentsGuidancePath)) ? await readTextFile(agentsGuidancePath) : null
      )
    : null;
  const applySafety = codexSelected
    ? await inspectCodexAgentsGuidanceApplySafety(projectRoot)
    : null;
  const workflowContract = buildWorkflowContract({
    cwd: options.explicitCwd ? projectRoot : undefined
  });

  return {
    cwd,
    projectRoot,
    cwdWithinProjectRoot: isPathWithin(projectRoot, cwd),
    serverName: MEMORY_RETRIEVAL_MCP_SERVER_NAME,
    readOnlyRetrieval: true,
    commandSurface: buildCommandSurface(hostSelection),
    agentsGuidance,
    applySafety,
    fallbackAssets,
    retrievalSidecar,
    topicDiagnostics,
    layoutDiagnostics,
    instructionProposalLane,
    workflowContract,
    experimentalHooks: codexSelected ? buildExperimentalCodexHooksGuidance() : null,
    hosts,
    codexStack:
      codexSelected && codexHost && agentsGuidance
        ? buildCodexStackReport(
            codexHost,
            fallbackAssets,
            camCommandAvailable,
            agentsGuidance,
            {
              cwd: options.explicitCwd ? projectRoot : undefined
            }
          )
        : null
  };
}

export function formatMcpDoctorReport(report: McpDoctorReport): string {
  const commandSurface = [
    report.commandSurface.install ? "cam mcp install" : null,
    "cam mcp serve",
    "cam mcp print-config",
    report.commandSurface.applyGuidance ? "cam mcp apply-guidance" : null,
    "cam mcp doctor"
  ].filter((command): command is string => Boolean(command));
  const lines = [
    "Codex Auto Memory MCP Doctor",
    `Working directory: ${report.cwd}`,
    `Project root: ${report.projectRoot}`,
    `Inside project root: ${report.cwdWithinProjectRoot ? "yes" : "no"}`,
    `Server name: ${report.serverName}`,
    "Retrieval plane: read-only",
    `Command surface: ${commandSurface.join(", ")}`,
    "",
    "Host checks:"
  ];

  for (const host of report.hosts) {
    lines.push(
      `- [${host.status}] ${host.host}`,
      `  Target file hint: ${host.targetFileHint}`,
      `  Project pinning: ${formatPinning(host.pinning)}`,
      `  Recommended scope: ${host.recommendedScope}`,
      `  Config scope summary: ${host.configScopeSummary}`,
      `  Detected scopes: ${host.detectedScopes.length > 0 ? host.detectedScopes.join(", ") : "none"}`,
      `  Summary: ${host.summary}`
    );

    if (host.configCheck) {
      lines.push(
        `  Config path: ${host.configCheck.path}`,
        `  Exists: ${host.configCheck.exists ? "yes" : "no"}`,
        `  Contains server name: ${host.configCheck.hasServerName ? "yes" : "no"}`,
        `  Contains cam command: ${host.configCheck.hasCamCommand ? "yes" : "no"}`,
        `  Contains mcp serve invocation: ${host.configCheck.hasServeInvocation ? "yes" : "no"}`,
        `  Project pinned: ${host.configCheck.projectPinned ? "yes" : "no"}`
      );
    }

    for (const alternateConfigCheck of host.alternateConfigChecks ?? []) {
      lines.push(
        `  Alternate ${alternateConfigCheck.scope} config path: ${alternateConfigCheck.path}`,
        `  Alternate ${alternateConfigCheck.scope} exists: ${alternateConfigCheck.exists ? "yes" : "no"}`,
        `  Alternate ${alternateConfigCheck.scope} contains server name: ${alternateConfigCheck.hasServerName ? "yes" : "no"}`,
        `  Alternate ${alternateConfigCheck.scope} contains cam command: ${alternateConfigCheck.hasCamCommand ? "yes" : "no"}`,
        `  Alternate ${alternateConfigCheck.scope} contains mcp serve invocation: ${alternateConfigCheck.hasServeInvocation ? "yes" : "no"}`,
        `  Alternate ${alternateConfigCheck.scope} project pinned: ${alternateConfigCheck.projectPinned ? "yes" : "no"}`
      );
    }

    lines.push(
      `  Alternate wiring detected: ${host.alternateWiring.detected ? "yes" : "no"}`,
      `  Alternate wiring valid: ${host.alternateWiring.valid ? "yes" : "no"}`,
      `  Alternate wiring scopes: ${host.alternateWiring.scopes.length > 0 ? host.alternateWiring.scopes.join(", ") : "none"}`
    );
    for (const issue of host.alternateWiring.issues) {
      lines.push(
        `  Alternate ${issue.scope} issue: ${issue.inspection} (${issue.path})`
      );
    }

    for (const note of host.notes) {
      lines.push(`  Note: ${note}`);
    }
  }

  lines.push(
    "",
    "Retrieval sidecar:",
    `- Status: ${report.retrievalSidecar.status}`,
    `- Summary: ${report.retrievalSidecar.summary}`,
    `- Repair command: ${report.retrievalSidecar.repairCommand}`,
    ...report.retrievalSidecar.checks.map(
      (check) =>
        `- ${check.scope}/${check.state}: ${check.status}${check.fallbackReason ? ` (${check.fallbackReason})` : ""} | index: ${check.indexPath} | generatedAt: ${check.generatedAt ?? "none"} | topicFiles: ${check.topicFileCount ?? "none"}`
    ),
    "",
    "Topic diagnostics:",
    `- Status: ${report.topicDiagnostics.status}`,
    `- Summary: ${report.topicDiagnostics.summary}`,
    ...report.topicDiagnostics.diagnostics.map(
      (diagnostic) =>
        `- ${diagnostic.scope}/${diagnostic.state}/${diagnostic.topic}: unsafe (${diagnostic.unsafeReason ?? "unknown reason"}) | entries=${diagnostic.entryCount} | malformed=${diagnostic.invalidEntryBlockCount} | manualContent=${diagnostic.manualContentDetected ? "yes" : "no"}`
    ),
    "",
    "Layout diagnostics:",
    `- Status: ${report.layoutDiagnostics.status}`,
    `- Summary: ${report.layoutDiagnostics.summary}`,
    ...report.layoutDiagnostics.diagnostics.map(
      (diagnostic) =>
        `- ${diagnostic.scope}/${diagnostic.state}/${diagnostic.fileName}: ${diagnostic.kind} | ${diagnostic.message}`
    ),
    "",
    "Fallback assets:"
  );
  for (const asset of report.fallbackAssets.assets) {
    const versionInfo =
      asset.status === "ok"
        ? `version ${asset.detectedVersion}`
        : asset.status === "stale"
          ? `expected ${asset.expectedVersion}, detected ${asset.detectedVersion ?? "none"}`
          : `expected ${asset.expectedVersion}`;
    const executableInfo = asset.executableExpected
      ? ` | executable: ${asset.executableOk ? "yes" : "no"}`
      : "";
    const launcherInfo = asset.launcher
      ? ` | launcher: ${asset.launcher.resolution} (${asset.launcher.operational ? "operational" : "blocked"})${asset.launcher.missingPaths.length > 0 ? ` missing: ${asset.launcher.missingPaths.join(", ")}` : ""}`
      : "";
    lines.push(`- ${asset.name}: ${asset.status} (${versionInfo})${executableInfo}${launcherInfo} (${asset.path})`);
  }
  lines.push(
    `- Post-session sync helper installed: ${report.fallbackAssets.postSessionSyncInstalled ? "yes" : "no"}`,
    `- Post-work review helper installed: ${report.fallbackAssets.postWorkReviewInstalled ? "yes" : "no"}`,
    `- Capture helpers installed: ${report.fallbackAssets.captureHelpersInstalled ? "yes" : "no"}`,
    `- Hook helpers installed: ${report.fallbackAssets.hookHelpersInstalled ? "yes" : "no"}`,
    `- Startup doctor installed: ${report.fallbackAssets.startupDoctorInstalled ? "yes" : "no"}`,
    `- Any skill surface installed: ${report.fallbackAssets.anySkillSurfaceInstalled ? "yes" : "no"}`,
    `- Any skill surface ready: ${report.fallbackAssets.anySkillSurfaceReady ? "yes" : "no"}`,
    `- Preferred skill surface ready: ${report.fallbackAssets.preferredSkillSurfaceReady ? "yes" : "no"}`,
    `- Legacy skillInstalled compatibility flag: ${report.fallbackAssets.skillInstalled ? "yes" : "no"}`,
    `- Shell fallback available: ${report.fallbackAssets.shellFallbackAvailable ? "yes" : "no"}`,
    `- Guidance available: ${report.fallbackAssets.guidanceAvailable ? "yes" : "no"}`,
    `- Executable fallback available: ${report.fallbackAssets.fallbackAvailable ? "yes" : "no"}`,
    `- Runtime skill dir: ${report.fallbackAssets.runtimeSkillDir || "n/a"}`,
    `- Runtime asset dir: ${report.fallbackAssets.runtimeAssetDir || "n/a"}`,
    `- Runtime source: ${report.fallbackAssets.runtimeSource}`,
    `- Preferred skill surface: ${report.fallbackAssets.preferredInstallSurface}`,
    `- Recommended skill install command: ${report.fallbackAssets.recommendedSkillInstallCommand}`,
    `- Runtime skill present: ${report.fallbackAssets.runtimeSkillPresent ? "yes" : "no"}`,
    `- Runtime skill installed: ${report.fallbackAssets.runtimeSkillInstalled ? "yes" : "no"}`,
    `- Runtime skill matches canonical: ${report.fallbackAssets.runtimeSkillMatchesCanonical ? "yes" : "no"}`,
    `- Runtime skill ready: ${report.fallbackAssets.runtimeSkillReady ? "yes" : "no"}`,
    `- Official user skill dir: ${report.fallbackAssets.officialUserSkillDir}`,
    `- Official project skill dir: ${report.fallbackAssets.officialProjectSkillDir}`,
    `- Official user skill installed: ${report.fallbackAssets.officialUserSkillInstalled ? "yes" : "no"}`,
    `- Official project skill installed: ${report.fallbackAssets.officialProjectSkillInstalled ? "yes" : "no"}`,
    `- Official user skill matches canonical: ${report.fallbackAssets.officialUserSkillMatchesCanonical ? "yes" : "no"}`,
    `- Official project skill matches canonical: ${report.fallbackAssets.officialProjectSkillMatchesCanonical ? "yes" : "no"}`,
    `- Official user skill matches runtime: ${report.fallbackAssets.officialUserSkillMatchesRuntime ? "yes" : "no"}`,
    `- Official project skill matches runtime: ${report.fallbackAssets.officialProjectSkillMatchesRuntime ? "yes" : "no"}`,
    `- Official user skill ready: ${report.fallbackAssets.officialUserSkillReady ? "yes" : "no"}`,
    `- Official project skill ready: ${report.fallbackAssets.officialProjectSkillReady ? "yes" : "no"}`,
    `- Installed skill surfaces: ${report.fallbackAssets.installedSkillSurfaces.length > 0 ? report.fallbackAssets.installedSkillSurfaces.join(", ") : "none"}`,
    `- Ready skill surfaces: ${report.fallbackAssets.readySkillSurfaces.length > 0 ? report.fallbackAssets.readySkillSurfaces.join(", ") : "none"}`,
    `- Skill path drift: ${report.fallbackAssets.skillPathDrift ? "yes" : "no"}`,
    "",
    "Notes:",
    "- cam mcp install writes the recommended project-scoped host config for codex only.",
    "- cam mcp doctor only inspects the recommended project-scoped wiring and never writes host config files.",
    "- Run the retrieval sidecar repair command above if retrieval indexes are missing, invalid, or stale.",
    `- Re-run ${buildResolvedCliCommand("hooks install", { cwd: report.projectRoot })} or ${buildResolvedCliCommand("skills install", { cwd: report.projectRoot })} if a fallback asset is reported as stale.`,
    "- cam memory is the inspect/audit surface for durable memory.",
    "- cam session is the temporary continuity surface and is not the same as durable memory retrieval."
  );

  if (report.applySafety) {
    lines.push(
      "",
      "Apply safety:",
      `- AGENTS managed-block apply safety: ${report.applySafety.status}${report.applySafety.blockedReason ? ` (${report.applySafety.blockedReason})` : ""}`
    );
  }

  if (report.experimentalHooks) {
    lines.push(
      "",
      "Experimental Codex hooks:",
      `- Status: ${report.experimentalHooks.status}`,
      `- Feature flag: ${report.experimentalHooks.featureFlag}`,
      `- Target file hint: ${report.experimentalHooks.targetFileHint}`,
      `- Snippet: ${report.experimentalHooks.snippet.replace(/\n/g, " | ")}`,
      ...report.experimentalHooks.notes.map((note) => `- ${note}`)
    );
  }

  if (report.agentsGuidance) {
    lines.push(
      "",
      "AGENTS guidance:",
      `- Path: ${report.agentsGuidance.path}`,
      `- Exists: ${report.agentsGuidance.exists ? "yes" : "no"}`,
      `- Status: ${report.agentsGuidance.status}`,
      `- Expected version: ${report.agentsGuidance.expectedVersion}`,
      `- Detected version: ${report.agentsGuidance.detectedVersion ?? "none"}`,
      `- Missing signatures: ${
        report.agentsGuidance.missingSignatures.length > 0
          ? report.agentsGuidance.missingSignatures.join(", ")
          : "none"
      }`
    );
  }

  if (report.codexStack) {
    lines.push(
      "",
      "Codex stack readiness:",
      `- Status: ${report.codexStack.status}`,
      `- Recommended route: ${report.codexStack.recommendedRoute}`,
      `- Current operational route: ${report.codexStack.currentlyOperationalRoute}`,
      `- Route kind: ${report.codexStack.routeKind}`,
      `- Route evidence: ${report.codexStack.routeEvidence.length > 0 ? report.codexStack.routeEvidence.join(", ") : "none"}`,
      `- Shell dependency level: ${report.codexStack.shellDependencyLevel}`,
      `- Host mutation required: ${report.codexStack.hostMutationRequired ? "yes" : "no"}`,
      `- Preferred route blockers: ${report.codexStack.preferredRouteBlockers.length > 0 ? report.codexStack.preferredRouteBlockers.join(", ") : "none"}`,
      `- Current operational blockers: ${report.codexStack.currentOperationalBlockers.length > 0 ? report.codexStack.currentOperationalBlockers.join(", ") : "none"}`,
      `- Recommended preset: ${report.codexStack.preset}`,
      `- Instruction proposal lane: ${report.instructionProposalLane.status} (${report.instructionProposalLane.summary})`,
      `- Asset version: ${report.codexStack.assetVersion}`,
      `- MCP ready: ${report.codexStack.mcpReady ? "yes" : "no"}`,
      `- MCP operational ready: ${report.codexStack.mcpOperationalReady ? "yes" : "no"}`,
      `- cam command available: ${report.codexStack.camCommandAvailable ? "yes" : "no"}`,
      `- Hook capture ready: ${report.codexStack.hookCaptureReady ? "yes" : "no"}`,
      `- Hook capture operational ready: ${report.codexStack.hookCaptureOperationalReady ? "yes" : "no"}`,
      `- Hook recall ready: ${report.codexStack.hookRecallReady ? "yes" : "no"}`,
      `- Hook recall operational ready: ${report.codexStack.hookRecallOperationalReady ? "yes" : "no"}`,
      `- Skill ready: ${report.codexStack.skillReady ? "yes" : "no"}`,
      `- Workflow consistent: ${report.codexStack.workflowConsistent ? "yes" : "no"}`,
      ...report.codexStack.notes.map((note) => `- ${note}`)
    );
  }

  return lines.join("\n");
}
