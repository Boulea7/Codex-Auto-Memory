import { spawn, spawnSync } from "node:child_process";

export interface ProcessOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function shouldUseWindowsShell(command: string, platform = process.platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: shouldUseWindowsShell(command)
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
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    input,
    shell: shouldUseWindowsShell(command)
  });

  return {
    stdout: result.stdout ?? "",
    stderr:
      result.stderr ??
      (result.error ? `${result.error.name}: ${result.error.message}` : ""),
    exitCode: result.status ?? 1
  };
}
