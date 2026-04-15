import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexIntegrationSubchecks,
  buildCodexIntegrationNextSteps,
  buildCodexRouteSummary,
  buildCodexStackNotes,
  CODEX_HOOK_CAPTURE_ASSET_IDS,
  CODEX_HOOK_RECALL_ASSET_IDS,
  CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS,
  formatIntegrationActionHeadline,
  summarizeCodexIntegrationStatus,
  type CodexIntegrationStatus
} from "../integration/codex-stack.js";
import {
  applyCodexAgentsGuidance,
  inspectCodexAgentsGuidanceApplySafety
} from "../integration/agents-guidance.js";
import { listIntegrationAssets } from "../integration/assets.js";
import { installIntegrationAssets } from "../integration/install-assets.js";
import { installMcpProjectConfig, type McpInstallResult } from "../integration/mcp-install.js";
import { normalizeMcpHost } from "../integration/mcp-config.js";
import { resolveMcpProjectRoot } from "../integration/mcp-config.js";
import { inspectMcpDoctor, type McpDoctorReport } from "../integration/mcp-doctor.js";
import { resolveMcpHostProjectConfigPath } from "../integration/mcp-hosts.js";
import {
  formatCodexSkillInstallSurface,
  normalizeCodexSkillInstallSurface,
  type CodexSkillInstallSurface
} from "../integration/skills-paths.js";
import {
  buildResolvedCliCommand,
  buildWorkflowContract
} from "../integration/retrieval-contract.js";
import { ensureDir, writeTextFileAtomic } from "../util/fs.js";
import { sanitizePathFieldsDeep } from "../util/public-paths.js";

type IntegrationStackAction = "created" | "updated" | "unchanged" | "blocked";
type InstallStackAction = Exclude<IntegrationStackAction, "blocked">;
type IntegrationSubactionStatus = "ok" | "blocked";

interface IntegrationsInstallOptions {
  cwd?: string;
  host?: string;
  skillSurface?: string;
  json?: boolean;
  homeDir?: string;
}

interface IntegrationsApplyOptions {
  cwd?: string;
  host?: string;
  skillSurface?: string;
  json?: boolean;
  homeDir?: string;
}

interface IntegrationsDoctorOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

interface IntegrationSubactionResult {
  status: IntegrationSubactionStatus;
  action: IntegrationStackAction;
  effectiveAction?: Exclude<IntegrationStackAction, "blocked">;
  attempted?: boolean;
  rolledBack?: boolean;
  skipped?: boolean;
  skipReason?: string;
  targetPath?: string;
  targetDir?: string;
  surface?: CodexSkillInstallSurface;
  projectPinned?: true;
  readOnlyRetrieval: true;
  notes: string[];
}

interface IntegrationStackInstallResult {
  host: "codex";
  projectRoot: string;
  stackAction: InstallStackAction;
  skillsSurface: CodexSkillInstallSurface;
  readOnlyRetrieval: true;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  postInstallReadinessCommand: string;
  subactions: {
    mcp: IntegrationSubactionResult;
    hooks: IntegrationSubactionResult;
    skills: IntegrationSubactionResult;
  };
  notes: string[];
}

interface IntegrationStackInstallFailureResult {
  host: "codex";
  projectRoot: string;
  stackAction: "failed";
  rollbackApplied: true;
  rollbackSucceeded: boolean;
  rollbackErrors: string[];
  rollbackPathCount: number;
  rollbackReport: RollbackReportEntry[];
  skillsSurface: CodexSkillInstallSurface;
  readOnlyRetrieval: true;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  subactions: {
    mcp: IntegrationSubactionResult;
    hooks: IntegrationSubactionResult;
    skills: IntegrationSubactionResult;
  };
  notes: string[];
}

interface IntegrationStackApplyResult {
  host: "codex";
  projectRoot: string;
  stackAction: IntegrationStackAction | "failed";
  failureStage?: "staged-write";
  failureMessage?: string;
  preflightBlocked?: boolean;
  blockedStage?: "agents-guidance-preflight";
  rollbackApplied?: boolean;
  rollbackSucceeded?: boolean;
  rollbackErrors?: string[];
  rollbackPathCount?: number;
  rollbackReport?: RollbackReportEntry[];
  skillsSurface: CodexSkillInstallSurface;
  readOnlyRetrieval: true;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  postApplyReadinessCommand: string;
  subactions: {
    mcp: IntegrationSubactionResult;
    agents: IntegrationSubactionResult;
    hooks: IntegrationSubactionResult;
    skills: IntegrationSubactionResult;
  };
  notes: string[];
}

interface FileRollbackSnapshot {
  path: string;
  existed: boolean;
  kind: "file" | "symlink" | "directory";
  contents: string | null;
  symlinkTarget: string | null;
  mode: number | null;
}

interface RollbackReportEntry {
  path: string;
  action: "restored-existing" | "deleted-new" | "error";
  error?: string;
}

async function captureFileRollbackSnapshot(filePath: string): Promise<FileRollbackSnapshot> {
  let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (!stat) {
    return {
      path: filePath,
      existed: false,
      kind: "file",
      contents: null,
      symlinkTarget: null,
      mode: null
    };
  }

  if (stat.isSymbolicLink()) {
    return {
      path: filePath,
      existed: true,
      kind: "symlink",
      contents: null,
      symlinkTarget: await fs.readlink(filePath),
      mode: null
    };
  }

  if (stat.isDirectory()) {
    return {
      path: filePath,
      existed: true,
      kind: "directory",
      contents: null,
      symlinkTarget: null,
      mode: stat.mode & 0o777
    };
  }

  const contents = await fs.readFile(filePath, "utf8");
  return {
    path: filePath,
    existed: true,
    kind: "file",
    contents,
    symlinkTarget: null,
    mode: stat.mode & 0o777
  };
}

async function captureRollbackSnapshots(paths: string[]): Promise<FileRollbackSnapshot[]> {
  const uniquePaths = [...new Set(paths)];
  return Promise.all(uniquePaths.map((filePath) => captureFileRollbackSnapshot(filePath)));
}

