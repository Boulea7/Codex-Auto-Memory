import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDream } from "../src/lib/commands/dream.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { sanitizePublicPath } from "../src/lib/util/public-paths.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";
import { minimalCommandPath, runCli } from "./helpers/cli-runner.js";

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

function resolvePublicPathForTest(
  publicPath: string,
  context: {
    projectRoot?: string;
    memoryRoot?: string;
    cwd?: string;
    homeDir?: string;
  }
): string {
  const roots = [
    ["<project-root>", context.projectRoot],
    ["<memory-root>", context.memoryRoot],
    ["<cwd>", context.cwd],
    ["<home>", context.homeDir]
  ] as const;

  for (const [label, root] of roots) {
    if (!root) {
      continue;
    }
    if (publicPath === label) {
      return root;
    }
    if (publicPath.startsWith(`${label}${path.sep}`)) {
      return path.join(root, publicPath.slice(label.length + 1));
    }
  }

  return publicPath;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("doctor command", () => {
  it("ignores codexBinary from shared project config and does not execute a repo-owned binary", async () => {
    const homeDir = await tempDir("cam-doctor-ignored-project-codex-home-");
    const projectDir = await tempDir("cam-doctor-ignored-project-codex-project-");
    const memoryRoot = await tempDir("cam-doctor-ignored-project-codex-memory-");
    process.env.HOME = homeDir;

    const fakeCodexPath = path.join(projectDir, "fake-codex");
    const proofPath = path.join(projectDir, "fake-codex-proof.txt");
    await fs.writeFile(
      fakeCodexPath,
      `#!/bin/sh
printf 'repo-owned binary ran\\n' > ${JSON.stringify(proofPath)}
exit 0
`,
      "utf8"
    );
    await fs.chmod(fakeCodexPath, 0o755);

    await writeCamConfig(
      projectDir,
      {
        ...makeAppConfig(),
        codexBinary: fakeCodexPath
      },
      {
        autoMemoryDirectory: memoryRoot,
        codexBinary: "codex"
      }
    );

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: {
        HOME: homeDir,
        PATH: minimalCommandPath()
      }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      warnings: string[];
    };

    expect(payload.warnings.join("\n")).toContain("Ignored codexBinary");
    expect(await pathExists(proofPath)).toBe(false);
  });

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

    expect(payload.memoryRoot).toBe(
      sanitizePublicPath(memoryRoot, {
        projectRoot: projectDir,
        memoryRoot
      })
    );
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
        PATH: minimalCommandPath()
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

  it("surfaces instruction proposal lane diagnostics when proposal artifacts exist", async () => {
    const homeDir = await tempDir("cam-doctor-instruction-home-");
    const projectDir = await tempDir("cam-doctor-instruction-project-");
    const memoryRoot = await tempDir("cam-doctor-instruction-memory-");
    process.env.HOME = homeDir;

    await fs.writeFile(path.join(projectDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      projectDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(projectDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-doctor-instruction",
            timestamp: "2026-03-15T00:00:00.000Z",
            cwd: projectDir
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Always run pnpm lint before pnpm build."
          }
        })
      ].join("\n"),
      "utf8"
    );

    await runDream("build", {
      cwd: projectDir,
      rollout: rolloutPath,
      json: true
    });
    const candidatePayload = JSON.parse(
      await runDream("candidates", {
        cwd: projectDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; targetSurface: string }>;
    };
    const instructionCandidate = candidatePayload.entries.find(
      (entry) => entry.targetSurface === "instruction-memory"
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });
    await runDream("promote-prep", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      json: true
    });

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      instructionProposalLane?: {
        status: string;
        latestCandidateId: string | null;
        latestProposalArtifactPath: string | null;
        selectedTargetFile: string | null;
        selectedTargetKind: string | null;
        targetHost: string | null;
        applyReadinessStatus: string | null;
        detectedTargets: string[];
        recommendedInspectCommand: string;
        recommendedApplyPrepCommand: string;
        recommendedVerifyApplyCommand: string;
      };
    };

    expect(payload.instructionProposalLane).toMatchObject({
      status: "warning",
      latestCandidateId: instructionCandidate!.candidateId,
      latestProposalArtifactPath: expect.stringContaining(
        `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
      ),
      selectedTargetFile: expect.stringContaining(`${path.sep}AGENTS.md`),
      selectedTargetKind: "agents-root",
      targetHost: "shared",
      applyReadinessStatus: "safe",
      detectedTargets: [expect.stringContaining(`${path.sep}AGENTS.md`)],
      recommendedInspectCommand: expect.stringContaining("dream proposal --candidate-id"),
      recommendedApplyPrepCommand: expect.stringContaining("dream apply-prep --candidate-id"),
      recommendedVerifyApplyCommand: expect.stringContaining("dream candidates --json")
    });
  });

  it("ignores rejected instruction proposal artifacts when recommending follow-up", async () => {
    const homeDir = await tempDir("cam-doctor-instruction-filter-home-");
    const projectDir = await tempDir("cam-doctor-instruction-filter-project-");
    const memoryRoot = await tempDir("cam-doctor-instruction-filter-memory-");
    process.env.HOME = homeDir;

    await fs.writeFile(path.join(projectDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      projectDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(projectDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-doctor-instruction-filter",
            timestamp: "2026-03-15T00:00:00.000Z",
            cwd: projectDir
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Always run pnpm lint before pnpm build."
          }
        })
      ].join("\n"),
      "utf8"
    );

    await runDream("build", {
      cwd: projectDir,
      rollout: rolloutPath,
      json: true
    });
    const candidatePayload = JSON.parse(
      await runDream("candidates", {
        cwd: projectDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; targetSurface: string }>;
    };
    const instructionCandidate = candidatePayload.entries.find(
      (entry) => entry.targetSurface === "instruction-memory"
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });
    await runDream("promote-prep", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      json: true
    });
    await runDream("review", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      reject: true,
      json: true
    });

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      instructionProposalLane?: {
        status: string;
        latestProposalArtifactPath: string | null;
        recommendedApplyPrepCommand: string;
      };
    };

    expect(payload.instructionProposalLane).toMatchObject({
      status: "ok",
      latestProposalArtifactPath: null,
      recommendedApplyPrepCommand: expect.stringContaining("dream candidates --json")
    });
  });

  it("fails closed when the latest instruction proposal artifact is unreadable", async () => {
    const homeDir = await tempDir("cam-doctor-instruction-broken-home-");
    const projectDir = await tempDir("cam-doctor-instruction-broken-project-");
    const memoryRoot = await tempDir("cam-doctor-instruction-broken-memory-");
    process.env.HOME = homeDir;

    await fs.writeFile(path.join(projectDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      projectDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(projectDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-doctor-instruction-broken",
            timestamp: "2026-03-15T00:00:00.000Z",
            cwd: projectDir
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Always run pnpm lint before pnpm build."
          }
        })
      ].join("\n"),
      "utf8"
    );

    await runDream("build", {
      cwd: projectDir,
      rollout: rolloutPath,
      json: true
    });
    const candidatePayload = JSON.parse(
      await runDream("candidates", {
        cwd: projectDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; targetSurface: string }>;
    };
    const instructionCandidate = candidatePayload.entries.find(
      (entry) => entry.targetSurface === "instruction-memory"
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: projectDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });

    const promotePayload = JSON.parse(
      await runDream("promote", {
        cwd: projectDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      instructionProposal: {
        artifactPath: string;
      };
    };
    await fs.writeFile(
      resolvePublicPathForTest(promotePayload.instructionProposal.artifactPath, {
        projectRoot: projectDir,
        memoryRoot,
        homeDir
      }),
      "{broken",
      "utf8"
    );

    const result = runCli(projectDir, ["doctor", "--json"], {
      env: { HOME: homeDir }
    });
    expect(result.exitCode, result.stderr).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      instructionProposalLane?: {
        latestCandidateId: string | null;
        latestProposalArtifactPath: string | null;
        selectedTargetFile: string | null;
        selectedTargetKind: string | null;
        targetHost: string | null;
        applyReadinessStatus: string | null;
        recommendedInspectCommand: string;
        recommendedApplyPrepCommand: string;
        recommendedVerifyApplyCommand: string;
      };
    };

    expect(payload.instructionProposalLane).toMatchObject({
      latestCandidateId: null,
      latestProposalArtifactPath: null,
      selectedTargetFile: null,
      selectedTargetKind: null,
      targetHost: null,
      applyReadinessStatus: null,
      recommendedInspectCommand: expect.stringContaining("dream candidates --json"),
      recommendedApplyPrepCommand: expect.stringContaining("dream candidates --json"),
      recommendedVerifyApplyCommand: expect.stringContaining("dream candidates --json")
    });
  });
});
