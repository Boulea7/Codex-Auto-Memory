import path from "node:path";
import { detectProjectContext } from "../domain/project-context.js";
import {
  buildCodexAgentsGuidance,
  buildExperimentalCodexHooksGuidance,
  READ_ONLY_RETRIEVAL_NOTE,
  type CodexAgentsGuidance,
  type ExperimentalCodexHooksGuidance
} from "./codex-stack.js";
import { buildWorkflowContract } from "./retrieval-contract.js";
import {
  buildMcpHostSnippet,
  getMcpHostDefinition,
  MEMORY_RETRIEVAL_MCP_SERVER_NAME,
  normalizeMcpHost,
  type McpHost
} from "./mcp-hosts.js";

export type { McpHost } from "./mcp-hosts.js";
export { MEMORY_RETRIEVAL_MCP_SERVER_NAME } from "./mcp-hosts.js";

export interface McpHostConfigSnippet {
  host: McpHost;
  serverName: string;
  transport: "stdio";
  readOnlyRetrieval: true;
  targetFileHint: string;
  projectRoot: string;
  snippetFormat: "toml" | "json";
  snippet: string;
  notes: string[];
  workflowContract?: ReturnType<typeof buildWorkflowContract>;
  agentsGuidance?: CodexAgentsGuidance;
  experimentalHooks?: ExperimentalCodexHooksGuidance;
}

export { normalizeMcpHost };

export function resolveMcpProjectRoot(cwd = process.cwd()): string {
  return detectProjectContext(path.resolve(cwd)).projectRoot;
}

export function buildMcpHostConfigSnippet(host: McpHost, projectRoot: string): McpHostConfigSnippet {
  const definition = getMcpHostDefinition(host);

  return {
    host,
    serverName: MEMORY_RETRIEVAL_MCP_SERVER_NAME,
    transport: "stdio",
    readOnlyRetrieval: true,
    targetFileHint: definition.targetFileHint,
    projectRoot,
    snippetFormat: definition.snippetFormat,
    snippet: buildMcpHostSnippet(host, projectRoot),
    notes: [...definition.notes],
    ...(host === "codex"
      ? {
          workflowContract: buildWorkflowContract({
            cwd: projectRoot
          }),
          agentsGuidance: buildCodexAgentsGuidance({ cwd: projectRoot }),
          experimentalHooks: buildExperimentalCodexHooksGuidance()
        }
      : {})
  };
}

export function formatMcpHostConfigSnippet(snippet: McpHostConfigSnippet): string {
  const lines = [
    READ_ONLY_RETRIEVAL_NOTE,
    `Target file hint: ${snippet.targetFileHint}`,
    `Server name: ${snippet.serverName}`,
    "",
    snippet.snippet,
    "",
    "Notes:",
    ...snippet.notes.map((note) => `- ${note}`)
  ];

  if (snippet.agentsGuidance) {
    lines.push(
      "",
      "AGENTS.md guidance:",
      `Target file hint: ${snippet.agentsGuidance.targetFileHint}`,
      "",
      snippet.agentsGuidance.snippet,
      "",
      "AGENTS notes:",
      ...snippet.agentsGuidance.notes.map((note) => `- ${note}`)
    );
  }

  if (snippet.experimentalHooks) {
    lines.push(
      "",
      "Experimental Codex hooks:",
      `Target file hint: ${snippet.experimentalHooks.targetFileHint}`,
      "",
      snippet.experimentalHooks.snippet,
      "",
      "Experimental hooks notes:",
      ...snippet.experimentalHooks.notes.map((note) => `- ${note}`)
    );
  }

  return lines.join("\n");
}