async function restoreRollbackSnapshots(snapshots: FileRollbackSnapshot[]): Promise<{
  rollbackErrors: string[];
  rollbackReport: RollbackReportEntry[];
}> {
  const rollbackErrors: string[] = [];
  const rollbackReport: RollbackReportEntry[] = [];

  for (const snapshot of snapshots) {
    if (!snapshot.existed) {
      try {
        await fs.rm(snapshot.path, { force: true, recursive: true });
        rollbackReport.push({
          path: snapshot.path,
          action: "deleted-new"
        });
      } catch (error) {
        const message = `Failed to remove ${snapshot.path} during rollback: ${error instanceof Error ? error.message : String(error)}`;
        rollbackErrors.push(message);
        rollbackReport.push({
          path: snapshot.path,
          action: "error",
          error: message
        });
      }
      continue;
    }

    try {
      await ensureDir(path.dirname(snapshot.path));
      if (snapshot.kind === "directory") {
        const currentStat = await fs.lstat(snapshot.path).catch(() => null);
        if (!currentStat?.isDirectory()) {
          await fs.rm(snapshot.path, { force: true, recursive: true }).catch(() => undefined);
          await ensureDir(snapshot.path);
        }
        if (snapshot.mode !== null) {
          await fs.chmod(snapshot.path, snapshot.mode);
        }
      } else {
        await fs.rm(snapshot.path, { force: true, recursive: true }).catch(() => undefined);
      }
      if (snapshot.kind === "symlink") {
        await fs.symlink(snapshot.symlinkTarget ?? "", snapshot.path);
      } else if (snapshot.kind === "directory") {
        if (snapshot.mode !== null) {
          await fs.chmod(snapshot.path, snapshot.mode);
        }
      } else {
        await writeTextFileAtomic(snapshot.path, snapshot.contents ?? "");
        if (snapshot.mode !== null) {
          await fs.chmod(snapshot.path, snapshot.mode);
        }
      }
      rollbackReport.push({
        path: snapshot.path,
        action: "restored-existing"
      });
    } catch (error) {
      const message = `Failed to restore ${snapshot.path} during rollback: ${error instanceof Error ? error.message : String(error)}`;
      rollbackErrors.push(message);
      rollbackReport.push({
        path: snapshot.path,
        action: "error",
        error: message
      });
    }
  }

  return {
    rollbackErrors,
    rollbackReport
  };
}

function buildRollbackFailureMessage(
  context: string,
  error: unknown,
  rollbackErrors: string[]
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (rollbackErrors.length === 0) {
    return `${context}: ${errorMessage}`;
  }

  return `${context}: ${errorMessage}. Rollback also reported ${rollbackErrors.length} issue(s): ${rollbackErrors.join(" | ")}`;
}

function toLateBlockSubactionState(
  action: IntegrationStackAction,
  rollbackSucceeded: boolean
): Pick<IntegrationSubactionResult, "rolledBack" | "effectiveAction"> {
  if (action === "unchanged") {
    return {
      rolledBack: false
    };
  }

  if (!rollbackSucceeded) {
    return {
      rolledBack: false
    };
  }

  return {
    rolledBack: true,
    effectiveAction: "unchanged"
  };
}

interface IntegrationDoctorSubcheck {
  status: CodexIntegrationStatus;
  summary: string;
}

interface IntegrationDoctorResult {
  host: "codex";
  projectRoot: string;
  readOnlyRetrieval: true;
  status: CodexIntegrationStatus;
  recommendedRoute: NonNullable<McpDoctorReport["codexStack"]>["recommendedRoute"];
  currentlyOperationalRoute: NonNullable<McpDoctorReport["codexStack"]>["currentlyOperationalRoute"];
  routeKind: NonNullable<McpDoctorReport["codexStack"]>["routeKind"];
  routeEvidence: string[];
  shellDependencyLevel: NonNullable<McpDoctorReport["codexStack"]>["shellDependencyLevel"];
  hostMutationRequired: boolean;
  preferredRouteBlockers: string[];
  currentOperationalBlockers: string[];
  recommendedPreset: string;
  retrievalSidecar: McpDoctorReport["retrievalSidecar"];
  topicDiagnostics: McpDoctorReport["topicDiagnostics"];
  layoutDiagnostics: McpDoctorReport["layoutDiagnostics"];
  instructionProposalLane: McpDoctorReport["instructionProposalLane"];
  workflowContract: McpDoctorReport["workflowContract"];
  experimentalHooks: NonNullable<McpDoctorReport["experimentalHooks"]>;
  applyReadiness: {
    status: "safe" | "blocked";
    reason?: string;
    recommendedFix?: string;
  };
  preferredSkillSurface: CodexSkillInstallSurface;
  recommendedSkillInstallCommand: string;
  installedSkillSurfaces: CodexSkillInstallSurface[];
  readySkillSurfaces: CodexSkillInstallSurface[];
  subchecks: {
    mcp: IntegrationDoctorSubcheck;
    agents: IntegrationDoctorSubcheck;
    hookCapture: IntegrationDoctorSubcheck;
    hookRecall: IntegrationDoctorSubcheck;
    skill: IntegrationDoctorSubcheck;
    workflowConsistency: IntegrationDoctorSubcheck;
  };
  notes: string[];
  nextSteps: string[];
}

function requireCodexDoctorSections(report: McpDoctorReport): {
  agentsGuidance: NonNullable<McpDoctorReport["agentsGuidance"]>;
  applySafety: NonNullable<McpDoctorReport["applySafety"]>;
  experimentalHooks: NonNullable<McpDoctorReport["experimentalHooks"]>;
  codexStack: NonNullable<McpDoctorReport["codexStack"]>;
} {
  if (!report.agentsGuidance || !report.applySafety || !report.experimentalHooks || !report.codexStack) {
    throw new Error("Codex integrations doctor requires codex-specific MCP doctor sections.");
  }

  return {
    agentsGuidance: report.agentsGuidance,
    applySafety: report.applySafety,
    experimentalHooks: report.experimentalHooks,
    codexStack: report.codexStack
  };
}

function describeSkillSurfaceInstallNote(surface: CodexSkillInstallSurface): string {
  switch (surface) {
    case "runtime":
      return "It writes project-scoped MCP wiring and refreshes user-scoped hook and runtime skill assets without touching Markdown memory files.";
    case "official-user":
      return "It writes project-scoped MCP wiring, refreshes user-scoped hook assets, and refreshes the explicit user-scoped official .agents/skills copy without touching Markdown memory files.";
    case "official-project":
      return "It writes project-scoped MCP wiring, refreshes user-scoped hook assets, and refreshes the project-scoped official .agents/skills copy without touching Markdown memory files.";
  }
}

