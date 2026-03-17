import { spawn } from "node:child_process";

export function openPath(targetPath: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "darwin"
      ? [targetPath]
      : process.platform === "win32"
        ? ["/c", "start", "", targetPath]
        : [targetPath];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
