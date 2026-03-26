import fs from "node:fs/promises";
import path from "node:path";

export type McpHost = "codex" | "claude" | "gemini" | "generic";
export type McpDoctorHostSelection = McpHost | "all";
export type McpHostPinningMode = "cwd-field" | "cwd-arg" | "manual";

export interface McpServerConfigShape {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  trust?: boolean;
}

export interface McpHostDefinition {
  host: McpHost;
  targetFileHint: string;
  snippetFormat: "toml" | "json";
  pinning: McpHostPinningMode;
  projectConfigRelativePath?: string;
  notes: string[];
}

export interface McpCanonicalConfigInspection {
  hasServerName: boolean;
  hasCamCommand: boolean;
  hasServeInvocation: boolean;
  projectPinned: boolean;
}

export const MEMORY_RETRIEVAL_MCP_SERVER_NAME = "codex_auto_memory";

export const SUPPORTED_MCP_HOSTS: readonly McpHost[] = [
  "codex",
  "claude",
  "gemini",
  "generic"
] as const;

const HOST_DEFINITIONS: Record<McpHost, McpHostDefinition> = {
  codex: {
    host: "codex",
    targetFileHint: ".codex/config.toml",
    snippetFormat: "toml",
    pinning: "cwd-field",
    projectConfigRelativePath: path.join(".codex", "config.toml"),
    notes: [
      "Paste this into a project-scoped .codex/config.toml file. ~/.codex/config.toml also works if you want the same server across repositories.",
      "This MCP surface only exposes search_memories, timeline_memories, and get_memory_details."
    ]
  },
  claude: {
    host: "claude",
    targetFileHint: ".mcp.json",
    snippetFormat: "json",
    pinning: "cwd-arg",
    projectConfigRelativePath: ".mcp.json",
    notes: [
      "Paste this into a project-scoped .mcp.json file. Claude Code asks for approval before using project-scoped MCP servers.",
      "The explicit --cwd argument keeps retrieval pinned to this repository root even when the host starts the server elsewhere."
    ]
  },
  gemini: {
    host: "gemini",
    targetFileHint: ".gemini/settings.json",
    snippetFormat: "json",
    pinning: "cwd-field",
    projectConfigRelativePath: path.join(".gemini", "settings.json"),
    notes: [
      "Paste this into .gemini/settings.json or ~/.gemini/settings.json.",
      "The snippet leaves trust set to false so tool confirmations stay host-controlled."
    ]
  },
  generic: {
    host: "generic",
    targetFileHint: "Your MCP client's stdio server config",
    snippetFormat: "json",
    pinning: "manual",
    notes: [
      "Wrap this server definition under your client's server registry using the serverName shown below.",
      "If your client supports a working-directory field, you can move the project root out of args and into that field instead."
    ]
  }
};

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordLike(value) && Object.values(value).every((item) => typeof item === "string");
}

function isComparableServerShape(value: unknown): value is McpServerConfigShape {
  return (
    isRecordLike(value) &&
    typeof value.command === "string" &&
    isStringArray(value.args) &&
    (value.cwd === undefined || typeof value.cwd === "string") &&
    (value.env === undefined || isStringRecord(value.env)) &&
    (value.trust === undefined || typeof value.trust === "boolean")
  );
}

async function normalizeComparablePath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}

async function pathsMatch(left: string, right: string): Promise<boolean> {
  return (await normalizeComparablePath(left)) === (await normalizeComparablePath(right));
}

function hasExpectedServeInvocation(
  host: Extract<McpHost, "codex" | "claude" | "gemini">,
  args: unknown
): args is string[] {
  if (!isStringArray(args)) {
    return false;
  }

  switch (host) {
    case "codex":
    case "gemini":
      return args.length === 2 && args[0] === "mcp" && args[1] === "serve";
    case "claude":
      return args.length === 4 && args[0] === "mcp" && args[1] === "serve" && args[2] === "--cwd";
  }
}

function toTomlArray(values: string[]): string {
  return `[${values.map((value) => toTomlString(value)).join(", ")}]`;
}

