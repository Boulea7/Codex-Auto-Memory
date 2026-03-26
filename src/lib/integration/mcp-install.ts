import path from "node:path";
import * as toml from "smol-toml";
import { ensureDir, fileExists, readTextFile, writeTextFile } from "../util/fs.js";
import { READ_ONLY_RETRIEVAL_NOTE } from "./codex-stack.js";
import {
  buildCanonicalMcpServerConfig,
  MEMORY_RETRIEVAL_MCP_SERVER_NAME,
  resolveMcpHostProjectConfigPath,
  type McpHost,
  type McpServerConfigShape
} from "./mcp-hosts.js";

export interface McpInstallResult {
  host: McpHost;
  serverName: string;
  projectRoot: string;
  targetPath: string;
  action: "created" | "updated" | "unchanged";
  projectPinned: true;
  readOnlyRetrieval: true;
  preservedCustomFields: string[];
  notes: string[];
}

interface RecordLike {
  [key: string]: unknown;
}

const MANAGED_MCP_SERVER_KEYS = new Set(["command", "args", "cwd", "env", "trust"]);

const PROJECT_SCOPED_PINNING_NOTE =
  "This install is project-scoped and keeps codex_auto_memory pinned to the current project root.";
const SINGLE_ENTRY_NOTE =
  "Only the codex_auto_memory server entry is created or replaced. Other host config remains untouched.";
const HOOKS_FALLBACK_NOTE =
  "If you also want shell fallback helpers, run cam hooks install separately.";
const SKILLS_FALLBACK_NOTE =
  "If you also want the Codex durable-memory skill, run cam skills install separately.";

function isRecordLike(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }

  if (isRecordLike(left) && isRecordLike(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      deepEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => deepEqual(left[key], right[key]))
    );
  }

  return false;
}

function ensureRecordProperty(
  parent: RecordLike,
  key: string,
  context: string
): RecordLike {
  const current = parent[key];
  if (current === undefined) {
    const next: RecordLike = {};
    parent[key] = next;
    return next;
  }

  if (!isRecordLike(current)) {
    throw new Error(`${context} must be an object so codex_auto_memory can be installed safely.`);
  }

  return current;
}

function buildInstallNotes(preservedCustomFields: string[] = []): string[] {
  return [
    READ_ONLY_RETRIEVAL_NOTE,
    PROJECT_SCOPED_PINNING_NOTE,
    SINGLE_ENTRY_NOTE,
    HOOKS_FALLBACK_NOTE,
    SKILLS_FALLBACK_NOTE,
    ...(preservedCustomFields.length > 0
      ? [
          `Preserved non-canonical fields on the existing codex_auto_memory entry: ${preservedCustomFields.join(", ")}.`
        ]
      : [])
  ];
}

function buildInstalledServerRecord(
  existingServer: unknown,
  canonicalServer: McpServerConfigShape
): { nextServer: RecordLike; preservedCustomFields: string[] } {
  if (!isRecordLike(existingServer)) {
    return {
      nextServer: {
        ...canonicalServer
      },
      preservedCustomFields: []
    };
  }

  const preservedEntries = Object.entries(existingServer).filter(
    ([key]) => !MANAGED_MCP_SERVER_KEYS.has(key)
  );

  return {
    nextServer: {
      ...Object.fromEntries(preservedEntries),
      ...canonicalServer
    },
    preservedCustomFields: preservedEntries.map(([key]) => key).sort()
  };
}

