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

function atomicTempPath(filePath: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${suffix}.tmp`);
}

function isIgnorableDirectorySyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "EBADF" ||
    code === "EINVAL" ||
    code === "EISDIR" ||
    code === "ENOSYS" ||
    code === "ENOTSUP" ||
    code === "EPERM"
  );
}

async function syncPath(targetPath: string): Promise<void> {
  const handle = await fs.open(targetPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryIfSupported(dirPath: string): Promise<void> {
  try {
    await syncPath(dirPath);
  } catch (error) {
    if (isIgnorableDirectorySyncError(error)) {
      return;
    }

    throw error;
  }
}

export async function writeTextFileAtomic(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = atomicTempPath(filePath);

  try {
    const tempHandle = await fs.open(tempPath, "w");
    try {
      await tempHandle.writeFile(contents, "utf8");
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    await fs.rename(tempPath, filePath);
    await syncDirectoryIfSupported(path.dirname(filePath));
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