export function normalizeMcpHost(host: string | undefined): McpHost {
  switch (host) {
    case "codex":
    case "claude":
    case "gemini":
    case "generic":
      return host;
    default:
      throw new Error(
        `Unsupported MCP host "${host ?? ""}". Expected one of: codex, claude, gemini, generic.`
      );
  }
}

export function normalizeMcpDoctorHostSelection(
  host: string | undefined
): McpDoctorHostSelection {
  if (!host || host === "all") {
    return "all";
  }

  return normalizeMcpHost(host);
}

export function listMcpHosts(selection: McpDoctorHostSelection): McpHost[] {
  return selection === "all" ? [...SUPPORTED_MCP_HOSTS] : [selection];
}

export function getMcpHostDefinition(host: McpHost): McpHostDefinition {
  return HOST_DEFINITIONS[host];
}

export function resolveMcpHostProjectConfigPath(
  host: McpHost,
  projectRoot: string
): string | null {
  const relativePath = getMcpHostDefinition(host).projectConfigRelativePath;
  return relativePath ? path.join(projectRoot, relativePath) : null;
}

export function buildCanonicalMcpServerConfig(
  host: Exclude<McpHost, "generic">,
  projectRoot: string
): McpServerConfigShape {
  switch (host) {
    case "codex":
      return {
        command: "cam",
        args: ["mcp", "serve"],
        cwd: projectRoot
      };
    case "claude":
      return {
        command: "cam",
        args: ["mcp", "serve", "--cwd", projectRoot],
        env: {}
      };
    case "gemini":
      return {
        command: "cam",
        args: ["mcp", "serve"],
        cwd: projectRoot,
        trust: false
      };
  }
}

export async function inspectCanonicalMcpServerConfig(
  host: Extract<McpHost, "codex" | "claude" | "gemini">,
  serverConfig: unknown,
  projectRoot: string
): Promise<McpCanonicalConfigInspection> {
  const expected = buildCanonicalMcpServerConfig(host, projectRoot);
  const hasServerName = isComparableServerShape(serverConfig);
  const hasCamCommand = hasServerName && serverConfig.command === expected.command;
  const hasServeInvocation =
    hasServerName && hasExpectedServeInvocation(host, serverConfig.args);
  const projectPinned =
    hasServerName &&
    (host === "claude"
      ? typeof serverConfig.args[3] === "string" &&
        (await pathsMatch(serverConfig.args[3], projectRoot))
      : typeof serverConfig.cwd === "string" &&
        (await pathsMatch(serverConfig.cwd, expected.cwd ?? projectRoot)));

  return {
    hasServerName,
    hasCamCommand,
    hasServeInvocation,
    projectPinned
  };
}

export function buildMcpHostSnippet(host: McpHost, projectRoot: string): string {
  switch (host) {
    case "codex":
      return (() => {
        const config = buildCanonicalMcpServerConfig("codex", projectRoot);
        return [
          `[mcp_servers.${MEMORY_RETRIEVAL_MCP_SERVER_NAME}]`,
          `command = ${toTomlString(config.command)}`,
          `args = ${toTomlArray(config.args)}`,
          `cwd = ${toTomlString(config.cwd ?? projectRoot)}`
        ].join("\n");
      })();
    case "claude":
      return JSON.stringify(
        {
          mcpServers: {
            [MEMORY_RETRIEVAL_MCP_SERVER_NAME]: buildCanonicalMcpServerConfig("claude", projectRoot)
          }
        },
        null,
        2
      );
    case "gemini":
      return JSON.stringify(
        {
          mcpServers: {
            [MEMORY_RETRIEVAL_MCP_SERVER_NAME]: buildCanonicalMcpServerConfig("gemini", projectRoot)
          }
        },
        null,
        2
      );
    case "generic":
      return JSON.stringify(
        {
          command: "cam",
          args: ["mcp", "serve", "--cwd", projectRoot]
        },
        null,
        2
      );
  }
}