function summarizeStackAction(actions: IntegrationStackAction[]): IntegrationStackAction {
  if (actions.includes("blocked")) {
    return "blocked";
  }

  if (actions.every((action) => action === "unchanged")) {
    return "unchanged";
  }

  if (actions.every((action) => action === "created")) {
    return "created";
  }

  return "updated";
}

function toMcpSubaction(result: McpInstallResult): IntegrationSubactionResult {
  return {
    status: "ok",
    action: result.action,
    targetPath: result.targetPath,
    projectPinned: result.projectPinned,
    readOnlyRetrieval: result.readOnlyRetrieval,
    notes: [...result.notes]
  };
}

function buildInstallFailureSubaction(
  result:
    | Awaited<ReturnType<typeof installMcpProjectConfig>>
    | Awaited<ReturnType<typeof installIntegrationAssets>>
    | null,
  options: {
    fallbackSurface?: CodexSkillInstallSurface;
    rollbackSucceeded: boolean;
    notes?: string[];
  } = {
    rollbackSucceeded: false
  }
): IntegrationSubactionResult {
  if (!result) {
    return {
      status: "ok",
      action: "unchanged",
      attempted: false,
      skipped: true,
      skipReason: "Skipped because integrations install failed before this subaction ran.",
      surface: options.fallbackSurface,
      readOnlyRetrieval: true,
      notes: options.notes ?? ["Skipped because integrations install failed before this subaction ran."]
    };
  }

  const shared = "targetPath" in result
    ? {
        ...toMcpSubaction(result),
        attempted: true
      }
    : {
        status: "ok" as const,
        action: result.action,
        attempted: true,
        targetDir: result.targetDir,
        surface: result.installSurface === "skills" ? result.skillSurface : undefined,
        readOnlyRetrieval: result.readOnlyRetrieval,
        notes: [...result.notes]
      };

  if (result.action === "unchanged" || !options.rollbackSucceeded) {
    return shared;
  }

  return {
    ...shared,
    rolledBack: true,
    effectiveAction: "unchanged"
  };
}

type ApplyFailureSubactionName = "mcp" | "agents" | "hooks" | "skills";

function inferFailedApplySubaction(
  mcpResult: Awaited<ReturnType<typeof installMcpProjectConfig>> | null,
  hooksResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null,
  skillsResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null,
  agentsResult: Awaited<ReturnType<typeof applyCodexAgentsGuidance>> | null
): ApplyFailureSubactionName | null {
  if (!mcpResult) {
    return "mcp";
  }

  if (!hooksResult) {
    return "hooks";
  }

  if (!skillsResult) {
    return "skills";
  }

  if (!agentsResult) {
    return "agents";
  }

  return null;
}

function buildApplyFailureSubaction(
  result:
    | Awaited<ReturnType<typeof installMcpProjectConfig>>
    | Awaited<ReturnType<typeof installIntegrationAssets>>
    | Awaited<ReturnType<typeof applyCodexAgentsGuidance>>
    | null,
  options: {
    currentSubaction: ApplyFailureSubactionName;
    failedSubaction: ApplyFailureSubactionName | null;
    fallbackSurface?: CodexSkillInstallSurface;
    failureMessage: string;
    skipReason: string;
    rollbackSucceeded: boolean;
  }
): IntegrationSubactionResult {
  if (!result) {
    if (options.currentSubaction === options.failedSubaction) {
      return {
        status: "blocked",
        action: "blocked",
        attempted: true,
        surface: options.fallbackSurface,
        readOnlyRetrieval: true,
        notes: [options.failureMessage]
      };
    }

    return {
      status: "ok",
      action: "unchanged",
      attempted: false,
      skipped: true,
      skipReason: options.skipReason,
      surface: options.fallbackSurface,
      readOnlyRetrieval: true,
      notes: [options.skipReason]
    };
  }

  if ("serverName" in result) {
    const shared = {
      ...toMcpSubaction(result),
      attempted: true
    };

    if (result.action === "unchanged" || !options.rollbackSucceeded) {
      return shared;
    }

    return {
      ...shared,
      rolledBack: true,
      effectiveAction: "unchanged"
    };
  }

  if ("installSurface" in result) {
    const shared = {
      status: "ok" as const,
      action: result.action,
      attempted: true,
      targetDir: result.targetDir,
      surface: result.installSurface === "skills" ? result.skillSurface : undefined,
      readOnlyRetrieval: result.readOnlyRetrieval,
      notes: [...result.notes]
    };

    if (result.action === "unchanged" || !options.rollbackSucceeded) {
      return shared;
    }

    return {
      ...shared,
      rolledBack: true,
      effectiveAction: "unchanged"
    };
  }

  if ("targetPath" in result) {
    return {
      status: result.action === "blocked" ? "blocked" : "ok",
      action: result.action,
      attempted: true,
      targetPath: result.targetPath,
      readOnlyRetrieval: true,
      notes: [...result.notes]
    };
  }

  return {
    status: "ok",
    action: "unchanged",
    attempted: false,
    skipped: true,
    skipReason: options.skipReason,
    surface: options.fallbackSurface,
    readOnlyRetrieval: true,
    notes: [options.skipReason]
  };
}

function normalizeIntegrationsHost(
  host: string | undefined,
  action: "install" | "apply" | "doctor"
): "codex" {
  const normalized = normalizeMcpHost(host);
  if (normalized !== "codex") {
    throw new Error(
      `cam integrations ${action} is Codex-only in this repository. Use --host codex, not "${normalized}".`
    );
  }

  return normalized;
}

function formatIntegrationApplyHeadline(action: IntegrationStackAction | "failed"): string {
  if (action === "blocked") {
    return "Codex integration apply was blocked.";
  }

  if (action === "failed") {
    return "Codex integration apply failed.";
  }

  return formatIntegrationActionHeadline(action, "Codex integration apply");
}

function hasAnyInstalledAsset(
  report: McpDoctorReport,
  ids: readonly string[]
): boolean {
  return ids.some((id) => report.fallbackAssets.assets.find((asset) => asset.id === id)?.installed);
}

