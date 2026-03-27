import fs from "node:fs/promises";
import path from "node:path";
import * as toml from "smol-toml";
import {
  listDoctorVisibleIntegrationAssets
} from "./assets.js";
import {
  buildCodexStackNotes,
  inspectCodexAgentsGuidance,
  CODEX_HOOK_CAPTURE_ASSET_IDS,
  CODEX_HOOK_RECALL_ASSET_IDS,
  CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS,
  resolveCodexIntegrationRoute,
  summarizeCodexIntegrationStatus,
  type CodexAgentsGuidanceInspection,
  type CodexIntegrationRoute
} from "./codex-stack.js";
import { inspectCodexAgentsGuidanceApplySafety } from "./agents-guidance.js";
import {
  appendCliCwdFlag,
  buildWorkflowContract,
  detectIntegrationAssetVersion,
  formatRecommendedRetrievalPreset,
  RETRIEVAL_INTEGRATION_ASSET_VERSION
} from "./retrieval-contract.js";
import {
  getMcpHostDefinition,
  inspectCanonicalMcpServerConfig,
  listMcpHosts,
  MEMORY_RETRIEVAL_MCP_SERVER_NAME,
  normalizeMcpDoctorHostSelection,
  resolveMcpHostProjectConfigPath,
  resolveMcpHostUserConfigPath,
  type McpDoctorHostSelection,
  type McpHost,
  type McpHostPinningMode
} from "./mcp-hosts.js";
import {
  buildCodexSkillInstallCommand,
  resolveCodexSkillPaths,
  type CodexSkillInstallSurface,
  type CodexSkillPathResolution
} from "./skills-paths.js";
import { fileExists, readTextFile } from "../util/fs.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import { resolveMcpProjectRoot } from "./mcp-config.js";
import type { RetrievalSidecarCheck } from "../domain/memory-store.js";

type McpDoctorStatus = "ok" | "warning" | "missing" | "manual";
type McpDoctorConfigInspection = "ok" | "missing" | "parse-error" | "shape-mismatch";
type McpDoctorConfigScope = "project" | "global";
type McpDoctorRecommendedScope = "project" | "manual";
type McpDoctorConfigScopeSummary =
  | "manual-only"
  | "project-ready"
  | "project-invalid"
  | "project-shape-mismatch"
  | "project-missing"
  | "project-missing-global-alternate"
  | "project-missing-global-invalid";

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
  installedSkillSurfaces: CodexSkillInstallSurface[];
  readySkillSurfaces: CodexSkillInstallSurface[];
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

interface McpDoctorRetrievalSidecarReport {
  status: "ok" | "warning";
  summary: string;
  checks: RetrievalSidecarCheck[];
}

export interface McpDoctorReport {
  cwd: string;
  projectRoot: string;
  cwdWithinProjectRoot: boolean;
  serverName: string;
  readOnlyRetrieval: true;
  commandSurface: {
    install: true;
    serve: true;
    printConfig: true;
    applyGuidance: true;
    doctor: true;
  };
  agentsGuidance: CodexAgentsGuidanceInspection;
  applySafety: Awaited<ReturnType<typeof inspectCodexAgentsGuidanceApplySafety>>;
  fallbackAssets: McpDoctorFallbackAssets;
  retrievalSidecar: McpDoctorRetrievalSidecarReport;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  hosts: McpDoctorHostReport[];
  codexStack: {
    status: McpDoctorStatus;
    recommendedRoute: CodexIntegrationRoute;
    preset: string;
    assetVersion: string;
    mcpReady: boolean;
    mcpOperationalReady: boolean;
    camCommandAvailable: boolean;
    hookCaptureReady: boolean;
    hookRecallReady: boolean;
    skillReady: boolean;
    workflowAssetsConsistent: boolean;
    workflowConsistent: boolean;
    notes: string[];
  };
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

async function isCommandAvailableInPath(command: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  if (!pathValue.trim()) {
    return false;
  }

  const entries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = path.join(
        entry,
        process.platform === "win32" ? `${command}${extension}` : command
      );
      if (!(await fileExists(candidate))) {
        continue;
      }

      if (process.platform === "win32") {
        return true;
      }

      if (isExecutableMode((await fs.stat(candidate)).mode)) {
        return true;
      }
    }
  }

  return false;
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
  const summary = summarizeHostReport(inspectionResult, alternateWiring);

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
  } = {}
): Promise<McpDoctorFallbackAssets> {
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
    }
    asset.status =
      asset.detectedVersion === asset.expectedVersion &&
      hasExpectedAssetSignatures(
        raw,
        descriptors.find((descriptor) => descriptor.name === asset.name)?.expectedSignatures ?? []
      ) &&
      (asset.executableExpected ? asset.executableOk === true : true)
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
    canonicalSkillContents
  );
  const officialProjectSkillInspection = await inspectSkillSurfaceFile(
    officialProjectSkillDir,
    canonicalSkillContents
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

  return {
    hooksDir: hooksDir ? path.dirname(hooksDir) : "",
    skillDir,
    runtimeSkillDir,
    runtimeAssetDir: skillDir,
    runtimeSource: skillPaths.runtimeSource,
    preferredInstallSurface: skillPaths.preferredInstallSurface,
    recommendedSkillInstallCommand: options.explicitCwd
      ? appendCliCwdFlag(
          buildCodexSkillInstallCommand(skillPaths.preferredInstallSurface),
          projectRoot
        )
      : buildCodexSkillInstallCommand(skillPaths.preferredInstallSurface),
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
    installedSkillSurfaces,
    readySkillSurfaces,
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
    fallbackAvailable: hookHelpersInstalled || anySkillSurfaceReady,
    assets
  };
}

