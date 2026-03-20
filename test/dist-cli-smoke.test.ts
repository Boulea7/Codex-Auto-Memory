import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import type { AppConfig } from "../src/lib/types.js";
import {
  initGitRepo,
  makeAppConfig,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("dist cli smoke", () => {
  it("reports the package version from the compiled cli entrypoint", async () => {
    const repoDir = await tempDir("cam-dist-version-");
    const packageJson = JSON.parse(
      await fs.readFile(path.resolve("package.json"), "utf8")
    ) as { version: string };

    const result = runCli(repoDir, ["--version"], { entrypoint: "dist" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it("serves reviewer json surfaces from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-home-");
    const projectDir = await tempDir("cam-dist-project-");
    const memoryRoot = await tempDir("cam-dist-memory-root-");
    process.env.HOME = homeDir;

    const config = makeAppConfig();
    await writeCamConfig(projectDir, config, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const memoryStore = new MemoryStore(project, {
      ...config,
      autoMemoryDirectory: memoryRoot
    });
    await memoryStore.ensureLayout();
    await memoryStore.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await memoryStore.appendSyncAuditEntry({
      appliedAt: "2026-03-14T12:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-dist-smoke.jsonl",
      sessionId: "session-dist-smoke",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied",
      operations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          reason: "Manual note.",
          sources: ["manual"]
        }
      ]
    });

    const continuityStore = new SessionContinuityStore(project, {
      ...config,
      autoMemoryDirectory: memoryRoot
    });
    await continuityStore.saveSummary(
      {
        project: {
          goal: "Continue reviewing the release-facing CLI surface.",
          confirmedWorking: ["Compiled CLI reviewer surfaces are available."],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: [],
          filesDecisionsEnvironment: []
        },
        projectLocal: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: [],
          filesDecisionsEnvironment: []
        }
      },
      "project"
    );

    const memoryResult = runCli(projectDir, ["memory", "--recent", "1", "--json"], {
      entrypoint: "dist"
    });
    const sessionResult = runCli(projectDir, ["session", "status", "--json"], {
      entrypoint: "dist"
    });

    expect(memoryResult.exitCode).toBe(0);
    expect(sessionResult.exitCode).toBe(0);

    const memoryPayload = JSON.parse(memoryResult.stdout) as {
      recentSyncAudit: Array<{ rolloutPath: string }>;
    };
    const sessionPayload = JSON.parse(sessionResult.stdout) as {
      projectLocation: { exists: boolean };
    };

    expect(memoryPayload.recentSyncAudit).toHaveLength(1);
    expect(memoryPayload.recentSyncAudit[0]?.rolloutPath).toBe("/tmp/rollout-dist-smoke.jsonl");
    expect(sessionPayload.projectLocation.exists).toBe(true);
  }, 30_000);

  it("routes exec through the compiled wrapper entrypoint", async () => {
    const repoDir = await tempDir("cam-dist-wrapper-repo-");
    const memoryRoot = await tempDir("cam-dist-wrapper-memory-");
    await initGitRepo(repoDir);

    const capturedArgsPath = path.join(repoDir, "captured-args.json");
    const mockCodexPath = path.join(repoDir, "mock-codex");
    await fs.writeFile(
      mockCodexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capturedArgsPath)}, JSON.stringify(process.argv.slice(2), null, 2));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    const projectConfig: AppConfig = makeAppConfig({
      autoMemoryEnabled: false,
      codexBinary: mockCodexPath,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false
    });
    await writeCamConfig(repoDir, projectConfig, {
      autoMemoryDirectory: memoryRoot,
      autoMemoryEnabled: false,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false
    });

    const result = runCli(repoDir, ["exec", "continue"], {
      entrypoint: "dist"
    });
    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];

    expect(result.exitCode).toBe(0);
    expect(capturedArgs).toContain("exec");
    expect(capturedArgs).toContain("continue");
    expect(capturedArgs.some((value) => value.startsWith("base_instructions="))).toBe(true);
  }, 30_000);
});
