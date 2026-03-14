import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, "utf8");
}

export async function updateGitignoreLine(rootDir: string, line: string): Promise<void> {
  const gitignorePath = path.join(rootDir, ".gitignore");
  const hasFile = await fileExists(gitignorePath);
  const current = hasFile ? await fs.readFile(gitignorePath, "utf8") : "";
  const lines = new Set(current.split("\n").filter(Boolean));
  if (lines.has(line)) {
    return;
  }

  const next = `${current.trimEnd()}${current.trimEnd() ? "\n" : ""}${line}\n`;
  await fs.writeFile(gitignorePath, next, "utf8");
}

