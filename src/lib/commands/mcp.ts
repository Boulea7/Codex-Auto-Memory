import path from "node:path";
import { formatIntegrationActionHeadline } from "../integration/codex-stack.js";
import { applyCodexAgentsGuidance } from "../integration/agents-guidance.js";
import {
  buildMcpHostConfigSnippet,
  formatMcpHostConfigSnippet,
  normalizeMcpHost,
  resolveMcpProjectRoot
} from "../integration/mcp-config.js";
import { installMcpProjectConfig } from "../integration/mcp-install.js";
import { formatMcpDoctorReport, inspectMcpDoctor } from "../integration/mcp-doctor.js";
import { startRetrievalMcpServer } from "../mcp/retrieval-server.js";

interface McpServeOptions {
  cwd?: string;
}

interface McpPrintConfigOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

interface McpDoctorOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

interface McpInstallOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

interface McpApplyGuidanceOptions {
  cwd?: string;
  host?: string;
  json?: boolean;
}

function resolveCommandCwd(cwd: string | undefined): string {
  return cwd ? path.resolve(cwd) : process.cwd();
}

export async function runMcpServe(options: McpServeOptions = {}): Promise<void> {
  await startRetrievalMcpServer(resolveCommandCwd(options.cwd));
}

export async function runMcpPrintConfig(options: McpPrintConfigOptions = {}): Promise<string> {
  const host = normalizeMcpHost(options.host);
  const projectRoot = resolveMcpProjectRoot(resolveCommandCwd(options.cwd));
  const snippet = buildMcpHostConfigSnippet(host, projectRoot);

  if (options.json) {
    return JSON.stringify(snippet, null, 2);
  }

  return formatMcpHostConfigSnippet(snippet);
}

export async function runMcpDoctor(options: McpDoctorOptions = {}): Promise<string> {
  const report = await inspectMcpDoctor({
    cwd: resolveCommandCwd(options.cwd),
    host: options.host,
    explicitCwd: Boolean(options.cwd)
  });

  if (options.json) {
    return JSON.stringify(report, null, 2);
  }

  return formatMcpDoctorReport(report);
}

export async function runMcpInstall(options: McpInstallOptions = {}): Promise<string> {
  const host = normalizeMcpHost(options.host);
  const projectRoot = resolveMcpProjectRoot(resolveCommandCwd(options.cwd));
  const result = await installMcpProjectConfig(host, projectRoot);

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  return [
    formatIntegrationActionHeadline(result.action, `project-scoped MCP wiring for ${result.host}`),
    `Target path: ${result.targetPath}`,
    `Action: ${result.action}`,
    "Retrieval plane: read-only",
    "",
    "Notes:",
    ...result.notes.map((note) => `- ${note}`)
  ].join("\n");
}

export async function runMcpApplyGuidance(
  options: McpApplyGuidanceOptions = {}
): Promise<string> {
  const host = normalizeMcpHost(options.host);
  if (host !== "codex") {
    throw new Error(
      `cam mcp apply-guidance currently supports only --host codex, not "${host}".`
    );
  }

  const projectRoot = resolveMcpProjectRoot(resolveCommandCwd(options.cwd));
  const result = await applyCodexAgentsGuidance(projectRoot);

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }

  if (result.action === "blocked") {
    return [
      "Codex AGENTS guidance update was blocked.",
      `Target path: ${result.targetPath}`,
      `Managed block version: ${result.managedBlockVersion}`,
      `Reason: ${result.blockedReason ?? "unknown"}`,
      "",
      "Notes:",
      ...result.notes.map((note) => `- ${note}`)
    ].join("\n");
  }

  return [
    formatIntegrationActionHeadline(result.action, "Codex AGENTS guidance"),
    `Target path: ${result.targetPath}`,
    `Managed block version: ${result.managedBlockVersion}`,
    `Created file: ${result.createdFile ? "yes" : "no"}`,
    "",
    "Notes:",
    ...result.notes.map((note) => `- ${note}`)
  ].join("\n");
}
