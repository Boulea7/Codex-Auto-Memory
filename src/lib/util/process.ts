import { spawn, spawnSync } from "node:child_process";

export interface ProcessOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function shouldUseWindowsShell(command: string, platform = process.platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function quoteWindowsCmdArg(value: string): string {
  if (!value) {
    return '""';
  }

  const escaped = value.replace(/"/g, '""');
  return /[\s&()<>^|]/.test(value) ? `"${escaped}"` : escaped;
}

export function buildWindowsCmdCommandLine(command: string, args: string[]): string {
  return [quoteWindowsCmdArg(command), ...args.map((arg) => quoteWindowsCmdArg(arg))].join(" ");
}

function resolveWindowsProcessInvocation(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): {
  command: string;
  args: string[];
  shell: boolean;
  windowsVerbatimArguments?: boolean;
} {
  if (!shouldUseWindowsShell(command)) {
    return {
      command,
      args,
      shell: false,
      windowsVerbatimArguments: false
    };
  }

  const shellCommand = env.ComSpec ?? process.env.ComSpec ?? "cmd.exe";
  return {
    command: shellCommand,
    args: ["/d", "/s", "/c", `"${buildWindowsCmdCommandLine(command, args)}"`],
    shell: false,
    windowsVerbatimArguments: true
  };
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const invocation = resolveWindowsProcessInvocation(command, args, env);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: "inherit",
      shell: invocation.shell,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  input?: string
): ProcessOutput {
  const invocation = resolveWindowsProcessInvocation(command, args, env);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env,
    encoding: "utf8",
    input,
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });

  return {
    stdout: result.stdout ?? "",
    stderr:
      result.stderr ??
      (result.error ? `${result.error.name}: ${result.error.message}` : ""),
    exitCode: result.status ?? 1
  };
}
