import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listIntegrationAssets, type IntegrationAssetInstallSurface } from "./assets.js";
import { READ_ONLY_RETRIEVAL_NOTE } from "./codex-stack.js";
import {
  buildWorkflowContract,
  formatRecommendedRetrievalPreset,
  MCP_FIRST_RECALL_WORKFLOW,
  CLI_FALLBACK_RECALL_WORKFLOW,
  RETRIEVAL_INTEGRATION_ASSET_VERSION
} from "./retrieval-contract.js";
import {
  type CodexSkillInstallSurface,
  formatCodexSkillInstallSurface
} from "./skills-paths.js";
import { ensureDir, fileExists, readTextFile, writeTextFile } from "../util/fs.js";

export type IntegrationAssetInstallAction = "created" | "updated" | "unchanged";

export interface InstalledIntegrationAssetResult {
  id: string;
  name: string;
  path: string;
  role: "capture-helper" | "recall-helper" | "guidance";
  action: IntegrationAssetInstallAction;
  executableExpected: boolean;
}

export interface IntegrationAssetInstallResult {
  installSurface: IntegrationAssetInstallSurface;
  targetDir: string;
  action: IntegrationAssetInstallAction;
  readOnlyRetrieval: true;
  assetVersion: string;
  recommendedPreset: string;
  workflowContract: ReturnType<typeof buildWorkflowContract>;
  skillSurface?: CodexSkillInstallSurface;
  preferredSkillSurface?: CodexSkillInstallSurface;
  notes: string[]; 
  assets: InstalledIntegrationAssetResult[];
}

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

function summarizeInstallAction(
  actions: IntegrationAssetInstallAction[]
): IntegrationAssetInstallAction {
  if (actions.every((action) => action === "unchanged")) {
    return "unchanged";
  }

  if (actions.every((action) => action === "created")) {
    return "created";
  }

  return "updated";
}

function buildInstallNotes(): string[] {
  return [
    READ_ONLY_RETRIEVAL_NOTE,
    `Recommended retrieval preset: ${formatRecommendedRetrievalPreset()}.`,
    MCP_FIRST_RECALL_WORKFLOW,
    CLI_FALLBACK_RECALL_WORKFLOW
  ];
}

interface InstallIntegrationAssetsOptions {
  homeDir?: string;
  projectRoot?: string;
  skillSurface?: CodexSkillInstallSurface;
}

export async function installIntegrationAssets(
  installSurface: IntegrationAssetInstallSurface,
  options: InstallIntegrationAssetsOptions = {}
): Promise<IntegrationAssetInstallResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const skillSurface = options.skillSurface ?? "runtime";
  const assets = listIntegrationAssets(homeDir, installSurface, {
    projectRoot: options.projectRoot,
    skillSurface
  });
  const targetDir = path.dirname(assets[0]?.path ?? path.join(homeDir, ".codex-auto-memory"));
  await ensureDir(targetDir);

  const assetResults: InstalledIntegrationAssetResult[] = [];
  for (const asset of assets) {
    const exists = await fileExists(asset.path);
    const currentContents = exists ? await readTextFile(asset.path) : null;
    const executableOk =
      exists && asset.executableExpected
        ? isExecutableMode((await fs.stat(asset.path)).mode)
        : !asset.executableExpected;
    const action: IntegrationAssetInstallAction = !exists
      ? "created"
      : currentContents !== asset.contents || !executableOk
        ? "updated"
        : "unchanged";

    if (action !== "unchanged") {
      await ensureDir(path.dirname(asset.path));
      await writeTextFile(asset.path, asset.contents);
      if (asset.executableExpected) {
        await fs.chmod(asset.path, 0o755);
      }
    }

    assetResults.push({
      id: asset.id,
      name: asset.name,
      path: asset.path,
      role: asset.role,
      action,
      executableExpected: asset.executableExpected
    });
  }

  return {
    installSurface,
    targetDir,
    action: summarizeInstallAction(assetResults.map((asset) => asset.action)),
    readOnlyRetrieval: true,
    assetVersion: RETRIEVAL_INTEGRATION_ASSET_VERSION,
    recommendedPreset: formatRecommendedRetrievalPreset(),
    workflowContract: buildWorkflowContract({
      cwd: options.projectRoot
    }),
    skillSurface: installSurface === "skills" ? skillSurface : undefined,
    preferredSkillSurface: installSurface === "skills" ? "runtime" : undefined,
    notes:
      installSurface === "skills"
        ? [
            ...buildInstallNotes(),
            `Preferred skill install surface: runtime.`,
            `Installed skill surface: ${formatCodexSkillInstallSurface(skillSurface)}.`,
            skillSurface === "runtime"
              ? "Runtime remains the default Codex skill target for this repository."
              : "Official .agents/skills targets stay explicit opt-in surfaces and do not replace the runtime default."
          ]
        : buildInstallNotes(),
    assets: assetResults
  };
}
