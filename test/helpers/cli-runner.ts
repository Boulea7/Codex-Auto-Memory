import path from "node:path";
import { runCommandCapture } from "../../src/lib/util/process.js";
import type { ProcessOutput } from "../../src/lib/util/process.js";

export type CliEntrypoint = "dist" | "source";

const sourceCliPath = path.resolve("src/cli.ts");
const distCliPath = path.resolve("dist/cli.js");
const tsxBinaryPath = path.resolve(
  process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx"
);

export function runCli(
  repoDir: string,
  args: string[],
  options: {
    entrypoint?: CliEntrypoint;
    env?: NodeJS.ProcessEnv;
  } = {}
): ProcessOutput {
  const entrypoint = options.entrypoint ?? "source";
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  if (entrypoint === "dist") {
    return runCommandCapture("node", [distCliPath, ...args], repoDir, env);
  }

  return runCommandCapture(tsxBinaryPath, [sourceCliPath, ...args], repoDir, env);
}