function buildIntegrationsDoctorResult(
  report: McpDoctorReport,
  options: {
    explicitCwd?: boolean;
  } = {}
): IntegrationDoctorResult {
  const { agentsGuidance, applySafety, experimentalHooks, codexStack } =
    requireCodexDoctorSections(report);
  const pinnedProjectRoot = options.explicitCwd ? report.projectRoot : undefined;
  const codexHost = report.hosts.find((host) => host.host === "codex");
  if (!codexHost) {
    throw new Error("Codex host inspection is required for integrations doctor.");
  }

  const hasCaptureAssets = hasAnyInstalledAsset(report, CODEX_HOOK_CAPTURE_ASSET_IDS);
  const hasRecallAssets = hasAnyInstalledAsset(report, CODEX_HOOK_RECALL_ASSET_IDS);
  const hasWorkflowAssets = hasAnyInstalledAsset(report, CODEX_WORKFLOW_CONSISTENCY_ASSET_IDS);
  const hasSkillAssets = hasAnyInstalledAsset(report, ["codex-memory-skill"]);

  const subchecks = buildCodexIntegrationSubchecks(
    {
      mcpReady: codexStack.mcpReady,
      mcpOperationalReady: codexStack.mcpOperationalReady,
      camCommandAvailable: codexStack.camCommandAvailable,
      hookCaptureReady: codexStack.hookCaptureReady,
      hookCaptureOperationalReady: codexStack.hookCaptureOperationalReady,
      hookRecallReady: codexStack.hookRecallReady,
      hookRecallOperationalReady: codexStack.hookRecallOperationalReady,
      skillReady: codexStack.skillReady,
      workflowAssetsConsistent: codexStack.workflowAssetsConsistent,
      workflowConsistent: codexStack.workflowConsistent
    },
    {
      hasCaptureAssets,
      hasRecallAssets,
      hasSkillAssets,
      hasWorkflowAssets
    },
    {
      status: codexHost.status === "missing" ? "missing" : "warning",
      summary: codexHost.summary
    }
  );
  const agents: IntegrationDoctorSubcheck =
    agentsGuidance.status === "ok"
      ? {
          status: "ok",
          summary: "Repository-level AGENTS.md includes the current Codex Auto Memory guidance."
        }
      : agentsGuidance.status === "warning"
        ? {
            status: "warning",
            summary:
              "Repository-level AGENTS.md exists, but the Codex Auto Memory guidance is missing or outdated."
          }
        : {
            status: "missing",
            summary: "Repository-level AGENTS.md does not exist yet."
          };
  const allSubchecks: IntegrationDoctorResult["subchecks"] = {
    ...subchecks,
    agents
  };

  const status = summarizeCodexIntegrationStatus(
    Object.values(allSubchecks).map((subcheck) => subcheck.status)
  );
  const notes = [
    buildCodexRouteSummary(codexStack.recommendedRoute),
    ...buildCodexStackNotes({
      cwd: pinnedProjectRoot
    }),
    `If retrieval sidecars are degraded, repair them explicitly with \`${report.retrievalSidecar.repairCommand}\` before treating the retrieval plane as fully healthy.`,
    ...(report.topicDiagnostics.status === "warning"
      ? [
          `Unsafe topic diagnostics are present: ${report.topicDiagnostics.summary}`
        ]
      : []),
    ...(report.layoutDiagnostics.status === "warning"
      ? [
          `Canonical layout diagnostics are present: ${report.layoutDiagnostics.summary}`
        ]
      : []),
    "AGENTS guidance is inspected read-only and is never auto-written by integrations doctor."
  ];
  const applySafetyStatus = applySafety.status;
  const applyReadiness =
    applySafetyStatus === "blocked"
      ? {
          status: "blocked" as const,
          reason: applySafety.blockedReason,
          recommendedFix:
            `Repair the existing AGENTS.md managed guidance block so its markers are balanced outside fenced code blocks, then re-run ${buildResolvedCliCommand(
              "mcp apply-guidance --host codex",
              { cwd: pinnedProjectRoot }
            )}.`
        }
      : {
          status: "safe" as const
        };
  const nextSteps = buildCodexIntegrationNextSteps({
    mcpReady: codexStack.mcpReady,
    mcpOperationalReady: codexStack.mcpOperationalReady,
    camCommandAvailable: codexStack.camCommandAvailable,
    hookCaptureReady: codexStack.hookCaptureReady,
    hookCaptureOperationalReady: codexStack.hookCaptureOperationalReady,
    hookRecallReady: codexStack.hookRecallReady,
    hookRecallOperationalReady: codexStack.hookRecallOperationalReady,
    skillReady: codexStack.skillReady,
    workflowAssetsConsistent: codexStack.workflowAssetsConsistent,
    workflowConsistent: codexStack.workflowConsistent
  }, {
    skillInstallCommand: report.fallbackAssets.recommendedSkillInstallCommand,
    projectRoot: pinnedProjectRoot
  });
  const needsAgents = agentsGuidance.status !== "ok";
  const agentsGuidanceRepairStep =
    applyReadiness.status === "safe" && needsAgents
      ? `Run \`${buildResolvedCliCommand("mcp apply-guidance --host codex", {
          cwd: pinnedProjectRoot
        })}\` to create or update the managed Codex Auto Memory block in the repository-level AGENTS.md.`
      : null;
  if (report.retrievalSidecar.status === "warning") {
    const repairStep =
      `Run \`${report.retrievalSidecar.repairCommand}\` to rebuild retrieval sidecars from Markdown canonical memory.`;
    if (agentsGuidanceRepairStep) {
      nextSteps.splice(1, 0, repairStep);
    } else {
      nextSteps.unshift(repairStep);
    }
  }
  const needsInstallableOtherStackSurface =
    !codexStack.mcpReady ||
    !codexStack.hookCaptureReady ||
    !codexStack.hookRecallReady ||
    !codexStack.skillReady;
  if (applyReadiness.status === "blocked") {
    nextSteps.unshift(applyReadiness.recommendedFix);
  } else if (needsAgents && needsInstallableOtherStackSurface) {
    nextSteps.unshift(
      `Run \`${buildResolvedCliCommand(
        `integrations apply --host codex --skill-surface ${report.fallbackAssets.preferredInstallSurface}`,
        {
          cwd: pinnedProjectRoot
        }
      )}\` to install project-scoped MCP wiring, refresh hook and skill assets, and safely apply the managed Codex Auto Memory AGENTS.md block in one step.`
    );
  } else if (needsAgents) {
    nextSteps.unshift(agentsGuidanceRepairStep!);
  }

  return {
    host: "codex",
    projectRoot: report.projectRoot,
    readOnlyRetrieval: true,
    status,
    recommendedRoute: codexStack.recommendedRoute,
    currentlyOperationalRoute: codexStack.currentlyOperationalRoute,
    routeKind: codexStack.routeKind,
    routeEvidence: [...codexStack.routeEvidence],
    shellDependencyLevel: codexStack.shellDependencyLevel,
    hostMutationRequired: codexStack.hostMutationRequired,
    preferredRouteBlockers: [...codexStack.preferredRouteBlockers],
    currentOperationalBlockers: [...codexStack.currentOperationalBlockers],
    recommendedPreset: codexStack.preset,
    retrievalSidecar: report.retrievalSidecar,
    topicDiagnostics: report.topicDiagnostics,
    layoutDiagnostics: report.layoutDiagnostics,
    instructionProposalLane: report.instructionProposalLane,
    workflowContract: report.workflowContract,
    experimentalHooks,
    applyReadiness,
    preferredSkillSurface: report.fallbackAssets.preferredInstallSurface,
    recommendedSkillInstallCommand: report.fallbackAssets.recommendedSkillInstallCommand,
    installedSkillSurfaces: [...report.fallbackAssets.installedSkillSurfaces],
    readySkillSurfaces: [...report.fallbackAssets.readySkillSurfaces],
    subchecks: allSubchecks,
    notes: [...new Set(notes)],
    nextSteps: [...new Set(nextSteps)]
  };
}

