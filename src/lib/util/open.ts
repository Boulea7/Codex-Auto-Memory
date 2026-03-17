import { spawn } from "node:child_process";

export function buildOpenCommand(
  targetPath: string,
  platform = process.platform
): {
  command: string;
  args: string[];
} {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [targetPath]
    };
  }

  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", targetPath]
    };
  }

  return {
    command: "xdg-open",
    args: [targetPath]
  };
}

export function openPath(targetPath: string): void {
  const { command, args } = buildOpenCommand(targetPath);

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
