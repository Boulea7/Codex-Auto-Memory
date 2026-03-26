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
import { installIntegrationAssets } from "../integration/install-assets.js";
import { installMcpProjectConfig, type McpInstallResult } from "../integration/mcp-install.js";
import { normalizeMcpHost } from "../integration/mcp-config.js";
import { resolveMcpProjectRoot } from "../integration/mcp-config.js";
import { inspectMcpDoctor, type McpDoctorReport } from "../integration/mcp-doctor.js";
import {
  formatCodexSkillInstallSurface,
  normalizeCodexSkillInstallSurface,
  type CodexSkillInstallSurface
} from "../integration/skills-paths.js";
import { appendCliCwdFlag } from "../integration/retrieval-contract.js";

type IntegrationStackAction = "created" | "updated" | "unchanged" | "blocked";
type InstallStackAction = Exclude<IntegrationStackAction, "blocked">;
type IntegrationSubactionStatus = "ok" | "blocked";

interface IntegrationsInstallOptions {
  cwd?: string;
  host?: string;
  skillSurface?: string;
  json?: boolean;
}

interface IntegrationsApplyOptions {
  cwd?: string;
  host?: string;
  skillSurface?: string;
  json?: boolean;
}

interface IntegrationsDoctorOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

interface IntegrationSubactionResult {
  status: IntegrationSubactionStatus;
  action: IntegrationStackAction;
  attempted?: boolean;
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
  stackAction: IntegrationStackAction;
  preflightBlocked?: boolean;
  blockedStage?: "agents-guidance-preflight";
  skillsSurface: CodexSkillInstallSurface;
  readOnlyRetrieval: true;
  subactions: {
    mcp: IntegrationSubactionResult;
    agents: IntegrationSubactionResult;
    hooks: IntegrationSubactionResult;
    skills: IntegrationSubactionResult;
  };
  notes: string[];
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
  recommendedRoute: McpDoctorReport["codexStack"]["recommendedRoute"];
  recommendedPreset: string;
  workflowContract: McpDoctorReport["workflowContract"];
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

function formatIntegrationApplyHeadline(action: IntegrationStackAction): string {
  if (action === "blocked") {
    return "Codex integration apply was blocked.";
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
      mcpReady: report.codexStack.mcpReady,
      mcpOperationalReady: report.codexStack.mcpOperationalReady,
      camCommandAvailable: report.codexStack.camCommandAvailable,
      hookCaptureReady: report.codexStack.hookCaptureReady,
      hookRecallReady: report.codexStack.hookRecallReady,
      skillReady: report.codexStack.skillReady,
      workflowConsistent: report.codexStack.workflowConsistent
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
    report.agentsGuidance.status === "ok"
      ? {
          status: "ok",
          summary: "Repository-level AGENTS.md includes the current Codex Auto Memory guidance."
        }
      : report.agentsGuidance.status === "warning"
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
    buildCodexRouteSummary(report.codexStack.recommendedRoute),
    ...buildCodexStackNotes(),
    "AGENTS guidance is inspected read-only and is never auto-written by integrations doctor."
  ];
  const applySafetyStatus = report.applySafety.status;
  const applyReadiness =
    applySafetyStatus === "blocked"
      ? {
          status: "blocked" as const,
          reason: report.applySafety.blockedReason,
          recommendedFix:
            `Repair the existing AGENTS.md managed guidance block so its markers are balanced outside fenced code blocks, then re-run ${appendCliCwdFlag(
              "cam mcp apply-guidance --host codex",
              pinnedProjectRoot
            )}.`
        }
      : {
          status: "safe" as const
        };
  const nextSteps = buildCodexIntegrationNextSteps({
    mcpReady: report.codexStack.mcpReady,
    mcpOperationalReady: report.codexStack.mcpOperationalReady,
    camCommandAvailable: report.codexStack.camCommandAvailable,
    hookCaptureReady: report.codexStack.hookCaptureReady,
    hookRecallReady: report.codexStack.hookRecallReady,
    skillReady: report.codexStack.skillReady,
    workflowConsistent: report.codexStack.workflowConsistent
  }, {
    skillInstallCommand: report.fallbackAssets.recommendedSkillInstallCommand,
    projectRoot: pinnedProjectRoot
  });
  const needsAgents = report.agentsGuidance.status !== "ok";
  const needsOtherStackSurface =
    !report.codexStack.mcpReady ||
    !report.codexStack.hookCaptureReady ||
    !report.codexStack.hookRecallReady ||
    !report.codexStack.skillReady;
  if (applyReadiness.status === "blocked") {
    nextSteps.unshift(applyReadiness.recommendedFix);
  } else if (needsAgents && needsOtherStackSurface) {
    nextSteps.unshift(
        `Run \`${appendCliCwdFlag(
          `cam integrations apply --host codex --skill-surface ${report.fallbackAssets.preferredInstallSurface}`,
          pinnedProjectRoot
        )}\` to install project-scoped MCP wiring, refresh hook and skill assets, and safely apply the managed Codex Auto Memory AGENTS.md block in one step.`
    );
  } else if (needsAgents) {
    nextSteps.push(
      `Run \`${appendCliCwdFlag(
        "cam mcp apply-guidance --host codex",
        pinnedProjectRoot
      )}\` to create or update the managed Codex Auto Memory block in the repository-level AGENTS.md.`
    );
  }

  return {
    host: "codex",
    projectRoot: report.projectRoot,
    readOnlyRetrieval: true,
    status,
    recommendedRoute: report.codexStack.recommendedRoute,
    recommendedPreset: report.codexStack.preset,
    workflowContract: report.workflowContract,
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
    `Recommended preset: ${result.recommendedPreset}`,
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

export async function runIntegrationsInstall(
  options: IntegrationsInstallOptions = {}
): Promise<string> {
  normalizeIntegrationsHost(options.host, "install");

  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const skillSurface = normalizeCodexSkillInstallSurface(options.skillSurface);
  const mcpResult = await installMcpProjectConfig("codex", projectRoot);
  const hooksResult = await installIntegrationAssets("hooks", {
    projectRoot
  });
  const skillsResult = await installIntegrationAssets("skills", {
    projectRoot,
    skillSurface
  });
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
      buildCodexRouteSummary("mcp"),
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
  const mcpResult = await installMcpProjectConfig("codex", projectRoot);
  const agentsResult = await applyCodexAgentsGuidance(projectRoot);
  const hooksResult = await installIntegrationAssets("hooks", {
    projectRoot
  });
  const skillsResult = await installIntegrationAssets("skills", {
    projectRoot,
    skillSurface
  });

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
      subactions: {
        mcp: {
          ...toMcpSubaction(mcpResult),
          attempted: true
        },
        agents: {
          status: agentsResult.action === "blocked" ? "blocked" : "ok",
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
      buildCodexRouteSummary("mcp"),
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

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  return formatIntegrationsDoctorResult(result);
}