function formatIntegrationsDoctorResult(result: IntegrationDoctorResult): string {
  return [
    "Codex Auto Memory Integrations Doctor",
    `Host: ${result.host}`,
    `Project root: ${result.projectRoot}`,
    `Retrieval plane: ${result.readOnlyRetrieval ? "read-only" : "unexpected"}`,
    `Status: ${result.status}`,
    `Recommended route: ${result.recommendedRoute}`,
    `Current operational route: ${result.currentlyOperationalRoute}`,
    `Route kind: ${result.routeKind}`,
    `Route evidence: ${result.routeEvidence.length > 0 ? result.routeEvidence.join(", ") : "none"}`,
    `Shell dependency level: ${result.shellDependencyLevel}`,
    `Host mutation required: ${result.hostMutationRequired ? "yes" : "no"}`,
    `Preferred route blockers: ${result.preferredRouteBlockers.length > 0 ? result.preferredRouteBlockers.join(", ") : "none"}`,
    `Current operational blockers: ${result.currentOperationalBlockers.length > 0 ? result.currentOperationalBlockers.join(", ") : "none"}`,
    `Recommended preset: ${result.recommendedPreset}`,
    `Experimental hooks: ${result.experimentalHooks.status} (${result.experimentalHooks.featureFlag})`,
    `Retrieval sidecar: ${result.retrievalSidecar.status} (${result.retrievalSidecar.summary})`,
    `Topic diagnostics: ${result.topicDiagnostics.status} (${result.topicDiagnostics.summary})`,
    `Layout diagnostics: ${result.layoutDiagnostics.status} (${result.layoutDiagnostics.summary})`,
    `Instruction proposal lane: ${result.instructionProposalLane.status} (${result.instructionProposalLane.summary})`,
    `Apply readiness: ${result.applyReadiness.status}${result.applyReadiness.reason ? ` (${result.applyReadiness.reason})` : ""}`,
    `Preferred skill surface: ${formatCodexSkillInstallSurface(result.preferredSkillSurface)}`,
    `Recommended skill install command: ${result.recommendedSkillInstallCommand}`,
    `Installed skill surfaces: ${result.installedSkillSurfaces.length > 0 ? result.installedSkillSurfaces.join(", ") : "none"}`,
    `Ready skill surfaces: ${result.readySkillSurfaces.length > 0 ? result.readySkillSurfaces.join(", ") : "none"}`,
    "",
    "Subchecks:",
    `- [${result.subchecks.mcp.status}] mcp: ${result.subchecks.mcp.summary}`,
    `- [${result.subchecks.agents.status}] agents: ${result.subchecks.agents.summary}`,
    `- [${result.subchecks.hookCapture.status}] hookCapture: ${result.subchecks.hookCapture.summary}`,
    `- [${result.subchecks.hookRecall.status}] hookRecall: ${result.subchecks.hookRecall.summary}`,
    `- [${result.subchecks.skill.status}] skill: ${result.subchecks.skill.summary}`,
    `- [${result.subchecks.workflowConsistency.status}] workflowConsistency: ${result.subchecks.workflowConsistency.summary}`,
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `- ${step}`),
    "",
    "Notes:",
    ...result.notes.map((note) => `- ${note}`)
  ].join("\n");
}

function buildOperationalRouteConfirmationNote(projectRoot: string): string {
  return `Run ${buildResolvedCliCommand("integrations doctor --host codex", {
    cwd: projectRoot
  })} to confirm which retrieval route is operational in the current environment.`;
}

