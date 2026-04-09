import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("doctor command", () => {
  it("surfaces retrieval sidecar and topic diagnostics without creating an uninitialized memory layout", async () => {
    const homeDir = await tempDir("cam-doctor-readonly-home-");
    const projectDir = await tempDir("cam-doctor-readonly-project-");
    const memoryRootParent = await tempDir("cam-doctor-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      memoryRoot: string;
      recommendedAction?: string;
      recommendedRoute?: string;
      recommendedActionCommand?: string;
      recommendedDoctorCommand?: string;
      readiness: {
        appServer?: {
          name: string;
          stage: string;
          enabled: boolean;
        } | null;
      };
      retrievalSidecar?: {
        status: string;
        checks: Array<{ scope: string; state: string; status: string }>;
      };
      topicDiagnostics?: {
        status: string;
        diagnostics: unknown[];
      };
      layoutDiagnostics: unknown[];
    };

    expect(payload.memoryRoot).toBe(memoryRoot);
    expect(payload.recommendedRoute).toBe("companion");
    expect(payload.recommendedAction).toContain("mcp doctor --host codex");
    expect(payload.recommendedActionCommand).toContain("mcp doctor --host codex");
    expect(payload.recommendedDoctorCommand).toContain("doctor --json");
    if (payload.readiness.appServer) {
      expect(payload.readiness.appServer).toMatchObject({
        stage: expect.any(String),
        enabled: expect.any(Boolean)
      });
      expect(["tui", "tui_app_server"]).toContain(payload.readiness.appServer.name);
    } else {
      expect(payload.readiness.appServer).toBeNull();
    }
    expect(payload.retrievalSidecar).toMatchObject({
      status: "warning",
      checks: expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          status: "missing"
        })
      ])
    });
    expect(payload.topicDiagnostics).toMatchObject({
      status: "ok",
      diagnostics: []
    });
    expect(payload.layoutDiagnostics).toEqual([]);
    expect(await pathExists(memoryRoot)).toBe(false);
  });

  it("keeps the top-level doctor contract stable when codex feature output omits app-server signals", async () => {
    const homeDir = await tempDir("cam-doctor-no-app-server-home-");
    const projectDir = await tempDir("cam-doctor-no-app-server-project-");
    const memoryRootParent = await tempDir("cam-doctor-no-app-server-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: {
        HOME: homeDir,
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`
      }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      readiness: {
        appServer?: {
          name: string;
          stage: string;
          enabled: boolean;
        } | null;
      };
      retrievalSidecar?: {
        status: string;
      };
    };

    expect(payload.readiness.appServer).toBeNull();
    expect(payload.retrievalSidecar).toMatchObject({
      status: "warning"
    });
  });

  it("surfaces unsafe topic and layout diagnostics through cam doctor", async () => {
    const homeDir = await tempDir("cam-doctor-diagnostics-home-");
    const projectDir = await tempDir("cam-doctor-diagnostics-project-");
    const memoryRoot = await tempDir("cam-doctor-diagnostics-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      [
        "# Workflow",
        "",
        "<!-- cam:topic workflow -->",
        "",
        "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
        "",
        "Manual notes outside managed entries"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(path.dirname(store.getMemoryFile("project")), "Bad Topic.md"),
      "# stray\n",
      "utf8"
    );
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{not-json", "utf8");

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      retrievalSidecar?: {
        status: string;
      };
      topicDiagnostics?: {
        status: string;
        diagnostics: Array<{ topic: string; safeToRewrite: boolean }>;
      };
      layoutDiagnostics: Array<{ kind: string; fileName: string }>;
    };

    expect(payload.retrievalSidecar).toMatchObject({
      status: "warning"
    });
    expect(payload.topicDiagnostics).toMatchObject({
      status: "warning",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          topic: "workflow",
          safeToRewrite: false
        })
      ])
    });
    expect(payload.layoutDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "malformed-topic-filename",
          fileName: "Bad Topic.md"
        })
      ])
    );
  });

  it("keeps the retrieval sidecar repair command scoped to the smallest degraded target", async () => {
    const homeDir = await tempDir("cam-doctor-min-repair-home-");
    const projectDir = await tempDir("cam-doctor-min-repair-project-");
    const memoryRoot = await tempDir("cam-doctor-min-repair-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{not-json", "utf8");

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      retrievalSidecar?: {
        status: string;
        repairCommand: string;
      };
    };

    expect(payload.retrievalSidecar).toMatchObject({
      status: "warning",
      repairCommand: expect.stringContaining("memory reindex --scope project --state active")
    });
  });

  it("separates native readiness from host UI signals in text output", async () => {
    const homeDir = await tempDir("cam-doctor-text-home-");
    const projectDir = await tempDir("cam-doctor-text-project-");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {});

    const result = runCli(projectDir, ["doctor"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Native memory/hooks readiness:");
    expect(result.stdout).toContain("Host/UI signals:");
  });
});
