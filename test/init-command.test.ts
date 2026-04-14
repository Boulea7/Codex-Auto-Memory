import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configPaths } from "../src/lib/config/load-config.js";
import {
  initGitRepo,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalManagedConfig = process.env.CAM_MANAGED_CONFIG;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

const expectedProjectInitConfig = {
  autoMemoryEnabled: true,
  extractorMode: "codex",
  defaultScope: "project",
  maxStartupLines: 200,
  sessionContinuityAutoLoad: false,
  sessionContinuityAutoSave: false,
  sessionContinuityLocalPathStyle: "codex",
  maxSessionContinuityLines: 60,
  dreamSidecarEnabled: false,
  dreamSidecarAutoBuild: false,
  codexBinary: "codex"
};

const expectedLocalInitConfig = {
  autoMemoryEnabled: true
};

afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalManagedConfig === undefined) {
    delete process.env.CAM_MANAGED_CONFIG;
  } else {
    process.env.CAM_MANAGED_CONFIG = originalManagedConfig;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("cam init", () => {
  it("keeps existing valid init config files by default", async () => {
    const homeDir = await tempDir("cam-init-home-");
    const repoDir = await tempDir("cam-init-repo-");
    const customMemoryRoot = await tempDir("cam-init-custom-memory-");
    await initGitRepo(repoDir);

    const existingProjectConfig = {
      ...expectedProjectInitConfig,
      defaultScope: "project-local",
      sessionContinuityAutoLoad: true,
      codexBinary: "codex-dev"
    };
    const existingLocalConfig = {
      autoMemoryEnabled: false,
      autoMemoryDirectory: customMemoryRoot,
      sessionContinuityAutoSave: true
    };
    await writeCamConfig(repoDir, existingProjectConfig, existingLocalConfig);

    const result = runCli(repoDir, ["init"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readJson(path.join(repoDir, "codex-auto-memory.json"))).toEqual(existingProjectConfig);
    expect(await readJson(path.join(repoDir, ".codex-auto-memory.local.json"))).toEqual(existingLocalConfig);
    expect(await pathExists(customMemoryRoot)).toBe(true);
    expect(await fs.readFile(path.join(repoDir, ".gitignore"), "utf8")).toContain(
      ".codex-auto-memory.local.json"
    );
    expect(await fs.readFile(path.join(repoDir, ".git", "info", "exclude"), "utf8")).toContain(
      ".codex-auto-memory/"
    );
  });

  it("overwrites existing init config files when --force is passed", async () => {
    const homeDir = await tempDir("cam-init-force-home-");
    const repoDir = await tempDir("cam-init-force-repo-");
    const customMemoryRoot = await tempDir("cam-init-force-custom-memory-");
    await initGitRepo(repoDir);

    await writeCamConfig(
      repoDir,
      {
        ...expectedProjectInitConfig,
        defaultScope: "project-local",
        codexBinary: "codex-dev"
      },
      {
        autoMemoryEnabled: false,
        autoMemoryDirectory: customMemoryRoot
      }
    );

    const result = runCli(repoDir, ["init", "--force"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readJson(path.join(repoDir, "codex-auto-memory.json"))).toEqual(
      expectedProjectInitConfig
    );
    expect(await readJson(path.join(repoDir, ".codex-auto-memory.local.json"))).toEqual(
      expectedLocalInitConfig
    );
  });

  it("fails closed on invalid existing init config without --force", async () => {
    const homeDir = await tempDir("cam-init-invalid-home-");
    const repoDir = await tempDir("cam-init-invalid-repo-");
    const memoryRootParent = await tempDir("cam-init-invalid-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    await initGitRepo(repoDir);

    await fs.writeFile(path.join(repoDir, "codex-auto-memory.json"), "{\n", "utf8");
    await fs.writeFile(
      path.join(repoDir, ".codex-auto-memory.local.json"),
      JSON.stringify({ autoMemoryDirectory: memoryRoot }, null, 2),
      "utf8"
    );

    const result = runCli(repoDir, ["init"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Re-run with --force");
    expect(await fs.readFile(path.join(repoDir, "codex-auto-memory.json"), "utf8")).toBe("{\n");
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("rebuilds invalid existing init config when --force is passed", async () => {
    const homeDir = await tempDir("cam-init-rebuild-home-");
    const repoDir = await tempDir("cam-init-rebuild-repo-");
    await initGitRepo(repoDir);

    await fs.writeFile(path.join(repoDir, "codex-auto-memory.json"), "{\n", "utf8");
    await fs.writeFile(path.join(repoDir, ".codex-auto-memory.local.json"), "{\n", "utf8");

    const result = runCli(repoDir, ["init", "--force"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readJson(path.join(repoDir, "codex-auto-memory.json"))).toEqual(
      expectedProjectInitConfig
    );
    expect(await readJson(path.join(repoDir, ".codex-auto-memory.local.json"))).toEqual(
      expectedLocalInitConfig
    );
  });

  it("does not let an invalid user config outside the target project block init", async () => {
    const homeDir = await tempDir("cam-init-invalid-user-home-");
    const repoDir = await tempDir("cam-init-invalid-user-repo-");
    await initGitRepo(repoDir);
    process.env.HOME = homeDir;

    const userConfigPath = configPaths.getUserConfigPath();
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });
    await fs.writeFile(userConfigPath, "{\n", "utf8");

    const result = runCli(repoDir, ["init"], {
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readJson(path.join(repoDir, "codex-auto-memory.json"))).toEqual(
      expectedProjectInitConfig
    );
  });

  it("does not let an invalid managed config block init", async () => {
    const homeDir = await tempDir("cam-init-invalid-managed-home-");
    const repoDir = await tempDir("cam-init-invalid-managed-repo-");
    const managedConfigPath = path.join(
      await tempDir("cam-init-invalid-managed-config-"),
      "config.json"
    );
    await initGitRepo(repoDir);
    process.env.HOME = homeDir;

    await fs.writeFile(managedConfigPath, "{\n", "utf8");

    const result = runCli(repoDir, ["init"], {
      env: {
        HOME: homeDir,
        CAM_MANAGED_CONFIG: managedConfigPath
      }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readJson(path.join(repoDir, "codex-auto-memory.json"))).toEqual(
      expectedProjectInitConfig
    );
  });
});