export async function runIntegrationsInstall(
  options: IntegrationsInstallOptions = {}
): Promise<string> {
  normalizeIntegrationsHost(options.host, "install");

  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const skillSurface = normalizeCodexSkillInstallSurface(options.skillSurface);
  const homeDir = options.homeDir ?? os.homedir();
  const rollbackTargetPaths = [
    resolveMcpHostProjectConfigPath("codex", projectRoot),
    ...listIntegrationAssets(homeDir, "hooks", {
      projectRoot
    }).map((asset) => asset.path),
    ...listIntegrationAssets(homeDir, "skills", {
      projectRoot,
      skillSurface
    }).map((asset) => asset.path)
  ].filter((value): value is string => Boolean(value));
  const rollbackSnapshots = await captureRollbackSnapshots(rollbackTargetPaths);

  let mcpResult: Awaited<ReturnType<typeof installMcpProjectConfig>> | null = null;
  let hooksResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null = null;
  let skillsResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null = null;

  try {
    mcpResult = await installMcpProjectConfig("codex", projectRoot);
    hooksResult = await installIntegrationAssets("hooks", {
      projectRoot,
      homeDir
    });
    skillsResult = await installIntegrationAssets("skills", {
      projectRoot,
      skillSurface,
      homeDir
    });
  } catch (error) {
    const { rollbackErrors, rollbackReport } = await restoreRollbackSnapshots(rollbackSnapshots);
    if (options.json) {
      const rollbackSucceeded = rollbackErrors.length === 0;
      const result: IntegrationStackInstallFailureResult = {
        host: "codex",
        projectRoot,
        stackAction: "failed",
        rollbackApplied: true,
        rollbackSucceeded,
        rollbackErrors,
        rollbackPathCount: rollbackSnapshots.length,
        rollbackReport,
        skillsSurface: skillSurface,
        readOnlyRetrieval: true,
        workflowContract: buildWorkflowContract({
          cwd: projectRoot
        }),
        subactions: {
          mcp: buildInstallFailureSubaction(mcpResult, {
            rollbackSucceeded
          }),
          hooks: buildInstallFailureSubaction(hooksResult, {
            rollbackSucceeded
          }),
          skills: buildInstallFailureSubaction(skillsResult, {
            rollbackSucceeded,
            fallbackSurface: skillSurface
          })
        },
        notes: [
          "This orchestration surface is Codex-only.",
          "Codex integration stack install failed after staged writes started.",
          `Rollback processed ${rollbackReport.length} target path(s) so partially written MCP, hook, and skill assets did not remain applied.`,
          `Failure: ${error instanceof Error ? error.message : String(error)}`,
          ...(rollbackErrors.length > 0
            ? [`Rollback reported ${rollbackErrors.length} issue(s): ${rollbackErrors.join(" | ")}.`]
            : [])
        ]
      };
      return JSON.stringify(result, null, 2);
    }

    throw new Error(
      buildRollbackFailureMessage(
        "Codex integration stack install failed after staged writes started",
        error,
        rollbackErrors
      )
    );
  }

  if (!mcpResult || !hooksResult || !skillsResult) {
    const { rollbackErrors, rollbackReport } = await restoreRollbackSnapshots(rollbackSnapshots);
    if (options.json) {
      const rollbackSucceeded = rollbackErrors.length === 0;
      const result: IntegrationStackInstallFailureResult = {
        host: "codex",
        projectRoot,
        stackAction: "failed",
        rollbackApplied: true,
        rollbackSucceeded,
        rollbackErrors,
        rollbackPathCount: rollbackSnapshots.length,
        rollbackReport,
        skillsSurface: skillSurface,
        readOnlyRetrieval: true,
        workflowContract: buildWorkflowContract({
          cwd: projectRoot
        }),
        subactions: {
          mcp: buildInstallFailureSubaction(mcpResult, {
            rollbackSucceeded
          }),
          hooks: buildInstallFailureSubaction(hooksResult, {
            rollbackSucceeded
          }),
          skills: buildInstallFailureSubaction(skillsResult, {
            rollbackSucceeded,
            fallbackSurface: skillSurface
          })
        },
        notes: [
          "This orchestration surface is Codex-only.",
          "Codex integration stack install could not complete its staged subactions safely.",
          `Rollback processed ${rollbackReport.length} target path(s) so partial integration assets did not remain applied.`,
          ...(rollbackErrors.length > 0
            ? [`Rollback reported ${rollbackErrors.length} issue(s): ${rollbackErrors.join(" | ")}.`]
            : [])
        ]
      };
      return JSON.stringify(result, null, 2);
    }

    throw new Error(
      buildRollbackFailureMessage(
        "Codex integration stack install could not complete its staged subactions safely",
        "missing staged result",
        rollbackErrors
      )
    );
  }

  const stackAction = summarizeStackAction([
    mcpResult.action,
    hooksResult.action,
    skillsResult.action
  ]) as InstallStackAction;

  const result: IntegrationStackInstallResult = {
    host: "codex",
    projectRoot,
    stackAction,
    skillsSurface: skillSurface,
    readOnlyRetrieval: true,
    workflowContract: buildWorkflowContract({
      cwd: projectRoot
    }),
    postInstallReadinessCommand: buildResolvedCliCommand("integrations doctor --host codex", {
      cwd: projectRoot
    }),
    subactions: {
      mcp: toMcpSubaction(mcpResult),
      hooks: {
        status: "ok",
        action: hooksResult.action,
        targetDir: hooksResult.targetDir,
        readOnlyRetrieval: hooksResult.readOnlyRetrieval,
        notes: [...hooksResult.notes]
      },
      skills: {
        status: "ok",
        action: skillsResult.action,
        targetDir: skillsResult.targetDir,
        surface: skillSurface,
        readOnlyRetrieval: skillsResult.readOnlyRetrieval,
        notes: [...skillsResult.notes]
      }
    },
    notes: [
      "This orchestration surface is Codex-only.",
      describeSkillSurfaceInstallNote(skillSurface),
      "Project-scoped retrieval MCP wiring was written, but operational readiness still depends on the current shell and host environment.",
      buildOperationalRouteConfirmationNote(projectRoot),
      `Skill surface: ${formatCodexSkillInstallSurface(skillSurface)}.`,
      `Recommended retrieval preset: ${hooksResult.recommendedPreset}.`
    ]
  };

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  return [
    formatIntegrationActionHeadline(result.stackAction, "Codex integration stack"),
    `Host: ${result.host}`,
    `Project root: ${result.projectRoot}`,
    `Stack action: ${result.stackAction}`,
    `Skill surface: ${formatCodexSkillInstallSurface(result.skillsSurface)}`,
    "Subactions:",
    `- mcp: [${result.subactions.mcp.status}] ${result.subactions.mcp.action} -> ${result.subactions.mcp.targetPath}`,
    `- hooks: [${result.subactions.hooks.status}] ${result.subactions.hooks.action} -> ${result.subactions.hooks.targetDir}`,
    `- skills: [${result.subactions.skills.status}] ${result.subactions.skills.action} -> ${result.subactions.skills.targetDir}`,
    "",
    "Notes:",
    ...result.notes.map((note) => `- ${note}`)
  ].join("\n");
}

