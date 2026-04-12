import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CliEntrypoint } from "./cli-runner.js";
import { resolveCliInvocation } from "./cli-runner.js";

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export async function connectCliMcpClient(
  repoDir: string,
  options: {
    entrypoint?: CliEntrypoint;
    env?: NodeJS.ProcessEnv;
    serverCwd?: string;
  } = {}
): Promise<Client> {
  const invocation = resolveCliInvocation(options.entrypoint ?? "source");
  const args = [...invocation.args, "mcp", "serve"];
  if (options.serverCwd) {
    args.push("--cwd", options.serverCwd);
  }
  const transport = new StdioClientTransport({
    command: invocation.command,
    args,
    cwd: repoDir,
    env: toStringEnv({
      ...process.env,
      ...options.env
    })
  });
  const client = new Client({
    name: "codex-auto-memory-test-client",
    version: "1.0.0"
  });

  await client.connect(transport);
  return client;
}
