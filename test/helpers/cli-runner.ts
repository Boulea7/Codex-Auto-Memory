import path from "node:path";
import { runCommandCapture } from "../../src/lib/util/process.js";
import type { ProcessOutput } from "../../src/lib/util/process.js";

export type CliEntrypoint = "dist" | "source";

const sourceCliPath = path.resolve("src/cli.ts");
const distCliPath = path.resolve("dist/cli.js");
const tsxBinaryPath = path.resolve(
  process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx"
);

export function joinPathEntries(...entries: Array<string | undefined | null>): string {
  return entries.filter((entry): entry is string => Boolean(entry)).join(path.delimiter);
}

export function minimalCommandPath(...extraEntries: Array<string | undefined | null>): string {
  return joinPathEntries(
    path.dirname(process.execPath),
    ...(process.platform === "win32" ? [] : ["/usr/bin", "/bin"]),
    ...extraEntries
  );
}

export function createIsolatedCliEnv(
  homeDir: string,
  env: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return normalizeCliEnv({
    ...env,
    HOME: homeDir
  });
}

function normalizeCliEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const nextEnv = {
    ...process.env,
    ...env
  };

  for (const key of Object.keys(nextEnv)) {
    if (
      key.startsWith("npm_") ||
      key.startsWith("NPM_") ||
      key.startsWith("pnpm_") ||
      key.startsWith("PNPM_")
    ) {
      delete nextEnv[key];
    }
  }

  const resolvedHome = nextEnv.HOME ?? nextEnv.USERPROFILE;
  if (resolvedHome) {
    nextEnv.HOME = resolvedHome;
    if (process.platform === "win32") {
      nextEnv.USERPROFILE = resolvedHome;
    }
  }

  return nextEnv;
}

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
  const env = normalizeCliEnv(options.env);
  return runCommandCapture(invocation.command, [...invocation.args, ...args], repoDir, env);
}
