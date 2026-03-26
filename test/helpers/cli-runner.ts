import path from "node:path";
import { runCommandCapture } from "../../src/lib/util/process.js";
import type { ProcessOutput } from "../../src/lib/util/process.js";

export type CliEntrypoint = "dist" | "source";

const sourceCliPath = path.resolve("src/cli.ts");
const distCliPath = path.resolve("dist/cli.js");
const tsxBinaryPath = path.resolve(
  process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx"
);

export function resolveCliInvocation(
  entrypoint: CliEntrypoint = "source"
): { command: string; args: string[] } {
  if (entrypoint === "dist") {
    return {
      command: "node",
      args: [distCliPath]
    };
  }

  return {
    command: tsxBinaryPath,
    args: [sourceCliPath]
  };
}

export function runCli(
  repoDir: string,
  args: string[],
  options: {
    entrypoint?: CliEntrypoint;
    env?: NodeJS.ProcessEnv;
  } = {}
): ProcessOutput {
  const invocation = resolveCliInvocation(options.entrypoint ?? "source");
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  return runCommandCapture(invocation.command, [...invocation.args, ...args], repoDir, env);
}