async function writeConfigIfChanged(
  targetPath: string,
  nextContents: string,
  action: "created" | "updated" | "unchanged"
): Promise<void> {
  if (action === "unchanged") {
    return;
  }

  await ensureDir(path.dirname(targetPath));
  await writeTextFile(targetPath, nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`);
}

async function installCodexProjectConfig(projectRoot: string): Promise<McpInstallResult> {
  const targetPath = resolveMcpHostProjectConfigPath("codex", projectRoot);
  if (!targetPath) {
    throw new Error("Missing project-scoped config path for codex MCP install.");
  }

  const targetExists = await fileExists(targetPath);
  const rawConfig = targetExists ? await readTextFile(targetPath) : "";
  const parsed = targetExists ? (toml.parse(rawConfig) as unknown) : {};
  if (!isRecordLike(parsed)) {
    throw new Error("The existing .codex/config.toml must parse to a TOML table.");
  }

  const mcpServers = ensureRecordProperty(parsed, "mcp_servers", ".codex/config.toml[mcp_servers]");
  const canonicalServer = buildCanonicalMcpServerConfig("codex", projectRoot);
  const existingServer = mcpServers[MEMORY_RETRIEVAL_MCP_SERVER_NAME];
  const { nextServer, preservedCustomFields } = buildInstalledServerRecord(existingServer, canonicalServer);
  const hadServer = Object.hasOwn(mcpServers, MEMORY_RETRIEVAL_MCP_SERVER_NAME);
  const action: McpInstallResult["action"] = !hadServer
    ? "created"
    : isRecordLike(existingServer) && deepEqual(existingServer, nextServer)
      ? "unchanged"
      : "updated";

  if (action !== "unchanged") {
    mcpServers[MEMORY_RETRIEVAL_MCP_SERVER_NAME] = nextServer;
  }

  await writeConfigIfChanged(targetPath, toml.stringify(parsed), action);

  return {
    host: "codex",
    serverName: MEMORY_RETRIEVAL_MCP_SERVER_NAME,
    projectRoot,
    targetPath,
    action,
    projectPinned: true,
    readOnlyRetrieval: true,
    preservedCustomFields,
    notes: buildInstallNotes(preservedCustomFields)
  };
}

async function installJsonProjectConfig(
  host: Extract<McpHost, "claude" | "gemini">,
  projectRoot: string
): Promise<McpInstallResult> {
  const targetPath = resolveMcpHostProjectConfigPath(host, projectRoot);
  if (!targetPath) {
    throw new Error(`Missing project-scoped config path for ${host} MCP install.`);
  }

  const targetExists = await fileExists(targetPath);
  const rawConfig = targetExists ? await readTextFile(targetPath) : "";
  const parsed = targetExists ? (JSON.parse(rawConfig) as unknown) : {};
  if (!isRecordLike(parsed)) {
    throw new Error(`The existing ${targetPath} must contain a top-level JSON object.`);
  }

  const mcpServers = ensureRecordProperty(parsed, "mcpServers", `${targetPath}#mcpServers`);
  const canonicalServer = buildCanonicalMcpServerConfig(host, projectRoot);
  const existingServer = mcpServers[MEMORY_RETRIEVAL_MCP_SERVER_NAME];
  const { nextServer, preservedCustomFields } = buildInstalledServerRecord(existingServer, canonicalServer);
  const hadServer = Object.hasOwn(mcpServers, MEMORY_RETRIEVAL_MCP_SERVER_NAME);
  const action: McpInstallResult["action"] = !hadServer
    ? "created"
    : isRecordLike(existingServer) && deepEqual(existingServer, nextServer)
      ? "unchanged"
      : "updated";

  if (action !== "unchanged") {
    mcpServers[MEMORY_RETRIEVAL_MCP_SERVER_NAME] = nextServer;
  }

  await writeConfigIfChanged(targetPath, JSON.stringify(parsed, null, 2), action);

  return {
    host,
    serverName: MEMORY_RETRIEVAL_MCP_SERVER_NAME,
    projectRoot,
    targetPath,
    action,
    projectPinned: true,
    readOnlyRetrieval: true,
    preservedCustomFields,
    notes: buildInstallNotes(preservedCustomFields)
  };
}

export async function installMcpProjectConfig(
  host: McpHost,
  projectRoot: string
): Promise<McpInstallResult> {
  switch (host) {
    case "codex":
      return installCodexProjectConfig(projectRoot);
    case "claude":
    case "gemini":
      return installJsonProjectConfig(host, projectRoot);
    case "generic":
      throw new Error(
        'MCP install does not support host "generic". generic wiring remains manual-only; use cam mcp print-config instead.'
      );
  }
}
