import {
  buildRecallBridgeSummaryLines,
  codexSkillAssetDirForSurface
} from "../integration/assets.js";
import { installIntegrationAssets } from "../integration/install-assets.js";
import { buildResolvedCliCommand } from "../integration/retrieval-contract.js";
import {
  CODEX_MEMORY_SKILL_NAME,
  formatCodexSkillInstallSurface,
  normalizeCodexSkillInstallSurface
} from "../integration/skills-paths.js";
import { resolveMcpProjectRoot } from "../integration/mcp-config.js";

interface SkillsCommandOptions {
  cwd?: string;
  json?: boolean;
  surface?: string;
}

export async function installSkills(options: SkillsCommandOptions = {}): Promise<string> {
  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const skillSurface = normalizeCodexSkillInstallSurface(options.surface);
  const result = await installIntegrationAssets("skills", {
    projectRoot,
    skillSurface
  });

  if (options.json) {
    return JSON.stringify(
      {
        action: result.action,
        targetDir: result.targetDir,
        surface: skillSurface,
        preferredSkillSurface: result.preferredSkillSurface ?? "runtime",
        readOnlyRetrieval: result.readOnlyRetrieval,
        postInstallReadinessCommand: buildResolvedCliCommand("mcp doctor --host codex", {
          cwd: projectRoot
        }),
        workflowContract: result.workflowContract,
        notes: result.notes,
        assets: result.assets
      },
      null,
      2
    );
  }

  return [
    `Installed Codex skill assets in ${result.targetDir}`,
    `Action: ${result.action}`,
    `Next: run ${buildResolvedCliCommand("mcp doctor --host codex", { cwd: projectRoot })}`,
    `Skill surface: ${formatCodexSkillInstallSurface(skillSurface)}`,
    `Preferred skill surface: ${result.preferredSkillSurface ?? "runtime"}`,
    ...result.assets.map((asset) => `- [${asset.action}] ${asset.path}`),
    "",
    `Skill name: ${CODEX_MEMORY_SKILL_NAME}`,
    "This skill teaches Codex to use durable memory with search -> timeline -> details instead of loading full memory bodies up front.",
    skillSurface === "runtime"
      ? "This keeps the current runtime-first install target unchanged."
      : "This writes an explicit official .agents/skills copy without changing the runtime-first default.",
    ...buildRecallBridgeSummaryLines({
      cwd: projectRoot
    }),
    `If a host prefers shell-based fallback helpers, run ${buildResolvedCliCommand("hooks install", { cwd: projectRoot })} to generate memory-recall.sh, compatibility wrappers, and recall-bridge.md.`
  ].join("\n");
}

export async function removeSkills(options: SkillsCommandOptions = {}): Promise<string> {
  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const skillSurface = normalizeCodexSkillInstallSurface(options.surface);
  const dir = codexSkillAssetDirForSurface(skillSurface, projectRoot);
  return `Codex skill assets live under ${dir}. Remove the directory manually if you no longer need them.`;
}
