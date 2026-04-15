import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSession } from "../src/lib/commands/session.js";
import { runDream } from "../src/lib/commands/dream.js";
import { runWrappedCodex } from "../src/lib/commands/wrapper.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import type { SessionContinuityAuditEntry } from "../src/lib/types.js";
import {
  initGitRepo,
  makeAppConfig,
  makeRolloutFixture,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";
import {
  cleanupTempDirs,
  createTempDir,
  makeEvidenceCounts,
  writeSessionRolloutFile
} from "./helpers/session-test-support.js";
import { restoreOptionalEnv } from "./helpers/env.js";
import { pathExists } from "./helpers/filesystem.js";

const tempDirs: string[] = [];
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;

async function tempDir(prefix: string): Promise<string> {
  return createTempDir(tempDirs, prefix);
}

const initRepo = initGitRepo;
const configJson = makeAppConfig;
const rolloutFixture = makeRolloutFixture;

async function writeProjectConfig(
  repoDir: string,
  projectConfig: Record<string, unknown>,
  localConfig: Record<string, unknown>
): Promise<void> {
  const projectCodexBinary =
    typeof projectConfig.codexBinary === "string" ? projectConfig.codexBinary : undefined;
  const nextLocalConfig =
    projectCodexBinary && typeof localConfig.codexBinary !== "string"
      ? {
          ...localConfig,
          codexBinary: projectCodexBinary
        }
      : localConfig;

  await writeCamConfig(repoDir, projectConfig, nextLocalConfig);
}

afterEach(async () => {
  restoreOptionalEnv("CAM_CODEX_SESSIONS_DIR", originalSessionsDir);
  await cleanupTempDirs(tempDirs);
});

beforeEach(async () => {
  process.env.CAM_CODEX_SESSIONS_DIR = await tempDir("cam-session-default-sessions-");
});

const rolloutFixturesDir = path.join(process.cwd(), "test/fixtures/rollouts");

async function copyRolloutFixture(fixtureName: string, destinationPath: string): Promise<void> {
  await fs.copyFile(path.join(rolloutFixturesDir, fixtureName), destinationPath);
}

async function writeNoopCodexBinary(repoDir: string): Promise<string> {
  const mockCodexPath = path.join(repoDir, "mock-codex");
  await fs.writeFile(
    mockCodexPath,
    `#!/usr/bin/env node
process.exit(0);
`,
    "utf8"
  );
  await fs.chmod(mockCodexPath, 0o755);
  return mockCodexPath;
}

describe("runSession", () => {
  it("shows an empty compact prior preview when no continuity audit history exists", async () => {
    const repoDir = await tempDir("cam-session-empty-history-repo-");
    const memoryRoot = await tempDir("cam-session-empty-history-memory-");
    await initRepo(repoDir);
    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Latest generation: none recorded yet");
    expect(loadOutput).toContain("Recent prior generations:");
    expect(loadOutput).toContain("- none recorded yet");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Latest generation: none recorded yet");
    expect(statusOutput).toContain("Recent prior generations:");
    expect(statusOutput).toContain("- none recorded yet");
  });

  it("saves, loads, reports, and clears continuity state", async () => {
    const repoDir = await tempDir("cam-session-cmd-repo-");
    const memoryRoot = await tempDir("cam-session-cmd-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Continue the login cookie work and add middleware."),
      "utf8"
    );
    const secondRolloutPath = path.join(repoDir, "rollout-2.jsonl");
    await fs.writeFile(
      secondRolloutPath,
      rolloutFixture(repoDir, "Finish the middleware retry work and document the fallback."),
      "utf8"
    );

    const saveOutput = await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "both"
    });
    expect(saveOutput).toContain("Saved session continuity");
    expect(saveOutput).toContain("Generation: heuristic");
    expect(saveOutput).toContain("confidence low");
    expect(saveOutput).toContain("Evidence: successful");
    expect(saveOutput).toContain("Written paths:");

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: secondRolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      diagnostics: {
        preferredPath: string;
        actualPath: string;
        confidence: string;
        warnings: string[];
        fallbackReason?: string;
      };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        confidence?: string;
        warnings?: string[];
        fallbackReason?: string;
        evidenceCounts: {
          successfulCommands: number;
          failedCommands: number;
          fileWrites: number;
          nextSteps: number;
          untried: number;
        };
        writtenPaths: string[];
      } | null;
      recentContinuityAuditEntries: Array<{
        rolloutPath: string;
        actualPath: string;
      }>;
      continuityAuditPath: string;
    };
    expect(saveJson.diagnostics.preferredPath).toBe("heuristic");
    expect(saveJson.diagnostics.actualPath).toBe("heuristic");
    expect(saveJson.diagnostics.confidence).toBe("low");
    expect(saveJson.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(saveJson.diagnostics.fallbackReason).toBe("configured-heuristic");
    expect(saveJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(saveJson.latestContinuityAuditEntry?.confidence).toBe("low");
    expect(saveJson.latestContinuityAuditEntry?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(saveJson.latestContinuityAuditEntry?.fallbackReason).toBe("configured-heuristic");
    expect(saveJson.latestContinuityAuditEntry?.evidenceCounts.successfulCommands).toBeGreaterThan(0);
    expect(saveJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(saveJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(saveJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(saveJson.recentContinuityAuditEntries[1]?.rolloutPath).toBe(rolloutPath);
    expect(saveJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const loadJson = JSON.parse(
      await runSession("load", {
        cwd: repoDir,
        json: true,
        printStartup: true
      })
    ) as {
      projectState: { goal: string; confirmedWorking: string[] } | null;
      localState: { incompleteNext: string[]; filesDecisionsEnvironment: string[] } | null;
      mergedState: { goal: string; confirmedWorking: string[]; incompleteNext: string[] };
      startup: { text: string };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        writtenPaths: string[];
        evidenceCounts: {
          successfulCommands: number;
          failedCommands: number;
          fileWrites: number;
          nextSteps: number;
          untried: number;
        };
      } | null;
      latestContinuityDiagnostics: {
        actualPath: string;
        confidence: string;
        warnings: string[];
        fallbackReason?: string;
      } | null;
      recentContinuityAuditEntries: Array<{
        rolloutPath: string;
        actualPath: string;
      }>;
      continuityAuditPath: string;
    };
    expect(loadJson.mergedState.goal).toContain("Finish the middleware retry work");
    expect(loadJson.mergedState.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(loadJson.localState?.incompleteNext.length).toBeGreaterThan(0);
    expect(loadJson.startup.text).toContain("# Session Continuity");
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(loadJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(loadJson.latestContinuityAuditEntry?.evidenceCounts.successfulCommands).toBeGreaterThan(0);
    expect(loadJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(loadJson.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(loadJson.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(loadJson.latestContinuityDiagnostics?.fallbackReason).toBe("configured-heuristic");
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(loadJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(loadJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Evidence: successful");
    expect(loadOutput).toContain("Warnings:");
    expect(loadOutput).toContain(
      "Next steps were inferred from the latest request because the rollout did not contain an explicit next-step phrase."
    );
    expect(loadOutput).toContain("Written paths:");
    expect(loadOutput).toContain(
      "Merged resume brief combines shared continuity with any project-local overrides."
    );
    expect(loadOutput).toContain(
      "Recent prior generations below are compact audit previews, not startup-injected history."
    );
    expect(loadOutput).toContain("Recent prior generations:");
    expect(loadOutput).toContain(rolloutPath);
    expect(
      loadOutput.match(new RegExp(secondRolloutPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []
    ).toHaveLength(1);

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      localPathStyle: string;
      latestContinuityAuditEntry: {
        rolloutPath: string;
        writtenPaths: string[];
      } | null;
      latestContinuityDiagnostics: { actualPath: string; confidence: string; warnings: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
      continuityAuditPath: string;
    };
    expect(statusJson.localPathStyle).toBe("codex");
    expect(statusJson.latestContinuityAuditEntry?.rolloutPath).toBe(secondRolloutPath);
    expect(statusJson.latestContinuityAuditEntry?.writtenPaths.length).toBeGreaterThan(0);
    expect(statusJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(statusJson.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(statusJson.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(statusJson.recentContinuityAuditEntries).toHaveLength(2);
    expect(statusJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe(secondRolloutPath);
    expect(statusJson.continuityAuditPath).toContain("session-continuity-log.jsonl");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Evidence: successful");
    expect(statusOutput).toContain("Warnings:");
    expect(statusOutput).toContain(
      "Next steps were inferred from the latest request because the rollout did not contain an explicit next-step phrase."
    );
    expect(statusOutput).toContain("Written paths:");
    expect(statusOutput).toContain(
      "Merged resume brief combines shared continuity with any project-local overrides."
    );
    expect(statusOutput).toContain(
      "Recent prior generations below are compact audit previews, not startup-injected history."
    );
    expect(statusOutput).toContain("Recent prior generations:");
    expect(statusOutput).toContain(rolloutPath);
    expect(
      statusOutput.match(new RegExp(secondRolloutPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []
    ).toHaveLength(1);

    const clearOutput = await runSession("clear", { cwd: repoDir, scope: "both" });
    expect(clearOutput).toContain("Cleared session continuity files");

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    const latestAudit = await store.readLatestAuditEntry();
    expect(latestAudit?.actualPath).toBe("heuristic");
    expect(latestAudit?.fallbackReason).toBe("configured-heuristic");
    expect(await store.readMergedState()).toBeNull();
  }, 25_000);

  it("supports session save --json from the CLI command surface", async () => {
    const repoDir = await tempDir("cam-session-cli-repo-");
    const memoryRoot = await tempDir("cam-session-cli-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save continuity through the CLI command surface."),
      "utf8"
    );

    const result = runCli(repoDir, ["session", "save", "--json", "--rollout", rolloutPath]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      diagnostics: { actualPath: string; confidence: string; warnings: string[] };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(payload.diagnostics.actualPath).toBe("heuristic");
    expect(payload.diagnostics.confidence).toBe("low");
    expect(payload.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(payload.latestContinuityAuditEntry?.rolloutPath).toBe(rolloutPath);
    expect(payload.latestContinuityAuditEntry?.trigger).toBe("manual-save");
    expect(payload.latestContinuityAuditEntry?.writeMode).toBe("merge");
    expect(payload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);
  }, 30_000);

  it("supports session refresh --json from the CLI command surface and replaces polluted continuity", async () => {
    const repoDir = await tempDir("cam-session-refresh-cli-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-cli-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.saveSummary(
      {
        project: {
          goal: "Stale shared goal",
          confirmedWorking: ["Stale shared success"],
          triedAndFailed: ["Stale shared failure"],
          notYetTried: ["Stale shared idea"],
          incompleteNext: [],
          filesDecisionsEnvironment: ["Stale shared note"]
        },
        projectLocal: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: ["Stale local next step"],
          filesDecisionsEnvironment: ["Stale local file note"]
        }
      },
      "both"
    );

    const rolloutPath = path.join(repoDir, "refresh-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Refresh continuity through the CLI command surface."),
      "utf8"
    );

    const result = runCli(repoDir, ["session", "refresh", "--json", "--rollout", rolloutPath]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      action: string;
      writeMode: string;
      rolloutPath: string;
      diagnostics: { confidence: string; warnings: string[] };
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
      continuityAuditPath: string;
      pendingContinuityRecovery: object | null;
      rolloutSelection: { kind: string; rolloutPath: string };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
    };
    expect(payload.action).toBe("refresh");
    expect(payload.writeMode).toBe("replace");
    expect(payload.rolloutPath).toBe(rolloutPath);
    expect(payload.rolloutSelection).toEqual({
      kind: "explicit-rollout",
      rolloutPath
    });
    expect(payload.latestContinuityAuditEntry?.rolloutPath).toBe(rolloutPath);
    expect(payload.latestContinuityAuditEntry?.trigger).toBe("manual-refresh");
    expect(payload.latestContinuityAuditEntry?.writeMode).toBe("replace");
    expect(payload.diagnostics.confidence).toBe("low");
    expect(payload.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(payload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);
    expect(payload.continuityAuditPath).toContain("session-continuity-log.jsonl");
    expect(payload.pendingContinuityRecovery).toBeNull();

    const loadPayload = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
    };
    expect(loadPayload.latestContinuityAuditEntry).toMatchObject({
      rolloutPath,
      trigger: "manual-refresh",
      writeMode: "replace"
    });
    expect(loadPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(loadPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );

    const statusPayload = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
    };
    expect(statusPayload.latestContinuityAuditEntry).toMatchObject({
      rolloutPath,
      trigger: "manual-refresh",
      writeMode: "replace"
    });
    expect(statusPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(statusPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );

    const merged = await store.readMergedState();
    expect(merged?.goal).toContain("Refresh continuity through the CLI command surface.");
    expect(merged?.goal).not.toContain("Stale shared goal");
    expect(merged?.confirmedWorking.join("\n")).not.toContain("Stale shared success");
    expect(merged?.incompleteNext.join("\n")).not.toContain("Stale local next step");
    expect(merged?.filesDecisionsEnvironment.join("\n")).not.toContain("Stale local file note");
  }, 30_000);

  it("supports session load/status from the real CLI surface, including startup source files", async () => {
    const repoDir = await tempDir("cam-session-load-cli-repo-");
    const memoryRoot = await tempDir("cam-session-load-cli-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.saveSummary(
      {
        project: {
          goal: "Resume the shared continuity path.",
          confirmedWorking: ["Shared continuity already exists."],
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

    const loadResult = runCli(repoDir, ["session", "load", "--json", "--print-startup"]);
    const statusResult = runCli(repoDir, ["session", "status", "--json"]);

    expect(loadResult.exitCode).toBe(0);
    expect(statusResult.exitCode).toBe(0);

    const loadPayload = JSON.parse(loadResult.stdout) as {
      startup: {
        text: string;
        sourceFiles: string[];
        candidateSourceFiles: string[];
        continuityMode: string;
        continuityProvenanceKind: string;
        continuitySectionKinds: string[];
        continuitySourceKinds: string[];
        sectionsRendered: { sources: boolean; goal: boolean };
        omissionCounts: Record<string, number>;
        futureCompactionSeam: { kind: string; rebuildsStartupSections: boolean };
      };
      projectLocation: { path: string };
      localLocation: { path: string };
    };
    const statusPayload = JSON.parse(statusResult.stdout) as {
      projectLocation: { exists: boolean; path: string };
      localLocation: { exists: boolean; path: string };
      startup: {
        sourceFiles: string[];
        candidateSourceFiles: string[];
        continuityMode: string;
        continuityProvenanceKind: string;
        continuitySectionKinds: string[];
      };
    };

    expect(loadPayload.startup.text).toContain("# Session Continuity");
    expect(loadPayload.startup.sourceFiles).toEqual([loadPayload.projectLocation.path]);
    expect(loadPayload.startup.candidateSourceFiles).toEqual([loadPayload.projectLocation.path]);
    expect(loadPayload.startup.sourceFiles).not.toContain(loadPayload.localLocation.path);
    expect(loadPayload.startup.continuityMode).toBe("startup");
    expect(loadPayload.startup.continuityProvenanceKind).toBe("temporary-continuity");
    expect(loadPayload.startup.continuitySectionKinds).toContain("sources");
    expect(loadPayload.startup.continuitySectionKinds).toContain("goal");
    expect(loadPayload.startup.continuitySourceKinds).toEqual(["shared"]);
    expect(loadPayload.startup.sectionsRendered.sources).toBe(true);
    expect(loadPayload.startup.sectionsRendered.goal).toBe(true);
    expect(loadPayload.startup.omissionCounts).toEqual({});
    expect(loadPayload.startup.futureCompactionSeam).toMatchObject({
      kind: "session-summary-placeholder",
      rebuildsStartupSections: true
    });
    expect(statusPayload.startup.sourceFiles).toEqual([statusPayload.projectLocation.path]);
    expect(statusPayload.startup.candidateSourceFiles).toEqual([statusPayload.projectLocation.path]);
    expect(statusPayload.startup.continuityMode).toBe("startup");
    expect(statusPayload.startup.continuityProvenanceKind).toBe("temporary-continuity");
    expect(statusPayload.startup.continuitySectionKinds).toContain("sources");
    expect(statusPayload.projectLocation.exists).toBe(true);
    expect(statusPayload.localLocation.exists).toBe(false);
  }, 30_000);

  it("supports session save, status, and load --cwd from another working directory", async () => {
    const repoDir = await tempDir("cam-session-cwd-repo-");
    const shellDir = await tempDir("cam-session-cwd-shell-");
    const memoryRoot = await tempDir("cam-session-cwd-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save continuity through the CLI --cwd surface."),
      "utf8"
    );

    const env = { CAM_CODEX_SESSIONS_DIR: process.env.CAM_CODEX_SESSIONS_DIR };

    const saveResult = runCli(
      shellDir,
      ["session", "save", "--cwd", repoDir, "--rollout", rolloutPath, "--json"],
      { env }
    );
    expect(saveResult.exitCode, saveResult.stderr).toBe(0);

    const statusResult = runCli(shellDir, ["session", "status", "--cwd", repoDir, "--json"], {
      env
    });
    expect(statusResult.exitCode, statusResult.stderr).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      mergedState: {
        goal: expect.stringContaining("Save continuity through the CLI")
      }
    });

    const loadResult = runCli(
      shellDir,
      ["session", "load", "--cwd", repoDir, "--json", "--print-startup"],
      { env }
    );
    expect(loadResult.exitCode, loadResult.stderr).toBe(0);
    expect(JSON.parse(loadResult.stdout)).toMatchObject({
      startup: {
        continuityMode: "startup"
      }
    });
  });

  it("keeps session load and status read-only on an uninitialized project", async () => {
    const homeDir = await tempDir("cam-session-readonly-home-");
    const projectDir = await tempDir("cam-session-readonly-project-");
    const memoryRootParent = await tempDir("cam-session-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    await initRepo(projectDir);

    await writeProjectConfig(
      projectDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const statusResult = runCli(projectDir, ["session", "status", "--json"], {
      env: { HOME: homeDir }
    });
    const loadResult = runCli(projectDir, ["session", "load", "--json", "--print-startup"], {
      env: { HOME: homeDir }
    });

    expect(statusResult.exitCode, statusResult.stderr).toBe(0);
    expect(loadResult.exitCode, loadResult.stderr).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      projectLocation: {
        exists: false
      },
      localLocation: {
        exists: false
      },
      latestContinuityAuditEntry: null,
      latestContinuityDiagnostics: null,
      pendingContinuityRecovery: null,
      startup: {
        sourceFiles: [],
        candidateSourceFiles: [],
        continuityMode: "startup",
        continuityProvenanceKind: "temporary-continuity"
      }
    });
    expect(JSON.parse(loadResult.stdout)).toMatchObject({
      projectLocation: {
        exists: false
      },
      localLocation: {
        exists: false
      },
      latestContinuityAuditEntry: null,
      latestContinuityDiagnostics: null,
      pendingContinuityRecovery: null,
      startup: {
        sourceFiles: [],
        candidateSourceFiles: [],
        continuityMode: "startup",
        continuityProvenanceKind: "temporary-continuity"
      }
    });
    expect(await pathExists(memoryRoot)).toBe(false);
  }, 30_000);

  it("refresh replaces only the selected scope", async () => {
    const repoDir = await tempDir("cam-session-refresh-scope-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-scope-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.saveSummary(
      {
        project: {
          goal: "Shared stale goal",
          confirmedWorking: ["Shared stale success"],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: [],
          filesDecisionsEnvironment: ["Shared stale note"]
        },
        projectLocal: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: ["Local stale next"],
          filesDecisionsEnvironment: ["Local stale file note"]
        }
      },
      "both"
    );

    const projectRolloutPath = path.join(repoDir, "project-refresh.jsonl");
    await fs.writeFile(
      projectRolloutPath,
      rolloutFixture(repoDir, "Refresh only the shared scope.", {
        sessionId: "session-project-refresh"
      }),
      "utf8"
    );
    await runSession("refresh", {
      cwd: repoDir,
      rollout: projectRolloutPath,
      scope: "project"
    });

    const projectAfterRefresh = await store.readState("project");
    const localAfterProjectRefresh = await store.readState("project-local");
    expect(projectAfterRefresh?.goal).toContain("Refresh only the shared scope.");
    expect(projectAfterRefresh?.goal).not.toContain("Shared stale goal");
    expect(localAfterProjectRefresh?.incompleteNext).toContain("Local stale next");

    const localRolloutPath = path.join(repoDir, "local-refresh.jsonl");
    await fs.writeFile(
      localRolloutPath,
      rolloutFixture(repoDir, "Refresh only the local scope.", {
        sessionId: "session-local-refresh"
      }),
      "utf8"
    );
    await runSession("refresh", {
      cwd: repoDir,
      rollout: localRolloutPath,
      scope: "project-local"
    });

    const projectAfterLocalRefresh = await store.readState("project");
    const localAfterRefresh = await store.readState("project-local");
    expect(projectAfterLocalRefresh?.goal).toContain("Refresh only the shared scope.");
    expect(localAfterRefresh?.incompleteNext.join("\n")).not.toContain("Local stale next");
    expect(localAfterRefresh?.filesDecisionsEnvironment.join("\n")).not.toContain(
      "Local stale file note"
    );
  }, 30_000);

  it("supports session load and status from the CLI command surface", async () => {
    const repoDir = await tempDir("cam-session-load-status-cli-repo-");
    const memoryRoot = await tempDir("cam-session-load-status-cli-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Continue the login cookie work and add middleware."),
      "utf8"
    );

    const saveResult = runCli(repoDir, ["session", "save", "--json", "--rollout", rolloutPath]);
    expect(saveResult.exitCode).toBe(0);

    const loadResult = runCli(repoDir, ["session", "load", "--json", "--print-startup"]);
    expect(loadResult.exitCode).toBe(0);
    const loadPayload = JSON.parse(loadResult.stdout) as {
      startup: { text: string };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: {
        actualPath: string;
        confidence: string;
        warnings: string[];
      } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadPayload.startup.text).toContain("# Session Continuity");
    expect(loadPayload.latestContinuityAuditEntry?.rolloutPath).toBe(rolloutPath);
    expect(loadPayload.latestContinuityAuditEntry?.trigger).toBe("manual-save");
    expect(loadPayload.latestContinuityAuditEntry?.writeMode).toBe("merge");
    expect(loadPayload.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(loadPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(loadPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(loadPayload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);

    const statusResult = runCli(repoDir, ["session", "status", "--json"]);
    expect(statusResult.exitCode).toBe(0);
    const statusPayload = JSON.parse(statusResult.stdout) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: {
        actualPath: string;
        confidence: string;
        warnings: string[];
      } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(statusPayload.latestContinuityAuditEntry?.rolloutPath).toBe(rolloutPath);
    expect(statusPayload.latestContinuityAuditEntry?.trigger).toBe("manual-save");
    expect(statusPayload.latestContinuityAuditEntry?.writeMode).toBe("merge");
    expect(statusPayload.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(statusPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(statusPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Next steps were inferred from the latest request")
      ])
    );
    expect(statusPayload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);
  }, 30_000);

  it("keeps reviewer noise in diagnostics but out of persisted continuity markdown for a mixed-language rollout fixture", async () => {
    const repoDir = await tempDir("cam-session-mixed-noise-repo-");
    const memoryRoot = await tempDir("cam-session-mixed-noise-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "mixed-language-reviewer-noise.jsonl");
    await copyRolloutFixture("mixed-language-reviewer-noise.jsonl", rolloutPath);

    const saveResult = runCli(repoDir, ["session", "save", "--json", "--rollout", rolloutPath]);
    expect(saveResult.exitCode).toBe(0);
    const savePayload = JSON.parse(saveResult.stdout) as {
      diagnostics: { confidence: string; warnings: string[] };
      latestContinuityAuditEntry: { warnings?: string[] } | null;
    };
    expect(savePayload.diagnostics.confidence).toBe("low");
    expect(savePayload.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );
    expect(savePayload.latestContinuityAuditEntry?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    const sharedBody = await fs.readFile(store.paths.sharedFile, "utf8");
    const localBody = await fs.readFile(store.paths.localFile, "utf8");

    expect(sharedBody).toContain("pnpm test");
    expect(sharedBody).toContain("pnpm build");
    expect(localBody).toContain("更新 src/auth/login.ts");
    expect(localBody).toContain("login.ts");
    expect(sharedBody).not.toContain("Reviewer or subagent prompt noise");
    expect(localBody).not.toContain("Reviewer or subagent prompt noise");
    expect(sharedBody).not.toContain("Focus on docs and contract surfaces only");
    expect(localBody).not.toContain("Focus on docs and contract surfaces only");
  }, 30_000);

  it("refresh prefers a matching recovery marker over audit and latest primary rollout", async () => {
    const repoDir = await tempDir("cam-session-refresh-recovery-priority-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-recovery-priority-memory-");
    const sessionsDir = await tempDir("cam-session-refresh-recovery-priority-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const recoveryRolloutPath = path.join(repoDir, "recovery-rollout.jsonl");
    await fs.writeFile(
      recoveryRolloutPath,
      rolloutFixture(repoDir, "Use the recovery provenance for refresh.", {
        sessionId: "session-recovery"
      }),
      "utf8"
    );
    const auditRolloutPath = path.join(repoDir, "audit-rollout.jsonl");
    await fs.writeFile(
      auditRolloutPath,
      rolloutFixture(repoDir, "Use the audit provenance for refresh.", {
        sessionId: "session-audit"
      }),
      "utf8"
    );
    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      rolloutFixture(repoDir, "Use the latest primary rollout for refresh.", {
        sessionId: "session-primary"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: recoveryRolloutPath,
      sourceSessionId: "session-recovery",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      writtenPaths: [store.paths.sharedFile, store.paths.localFile],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      failedStage: "audit-write",
      failureMessage: "stale recovery marker"
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const payload = JSON.parse(
      await runSession("refresh", { cwd: repoDir, scope: "both", json: true })
    ) as {
      rolloutPath: string;
      rolloutSelection: { kind: string; rolloutPath: string };
      latestContinuityAuditEntry: { trigger?: string; writeMode?: string } | null;
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "pending-recovery-marker",
      rolloutPath: recoveryRolloutPath
    });
    expect(payload.rolloutPath).toBe(recoveryRolloutPath);
    expect(payload.latestContinuityAuditEntry?.trigger).toBe("manual-refresh");
    expect(payload.latestContinuityAuditEntry?.writeMode).toBe("replace");

    const merged = await store.readMergedState();
    expect(merged?.goal).toContain("Use the recovery provenance for refresh.");
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("refresh falls back to the latest matching audit entry when recovery scope does not match", async () => {
    const repoDir = await tempDir("cam-session-refresh-audit-priority-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-audit-priority-memory-");
    const sessionsDir = await tempDir("cam-session-refresh-audit-priority-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const auditRolloutPath = path.join(repoDir, "matching-audit-rollout.jsonl");
    await fs.writeFile(
      auditRolloutPath,
      rolloutFixture(repoDir, "Use the latest matching audit entry.", {
        sessionId: "session-matching-audit"
      }),
      "utf8"
    );
    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      rolloutFixture(repoDir, "Fallback primary rollout should not be used here.", {
        sessionId: "session-primary-fallback"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: path.join(repoDir, "project-only-recovery.jsonl"),
      sourceSessionId: "session-project-only",
      scope: "project",
      writtenPaths: [store.paths.sharedFile],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      evidenceCounts: makeEvidenceCounts(),
      failedStage: "audit-write",
      failureMessage: "project-only marker"
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-matching-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const payload = JSON.parse(
      await runSession("refresh", { cwd: repoDir, scope: "both", json: true })
    ) as {
      rolloutSelection: { kind: string; rolloutPath: string };
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "latest-audit-entry",
      rolloutPath: auditRolloutPath
    });

    const merged = await store.readMergedState();
    expect(merged?.goal).toContain("Use the latest matching audit entry.");
    expect(await store.readRecoveryRecord()).toMatchObject({
      scope: "project"
    });
  }, 30_000);

  it("refresh can reuse scope=both audit provenance when refreshing only the shared project layer", async () => {
    const repoDir = await tempDir("cam-session-refresh-project-scope-both-audit-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-project-scope-both-audit-memory-");
    const sessionsDir = await tempDir("cam-session-refresh-project-scope-both-audit-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const auditRolloutPath = path.join(repoDir, "matching-both-audit-rollout.jsonl");
    await fs.writeFile(
      auditRolloutPath,
      rolloutFixture(repoDir, "Use the shared project audit provenance.", {
        sessionId: "session-both-audit"
      }),
      "utf8"
    );
    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      rolloutFixture(repoDir, "Fallback primary rollout should stay unused here.", {
        sessionId: "session-primary-fallback"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-both-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const payload = JSON.parse(
      await runSession("refresh", { cwd: repoDir, scope: "project", json: true })
    ) as {
      rolloutSelection: { kind: string; rolloutPath: string };
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "latest-audit-entry",
      rolloutPath: auditRolloutPath
    });

    const merged = await store.readMergedState();
    expect(merged?.goal).toContain("Use the shared project audit provenance.");
  }, 30_000);

  it("save can reuse scope=both audit provenance when saving only the local project layer", async () => {
    const repoDir = await tempDir("cam-session-save-local-scope-both-audit-repo-");
    const memoryRoot = await tempDir("cam-session-save-local-scope-both-audit-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const auditRolloutPath = path.join(repoDir, "matching-both-save-audit-rollout.jsonl");
    await fs.writeFile(
      auditRolloutPath,
      rolloutFixture(repoDir, "Use the local project audit provenance.", {
        sessionId: "session-both-save-audit"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-both-save-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const payload = JSON.parse(
      await runSession("save", { cwd: repoDir, scope: "project-local", json: true })
    ) as {
      rolloutSelection: { kind: string; rolloutPath: string };
      latestContinuityAuditEntry: { trigger?: string; writeMode?: string } | null;
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "latest-audit-entry",
      rolloutPath: auditRolloutPath
    });
    expect(payload.latestContinuityAuditEntry?.trigger).toBe("manual-save");
    expect(payload.latestContinuityAuditEntry?.writeMode).toBe("merge");
  }, 30_000);

  it("save still prefers the latest primary rollout over older matching audit provenance", async () => {
    const repoDir = await tempDir("cam-session-save-primary-preferred-repo-");
    const memoryRoot = await tempDir("cam-session-save-primary-preferred-memory-");
    const sessionsDir = await tempDir("cam-session-save-primary-preferred-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const auditRolloutPath = path.join(repoDir, "older-matching-audit-rollout.jsonl");
    await fs.writeFile(
      auditRolloutPath,
      rolloutFixture(repoDir, "Old audit provenance should not win normal save.", {
        sessionId: "session-older-audit"
      }),
      "utf8"
    );
    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      rolloutFixture(repoDir, "Newest primary rollout should drive normal save.", {
        sessionId: "session-new-primary"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-older-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const payload = JSON.parse(
      await runSession("save", { cwd: repoDir, scope: "project-local", json: true })
    ) as {
      rolloutPath: string;
      rolloutSelection: { kind: string; rolloutPath: string };
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "latest-primary-rollout",
      rolloutPath: primaryRolloutPath
    });
    expect(payload.rolloutPath).toBe(primaryRolloutPath);
  }, 30_000);

  it("save prefers a matching recovery marker over a newer primary rollout", async () => {
    const repoDir = await tempDir("cam-session-save-recovery-priority-repo-");
    const memoryRoot = await tempDir("cam-session-save-recovery-priority-memory-");
    const sessionsDir = await tempDir("cam-session-save-recovery-priority-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const recoveryRolloutPath = path.join(repoDir, "recovery-rollout.jsonl");
    await fs.writeFile(
      recoveryRolloutPath,
      rolloutFixture(repoDir, "Retry the recovery provenance for save.", {
        sessionId: "session-save-recovery"
      }),
      "utf8"
    );
    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      rolloutFixture(repoDir, "This newer primary rollout should not win.", {
        sessionId: "session-save-primary"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: recoveryRolloutPath,
      sourceSessionId: "session-save-recovery",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      writtenPaths: [store.paths.sharedFile, store.paths.localFile],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      failedStage: "audit-write",
      failureMessage: "retry the same save provenance"
    });

    const payload = JSON.parse(
      await runSession("save", { cwd: repoDir, scope: "both", json: true })
    ) as {
      rolloutPath: string;
      rolloutSelection: { kind: string; rolloutPath: string };
      latestContinuityAuditEntry: { trigger?: string; writeMode?: string } | null;
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "pending-recovery-marker",
      rolloutPath: recoveryRolloutPath
    });
    expect(payload.rolloutPath).toBe(recoveryRolloutPath);
    expect(payload.latestContinuityAuditEntry?.trigger).toBe("manual-save");
    expect(payload.latestContinuityAuditEntry?.writeMode).toBe("merge");

    const merged = await store.readMergedState();
    expect(merged?.goal).toContain("Retry the recovery provenance for save.");
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("clears a scope=both recovery marker after a single-scope save reuses it", async () => {
    const repoDir = await tempDir("cam-session-save-clear-shared-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-save-clear-shared-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const recoveryRolloutPath = path.join(repoDir, "shared-recovery-rollout.jsonl");
    await fs.writeFile(
      recoveryRolloutPath,
      rolloutFixture(repoDir, "Single-scope save should clear the shared recovery marker.", {
        sessionId: "session-shared-recovery"
      }),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: recoveryRolloutPath,
      sourceSessionId: "session-shared-recovery",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      writtenPaths: [store.paths.sharedFile, store.paths.localFile],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      failedStage: "audit-write",
      failureMessage: "retry the same save provenance"
    });

    const payload = JSON.parse(
      await runSession("save", { cwd: repoDir, scope: "project-local", json: true })
    ) as {
      rolloutSelection: { kind: string; rolloutPath: string };
    };
    expect(payload.rolloutSelection).toEqual({
      kind: "pending-recovery-marker",
      rolloutPath: recoveryRolloutPath
    });
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("does not fall back to a lower-priority source when the selected refresh provenance cannot be read", async () => {
    const repoDir = await tempDir("cam-session-refresh-missing-provenance-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-missing-provenance-memory-");
    const sessionsDir = await tempDir("cam-session-refresh-missing-provenance-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: path.join(repoDir, "missing-audit-rollout.jsonl"),
      sourceSessionId: "session-missing-audit",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-missing.md"]
    });
    await fs.writeFile(
      path.join(dayDir, "rollout-primary.jsonl"),
      rolloutFixture(repoDir, "Fallback primary rollout should stay unused."),
      "utf8"
    );

    await expect(
      runSession("refresh", { cwd: repoDir, scope: "both" })
    ).rejects.toThrow(/ENOENT|no such file/i);
  }, 30_000);

  it("auto-selects the latest primary rollout instead of a newer subagent rollout", async () => {
    const repoDir = await tempDir("cam-session-latest-primary-repo-");
    const memoryRoot = await tempDir("cam-session-latest-primary-memory-");
    const sessionsDir = await tempDir("cam-session-latest-primary-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const primaryRolloutPath = path.join(dayDir, "rollout-primary.jsonl");
    await fs.writeFile(
      primaryRolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-main",
            timestamp: "2026-03-15T00:00:01.000Z",
            cwd: repoDir,
            source: "cli"
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Continue the real primary continuity path."
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-1",
            arguments: "{\"cmd\":\"pnpm test\"}"
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "Process exited with code 0"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const subagentRolloutPath = path.join(dayDir, "rollout-subagent.jsonl");
    await fs.writeFile(
      subagentRolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-subagent",
            forked_from_id: "session-main",
            timestamp: "2026-03-15T00:00:02.000Z",
            cwd: repoDir,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "session-main"
                }
              }
            }
          }
        }),
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-main",
            timestamp: "2026-03-15T00:00:01.000Z",
            cwd: repoDir,
            source: "cli"
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "You are reviewer sub-agent 4. Work read-only. Focus on docs and contract surfaces only."
          }
        })
      ].join("\n"),
      "utf8"
    );

    const payload = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        scope: "both",
        json: true
      })
    ) as {
      rolloutPath: string;
      diagnostics: { sourceSessionId: string };
      summary: {
        project: { goal: string };
        projectLocal: { incompleteNext: string[] };
      };
      latestContinuityAuditEntry: { rolloutPath: string } | null;
    };

    expect(payload.rolloutPath).toBe(primaryRolloutPath);
    expect(payload.diagnostics.sourceSessionId).toBe("session-main");
    expect(payload.latestContinuityAuditEntry?.rolloutPath).toBe(primaryRolloutPath);
    expect(payload.summary.project.goal).toContain("real primary continuity");
    expect(payload.summary.projectLocal.incompleteNext.join("\n")).not.toContain(
      "reviewer sub-agent"
    );
  }, 30_000);

  it("uses a deterministic tie-breaker when multiple primary rollouts share the same timestamp", async () => {
    const repoDir = await tempDir("cam-session-latest-tie-break-repo-");
    const memoryRoot = await tempDir("cam-session-latest-tie-break-memory-");
    const sessionsDir = await tempDir("cam-session-latest-tie-break-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), { autoMemoryDirectory: memoryRoot });

    const olderPrimaryRolloutPath = await writeSessionRolloutFile(
      path.join(dayDir, "rollout-z-primary.jsonl"),
      rolloutFixture(repoDir, "Use the older primary rollout.", {
        sessionId: "session-primary-older",
        timestamp: "2026-03-15T00:00:01.000Z"
      })
    );
    const newerPrimaryRolloutPath = await writeSessionRolloutFile(
      path.join(dayDir, "rollout-a-primary.jsonl"),
      rolloutFixture(repoDir, "Use the newer primary rollout.", {
        sessionId: "session-primary-newer",
        timestamp: "2026-03-15T00:00:01.000Z"
      })
    );
    const olderMtime = new Date("2026-03-15T00:00:02.000Z");
    const newerMtime = new Date("2026-03-15T00:00:03.000Z");
    await fs.utimes(olderPrimaryRolloutPath, olderMtime, olderMtime);
    await fs.utimes(newerPrimaryRolloutPath, newerMtime, newerMtime);

    const payload = JSON.parse(
      await runSession("save", { cwd: repoDir, scope: "both", json: true })
    ) as {
      rolloutPath: string;
      diagnostics: { sourceSessionId: string };
      latestContinuityAuditEntry: { rolloutPath: string } | null;
    };

    expect(payload.rolloutPath).toBe(newerPrimaryRolloutPath);
    expect(payload.diagnostics.sourceSessionId).toBe("session-primary-newer");
    expect(payload.latestContinuityAuditEntry?.rolloutPath).toBe(newerPrimaryRolloutPath);
  }, 30_000);

  it("keeps modern audit metadata and reviewer-noise scrub stable for a conflict-heavy rollout fixture", async () => {
    const repoDir = await tempDir("cam-session-conflict-heavy-repo-");
    const memoryRoot = await tempDir("cam-session-conflict-heavy-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "session-continuity-conflict-heavy.jsonl");
    await writeSessionRolloutFile(
      rolloutPath,
      await fs.readFile(
        path.join(rolloutFixturesDir, "session-continuity-conflict-heavy.jsonl"),
        "utf8"
      )
    );

    const savePayload = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      diagnostics: { actualPath: string; confidence: string; warnings: string[] };
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
        warnings?: string[];
      } | null;
    };
    expect(savePayload.diagnostics.actualPath).toBe("heuristic");
    expect(savePayload.diagnostics.confidence).toBe("low");
    expect(savePayload.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );
    expect(savePayload.latestContinuityAuditEntry).toMatchObject({
      rolloutPath,
      trigger: "manual-save",
      writeMode: "merge"
    });
    expect(savePayload.latestContinuityAuditEntry?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );

    const loadPayload = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
      projectState: {
        goal: string;
        confirmedWorking: string[];
        triedAndFailed: string[];
        notYetTried: string[];
      } | null;
      localState: {
        incompleteNext: string[];
        filesDecisionsEnvironment: string[];
      } | null;
      mergedState: {
        goal: string;
        confirmedWorking: string[];
        triedAndFailed: string[];
        incompleteNext: string[];
      };
    };
    expect(loadPayload.latestContinuityAuditEntry).toMatchObject({
      rolloutPath,
      trigger: "manual-save",
      writeMode: "merge"
    });
    expect(loadPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(loadPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );
    expect(loadPayload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);
    expect(loadPayload.projectState?.goal).toContain("pnpm test passes");
    expect(loadPayload.projectState?.notYetTried.join("\n")).toContain("cookies()");
    expect(loadPayload.localState?.incompleteNext.join("\n")).toContain("guard the redirect");
    expect(loadPayload.localState?.filesDecisionsEnvironment.join("\n")).toContain("login.ts");
    expect(loadPayload.mergedState.goal).toContain("pnpm test passes");

    const statusPayload = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(statusPayload.latestContinuityAuditEntry).toMatchObject({
      rolloutPath,
      trigger: "manual-save",
      writeMode: "merge"
    });
    expect(statusPayload.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(statusPayload.latestContinuityDiagnostics?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reviewer or subagent prompt noise")
      ])
    );
    expect(statusPayload.recentContinuityAuditEntries[0]?.rolloutPath).toBe(rolloutPath);

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    const sharedBody = await fs.readFile(store.paths.sharedFile, "utf8");
    const localBody = await fs.readFile(store.paths.localFile, "utf8");
    expect(sharedBody).not.toContain("Reviewer or subagent prompt noise");
    expect(localBody).not.toContain("Reviewer or subagent prompt noise");
    expect(sharedBody).not.toContain("Focus on docs and contract surfaces only");
    expect(localBody).not.toContain("Focus on docs and contract surfaces only");
    expect(sharedBody).toContain("Redis must be running before integration tests.");
    expect(localBody).toContain("src/auth/middleware.ts");
  }, 30_000);

  it("keeps refresh provenance selection distinct from wrapper auto-save in the same scenario", async () => {
    const repoDir = await tempDir("cam-session-refresh-vs-wrapper-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-vs-wrapper-memory-");
    const sessionsDir = await tempDir("cam-session-refresh-vs-wrapper-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "15");
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;
    await fs.mkdir(dayDir, { recursive: true });
    await initRepo(repoDir);

    const mockCodexPath = await writeNoopCodexBinary(repoDir);
    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }
    );

    const recoveryRolloutPath = await writeSessionRolloutFile(
      path.join(repoDir, "recovery-rollout.jsonl"),
      rolloutFixture(repoDir, "Refresh should use the recovery provenance.", {
        sessionId: "session-recovery-shared"
      })
    );
    const auditRolloutPath = await writeSessionRolloutFile(
      path.join(repoDir, "audit-rollout.jsonl"),
      rolloutFixture(repoDir, "Refresh should use the audit provenance only if recovery is absent.", {
        sessionId: "session-audit-shared"
      })
    );
    const primaryRolloutPath = await writeSessionRolloutFile(
      path.join(dayDir, "rollout-primary.jsonl"),
      rolloutFixture(repoDir, "Wrapper auto-save should keep the real primary rollout.", {
        sessionId: "session-primary-shared"
      })
    );
    const subagentRolloutPath = await writeSessionRolloutFile(
      path.join(dayDir, "rollout-subagent.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-subagent-shared",
            forked_from_id: "session-primary-shared",
            timestamp: "2026-03-15T00:00:02.000Z",
            cwd: repoDir,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "session-primary-shared"
                }
              }
            }
          }
        }),
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-primary-shared",
            timestamp: "2026-03-15T00:00:01.000Z",
            cwd: repoDir,
            source: "cli"
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "You are reviewer sub-agent 4. Work read-only. Focus on docs and contract surfaces only."
          }
        })
      ].join("\n")
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: recoveryRolloutPath,
      sourceSessionId: "session-recovery-shared",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      writtenPaths: [store.paths.sharedFile, store.paths.localFile],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      failedStage: "audit-write",
      failureMessage: "stale recovery marker"
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-18T00:01:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      configuredExtractorMode: "heuristic",
      trigger: "manual-save",
      writeMode: "merge",
      scope: "both",
      rolloutPath: auditRolloutPath,
      sourceSessionId: "session-audit-shared",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: makeEvidenceCounts(),
      writtenPaths: ["/tmp/continuity-audit.md"]
    });

    const refreshPayload = JSON.parse(
      await runSession("refresh", { cwd: repoDir, scope: "both", json: true })
    ) as {
      rolloutPath: string;
      rolloutSelection: { kind: string; rolloutPath: string };
    };
    expect(refreshPayload).toMatchObject({
      rolloutPath: recoveryRolloutPath,
      rolloutSelection: {
        kind: "pending-recovery-marker",
        rolloutPath: recoveryRolloutPath
      }
    });

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const latestAudit = await store.readLatestAuditEntry();
    expect(latestAudit).toMatchObject({
      trigger: "wrapper-auto-save",
      writeMode: "merge",
      rolloutPath: primaryRolloutPath,
      sourceSessionId: "session-primary-shared"
    });
    expect(latestAudit?.rolloutPath).not.toBe(recoveryRolloutPath);
    expect(latestAudit?.rolloutPath).not.toBe(auditRolloutPath);
    expect(latestAudit?.rolloutPath).not.toBe(subagentRolloutPath);
  }, 30_000);

  it("rejects invalid scope values", async () => {
    const repoDir = await tempDir("cam-session-invalid-scope-repo-");
    const memoryRoot = await tempDir("cam-session-invalid-scope-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    await expect(
      runSession("status", {
        cwd: repoDir,
        scope: "invalid" as never
      })
    ).rejects.toThrow("Scope must be one of: project, project-local, both.");
  });

  it("adds resume context and dream sidecar summaries to session status json", async () => {
    const repoDir = await tempDir("cam-session-dream-repo-");
    const memoryRoot = await tempDir("cam-session-dream-memory-");
    await initRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "CLAUDE.md"), "# Project rules\n", "utf8");

    await writeProjectConfig(
      repoDir,
      configJson({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Continue the middleware retry work and document the fallback."),
      "utf8"
    );

    await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "both"
    });
    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });

    const statusPayload = JSON.parse(
      await runSession("status", {
        cwd: repoDir,
        json: true
      })
    ) as {
      resumeContext: {
        goal: string;
        instructionFiles: string[];
      };
      dreamSidecar: {
        enabled: boolean;
        status: string;
        suggestedRefCount: number;
      };
      instructionReviewLane: {
        latestCandidateId: string | null;
        latestProposalArtifactPath: string | null;
        selectedTargetFile: string | null;
        targetHost: string | null;
      };
    };

    expect(statusPayload.resumeContext.goal).toContain("middleware retry work");
    expect(
      statusPayload.resumeContext.instructionFiles.some((filePath) =>
        filePath.endsWith(`${path.sep}CLAUDE.md`)
      )
    ).toBe(true);
    expect(statusPayload.dreamSidecar).toMatchObject({
      enabled: true,
      status: "available"
    });
    expect(statusPayload.dreamSidecar.suggestedRefCount).toBeGreaterThanOrEqual(0);
    expect(statusPayload.instructionReviewLane).toMatchObject({
      latestCandidateId: null,
      latestProposalArtifactPath: null,
      selectedTargetFile: null,
      targetHost: null
    });
  });

  it("merges shared and local dream refs into the session resume context", async () => {
    const repoDir = await tempDir("cam-session-dream-merge-repo-");
    const memoryRoot = await tempDir("cam-session-dream-merge-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const memoryStore = new MemoryStore(detectProjectContext(repoDir), {
      ...configJson({
        dreamSidecarEnabled: true
      }),
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });
    await memoryStore.ensureLayout();
    await memoryStore.remember(
      "project",
      "workflow",
      "prefer-pnpm-shared",
      "Prefer pnpm from the shared workflow memory.",
      ["Use pnpm across the shared project workflow."],
      "Manual note."
    );

    const sharedRolloutPath = path.join(repoDir, "shared-rollout.jsonl");
    await fs.writeFile(
      sharedRolloutPath,
      rolloutFixture(repoDir, "Keep using pnpm for the shared middleware workflow."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: sharedRolloutPath,
      scope: "project",
      json: true
    });

    await memoryStore.remember(
      "project-local",
      "workflow",
      "prefer-pnpm-local",
      "Prefer pnpm for this local retry loop.",
      ["Use pnpm for the local worktree retry workflow."],
      "Manual note."
    );

    const localRolloutPath = path.join(repoDir, "local-rollout.jsonl");
    await fs.writeFile(
      localRolloutPath,
      rolloutFixture(repoDir, "Keep using pnpm for the local retry workflow."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: localRolloutPath,
      scope: "project-local",
      json: true
    });

    const statusPayload = JSON.parse(
      await runSession("status", {
        cwd: repoDir,
        json: true
      })
    ) as {
      resumeContext: {
        suggestedDurableRefs: Array<{ ref: string }>;
        topDurableRefs?: Array<{ ref: string }>;
      };
    };

    expect(statusPayload.resumeContext.suggestedDurableRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm-shared"
        }),
        expect.objectContaining({
          ref: "project-local:active:workflow:prefer-pnpm-local"
        })
      ])
    );
    expect(statusPayload.resumeContext.topDurableRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm-shared"
        })
      ])
    );
  });

  it("rejects save when no relevant rollout exists for the project", async () => {
    const repoDir = await tempDir("cam-session-missing-rollout-repo-");
    const memoryRoot = await tempDir("cam-session-missing-rollout-memory-");
    const sessionsDir = await tempDir("cam-session-missing-rollout-sessions-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    await expect(
      runSession("save", {
        cwd: repoDir,
        scope: "both"
      })
    ).rejects.toThrow("No relevant rollout found for this project.");
  });

  it("rejects save when the selected rollout cannot be parsed", async () => {
    const repoDir = await tempDir("cam-session-bad-rollout-repo-");
    const memoryRoot = await tempDir("cam-session-bad-rollout-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "broken-rollout.jsonl");
    await fs.writeFile(rolloutPath, "{\"type\":\"event_msg\"}\n", "utf8");

    await expect(
      runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both"
      })
    ).rejects.toThrow(`Could not parse rollout evidence from ${rolloutPath}.`);
  });

  it("supports clear --json from the command surface", async () => {
    const repoDir = await tempDir("cam-session-clear-json-repo-");
    const memoryRoot = await tempDir("cam-session-clear-json-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Write continuity before clearing it."),
      "utf8"
    );
    await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "both"
    });

    const payload = JSON.parse(
      await runSession("clear", {
        cwd: repoDir,
        scope: "both",
        json: true
      })
    ) as {
      cleared: string[];
    };

    expect(payload.cleared.length).toBeGreaterThan(0);
  });

  it("does not update local ignore when saving shared continuity only", async () => {
    const repoDir = await tempDir("cam-session-project-scope-repo-");
    const memoryRoot = await tempDir("cam-session-project-scope-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save shared continuity only."),
      "utf8"
    );

    const saveOutput = await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "project"
    });
    expect(saveOutput).not.toContain("Local exclude updated:");

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "project",
        json: true
      })
    ) as {
      excludePath: string | null;
      written: string[];
    };
    expect(saveJson.excludePath).toBeNull();
    expect(saveJson.written).toHaveLength(1);

    const excludePath = path.join(repoDir, ".git", "info", "exclude");
    const excludeContents = await fs.readFile(excludePath, "utf8");
    expect(excludeContents).not.toContain(".codex-auto-memory/");
    expect(excludeContents).not.toContain(".claude/sessions/");
  }, 30_000);

  it("keeps recent continuity history readable when the audit log contains a bad line", async () => {
    const repoDir = await tempDir("cam-session-bad-audit-repo-");
    const memoryRoot = await tempDir("cam-session-bad-audit-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-17T00:00:00.000Z",
      projectId: detectProjectContext(repoDir).projectId,
      worktreeId: detectProjectContext(repoDir).worktreeId,
      configuredExtractorMode: "heuristic",
      scope: "both",
      rolloutPath: "/tmp/rollout-good.jsonl",
      sourceSessionId: "session-good",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      writtenPaths: ["/tmp/continuity.md"]
    } satisfies SessionContinuityAuditEntry);
    await fs.appendFile(store.paths.auditFile, "{\"broken\":\n", "utf8");

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string; writtenPaths: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityAuditEntry?.writtenPaths).toEqual(["/tmp/continuity.md"]);
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(1);
    expect(loadJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe("/tmp/rollout-good.jsonl");

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string; writtenPaths: string[] } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(statusJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(statusJson.latestContinuityAuditEntry?.writtenPaths).toEqual(["/tmp/continuity.md"]);
    expect(statusJson.recentContinuityAuditEntries).toHaveLength(1);
    expect(statusJson.recentContinuityAuditEntries[0]?.rolloutPath).toBe("/tmp/rollout-good.jsonl");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Evidence: successful 1 | failed 0 | file writes 0 | next steps 1 | untried 0");
    expect(loadOutput).toContain("/tmp/continuity.md");
    expect(loadOutput).toContain("Recent prior generations:");
    expect(loadOutput).toContain("- none beyond latest");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Evidence: successful 1 | failed 0 | file writes 0 | next steps 1 | untried 0");
    expect(statusOutput).toContain("/tmp/continuity.md");
    expect(statusOutput).toContain("Recent prior generations:");
    expect(statusOutput).toContain("- none beyond latest");
  }, 30_000);

  it("keeps latest continuity audit separate from compact prior history and coalesces repeated prior entries", async () => {
    const repoDir = await tempDir("cam-session-compact-history-repo-");
    const memoryRoot = await tempDir("cam-session-compact-history-memory-");
    await initRepo(repoDir);
    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureAuditLayout();
    await fs.writeFile(
      store.paths.auditFile,
      [
        JSON.stringify({
          generatedAt: "2026-03-15T00:00:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-oldest.jsonl",
          sourceSessionId: "session-oldest",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 1,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-oldest.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:01:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-repeat.jsonl",
          sourceSessionId: "session-repeat",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 1,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-repeat.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:02:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-repeat.jsonl",
          sourceSessionId: "session-repeat",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 1,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-repeat.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:03:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-prior-b.jsonl",
          sourceSessionId: "session-prior-b",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 2,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-prior-b.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:04:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-prior-c.jsonl",
          sourceSessionId: "session-prior-c",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 3,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-prior-c.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:05:00.000Z",
          projectId: detectProjectContext(repoDir).projectId,
          worktreeId: detectProjectContext(repoDir).worktreeId,
          configuredExtractorMode: "heuristic",
          scope: "both",
          rolloutPath: "/tmp/rollout-latest.jsonl",
          sourceSessionId: "session-latest",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: {
            successfulCommands: 4,
            failedCommands: 0,
            fileWrites: 0,
            nextSteps: 1,
            untried: 0
          },
          writtenPaths: ["/tmp/continuity-latest.md"]
        } satisfies SessionContinuityAuditEntry)
      ].join("\n"),
      "utf8"
    );

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Recent prior generations:");
    expect(loadOutput).toContain("/tmp/rollout-repeat.jsonl");
    expect(loadOutput).toContain("Repeated similar generations hidden: 1");
    expect(loadOutput).toContain("- older generations omitted: 1");
    expect(loadOutput.match(/\/tmp\/rollout-latest\.jsonl/g) ?? []).toHaveLength(1);
  });

  it("does not coalesce save and refresh audit entries with the same rollout provenance", async () => {
    const repoDir = await tempDir("cam-session-refresh-history-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-history-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureAuditLayout();
    await fs.writeFile(
      store.paths.auditFile,
      [
        JSON.stringify({
          generatedAt: "2026-03-15T00:00:00.000Z",
          projectId: project.projectId,
          worktreeId: project.worktreeId,
          configuredExtractorMode: "heuristic",
          trigger: "manual-save",
          writeMode: "merge",
          scope: "both",
          rolloutPath: "/tmp/rollout-same.jsonl",
          sourceSessionId: "session-same",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: makeEvidenceCounts(),
          writtenPaths: ["/tmp/continuity-save.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:01:00.000Z",
          projectId: project.projectId,
          worktreeId: project.worktreeId,
          configuredExtractorMode: "heuristic",
          trigger: "manual-refresh",
          writeMode: "replace",
          scope: "both",
          rolloutPath: "/tmp/rollout-same.jsonl",
          sourceSessionId: "session-same",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: makeEvidenceCounts(),
          writtenPaths: ["/tmp/continuity-refresh.md"]
        } satisfies SessionContinuityAuditEntry),
        JSON.stringify({
          generatedAt: "2026-03-15T00:02:00.000Z",
          projectId: project.projectId,
          worktreeId: project.worktreeId,
          configuredExtractorMode: "heuristic",
          trigger: "manual-save",
          writeMode: "merge",
          scope: "both",
          rolloutPath: "/tmp/rollout-latest.jsonl",
          sourceSessionId: "session-latest",
          preferredPath: "heuristic",
          actualPath: "heuristic",
          fallbackReason: "configured-heuristic",
          evidenceCounts: makeEvidenceCounts(2),
          writtenPaths: ["/tmp/continuity-latest.md"]
        } satisfies SessionContinuityAuditEntry)
      ].join("\n"),
      "utf8"
    );

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput.match(/\/tmp\/rollout-same\.jsonl/g) ?? []).toHaveLength(2);
  });

  it("skips invalid-shaped continuity audit entries", async () => {
    const repoDir = await tempDir("cam-session-invalid-shape-repo-");
    const memoryRoot = await tempDir("cam-session-invalid-shape-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.appendAuditLog({
      generatedAt: "2026-03-17T00:00:00.000Z",
      projectId: detectProjectContext(repoDir).projectId,
      worktreeId: detectProjectContext(repoDir).worktreeId,
      configuredExtractorMode: "heuristic",
      scope: "both",
      rolloutPath: "/tmp/rollout-good.jsonl",
      sourceSessionId: "session-good",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      writtenPaths: ["/tmp/continuity.md"]
    } satisfies SessionContinuityAuditEntry);
    await fs.appendFile(
      store.paths.auditFile,
      `${JSON.stringify({
        generatedAt: "2026-03-17T01:00:00.000Z",
        rolloutPath: "/tmp/rollout-invalid.jsonl",
        actualPath: "heuristic"
      })}\n`,
      "utf8"
    );

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: { rolloutPath: string } | null;
      latestContinuityDiagnostics: { rolloutPath: string; actualPath: string } | null;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityDiagnostics?.rolloutPath).toBe("/tmp/rollout-good.jsonl");
    expect(loadJson.latestContinuityDiagnostics?.actualPath).toBe("heuristic");
    expect(loadJson.recentContinuityAuditEntries).toHaveLength(1);

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("/tmp/rollout-good.jsonl");
    expect(statusOutput).not.toContain("/tmp/rollout-invalid.jsonl");
  }, 30_000);

  it("keeps reading legacy audit and recovery records that do not include trigger or writeMode", async () => {
    const repoDir = await tempDir("cam-session-legacy-audit-repo-");
    const memoryRoot = await tempDir("cam-session-legacy-audit-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureAuditLayout();
    await fs.writeFile(
      store.paths.auditFile,
      `${JSON.stringify({
        generatedAt: "2026-03-17T00:00:00.000Z",
        projectId: project.projectId,
        worktreeId: project.worktreeId,
        configuredExtractorMode: "heuristic",
        scope: "both",
        rolloutPath: "/tmp/rollout-legacy.jsonl",
        sourceSessionId: "session-legacy",
        preferredPath: "heuristic",
        actualPath: "heuristic",
        fallbackReason: "configured-heuristic",
        evidenceCounts: makeEvidenceCounts(),
        writtenPaths: ["/tmp/legacy-continuity.md"]
      })}\n`,
      "utf8"
    );
    await fs.writeFile(
      store.getRecoveryPath(),
      JSON.stringify({
        recordedAt: "2026-03-17T00:01:00.000Z",
        projectId: project.projectId,
        worktreeId: project.worktreeId,
        rolloutPath: "/tmp/rollout-legacy-recovery.jsonl",
        sourceSessionId: "session-legacy-recovery",
        scope: "both",
        writtenPaths: ["/tmp/legacy-recovery.md"],
        preferredPath: "heuristic",
        actualPath: "heuristic",
        evidenceCounts: makeEvidenceCounts(),
        failedStage: "audit-write",
        failureMessage: "legacy recovery marker"
      }),
      "utf8"
    );

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityAuditEntry: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
      } | null;
      latestContinuityDiagnostics: {
        confidence: string;
        warnings: string[];
        fallbackReason?: string;
      } | null;
      pendingContinuityRecovery: {
        rolloutPath: string;
        trigger?: string;
        writeMode?: string;
        confidence?: string;
        warnings?: string[];
      } | null;
    };
    expect(loadJson.latestContinuityAuditEntry?.rolloutPath).toBe("/tmp/rollout-legacy.jsonl");
    expect(loadJson.latestContinuityAuditEntry?.trigger).toBeUndefined();
    expect(loadJson.latestContinuityAuditEntry?.writeMode).toBeUndefined();
    expect(loadJson.latestContinuityDiagnostics?.confidence).toBe("low");
    expect(loadJson.latestContinuityDiagnostics?.warnings).toEqual([]);
    expect(loadJson.latestContinuityDiagnostics?.fallbackReason).toBe("configured-heuristic");
    expect(loadJson.pendingContinuityRecovery?.rolloutPath).toBe(
      "/tmp/rollout-legacy-recovery.jsonl"
    );
    expect(loadJson.pendingContinuityRecovery?.trigger).toBeUndefined();
    expect(loadJson.pendingContinuityRecovery?.writeMode).toBeUndefined();
    expect(loadJson.pendingContinuityRecovery?.confidence).toBe("high");
    expect(loadJson.pendingContinuityRecovery?.warnings).toEqual([]);

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("/tmp/rollout-legacy.jsonl");
    expect(statusOutput).toContain("/tmp/rollout-legacy-recovery.jsonl");
    expect(statusOutput).toContain("preferred heuristic | confidence high");
  }, 30_000);

  it("normalizes legacy audit and recovery warnings into json and text outputs", async () => {
    const repoDir = await tempDir("cam-session-legacy-warning-repo-");
    const memoryRoot = await tempDir("cam-session-legacy-warning-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const auditWarning = "Legacy audit reviewer warning.";
    const recoveryWarning = "Legacy recovery reviewer warning.";
    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureAuditLayout();
    await fs.writeFile(
      store.paths.auditFile,
      `${JSON.stringify({
        generatedAt: "2026-03-17T00:00:00.000Z",
        projectId: project.projectId,
        worktreeId: project.worktreeId,
        configuredExtractorMode: "heuristic",
        scope: "both",
        rolloutPath: "/tmp/rollout-legacy-warning.jsonl",
        sourceSessionId: "session-legacy-warning",
        preferredPath: "heuristic",
        actualPath: "heuristic",
        warnings: [auditWarning],
        evidenceCounts: makeEvidenceCounts(),
        writtenPaths: ["/tmp/legacy-warning-continuity.md"]
      })}\n`,
      "utf8"
    );
    await fs.writeFile(
      store.getRecoveryPath(),
      JSON.stringify({
        recordedAt: "2026-03-17T00:01:00.000Z",
        projectId: project.projectId,
        worktreeId: project.worktreeId,
        rolloutPath: "/tmp/rollout-legacy-warning-recovery.jsonl",
        sourceSessionId: "session-legacy-warning-recovery",
        scope: "both",
        writtenPaths: ["/tmp/legacy-warning-recovery.md"],
        preferredPath: "heuristic",
        actualPath: "heuristic",
        warnings: [recoveryWarning],
        evidenceCounts: makeEvidenceCounts(),
        failedStage: "audit-write",
        failureMessage: "legacy warning recovery marker"
      }),
      "utf8"
    );

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
      pendingContinuityRecovery: {
        confidence?: string;
        warnings?: string[];
      } | null;
    };
    expect(loadJson.latestContinuityDiagnostics?.confidence).toBe("medium");
    expect(loadJson.latestContinuityDiagnostics?.warnings).toEqual([auditWarning]);
    expect(loadJson.pendingContinuityRecovery?.confidence).toBe("medium");
    expect(loadJson.pendingContinuityRecovery?.warnings).toEqual([recoveryWarning]);

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      latestContinuityDiagnostics: { confidence: string; warnings: string[] } | null;
      pendingContinuityRecovery: {
        confidence?: string;
        warnings?: string[];
      } | null;
    };
    expect(statusJson.latestContinuityDiagnostics?.confidence).toBe("medium");
    expect(statusJson.latestContinuityDiagnostics?.warnings).toEqual([auditWarning]);
    expect(statusJson.pendingContinuityRecovery?.confidence).toBe("medium");
    expect(statusJson.pendingContinuityRecovery?.warnings).toEqual([recoveryWarning]);

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Warnings:");
    expect(loadOutput).toContain(auditWarning);
    expect(loadOutput).toContain(`- Warning: ${recoveryWarning}`);
    expect(loadOutput).toContain("confidence medium");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).toContain("Warnings:");
    expect(statusOutput).toContain(auditWarning);
    expect(statusOutput).toContain(`- Warning: ${recoveryWarning}`);
    expect(statusOutput).toContain("confidence medium");
  }, 30_000);

  it("writes and surfaces a continuity recovery marker when audit persistence fails", async () => {
    const repoDir = await tempDir("cam-session-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Persist continuity even if audit append fails."),
      "utf8"
    );

    const appendAuditSpy = vi
      .spyOn(SessionContinuityStore.prototype, "appendAuditLog")
      .mockRejectedValueOnce(new Error("continuity audit write failed"));

    await expect(
      runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both"
      })
    ).rejects.toThrow("continuity audit write failed");
    appendAuditSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath,
      failedStage: "audit-write",
      failureMessage: "continuity audit write failed",
      scope: "both"
    });

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: {
        rolloutPath: string;
        sourceSessionId: string;
        scope: string;
        writtenPaths: string[];
        preferredPath: string;
        actualPath: string;
        evidenceCounts: {
          successfulCommands: number;
          failedCommands: number;
          fileWrites: number;
          nextSteps: number;
          untried: number;
        };
        failedStage: string;
        failureMessage: string;
      } | null;
      continuityRecoveryPath: string;
      recentContinuityAuditEntries: Array<{ rolloutPath: string }>;
    };
    expect(loadJson.pendingContinuityRecovery).toMatchObject({
      rolloutPath,
      sourceSessionId: "session-1",
      scope: "both",
      preferredPath: "heuristic",
      actualPath: "heuristic",
      failedStage: "audit-write",
      failureMessage: "continuity audit write failed"
    });
    expect(loadJson.pendingContinuityRecovery?.writtenPaths).toHaveLength(2);
    expect(loadJson.pendingContinuityRecovery?.evidenceCounts.successfulCommands).toBeGreaterThan(0);
    expect(loadJson.continuityRecoveryPath).toContain("session-continuity-recovery.json");
    expect(loadJson.recentContinuityAuditEntries).toEqual([]);

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: {
        rolloutPath: string;
        sourceSessionId: string;
        writtenPaths: string[];
      } | null;
      continuityRecoveryPath: string;
    };
    expect(statusJson.pendingContinuityRecovery).toMatchObject({
      rolloutPath,
      sourceSessionId: "session-1"
    });
    expect(statusJson.pendingContinuityRecovery?.writtenPaths).toHaveLength(2);
    expect(statusJson.continuityRecoveryPath).toContain("session-continuity-recovery.json");

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).toContain("Pending continuity recovery:");
    expect(loadOutput).toContain("continuity audit write failed");
    expect(loadOutput).toContain(rolloutPath);

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(saveJson.pendingContinuityRecovery).toBeNull();
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("writes a summary-write recovery marker when continuity summary persistence fails", async () => {
    const repoDir = await tempDir("cam-session-summary-write-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-summary-write-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Fail continuity summary writes before audit append."),
      "utf8"
    );

    const saveSummarySpy = vi
      .spyOn(SessionContinuityStore.prototype, "saveSummary")
      .mockRejectedValueOnce(new Error("continuity summary write failed"));

    await expect(
      runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both"
      })
    ).rejects.toThrow("continuity summary write failed");
    saveSummarySpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath,
      failedStage: "summary-write",
      failureMessage: "continuity summary write failed",
      scope: "both",
      writtenPaths: []
    });
    expect(await store.readLatestAuditEntry()).toBeNull();
  }, 30_000);

  it("writes a summary-write recovery marker when refresh replacement fails", async () => {
    const repoDir = await tempDir("cam-session-refresh-summary-write-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-refresh-summary-write-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(repoDir, configJson(), {
      autoMemoryDirectory: memoryRoot
    });

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Fail continuity replacement writes before audit append."),
      "utf8"
    );

    const replaceSummarySpy = vi
      .spyOn(SessionContinuityStore.prototype, "replaceSummary")
      .mockRejectedValueOnce(new Error("continuity replace write failed"));

    await expect(
      runSession("refresh", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both"
      })
    ).rejects.toThrow("continuity replace write failed");
    replaceSummarySpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath,
      failedStage: "summary-write",
      failureMessage: "continuity replace write failed",
      scope: "both",
      writtenPaths: []
    });
    expect(await store.readLatestAuditEntry()).toBeNull();
  }, 30_000);

  it("does not clear an unrelated continuity recovery marker after a successful save", async () => {
    const repoDir = await tempDir("cam-session-stale-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-stale-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Save continuity while preserving an unrelated marker."),
      "utf8"
    );

    const project = detectProjectContext(repoDir);
    const store = new SessionContinuityStore(project, {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await store.writeRecoveryRecord({
      recordedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session",
      scope: "both",
      writtenPaths: ["/tmp/stale-continuity.md"],
      preferredPath: "heuristic",
      actualPath: "heuristic",
      fallbackReason: "configured-heuristic",
      evidenceCounts: {
        successfulCommands: 1,
        failedCommands: 0,
        fileWrites: 0,
        nextSteps: 1,
        untried: 0
      },
      failedStage: "audit-write",
      failureMessage: "stale marker"
    });

    const saveJson = JSON.parse(
      await runSession("save", {
        cwd: repoDir,
        rollout: rolloutPath,
        scope: "both",
        json: true
      })
    ) as {
      pendingContinuityRecovery: { rolloutPath: string; sourceSessionId: string } | null;
    };

    expect(saveJson.pendingContinuityRecovery).toMatchObject({
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session"
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      rolloutPath: "/tmp/stale-rollout.jsonl",
      sourceSessionId: "stale-session"
    });
  }, 30_000);

  it("ignores a corrupted continuity recovery marker instead of crashing load or status", async () => {
    const repoDir = await tempDir("cam-session-bad-recovery-repo-");
    const memoryRoot = await tempDir("cam-session-bad-recovery-memory-");
    await initRepo(repoDir);

    await writeProjectConfig(
      repoDir,
      configJson(),
      { autoMemoryDirectory: memoryRoot }
    );

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    await fs.mkdir(path.dirname(store.getRecoveryPath()), { recursive: true });
    await fs.writeFile(store.getRecoveryPath(), "{\"broken\":\n", "utf8");

    const loadJson = JSON.parse(
      await runSession("load", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(loadJson.pendingContinuityRecovery).toBeNull();

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as {
      pendingContinuityRecovery: object | null;
    };
    expect(statusJson.pendingContinuityRecovery).toBeNull();

    const loadOutput = await runSession("load", { cwd: repoDir });
    expect(loadOutput).not.toContain("Pending continuity recovery:");

    const statusOutput = await runSession("status", { cwd: repoDir });
    expect(statusOutput).not.toContain("Pending continuity recovery:");
  }, 30_000);
});
