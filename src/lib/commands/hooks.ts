import {
  buildRecallBridgeSummaryLines,
  hookAssetDir
} from "../integration/assets.js";
import { LOCAL_BRIDGE_BUNDLE_NOTE } from "../integration/codex-stack.js";
import { installIntegrationAssets } from "../integration/install-assets.js";
import { resolveMcpProjectRoot } from "../integration/mcp-config.js";

interface HooksCommandOptions {
  cwd?: string;
}

export async function installHooks(options: HooksCommandOptions = {}): Promise<string> {
  const projectRoot = options.cwd ? resolveMcpProjectRoot(options.cwd) : undefined;
  const result = await installIntegrationAssets("hooks", {
    projectRoot
  });

  return [
    `Generated hook bridge bundle in ${result.targetDir}`,
    `Action: ${result.action}`,
    ...result.assets.map((asset) => `- [${asset.action}] ${asset.path}`),
    "",
    "These files now form a local bridge bundle for current Codex workflows and future hook/skill/MCP-aware retrieval flows.",
    LOCAL_BRIDGE_BUNDLE_NOTE,
    ...buildRecallBridgeSummaryLines()
  ].join("\n");
}

export async function removeHooks(): Promise<string> {
  const dir = hookAssetDir();
  return `Hook bridge assets live under ${dir}. Remove the directory manually if you no longer need them.`;
}
