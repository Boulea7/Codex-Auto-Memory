import fs from "node:fs";
import path from "node:path";

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

export function isCommandAvailableInPath(
  command: string,
  pathValue = process.env.PATH ?? ""
): boolean {
  if (!pathValue.trim()) {
    return false;
  }

  const entries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = path.join(
        entry,
        process.platform === "win32" ? `${command}${extension}` : command
      );
      if (!fs.existsSync(candidate)) {
        continue;
      }

      if (process.platform === "win32") {
        return true;
      }

      try {
        if (isExecutableMode(fs.statSync(candidate).mode)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}
