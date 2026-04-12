import {
  buildRecallBridgeSummaryLines,
  hookAssetDir
} from "../integration/assets.js";
import { LOCAL_BRIDGE_BUNDLE_NOTE } from "../integration/codex-stack.js";
import { installIntegrationAssets } from "../integration/install-assets.js";
import { resolveMcpProjectRoot } from "../integration/mcp-config.js";
import { buildResolvedCliCommand } from "../integration/retrieval-contract.js";

interface HooksCommandOptions {
  cwd?: string;
  json?: boolean;
}

export async function installHooks(options: HooksCommandOptions = {}): Promise<string> {
  const projectRoot = resolveMcpProjectRoot(options.cwd);
  const result = await installIntegrationAssets("hooks", {
    projectRoot
  });

  if (options.json) {
    return JSON.stringify(
      {
        action: result.action,
        targetDir: result.targetDir,
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
    `Generated hook bridge bundle in ${result.targetDir}`,
    `Action: ${result.action}`,
    `Next: run ${buildResolvedCliCommand("mcp doctor --host codex", { cwd: projectRoot })}`,
    ...result.assets.map((asset) => `- [${asset.action}] ${asset.path}`),
    "",
    "These files now form a local bridge bundle for current Codex workflows and future hook/skill/MCP-aware retrieval flows.",
    LOCAL_BRIDGE_BUNDLE_NOTE,
    ...buildRecallBridgeSummaryLines({
      cwd: projectRoot
    })
  ].join("\n");
}

export async function removeHooks(): Promise<string> {
  const dir = hookAssetDir();
  return `Hook bridge assets live under ${dir}. Remove the directory manually if you no longer need them.`;
}