function buildRetrievalSidecarReport(
  checks: RetrievalSidecarCheck[]
): McpDoctorRetrievalSidecarReport {
  const degradedChecks = checks.filter((check) => check.status !== "ok");
  if (degradedChecks.length === 0) {
    return {
      status: "ok",
      summary: "All inspected retrieval sidecars are current.",
      checks
    };
  }

  return {
    status: "warning",
    summary:
      "One or more retrieval sidecars are missing, invalid, or stale. Recall still falls back to Markdown canonical memory safely.",
    checks
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
  const hookRecallReady = isAssetReady(
    fallbackAssets.assets,
    [...CODEX_HOOK_RECALL_ASSET_IDS]
  );
  const skillReady = fallbackAssets.readySkillSurfaces.length > 0;
  const workflowAssetsConsistent =
    isAssetReady(
      fallbackAssets.assets,
      [...CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS]
    ) &&
    fallbackAssets.postWorkReviewInstalled &&
    skillReady;
  const workflowConsistent =
    workflowAssetsConsistent &&
    agentsGuidance.status === "ok";
  const status = summarizeCodexIntegrationStatus([
    mcpOperationalReady ? "ok" : mcpReady ? "warning" : "missing",
    hookCaptureReady ? "ok" : "missing",
    hookRecallReady ? "ok" : "missing",
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

  return {
    status,
    recommendedRoute: resolveCodexIntegrationRoute({
      mcpOperationalReady,
      hookRecallReady
    }),
    preset: formatRecommendedRetrievalPreset(),
    assetVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    mcpReady,
    mcpOperationalReady,
    camCommandAvailable,
    hookCaptureReady,
    hookRecallReady,
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
  const cwd = await normalizeComparablePath(options.cwd ?? process.cwd());
  const projectRoot = resolveMcpProjectRoot(cwd);
  const agentsGuidancePath = path.join(projectRoot, "AGENTS.md");
  const hostSelection: McpDoctorHostSelection = normalizeMcpDoctorHostSelection(options.host);
  const hosts = await Promise.all(
    listMcpHosts(hostSelection).map((host) => inspectHost(host, projectRoot))
  );
  const fallbackAssets = await inspectFallbackAssets(projectRoot, {
    explicitCwd: options.explicitCwd ?? false
  });
  const runtime = await buildRuntimeContext(cwd, {}, { ensureMemoryLayout: false });
  const retrievalSidecar = buildRetrievalSidecarReport(
    await runtime.syncService.memoryStore.inspectRetrievalSidecars()
  );
  const camCommandAvailable = await isCommandAvailableInPath("cam");
  const codexHost = hosts.find((host) => host.host === "codex") ?? (await inspectHost("codex", projectRoot));
  const agentsGuidance = inspectCodexAgentsGuidance(
    agentsGuidancePath,
    (await fileExists(agentsGuidancePath)) ? await readTextFile(agentsGuidancePath) : null
  );
  const applySafety = await inspectCodexAgentsGuidanceApplySafety(projectRoot);
  const workflowContract = buildWorkflowContract({
    cwd: options.explicitCwd ? projectRoot : undefined
  });

  return {
    cwd,
    projectRoot,
    cwdWithinProjectRoot: isPathWithin(projectRoot, cwd),
    serverName: MEMORY_RETRIEVAL_MCP_SERVER_NAME,
    readOnlyRetrieval: true,
    commandSurface: {
      install: true,
      serve: true,
      printConfig: true,
      applyGuidance: true,
      doctor: true
    },
    agentsGuidance,
    applySafety,
    fallbackAssets,
    retrievalSidecar,
    workflowContract,
    hosts,
    codexStack: buildCodexStackReport(
    codexHost,
    fallbackAssets,
    camCommandAvailable,
    agentsGuidance,
    {
      cwd: options.explicitCwd ? projectRoot : undefined
    }
  )
  };
}

export function formatMcpDoctorReport(report: McpDoctorReport): string {
  const lines = [
    "Codex Auto Memory MCP Doctor",
    `Working directory: ${report.cwd}`,
    `Project root: ${report.projectRoot}`,
    `Inside project root: ${report.cwdWithinProjectRoot ? "yes" : "no"}`,
    `Server name: ${report.serverName}`,
    "Retrieval plane: read-only",
    "Command surface: cam mcp install, cam mcp serve, cam mcp print-config, cam mcp apply-guidance, cam mcp doctor",
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
    "Apply safety:",
    `- AGENTS managed-block apply safety: ${report.applySafety.status}${report.applySafety.blockedReason ? ` (${report.applySafety.blockedReason})` : ""}`,
    "",
    "Retrieval sidecar:",
    `- Status: ${report.retrievalSidecar.status}`,
    `- Summary: ${report.retrievalSidecar.summary}`,
    ...report.retrievalSidecar.checks.map(
      (check) =>
        `- ${check.scope}/${check.state}: ${check.status}${check.fallbackReason ? ` (${check.fallbackReason})` : ""} | index: ${check.indexPath} | generatedAt: ${check.generatedAt ?? "none"} | topicFiles: ${check.topicFileCount ?? "none"}`
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
    lines.push(`- ${asset.name}: ${asset.status} (${versionInfo})${executableInfo} (${asset.path})`);
  }
  lines.push(
    `- Post-session sync helper installed: ${report.fallbackAssets.postSessionSyncInstalled ? "yes" : "no"}`,
    `- Post-work review helper installed: ${report.fallbackAssets.postWorkReviewInstalled ? "yes" : "no"}`,
    `- Capture helpers installed: ${report.fallbackAssets.captureHelpersInstalled ? "yes" : "no"}`,
    `- Hook helpers installed: ${report.fallbackAssets.hookHelpersInstalled ? "yes" : "no"}`,
    `- Startup doctor installed: ${report.fallbackAssets.startupDoctorInstalled ? "yes" : "no"}`,
    `- Any skill surface installed: ${report.fallbackAssets.anySkillSurfaceInstalled ? "yes" : "no"}`,
    `- Any skill surface ready: ${report.fallbackAssets.anySkillSurfaceReady ? "yes" : "no"}`,
    `- Legacy skillInstalled compatibility flag: ${report.fallbackAssets.skillInstalled ? "yes" : "no"}`,
    `- Shell fallback available: ${report.fallbackAssets.shellFallbackAvailable ? "yes" : "no"}`,
    `- Guidance available: ${report.fallbackAssets.guidanceAvailable ? "yes" : "no"}`,
    `- Retrieval fallback available: ${report.fallbackAssets.fallbackAvailable ? "yes" : "no"}`,
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
    }`,
    "",
    "Codex stack readiness:",
    `- Status: ${report.codexStack.status}`,
    `- Recommended route: ${report.codexStack.recommendedRoute}`,
    `- Recommended preset: ${report.codexStack.preset}`,
    `- Asset version: ${report.codexStack.assetVersion}`,
    `- MCP ready: ${report.codexStack.mcpReady ? "yes" : "no"}`,
    `- MCP operational ready: ${report.codexStack.mcpOperationalReady ? "yes" : "no"}`,
    `- cam command available: ${report.codexStack.camCommandAvailable ? "yes" : "no"}`,
    `- Hook capture ready: ${report.codexStack.hookCaptureReady ? "yes" : "no"}`,
    `- Hook recall ready: ${report.codexStack.hookRecallReady ? "yes" : "no"}`,
    `- Skill ready: ${report.codexStack.skillReady ? "yes" : "no"}`,
    `- Workflow consistent: ${report.codexStack.workflowConsistent ? "yes" : "no"}`,
    "",
    "Notes:",
    "- cam mcp install writes the recommended project-scoped host config for codex, claude, or gemini only.",
    "- cam mcp doctor only inspects the recommended project-scoped wiring and never writes host config files.",
    "- Re-run cam hooks install or cam skills install if a fallback asset is reported as stale.",
    "- cam memory is the inspect/audit surface for durable memory.",
    "- cam session is the temporary continuity surface and is not the same as durable memory retrieval.",
    ...report.codexStack.notes.map((note) => `- ${note}`)
  );

  return lines.join("\n");
}
