import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTextFileAtomic } from "../src/lib/util/fs.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("fs util helpers", () => {
  it("fsyncs the temp file and parent directory before renaming", async () => {
    const dir = await tempDir("cam-fs-atomic-");
    const filePath = path.join(dir, "entry.txt");
    const originalOpen = fs.open.bind(fs);
    const syncedPaths: string[] = [];

    vi.spyOn(fs, "open").mockImplementation(async (targetPath, flags) => {
      const handle = await originalOpen(targetPath, flags);
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              syncedPaths.push(String(targetPath));
              return target.sync();
            };
          }

          return Reflect.get(target, prop, receiver);
        }
      });
    });

    await writeTextFileAtomic(filePath, "atomic contents");

    expect(await fs.readFile(filePath, "utf8")).toBe("atomic contents");
    expect(syncedPaths).toContain(dir);
    expect(
      syncedPaths.some(
        (targetPath) =>
          targetPath !== dir && targetPath.includes(".entry.txt.") && targetPath.endsWith(".tmp")
      )
    ).toBe(true);
  });

  it("succeeds when syncing the parent directory is not permitted", async () => {
    const dir = await tempDir("cam-fs-atomic-");
    const filePath = path.join(dir, "entry.txt");
    const originalOpen = fs.open.bind(fs);

    vi.spyOn(fs, "open").mockImplementation(async (targetPath, flags) => {
      if (String(targetPath) === dir) {
        const error = new Error("operation not permitted") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }

      return originalOpen(targetPath, flags);
    });

    await expect(writeTextFileAtomic(filePath, "atomic contents")).resolves.toBeUndefined();
    expect(await fs.readFile(filePath, "utf8")).toBe("atomic contents");
  });

  it("succeeds when parent directory handles do not support fsync", async () => {
    const dir = await tempDir("cam-fs-atomic-");
    const filePath = path.join(dir, "entry.txt");
    const originalOpen = fs.open.bind(fs);

    vi.spyOn(fs, "open").mockImplementation(async (targetPath, flags) => {
      const handle = await originalOpen(targetPath, flags);
      if (String(targetPath) !== dir) {
        return handle;
      }

      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("operation not supported") as NodeJS.ErrnoException;
              error.code = "EINVAL";
              throw error;
            };
          }

          return Reflect.get(target, prop, receiver);
        }
      });
    });

    await expect(writeTextFileAtomic(filePath, "atomic contents")).resolves.toBeUndefined();
    expect(await fs.readFile(filePath, "utf8")).toBe("atomic contents");
  });
});