export async function runIntegrationsApply(
  options: IntegrationsApplyOptions = {}
): Promise<string> {
  normalizeIntegrationsHost(options.host, "apply");

  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const skillSurface = normalizeCodexSkillInstallSurface(options.skillSurface);
  const homeDir = options.homeDir ?? os.homedir();
  const applySafety = await inspectCodexAgentsGuidanceApplySafety(projectRoot);
  if (applySafety.status === "blocked") {
    const skipReason =
      "Skipped because integrations apply was blocked during AGENTS guidance preflight.";
    const result: IntegrationStackApplyResult = {
      host: "codex",
      projectRoot,
      stackAction: "blocked",
      preflightBlocked: true,
      blockedStage: "agents-guidance-preflight",
      skillsSurface: skillSurface,
      readOnlyRetrieval: true,
      workflowContract: buildWorkflowContract({
        cwd: projectRoot
      }),
      postApplyReadinessCommand: buildResolvedCliCommand("integrations doctor --host codex", {
        cwd: projectRoot
      }),
      subactions: {
        mcp: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason,
          readOnlyRetrieval: true,
          notes: [skipReason]
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true,
          targetPath: applySafety.targetPath,
          readOnlyRetrieval: true,
          notes: [...applySafety.notes]
        },
        hooks: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason,
          readOnlyRetrieval: true,
          notes: [skipReason]
        },
        skills: {
          status: "ok",
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason,
          targetDir: undefined,
          surface: skillSurface,
          readOnlyRetrieval: true,
          notes: [skipReason]
        }
      },
      notes: [
        "This orchestration surface is Codex-only and explicit.",
        "Integrations apply was blocked during AGENTS guidance preflight, so no project-scoped MCP wiring, hook assets, or skill assets were written.",
        ...(applySafety.blockedReason ? [`Reason: ${applySafety.blockedReason}`] : [])
      ]
    };

    if (options.json) {
      return JSON.stringify(result, null, 2);
    }

    return [
      formatIntegrationApplyHeadline(result.stackAction),
      `Host: ${result.host}`,
      `Project root: ${result.projectRoot}`,
      `Stack action: ${result.stackAction}`,
      "Blocked stage: agents-guidance-preflight",
      "",
      "Notes:",
      ...result.notes.map((note) => `- ${note}`)
    ].join("\n");
  }

  const rollbackTargetPaths = [
    resolveMcpHostProjectConfigPath("codex", projectRoot),
    applySafety.targetPath,
    ...listIntegrationAssets(homeDir, "hooks", {
      projectRoot
    }).map((asset) => asset.path),
    ...listIntegrationAssets(homeDir, "skills", {
      projectRoot,
      skillSurface
    }).map((asset) => asset.path)
  ].filter((value): value is string => Boolean(value));
  const rollbackSnapshots = await captureRollbackSnapshots(rollbackTargetPaths);

  let mcpResult: Awaited<ReturnType<typeof installMcpProjectConfig>> | null = null;
  let hooksResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null = null;
  let skillsResult: Awaited<ReturnType<typeof installIntegrationAssets>> | null = null;
  let agentsResult: Awaited<ReturnType<typeof applyCodexAgentsGuidance>> | null = null;

  try {
    mcpResult = await installMcpProjectConfig("codex", projectRoot);
    hooksResult = await installIntegrationAssets("hooks", {
      projectRoot,
      homeDir
    });
    skillsResult = await installIntegrationAssets("skills", {
      projectRoot,
      skillSurface,
      homeDir
    });
    agentsResult = await applyCodexAgentsGuidance(projectRoot);
  } catch (error) {
    const { rollbackErrors, rollbackReport } = await restoreRollbackSnapshots(rollbackSnapshots);
    const failureMessage = buildRollbackFailureMessage(
      "Codex integration apply failed after staged writes started",
      error,
      rollbackErrors
    );
    if (options.json) {
      const rollbackSucceeded = rollbackErrors.length === 0;
      const skipReason = "Skipped because integrations apply failed before this subaction ran.";
      const result: IntegrationStackApplyResult = {
        host: "codex",
        projectRoot,
        stackAction: "failed",
        failureStage: "staged-write",
        failureMessage,
        rollbackApplied: true,
        rollbackSucceeded,
        rollbackErrors,
        rollbackPathCount: rollbackSnapshots.length,
        rollbackReport,
        skillsSurface: skillSurface,
        readOnlyRetrieval: true,
        workflowContract: buildWorkflowContract({
          cwd: projectRoot
        }),
        postApplyReadinessCommand: buildResolvedCliCommand("integrations doctor --host codex", {
          cwd: projectRoot
        }),
        subactions: {
          ...(function () {
            const failedSubaction = inferFailedApplySubaction(
              mcpResult,
              hooksResult,
              skillsResult,
              agentsResult
            );
            return {
          mcp: buildApplyFailureSubaction(mcpResult, {
            currentSubaction: "mcp",
            failedSubaction,
            rollbackSucceeded,
            failureMessage,
            skipReason
          }),
          agents: buildApplyFailureSubaction(agentsResult, {
            currentSubaction: "agents",
            failedSubaction,
            rollbackSucceeded,
            failureMessage,
            skipReason
          }),
          hooks: buildApplyFailureSubaction(hooksResult, {
            currentSubaction: "hooks",
            failedSubaction,
            rollbackSucceeded,
            failureMessage,
            skipReason
          }),
          skills: buildApplyFailureSubaction(skillsResult, {
            currentSubaction: "skills",
            failedSubaction,
            fallbackSurface: skillSurface,
            rollbackSucceeded,
            failureMessage,
            skipReason
          })
            };
          })()
        },
        notes: [
          "This orchestration surface is Codex-only and explicit.",
          "Integrations apply failed after staged writes started.",
          `Rollback processed ${rollbackReport.length} target path(s) so partial project-scoped wiring and helper assets did not remain applied.`,
          `Failure: ${failureMessage}`
        ]
      };
      return JSON.stringify(result, null, 2);
    }

    throw new Error(failureMessage);
  }

  if (!mcpResult || !hooksResult || !skillsResult || !agentsResult) {
    const { rollbackErrors } = await restoreRollbackSnapshots(rollbackSnapshots);
    throw new Error(
      buildRollbackFailureMessage(
        "Integrations apply could not complete its staged subactions safely",
        "missing staged result",
        rollbackErrors
      )
    );
  }

  if (agentsResult.action === "blocked") {
    const { rollbackErrors, rollbackReport } = await restoreRollbackSnapshots(rollbackSnapshots);
    const rollbackSucceeded = rollbackErrors.length === 0;
    const result: IntegrationStackApplyResult = {
      host: "codex",
      projectRoot,
      stackAction: "blocked",
      rollbackApplied: true,
      rollbackSucceeded,
      rollbackErrors,
      rollbackPathCount: rollbackSnapshots.length,
      rollbackReport,
      skillsSurface: skillSurface,
      readOnlyRetrieval: true,
      workflowContract: buildWorkflowContract({
        cwd: projectRoot
      }),
      postApplyReadinessCommand: buildResolvedCliCommand("integrations doctor --host codex", {
        cwd: projectRoot
      }),
      subactions: {
        mcp: {
          ...toMcpSubaction(mcpResult),
          attempted: true,
          ...toLateBlockSubactionState(mcpResult.action, rollbackSucceeded)
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true,
          targetPath: agentsResult.targetPath,
          readOnlyRetrieval: true,
          notes: [...agentsResult.notes]
        },
        hooks: {
          status: "ok",
          action: hooksResult.action,
          attempted: true,
          ...toLateBlockSubactionState(hooksResult.action, rollbackSucceeded),
          targetDir: hooksResult.targetDir,
          readOnlyRetrieval: hooksResult.readOnlyRetrieval,
          notes: [...hooksResult.notes]
        },
        skills: {
          status: "ok",
          action: skillsResult.action,
          attempted: true,
          ...toLateBlockSubactionState(skillsResult.action, rollbackSucceeded),
          targetDir: skillsResult.targetDir,
          surface: skillSurface,
          readOnlyRetrieval: skillsResult.readOnlyRetrieval,
          notes: [...skillsResult.notes]
        }
      },
      notes: [
        "This orchestration surface is Codex-only and explicit.",
        "Integrations apply was blocked while applying the repository-level AGENTS.md guidance block after staged writes had started.",
        `Rollback processed ${rollbackReport.length} target path(s) so project-scoped MCP wiring, hook assets, and skill assets did not remain half-applied.`,
        ...(rollbackErrors.length > 0
          ? [
              `Rollback reported ${rollbackErrors.length} issue(s): ${rollbackErrors.join(" | ")}.`
            ]
          : []),
        ...(agentsResult.blockedReason ? [`Reason: ${agentsResult.blockedReason}`] : [])
      ]
    };

    if (options.json) {
      return JSON.stringify(result, null, 2);
    }

    return [
      formatIntegrationApplyHeadline(result.stackAction),
      `Host: ${result.host}`,
      `Project root: ${result.projectRoot}`,
      `Stack action: ${result.stackAction}`,
      "",
      "Notes:",
      ...result.notes.map((note) => `- ${note}`)
    ].join("\n");
  }

  const result: IntegrationStackApplyResult = {
    host: "codex",
    projectRoot,
    skillsSurface: skillSurface,
    stackAction: summarizeStackAction([
      mcpResult.action,
      agentsResult.action,
      hooksResult.action,
      skillsResult.action
    ]),
    readOnlyRetrieval: true,
    workflowContract: buildWorkflowContract({
      cwd: projectRoot
    }),
    postApplyReadinessCommand: buildResolvedCliCommand("integrations doctor --host codex", {
      cwd: projectRoot
    }),
    subactions: {
      mcp: {
        ...toMcpSubaction(mcpResult),
        attempted: true
      },
      agents: {
        status: "ok",
        action: agentsResult.action,
        attempted: true,
        targetPath: agentsResult.targetPath,
        readOnlyRetrieval: true,
        notes: [...agentsResult.notes]
      },
      hooks: {
        status: "ok",
        action: hooksResult.action,
        attempted: true,
        targetDir: hooksResult.targetDir,
        readOnlyRetrieval: hooksResult.readOnlyRetrieval,
        notes: [...hooksResult.notes]
      },
      skills: {
        status: "ok",
        action: skillsResult.action,
        attempted: true,
        targetDir: skillsResult.targetDir,
        surface: skillSurface,
        readOnlyRetrieval: skillsResult.readOnlyRetrieval,
        notes: [...skillsResult.notes]
      }
    },
    notes: [
      "This orchestration surface is Codex-only and explicit.",
      "Unlike `cam integrations install --host codex`, this command also manages the repository-level AGENTS.md guidance block through the existing additive, marker-scoped, fail-closed flow.",
      describeSkillSurfaceInstallNote(skillSurface),
      "Project-scoped retrieval MCP wiring and AGENTS guidance were updated, but operational readiness still depends on the current shell and host environment.",
      buildOperationalRouteConfirmationNote(projectRoot),
      `Skill surface: ${formatCodexSkillInstallSurface(skillSurface)}.`,
      `Recommended retrieval preset: ${hooksResult.recommendedPreset}.`
    ]
  };

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  return [
    formatIntegrationApplyHeadline(result.stackAction),
    `Host: ${result.host}`,
    `Project root: ${result.projectRoot}`,
    `Stack action: ${result.stackAction}`,
    `Skill surface: ${formatCodexSkillInstallSurface(result.skillsSurface)}`,
    "Subactions:",
    `- mcp: [${result.subactions.mcp.status}] ${result.subactions.mcp.action} -> ${result.subactions.mcp.targetPath}`,
    `- agents: [${result.subactions.agents.status}] ${result.subactions.agents.action} -> ${result.subactions.agents.targetPath}`,
    `- hooks: [${result.subactions.hooks.status}] ${result.subactions.hooks.action} -> ${result.subactions.hooks.targetDir}`,
    `- skills: [${result.subactions.skills.status}] ${result.subactions.skills.action} -> ${result.subactions.skills.targetDir}`,
    "",
    "Notes:",
    ...result.notes.map((note) => `- ${note}`)
  ].join("\n");
}

export async function runIntegrationsDoctor(
  options: IntegrationsDoctorOptions = {}
): Promise<string> {
  normalizeIntegrationsHost(options.host, "doctor");
  const report = await inspectMcpDoctor({
    cwd: options.cwd,
    host: "codex",
    explicitCwd: Boolean(options.cwd)
  });
  const result = buildIntegrationsDoctorResult(report, {
    explicitCwd: Boolean(options.cwd)
  });
  const publicResult = sanitizePathFieldsDeep(result, {
    projectRoot: result.projectRoot
  });

  if (options.json) {
    return JSON.stringify(publicResult, null, 2);
  }

  return formatIntegrationsDoctorResult(publicResult);
}
