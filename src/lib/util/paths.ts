import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function resolveAppPath(input: string): string {
  return path.resolve(expandHome(input));
}

export async function ensureExistingDirectory(input: string): Promise<string> {
  const resolved = resolveAppPath(input);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Path must be an existing directory: ${resolved}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Path must be an existing directory: ${resolved}`);
  }

  return resolved;
}
