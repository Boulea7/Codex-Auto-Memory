import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as toml from "smol-toml";
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
import { connectCliMcpClient } from "./helpers/mcp-client.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeCamShim(binDir: string): Promise<void> {
  if (process.platform === "win32") {
    await fs.writeFile(path.join(binDir, "cam.cmd"), "@echo off\r\nexit /b 0\r\n", "utf8");
    return;
  }

  const shimPath = path.join(binDir, "cam");
  await fs.writeFile(shimPath, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(shimPath, 0o755);
}

async function waitForFile(pathname: string, timeoutMs = 2_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await fs.readFile(pathname, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT" &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      throw error;
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function subagentRolloutFixture(
  projectDir: string,
  message: string,
  sessionId: string,
  parentSessionId = "session-dist-primary"
): string {
  return [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        forked_from_id: parentSessionId,
        timestamp: "2026-03-15T00:07:00.000Z",
        cwd: projectDir,
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: parentSessionId
            }
          }
        }
      }
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message
      }
    })
  ].join("\n");
}

afterEach(async () => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
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

  it("surfaces the top-level doctor json contract from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-doctor-home-");
    const projectDir = await tempDir("cam-dist-doctor-project-");
    const memoryRootParent = await tempDir("cam-dist-doctor-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["doctor", "--json"], {
      entrypoint: "dist",
      env: {
        HOME: homeDir,
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`
      }
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      recommendedRoute: "companion",
      recommendedActionCommand: expect.stringContaining("mcp doctor --host codex"),
      recommendedDoctorCommand: expect.stringContaining("doctor --json"),
      retrievalSidecar: {
        status: "warning"
      },
      readiness: {
        appServer: null
      }
    });
  });

  it("serves reviewer json surfaces from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-home-");
    const projectDir = await tempDir("cam-dist-project-");
    const memoryRoot = await tempDir("cam-dist-memory-root-");
    const cliEnv = { HOME: homeDir };

    const config = makeAppConfig({
      dreamSidecarEnabled: true
    });
    await writeCamConfig(projectDir, config, {
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });
    await fs.writeFile(path.join(projectDir, "CLAUDE.md"), "# Project rules\n", "utf8");

    const project = detectProjectContext(projectDir);
    const memoryStore = new MemoryStore(project, {
      ...config,
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
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
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-dist-dream",
          timestamp: "2026-04-12T10:00:00.000Z",
          cwd: projectDir
        }
      }) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Continue the release smoke review and keep using pnpm in this repository."
          }
        }) +
        "\n",
      "utf8"
    );

    const dreamBuildResult = runCli(
      projectDir,
      ["dream", "build", "--rollout", rolloutPath, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );

    const memoryResult = runCli(projectDir, ["memory", "--recent", "1", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });
    const sessionResult = runCli(projectDir, ["session", "status", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });
    const sessionLoadResult = runCli(
      projectDir,
      ["session", "load", "--json", "--print-startup"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    const rememberResult = runCli(
      projectDir,
      ["remember", "Keep release smoke on pnpm.", "--scope", "project", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    const forgetResult = runCli(
      projectDir,
      ["forget", "release smoke", "--scope", "project", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    const recallResult = runCli(projectDir, ["recall", "search", "pnpm", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });
    const dreamInspectResult = runCli(projectDir, ["dream", "inspect", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });

    expect(dreamBuildResult.exitCode, dreamBuildResult.stderr).toBe(0);
    expect(memoryResult.exitCode, memoryResult.stderr).toBe(0);
    expect(sessionResult.exitCode, sessionResult.stderr).toBe(0);
    expect(sessionLoadResult.exitCode, sessionLoadResult.stderr).toBe(0);
    expect(rememberResult.exitCode, rememberResult.stderr).toBe(0);
    expect(forgetResult.exitCode, forgetResult.stderr).toBe(0);
    expect(recallResult.exitCode, recallResult.stderr).toBe(0);
    expect(dreamInspectResult.exitCode, dreamInspectResult.stderr).toBe(0);

    const memoryPayload = JSON.parse(memoryResult.stdout) as {
      recentSyncAudit: Array<{ rolloutPath: string }>;
      dreamSidecar: {
        enabled: boolean;
        status: string;
      };
    };
    const sessionPayload = JSON.parse(sessionResult.stdout) as {
      projectLocation: { exists: boolean };
      latestContinuityDiagnostics: { confidence: string; fallbackReason?: string | null } | null;
      resumeContext: {
        goal: string;
        instructionFiles: string[];
        suggestedDurableRefs: Array<{ ref: string }>;
      };
      dreamSidecar: {
        enabled: boolean;
        status: string;
      };
    };
    const sessionLoadPayload = JSON.parse(sessionLoadResult.stdout) as {
      startup: {
        continuityMode: string;
        continuityProvenanceKind: string;
        sourceFiles: string[];
        candidateSourceFiles: string[];
        continuitySectionKinds: string[];
        continuitySourceKinds: string[];
        sectionsRendered: { sources: boolean; goal: boolean };
        omissionCounts: Record<string, number>;
        futureCompactionSeam: { kind: string; rebuildsStartupSections: boolean };
      };
      latestContinuityDiagnostics: { confidence: string; fallbackReason?: string | null } | null;
      resumeContext: {
        suggestedDurableRefs: Array<{ ref: string }>;
      };
      dreamSidecar: {
        enabled: boolean;
        status: string;
      };
    };
    const rememberPayload = JSON.parse(rememberResult.stdout) as {
      mutationKind: string;
      latestAppliedLifecycle: { action: string } | null;
      followUp: { timelineRefs: string[]; detailsRefs: string[] };
    };
    const forgetPayload = JSON.parse(forgetResult.stdout) as {
      mutationKind: string;
      latestAppliedLifecycle: { action: string } | null;
      followUp: { timelineRefs: string[]; detailsRefs: string[] };
    };
    const recallPayload = JSON.parse(recallResult.stdout) as {
      querySurfacing: {
        suggestedDreamRefs: Array<{ ref: string; reason: string }>;
        suggestedInstructionFiles: string[];
      };
    };
    const dreamBuildPayload = JSON.parse(dreamBuildResult.stdout) as {
      action: string;
      snapshot: {
        promotionCandidates: {
          instructionLikeCandidates: unknown[];
          durableMemoryCandidates: unknown[];
        };
      };
    };
    const dreamInspectPayload = JSON.parse(dreamInspectResult.stdout) as {
      enabled: boolean;
      snapshots: {
        project: {
          status: string;
          latestPath: string | null;
        };
      };
    };
    const durableDreamRolloutPath = path.join(projectDir, "dream-durable-rollout.jsonl");
    await fs.writeFile(
      durableDreamRolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-dist-dream-durable",
          timestamp: "2026-03-15T00:05:00.000Z",
          cwd: projectDir
        }
      }) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "The runbook lives at https://docs.example.com/runbook. Continue the release-facing CLI surface."
          }
        }) +
        "\n",
      "utf8"
    );
    const durableDreamBuildResult = runCli(
      projectDir,
      ["dream", "build", "--rollout", durableDreamRolloutPath, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(durableDreamBuildResult.exitCode, durableDreamBuildResult.stderr).toBe(0);

    const dreamCandidatesResult = runCli(projectDir, ["dream", "candidates", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });
    expect(dreamCandidatesResult.exitCode, dreamCandidatesResult.stderr).toBe(0);
    const dreamCandidatesPayload = JSON.parse(dreamCandidatesResult.stdout) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
        summary: string;
      }>;
    };
    const durableCandidate = dreamCandidatesPayload.entries.find(
      (entry) =>
        entry.targetSurface === "durable-memory" && entry.summary.includes("runbook lives")
    );
    expect(durableCandidate).toBeDefined();

    const dreamReviewResult = runCli(
      projectDir,
      ["dream", "review", "--candidate-id", durableCandidate!.candidateId, "--approve", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(dreamReviewResult.exitCode, dreamReviewResult.stderr).toBe(0);

    const dreamPromoteResult = runCli(
      projectDir,
      ["dream", "promote", "--candidate-id", durableCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(dreamPromoteResult.exitCode, dreamPromoteResult.stderr).toBe(0);
    expect(JSON.parse(dreamPromoteResult.stdout)).toMatchObject({
      action: "promote",
      promotionOutcome: "applied",
      entry: {
        candidateId: durableCandidate!.candidateId,
        status: "promoted",
        targetSurface: "durable-memory"
      },
      durableMemory: {
        ref: expect.stringContaining("project:active:")
      }
    });

    const blockedSubagentRolloutPath = path.join(projectDir, "dream-subagent-rollout.jsonl");
    await fs.writeFile(
      blockedSubagentRolloutPath,
      subagentRolloutFixture(
        projectDir,
        "The subagent runbook lives at https://docs.example.com/subagent-runbook.",
        "session-dist-dream-subagent"
      ),
      "utf8"
    );
    const blockedSubagentBuildResult = runCli(
      projectDir,
      ["dream", "build", "--rollout", blockedSubagentRolloutPath, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(blockedSubagentBuildResult.exitCode, blockedSubagentBuildResult.stderr).toBe(0);

    const blockedSubagentCandidatesResult = runCli(
      projectDir,
      [
        "dream",
        "candidates",
        "--origin-kind",
        "subagent",
        "--target-surface",
        "durable-memory",
        "--json"
      ],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(blockedSubagentCandidatesResult.exitCode, blockedSubagentCandidatesResult.stderr).toBe(0);
    const blockedSubagentCandidatesPayload = JSON.parse(blockedSubagentCandidatesResult.stdout) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
        originKind: string;
        status: string;
        summary: string;
      }>;
    };
    const blockedSubagentCandidate = blockedSubagentCandidatesPayload.entries.find(
      (entry) => entry.summary.includes("subagent runbook")
    );
    expect(blockedSubagentCandidate).toMatchObject({
      targetSurface: "durable-memory",
      originKind: "subagent",
      status: "blocked"
    });

    const dreamAdoptResult = runCli(
      projectDir,
      ["dream", "adopt", "--candidate-id", blockedSubagentCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(dreamAdoptResult.exitCode, dreamAdoptResult.stderr).toBe(0);
    expect(JSON.parse(dreamAdoptResult.stdout)).toMatchObject({
      action: "adopt",
      entry: {
        candidateId: blockedSubagentCandidate!.candidateId,
        status: "pending",
        originKind: "subagent",
        adoption: {
          adoptionKind: "manual",
          adoptedFromBlockedSubagent: true
        }
      }
    });

    const adoptedSubagentReviewResult = runCli(
      projectDir,
      ["dream", "review", "--candidate-id", blockedSubagentCandidate!.candidateId, "--approve", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(adoptedSubagentReviewResult.exitCode, adoptedSubagentReviewResult.stderr).toBe(0);
    expect(JSON.parse(adoptedSubagentReviewResult.stdout)).toMatchObject({
      action: "review",
      entry: {
        candidateId: blockedSubagentCandidate!.candidateId,
        status: "approved"
      }
    });

    const adoptedSubagentPromotePrepResult = runCli(
      projectDir,
      ["dream", "promote-prep", "--candidate-id", blockedSubagentCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(adoptedSubagentPromotePrepResult.exitCode, adoptedSubagentPromotePrepResult.stderr).toBe(0);
    expect(JSON.parse(adoptedSubagentPromotePrepResult.stdout)).toMatchObject({
      action: "promote-prep",
      entry: {
        candidateId: blockedSubagentCandidate!.candidateId,
        originKind: "subagent"
      },
      resolvedTarget: {
        targetSurface: "durable-memory",
        scope: "project"
      },
      preview: {
        lifecycleAction: "add",
        wouldWrite: true,
        ref: expect.stringContaining("project:active:"),
        targetPath: expect.stringContaining(`${path.sep}reference.md`)
      }
    });

    const instructionDreamRolloutPath = path.join(projectDir, "dream-instruction-rollout.jsonl");
    await fs.writeFile(
      instructionDreamRolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-dist-dream-instruction",
          timestamp: "2026-03-15T00:06:00.000Z",
          cwd: projectDir
        }
      }) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Always run pnpm test before build in this repository."
          }
        }) +
        "\n",
      "utf8"
    );
    const instructionDreamBuildResult = runCli(
      projectDir,
      ["dream", "build", "--rollout", instructionDreamRolloutPath, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(instructionDreamBuildResult.exitCode, instructionDreamBuildResult.stderr).toBe(0);

    const instructionCandidatesResult = runCli(projectDir, ["dream", "candidates", "--json"], {
      entrypoint: "dist",
      env: cliEnv
    });
    expect(instructionCandidatesResult.exitCode, instructionCandidatesResult.stderr).toBe(0);
    const instructionCandidatesPayload = JSON.parse(instructionCandidatesResult.stdout) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
        summary: string;
      }>;
    };
    const instructionCandidate = instructionCandidatesPayload.entries.find(
      (entry) =>
        entry.targetSurface === "instruction-memory" &&
        entry.summary.includes("Always run pnpm test before build")
    );
    expect(instructionCandidate).toBeDefined();

    const instructionReviewResult = runCli(
      projectDir,
      ["dream", "review", "--candidate-id", instructionCandidate!.candidateId, "--approve", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(instructionReviewResult.exitCode, instructionReviewResult.stderr).toBe(0);

    const instructionPromotePrepResult = runCli(
      projectDir,
      ["dream", "promote-prep", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(instructionPromotePrepResult.exitCode, instructionPromotePrepResult.stderr).toBe(0);
    const instructionPromotePrepPayload = JSON.parse(instructionPromotePrepResult.stdout) as {
      action: string;
      resolvedTarget: {
        targetSurface: string;
        path: string;
        kind: string;
      };
      preview: {
        schemaVersion: number;
        neverAutoEditsInstructionFiles: boolean;
        artifactDir: string;
        manualWorkflow: {
          applyPrepPath: string;
        };
      };
    };
    expect(instructionPromotePrepPayload).toMatchObject({
      action: "promote-prep",
      resolvedTarget: {
        targetSurface: "instruction-memory",
        kind: "claude-project"
      },
      preview: {
        schemaVersion: 2,
        neverAutoEditsInstructionFiles: true,
        artifactDir: expect.stringContaining(
          `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
        ),
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });

    const instructionApplyPrepResult = runCli(
      projectDir,
      ["dream", "apply-prep", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(instructionApplyPrepResult.exitCode, instructionApplyPrepResult.stderr).toBe(0);
    const instructionApplyPrepPayload = JSON.parse(instructionApplyPrepResult.stdout) as {
      action: string;
      applyReadiness: {
        status: string;
      };
      instructionProposal: {
        schemaVersion: number;
        neverAutoEditsInstructionFiles: boolean;
        artifactDir: string;
        manualWorkflow: {
          applyPrepPath: string;
        };
      };
    };
    expect(instructionApplyPrepPayload).toMatchObject({
      action: "apply-prep",
      applyReadiness: {
        status: "safe"
      },
      instructionProposal: {
        schemaVersion: 2,
        neverAutoEditsInstructionFiles: true,
        artifactDir: expect.stringContaining(
          `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
        ),
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });
    expect(
      await pathExists(instructionApplyPrepPayload.instructionProposal.manualWorkflow.applyPrepPath)
    ).toBe(true);

    const instructionPromoteResult = runCli(
      projectDir,
      ["dream", "promote", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(instructionPromoteResult.exitCode, instructionPromoteResult.stderr).toBe(0);
    expect(JSON.parse(instructionPromoteResult.stdout)).toMatchObject({
      action: "promote",
      promotionOutcome: "proposal-only",
      entry: {
        candidateId: instructionCandidate!.candidateId,
        targetSurface: "instruction-memory"
      },
      instructionProposal: {
        proposalOnly: true,
        schemaVersion: 2,
        neverAutoEditsInstructionFiles: true,
        artifactDir: expect.stringContaining(
          `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
        ),
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });

    expect(memoryPayload.recentSyncAudit).toHaveLength(1);
    expect(memoryPayload.recentSyncAudit[0]?.rolloutPath).toBe("/tmp/rollout-dist-smoke.jsonl");
    expect(memoryPayload.dreamSidecar).toMatchObject({
      enabled: true,
      status: "available"
    });
    expect(sessionPayload.projectLocation.exists).toBe(true);
    expect(sessionPayload.latestContinuityDiagnostics).toBeNull();
    expect(sessionPayload.resumeContext.goal).toContain("release-facing CLI surface");
    expect(sessionPayload.resumeContext.suggestedDurableRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(
      sessionPayload.resumeContext.instructionFiles.some((filePath) =>
        filePath.endsWith(`${path.sep}CLAUDE.md`)
      )
    ).toBe(true);
    expect(sessionPayload.dreamSidecar).toMatchObject({
      enabled: true,
      status: "available"
    });
    expect(sessionLoadPayload.latestContinuityDiagnostics).toBeNull();
    expect(sessionLoadPayload.resumeContext.suggestedDurableRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(sessionLoadPayload.dreamSidecar).toMatchObject({
      enabled: true,
      status: "available"
    });
    expect(sessionLoadPayload.startup).toMatchObject({
      continuityMode: "startup",
      continuityProvenanceKind: "temporary-continuity",
      continuitySectionKinds: expect.arrayContaining(["sources", "goal"]),
      continuitySourceKinds: ["shared"],
      sectionsRendered: {
        sources: true,
        goal: true
      },
      omissionCounts: {},
      futureCompactionSeam: {
        kind: "session-summary-placeholder",
        rebuildsStartupSections: true
      }
    });
    expect(sessionLoadPayload.startup.sourceFiles).toEqual(
      sessionLoadPayload.startup.candidateSourceFiles
    );
    expect(rememberPayload).toMatchObject({
      mutationKind: "remember",
      latestAppliedLifecycle: {
        action: "add"
      }
    });
    expect(rememberPayload.followUp.timelineRefs.length).toBeGreaterThan(0);
    expect(forgetPayload).toMatchObject({
      mutationKind: "forget"
    });
    expect(forgetPayload.followUp.timelineRefs.length).toBeGreaterThan(0);
    expect(forgetPayload.followUp.timelineRefs.length).toBeGreaterThan(0);
    expect(recallPayload.querySurfacing.suggestedDreamRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(
      recallPayload.querySurfacing.suggestedInstructionFiles.some((filePath) =>
        filePath.endsWith(`${path.sep}CLAUDE.md`)
      )
    ).toBe(true);
    expect(dreamBuildPayload.action).toBe("build");
    expect(dreamBuildPayload.snapshot.promotionCandidates.instructionLikeCandidates).toBeDefined();
    expect(dreamBuildPayload.snapshot.promotionCandidates.durableMemoryCandidates).toBeDefined();
    expect(dreamInspectPayload.enabled).toBe(true);
    expect(dreamInspectPayload.snapshots.project.status).toBe("available");
    expect(dreamInspectPayload.snapshots.project.latestPath).toBeTruthy();
  }, 30_000);

  it("keeps session inspection read-only from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-session-readonly-home-");
    const projectDir = await tempDir("cam-dist-session-readonly-project-");
    const memoryRootParent = await tempDir("cam-dist-session-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const sessionStatusResult = runCli(projectDir, ["session", "status", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });
    const sessionLoadResult = runCli(
      projectDir,
      ["session", "load", "--json", "--print-startup"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(sessionStatusResult.exitCode, sessionStatusResult.stderr).toBe(0);
    expect(sessionLoadResult.exitCode, sessionLoadResult.stderr).toBe(0);
    expect(JSON.parse(sessionStatusResult.stdout)).toMatchObject({
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
    expect(JSON.parse(sessionLoadResult.stdout)).toMatchObject({
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
  });

  it("uses the recommended recall search preset from the compiled cli entrypoint without creating memory layout on first lookup", async () => {
    const homeDir = await tempDir("cam-dist-recall-home-");
    const projectDir = await tempDir("cam-dist-recall-project-");
    const memoryRootParent = await tempDir("cam-dist-recall-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(
      projectDir,
      ["recall", "search", "pnpm", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      stateFallbackUsed: true,
      markdownFallbackUsed: true,
      diagnostics: {
        anyMarkdownFallback: true,
        fallbackReasons: ["missing"]
      },
      results: []
    });
    await expect(fs.access(memoryRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serves additive recall search and details JSON contract from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-recall-contract-home-");
    const projectDir = await tempDir("cam-dist-recall-contract-project-");
    const memoryRoot = await tempDir("cam-dist-recall-contract-memory-");
    const rolloutPath = "/tmp/rollout-dist-recall-contract.jsonl";
    const cliEnv = { HOME: homeDir };

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
      appliedAt: "2026-03-27T08:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath,
      sessionId: "session-dist-recall-contract",
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

    const searchResult = runCli(
      projectDir,
      ["recall", "search", "prefer pnpm", "--state", "active", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(searchResult.exitCode, searchResult.stderr).toBe(0);
    const searchPayload = JSON.parse(searchResult.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      stateFallbackUsed: boolean;
      markdownFallbackUsed: boolean;
      retrievalMode: string;
      diagnostics: {
        anyMarkdownFallback: boolean;
        fallbackReasons: string[];
        checkedPaths: Array<{
          scope: string;
          state: string;
          retrievalMode: string;
          matchedCount: number;
          indexPath: string;
          generatedAt: string | null;
        }>;
      };
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(searchPayload).toMatchObject({
      state: "active",
      resolvedState: "active",
      fallbackUsed: false,
      stateFallbackUsed: false,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      results: [
        {
          ref: "project:active:workflow:prefer-pnpm",
          state: "active",
          topic: "workflow"
        }
      ]
    });
    expect(searchPayload.diagnostics.checkedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          retrievalMode: "index",
          matchedCount: 1,
          indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
          generatedAt: expect.any(String)
        })
      ])
    );

    const detailsResult = runCli(
      projectDir,
      ["recall", "details", "project:active:workflow:prefer-pnpm", "--json"],
      {
        entrypoint: "dist",
        env: cliEnv
      }
    );
    expect(detailsResult.exitCode, detailsResult.stderr).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref: "project:active:workflow:prefer-pnpm",
      path: memoryStore.getTopicFile("project", "workflow"),
      latestLifecycleAction: "add",
      latestState: "active",
      latestSessionId: null,
      latestRolloutPath: null,
      historyPath: memoryStore.getHistoryPath("project"),
      timelineWarningCount: 0,
      warnings: [],
      lineageSummary: {
        eventCount: 1,
        latestAction: "add",
        latestState: "active",
        latestAuditStatus: null,
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        conflictCount: 0
      },
      latestAudit: null
    });
  });

  it("serves retrieval MCP tools from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-home-");
    const projectDir = await tempDir("cam-dist-mcp-project-");
    const memoryRoot = await tempDir("cam-dist-mcp-memory-root-");
    const cliEnv = { HOME: homeDir };

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

    const client = await connectCliMcpClient(projectDir, {
      entrypoint: "dist",
      env: cliEnv
    });

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["search_memories", "timeline_memories", "get_memory_details"])
      );

      const result = await client.callTool({
        name: "search_memories",
        arguments: {
          query: "pnpm",
          limit: 3
        }
      });
      expect(result.structuredContent).toMatchObject({
        query: "pnpm",
        results: [
          expect.objectContaining({
            ref: "project:active:workflow:prefer-pnpm",
            summary: "Prefer pnpm in this repository."
          })
        ]
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("prints host MCP config snippets from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-print-home-");
    const projectDir = await tempDir("cam-dist-mcp-print-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const result = runCli(projectDir, ["mcp", "print-config", "--host", "codex", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      host: string;
      readOnlyRetrieval: boolean;
      serverName: string;
      targetFileHint: string;
      workflowContract: {
        recommendedPreset: string;
        routePreference: {
          preferredRoute: string;
        };
        cliFallback: {
          searchCommand: string;
        };
      };
      agentsGuidance: {
        targetFileHint: string;
        snippetFormat: string;
        snippet: string;
      };
    };
    expect(payload).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      targetFileHint: ".codex/config.toml",
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        routePreference: {
          preferredRoute: "mcp-first"
        },
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realProjectDir}'`
        }
      },
      agentsGuidance: {
        targetFileHint: "AGENTS.md",
        snippetFormat: "markdown"
      }
    });
    expect(payload.agentsGuidance.snippet).toContain("search_memories");
    expect(payload.agentsGuidance.snippet).toContain("cam recall search");

    const claudeResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "claude", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(claudeResult.exitCode, claudeResult.stderr).toBe(0);
    expect(JSON.parse(claudeResult.stdout)).toMatchObject({
      host: "claude",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      targetFileHint: ".mcp.json"
    });
    expect(JSON.parse(claudeResult.stdout).workflowContract).toBeUndefined();

    const geminiResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "gemini", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(geminiResult.exitCode, geminiResult.stderr).toBe(0);
    expect(JSON.parse(geminiResult.stdout)).toMatchObject({
      host: "gemini",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      targetFileHint: ".gemini/settings.json"
    });
    expect(JSON.parse(geminiResult.stdout).workflowContract).toBeUndefined();

    const genericResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "generic", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(genericResult.exitCode, genericResult.stderr).toBe(0);
    expect(JSON.parse(genericResult.stdout)).toMatchObject({
      host: "generic",
      readOnlyRetrieval: true,
      serverName: "codex_auto_memory",
      targetFileHint: "Your MCP client's stdio server config",
      snippetFormat: "json"
    });
    expect(JSON.parse(genericResult.stdout).workflowContract).toBeUndefined();
  });

  it("rejects generic MCP install from the compiled cli entrypoint because wiring stays manual-only", async () => {
    const homeDir = await tempDir("cam-dist-mcp-install-generic-home-");
    const projectDir = await tempDir("cam-dist-mcp-install-generic-project-");

    const result = runCli(projectDir, ["mcp", "install", "--host", "generic"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generic");
    expect(result.stderr).toContain("manual-only");
  });

  it("rejects gemini MCP install from the compiled cli entrypoint because install stays Codex-only", async () => {
    const homeDir = await tempDir("cam-dist-mcp-install-gemini-home-");
    const projectDir = await tempDir("cam-dist-mcp-install-gemini-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const result = runCli(projectDir, ["mcp", "install", "--host", "gemini", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("gemini");
    expect(result.stderr).toContain("Codex-only");
  });

  it("applies the Codex AGENTS guidance from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-apply-guidance-home-");
    const projectDir = await tempDir("cam-dist-mcp-apply-guidance-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const created = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(created.exitCode, created.stderr).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "created",
      targetPath: path.join(realProjectDir, "AGENTS.md"),
      managedBlockVersion: "codex-agents-guidance-v1"
    });

    const unchanged = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({
      host: "codex",
      action: "unchanged"
    });

    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain("cam:codex-agents-guidance:start");
    expect(agentsContents).toContain("cam:codex-agents-guidance:end");
  });

  it("fails closed for unsafe AGENTS guidance from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-apply-guidance-blocked-home-");
    const projectDir = await tempDir("cam-dist-mcp-apply-guidance-blocked-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );

    const before = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    const result = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      action: "blocked"
    });
    expect(await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("does not treat fenced AGENTS examples as managed guidance from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-apply-guidance-fenced-home-");
    const projectDir = await tempDir("cam-dist-mcp-apply-guidance-fenced-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      ["# Example", "", "```md", printConfigPayload.agentsGuidance.snippet, "```"].join("\n"),
      "utf8"
    );

    const doctorResult = runCli(
      projectDir,
      ["mcp", "doctor", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      agentsGuidance: {
        exists: true,
        status: "warning"
      }
    });

    const applyResult = runCli(
      projectDir,
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      host: "codex",
      action: "updated"
    });
    const agentsContents = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    expect(agentsContents).toContain("```md");
    expect(agentsContents).toContain("cam:agents-guidance-version codex-agents-guidance-v1");
  });

  it("uses action-aware MCP install text output from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-install-text-home-");
    const projectDir = await tempDir("cam-dist-mcp-install-text-project-");

    const created = runCli(projectDir, ["mcp", "install", "--host", "codex"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });
    expect(created.exitCode, created.stderr).toBe(0);
    expect(created.stdout).toContain("Installed project-scoped MCP wiring for codex.");

    const unchanged = runCli(projectDir, ["mcp", "install", "--host", "codex"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(unchanged.stdout).toContain(
      "Project-scoped MCP wiring for codex is already up to date."
    );
  });

  it("inspects MCP wiring from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-doctor-home-");
    const projectDir = await tempDir("cam-dist-mcp-doctor-project-");

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "generic", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      serverName: "codex_auto_memory",
      readOnlyRetrieval: true,
      agentsGuidance: null,
      commandSurface: {
        install: false,
        serve: true,
        printConfig: true,
        applyGuidance: false,
        doctor: true
      },
      hosts: [
        {
          host: "generic",
          status: "manual",
          targetFileHint: "Your MCP client's stdio server config"
        }
      ]
    });
  });

  it("inspects codex MCP wiring and workflow contract from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-doctor-codex-home-");
    const projectDir = await tempDir("cam-dist-mcp-doctor-codex-project-");
    const realProjectDir = await fs.realpath(projectDir);

    expect(
      runCli(projectDir, ["hooks", "install"], {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }).exitCode
    ).toBe(0);
    expect(
      runCli(projectDir, ["skills", "install"], {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }).exitCode
    ).toBe(0);
    expect(
      runCli(projectDir, ["mcp", "install", "--host", "codex"], {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }).exitCode
    ).toBe(0);

    const result = runCli(projectDir, ["mcp", "doctor", "--host", "codex", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      projectRoot: realProjectDir,
      workflowContract: {
        version: expect.any(String),
        cliFallback: {
          searchCommand: expect.stringContaining('cam recall search "<query>" --state auto --limit 8'),
          timelineCommand: expect.stringContaining('cam recall timeline "<ref>"'),
          detailsCommand: expect.stringContaining('cam recall details "<ref>"')
        },
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh",
          syncCommand: expect.any(String),
          reviewCommand: expect.any(String)
        }
      },
      fallbackAssets: {
        runtimeSkillPresent: true,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        postWorkReviewInstalled: true
      },
      retrievalSidecar: {
        status: "warning",
        repairCommand: expect.stringContaining("memory reindex --scope all --state all"),
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "missing",
            fallbackReason: "missing"
          })
        ])
      }
    });
  });

  it("installs project-scoped MCP wiring from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-install-home-");
    const projectDir = await tempDir("cam-dist-mcp-install-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const result = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      serverName: "codex_auto_memory",
      projectRoot: realProjectDir,
      targetPath: path.join(realProjectDir, ".codex", "config.toml"),
      projectPinned: true,
      readOnlyRetrieval: true
    });

    const writtenConfig = toml.parse(
      await fs.readFile(path.join(realProjectDir, ".codex", "config.toml"), "utf8")
    ) as Record<string, unknown>;
    expect(writtenConfig).toMatchObject({
      mcp_servers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir
        }
      }
    });

    const claudeResult = runCli(
      projectDir,
      ["mcp", "install", "--host", "claude", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(claudeResult.exitCode).toBe(1);
    expect(claudeResult.stderr).toContain("claude");
    expect(claudeResult.stderr).toContain("Codex-only");
  });

  it("preserves custom fields on the codex_auto_memory install entry from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-mcp-install-preserve-home-");
    const projectDir = await tempDir("cam-dist-mcp-install-preserve-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.mkdir(path.join(projectDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        `cwd = ${JSON.stringify(realProjectDir)}`,
        'label = "keep-me"'
      ].join("\n"),
      "utf8"
    );

    const result = runCli(projectDir, ["mcp", "install", "--host", "codex", "--json"], {
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "unchanged",
      preservedCustomFields: ["label"]
    });

    const writtenConfig = toml.parse(
      await fs.readFile(path.join(projectDir, ".codex", "config.toml"), "utf8")
    ) as Record<string, unknown>;
    expect(writtenConfig).toMatchObject({
      mcp_servers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realProjectDir,
          label: "keep-me"
        }
      }
    });
  });

  it("installs hooks and skills from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-hook-skill-home-");
    const projectDir = await tempDir("cam-dist-hook-skill-project-");
    const realProjectDir = await fs.realpath(projectDir);
    const env = { HOME: homeDir };

    const hooksResult = runCli(projectDir, ["hooks", "install"], {
      entrypoint: "dist",
      env
    });
    expect(hooksResult.exitCode, hooksResult.stderr).toBe(0);

    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const recallScript = await fs.readFile(path.join(hooksDir, "memory-recall.sh"), "utf8");
    const postWorkReviewScript = await fs.readFile(
      path.join(hooksDir, "post-work-memory-review.sh"),
      "utf8"
    );
    const recallGuide = await fs.readFile(path.join(hooksDir, "recall-bridge.md"), "utf8");
    expect(recallScript).toContain("cam:asset-version");
    expect(recallScript).toContain('PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"');
    expect(postWorkReviewScript).toContain('sync --cwd "$PROJECT_ROOT"');
    expect(postWorkReviewScript).toContain('memory --recent --cwd "$PROJECT_ROOT"');
    expect(recallGuide).toContain("cam:asset-version");

    const skillsResult = runCli(projectDir, ["skills", "install"], {
      entrypoint: "dist",
      env
    });
    expect(skillsResult.exitCode, skillsResult.stderr).toBe(0);

    const skillFile = await fs.readFile(
      path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md"),
      "utf8"
    );
    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("search_memories");
  });

  it("installs an explicit official user skill surface from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-skill-official-user-home-");
    const projectDir = await tempDir("cam-dist-skill-official-user-project-");

    const env = { HOME: homeDir };
    const skillsResult = runCli(
      projectDir,
      ["skills", "install", "--surface", "official-user"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(skillsResult.exitCode, skillsResult.stderr).toBe(0);
    expect(skillsResult.stdout).toContain("Skill surface: official-user");

    const skillFile = await fs.readFile(
      path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
      "utf8"
    );
    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("search_memories");
  });

  it("installs an explicit official project skill surface from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-skill-official-project-home-");
    const projectDir = await tempDir("cam-dist-skill-official-project-project-");

    const env = { HOME: homeDir };
    const skillsResult = runCli(
      projectDir,
      ["skills", "install", "--surface", "official-project"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(skillsResult.exitCode, skillsResult.stderr).toBe(0);
    expect(skillsResult.stdout).toContain("Skill surface: official-project");

    const skillFile = await fs.readFile(
      path.join(projectDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
      "utf8"
    );
    expect(skillFile).toContain("cam:asset-version");
    expect(skillFile).toContain("search_memories");
  });

  it("installs skills under CODEX_HOME from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-skill-codex-home-home-");
    const codexHome = await tempDir("cam-dist-skill-codex-home-codex-home-");
    const projectDir = await tempDir("cam-dist-skill-codex-home-project-");

    const env = { HOME: homeDir, CODEX_HOME: codexHome };
    const skillsResult = runCli(projectDir, ["skills", "install"], {
      entrypoint: "dist",
      env
    });
    expect(skillsResult.exitCode, skillsResult.stderr).toBe(0);

    const skillFile = await fs.readFile(
      path.join(codexHome, "skills", "codex-auto-memory-recall", "SKILL.md"),
      "utf8"
    );
    expect(skillFile).toContain("cam:asset-version");

    const doctorResult = runCli(projectDir, ["mcp", "doctor", "--json"], {
      entrypoint: "dist",
      env
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      fallbackAssets: {
        runtimeSkillPresent: true,
        runtimeSkillDir: path.join(codexHome, "skills", "codex-auto-memory-recall"),
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        officialUserSkillMatchesCanonical: false,
        officialProjectSkillMatchesCanonical: false,
        skillPathDrift: true
      }
    });
  });

  it("reports canonical and runtime skill readiness separately from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-skill-doctor-home-");
    const projectDir = await tempDir("cam-dist-skill-doctor-project-");

    const env = { HOME: homeDir };
    const skillsResult = runCli(
      projectDir,
      ["skills", "install", "--surface", "official-user"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(skillsResult.exitCode, skillsResult.stderr).toBe(0);

    const doctorResult = runCli(projectDir, ["mcp", "doctor", "--json"], {
      entrypoint: "dist",
      env
    });
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      fallbackAssets: {
        runtimeSkillPresent: false,
        runtimeSkillInstalled: false,
        officialUserSkillInstalled: true,
        officialUserSkillMatchesCanonical: true,
        officialUserSkillMatchesRuntime: false,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        installedSkillSurfaces: ["official-user"],
        readySkillSurfaces: ["official-user"]
      }
    });
  });

  it("installs the Codex integration stack from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-home-");
    const projectDir = await tempDir("cam-dist-integrations-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const result = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "created",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realProjectDir}'`
        }
      },
      subactions: {
        mcp: {
          action: "created",
          targetPath: path.join(realProjectDir, ".codex", "config.toml")
        },
        hooks: {
          action: "created",
          targetDir: path.join(homeDir, ".codex-auto-memory", "hooks")
        },
        skills: {
          action: "created",
          surface: "runtime",
          targetDir: path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall")
        }
      }
    });
  });

  it("applies the full Codex integration stack from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-apply-home-");
    const projectDir = await tempDir("cam-dist-integrations-apply-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "created",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realProjectDir}'`
        }
      },
      subactions: {
        mcp: { action: "created" },
        agents: { action: "created" },
        hooks: { action: "created" },
        skills: { action: "created" }
      }
    });
  });

  it("surfaces staged-write failure payloads from the compiled integrations apply entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-apply-failed-home-");
    const projectDir = await tempDir("cam-dist-integrations-apply-failed-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.mkdir(path.join(realProjectDir, ".codex", "config.toml"), { recursive: true });

    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "failed",
      failureStage: "staged-write",
      failureMessage: expect.stringContaining("directory"),
      rollbackApplied: true,
      subactions: {
        mcp: { attempted: true, status: "blocked", action: "blocked" },
        agents: { attempted: false },
        hooks: { attempted: false },
        skills: { attempted: false }
      }
    });
  });

  it("surfaces blocked AGENTS updates from the compiled integrations apply entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-apply-blocked-home-");
    const projectDir = await tempDir("cam-dist-integrations-apply-blocked-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );

    const before = await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8");
    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "blocked",
      preflightBlocked: true,
      blockedStage: "agents-guidance-preflight",
      subactions: {
        mcp: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        agents: {
          status: "blocked",
          action: "blocked",
          attempted: true
        },
        hooks: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        },
        skills: {
          action: "unchanged",
          attempted: false,
          skipped: true,
          skipReason: expect.stringContaining("preflight")
        }
      }
    });
    expect(await fs.readFile(path.join(realProjectDir, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("surfaces staged-write failure payloads from the compiled integrations apply entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-apply-failed-home-");
    const projectDir = await tempDir("cam-dist-integrations-apply-failed-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.mkdir(path.join(realProjectDir, ".codex", "config.toml"), { recursive: true });

    const result = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      stackAction: "failed",
      failureStage: "staged-write",
      failureMessage: expect.stringContaining("directory"),
      rollbackApplied: true,
      subactions: {
        mcp: { attempted: true, status: "blocked", action: "blocked" },
        agents: { attempted: false },
        hooks: { attempted: false },
        skills: { attempted: false }
      }
    });
  });

  it("supports the official-project skill surface from the compiled integrations entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-official-project-home-");
    const projectDir = await tempDir("cam-dist-integrations-official-project-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--skill-surface", "official-project", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(installResult.exitCode, installResult.stderr).toBe(0);
    expect(JSON.parse(installResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "created",
          surface: "official-project",
          targetDir: path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const applyResult = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--skill-surface", "official-project", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-project",
      subactions: {
        skills: {
          surface: "official-project",
          targetDir: path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });
  });

  it("supports the official-user skill surface from the compiled integrations entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-official-user-home-");
    const projectDir = await tempDir("cam-dist-integrations-official-user-project-");
    const realProjectDir = await fs.realpath(projectDir);

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--skill-surface", "official-user", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(installResult.exitCode, installResult.stderr).toBe(0);
    expect(JSON.parse(installResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "created",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const applyResult = runCli(
      projectDir,
      ["integrations", "apply", "--host", "codex", "--skill-surface", "official-user", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );

    expect(applyResult.exitCode, applyResult.stderr).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      skillsSurface: "official-user",
      subactions: {
        skills: {
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });
  });

  it("inspects the Codex integration stack from the compiled cli entrypoint", async () => {
    const homeDir = await tempDir("cam-dist-integrations-doctor-home-");
    const projectDir = await tempDir("cam-dist-integrations-doctor-project-");
    const binDir = await tempDir("cam-dist-integrations-doctor-bin-");
    const realProjectDir = await fs.realpath(projectDir);
    await writeCamShim(binDir);

    const env = {
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
    };

    const installResult = runCli(
      projectDir,
      ["integrations", "install", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    const printConfigResult = runCli(
      projectDir,
      ["mcp", "print-config", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(printConfigResult.exitCode, printConfigResult.stderr).toBe(0);
    const printConfigPayload = JSON.parse(printConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      `${printConfigPayload.agentsGuidance.snippet}\n`,
      "utf8"
    );

    const doctorResult = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      applyReadiness: {
        status: "safe"
      },
      retrievalSidecar: {
        status: "warning",
        repairCommand: "cam memory reindex --scope all --state all",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "missing",
            fallbackReason: "missing"
          })
        ])
      },
      workflowContract: {
        version: expect.any(String),
        cliFallback: {
          searchCommand: 'cam recall search "<query>" --state auto --limit 8',
          timelineCommand: 'cam recall timeline "<ref>"',
          detailsCommand: 'cam recall details "<ref>"'
        },
        postWorkSyncReview: {
          helperScript: "post-work-memory-review.sh",
          syncCommand: "cam sync",
          reviewCommand: "cam memory --recent"
        }
      },
      preferredSkillSurface: "runtime",
      recommendedSkillInstallCommand: "cam skills install --surface runtime",
      subchecks: {
        mcp: { status: "ok" },
        agents: { status: "ok" },
        hookCapture: { status: "ok" },
        hookRecall: { status: "ok" },
        skill: { status: "ok" },
        workflowConsistency: { status: "ok" }
      }
    });
  });

  it("surfaces blocked apply readiness from the compiled integrations doctor", async () => {
    const homeDir = await tempDir("cam-dist-integrations-doctor-blocked-home-");
    const projectDir = await tempDir("cam-dist-integrations-doctor-blocked-project-");
    const realProjectDir = await fs.realpath(projectDir);

    await fs.writeFile(
      path.join(realProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );

    const result = runCli(
      projectDir,
      ["integrations", "doctor", "--host", "codex", "--json"],
      {
        entrypoint: "dist",
        env: { HOME: homeDir }
      }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir,
      applyReadiness: {
        status: "blocked",
        reason: expect.stringContaining("managed guidance block"),
        recommendedFix: expect.stringContaining("mcp apply-guidance --host codex")
      }
    });
  });

  it("fails closed for invalid --cwd on compiled integrations entrypoints", async () => {
    const homeDir = await tempDir("cam-dist-integrations-doctor-invalid-cwd-home-");
    const projectDir = await tempDir("cam-dist-integrations-doctor-invalid-cwd-project-");

    for (const command of [
      ["integrations", "apply", "--host", "codex"] as const,
      ["integrations", "doctor", "--host", "codex"] as const
    ]) {
      for (const cwd of ["", "   ", path.join(projectDir, "missing-project")]) {
        const result = runCli(
          projectDir,
          [...command, "--cwd", cwd],
          {
            entrypoint: "dist",
            env: { HOME: homeDir }
          }
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--cwd must be a non-empty path to an existing directory.");
      }
    }
  });

  it("routes exec through the compiled wrapper entrypoint", async () => {
    const repoDir = await tempDir("cam-dist-wrapper-repo-");
    const homeDir = await tempDir("cam-dist-wrapper-home-");
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
      entrypoint: "dist",
      env: { HOME: homeDir }
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const capturedArgs = JSON.parse(await waitForFile(capturedArgsPath)) as string[];
    expect(capturedArgs).toContain("exec");
    expect(capturedArgs).toContain("continue");
    expect(capturedArgs.some((value) => value.startsWith("base_instructions="))).toBe(true);
  }, 30_000);

  it("keeps key compiled help surfaces aligned with the release-facing command contract", async () => {
    const projectDir = await tempDir("cam-dist-help-project-");
    const homeDir = await tempDir("cam-dist-help-home-");
    const env = { HOME: homeDir };

    const recallHelp = runCli(projectDir, ["recall", "search", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(recallHelp.exitCode, recallHelp.stderr).toBe(0);
    expect(recallHelp.stdout).toContain("Search compact memory candidates without loading full details");
    expect(recallHelp.stdout).toContain("Limit memory state: active, archived, all, or auto");

    const dreamHelp = runCli(projectDir, ["dream", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamHelp.exitCode, dreamHelp.stderr).toBe(0);
    expect(dreamHelp.stdout).toContain("dream");
    expect(dreamHelp.stdout).toContain("candidates");
    expect(dreamHelp.stdout).toContain("review");
    expect(dreamHelp.stdout).toContain("adopt");
    expect(dreamHelp.stdout).toContain("promote-prep");
    expect(dreamHelp.stdout).toContain("apply-prep");
    expect(dreamHelp.stdout).toContain("promote");

    const dreamCandidatesHelp = runCli(projectDir, ["dream", "candidates", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamCandidatesHelp.exitCode, dreamCandidatesHelp.stderr).toBe(0);
    expect(dreamCandidatesHelp.stdout).toContain(
      "List explicit dream promotion candidates from the reviewer queue"
    );

    const dreamReviewHelp = runCli(projectDir, ["dream", "review", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamReviewHelp.exitCode, dreamReviewHelp.stderr).toBe(0);
    expect(dreamReviewHelp.stdout).toContain(
      "Review a dream candidate without mutating canonical memory"
    );

    const dreamAdoptHelp = runCli(projectDir, ["dream", "adopt", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamAdoptHelp.exitCode, dreamAdoptHelp.stderr).toBe(0);
    expect(dreamAdoptHelp.stdout).toContain(
      "Adopt a blocked subagent dream candidate into the primary review lane"
    );

    const dreamPromotePrepHelp = runCli(projectDir, ["dream", "promote-prep", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamPromotePrepHelp.exitCode, dreamPromotePrepHelp.stderr).toBe(0);
    expect(dreamPromotePrepHelp.stdout).toContain("Preview the outcome of promoting an approved dream candidate");

    const dreamApplyPrepHelp = runCli(projectDir, ["dream", "apply-prep", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamApplyPrepHelp.exitCode, dreamApplyPrepHelp.stderr).toBe(0);
    expect(dreamApplyPrepHelp.stdout).toContain(
      "Re-check a proposal-only instruction artifact without editing instruction files"
    );

    const dreamPromoteHelp = runCli(projectDir, ["dream", "promote", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(dreamPromoteHelp.exitCode, dreamPromoteHelp.stderr).toBe(0);
    expect(dreamPromoteHelp.stdout).toContain("Explicitly promote an approved dream candidate");

    const hooksHelp = runCli(projectDir, ["hooks", "install", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(hooksHelp.exitCode, hooksHelp.stderr).toBe(0);
    expect(hooksHelp.stdout).toContain(
      "Generate the local bridge / fallback helper bundle"
    );
    expect(hooksHelp.stdout).toContain("Project directory to anchor generated hook helpers to");

    const mcpHelp = runCli(projectDir, ["mcp", "print-config", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(mcpHelp.exitCode, mcpHelp.stderr).toBe(0);
    expect(mcpHelp.stdout).toContain("Print a ready-to-paste MCP config snippet for a supported host");
    expect(mcpHelp.stdout).toContain("Target host: codex, claude, gemini, or generic");

    const mcpInstallHelp = runCli(projectDir, ["mcp", "install", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(mcpInstallHelp.exitCode, mcpInstallHelp.stderr).toBe(0);
    expect(mcpInstallHelp.stdout).toContain(
      "Install the recommended project-scoped MCP wiring for a supported host"
    );
    expect(mcpInstallHelp.stdout).toContain("Target host: codex");

    const mcpApplyGuidanceHelp = runCli(projectDir, ["mcp", "apply-guidance", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(mcpApplyGuidanceHelp.exitCode, mcpApplyGuidanceHelp.stderr).toBe(0);
    expect(mcpApplyGuidanceHelp.stdout).toContain(
      "Safely create or update the managed Codex Auto Memory block inside AGENTS.md"
    );
    expect(mcpApplyGuidanceHelp.stdout).toContain("Target host: codex");

    const mcpDoctorHelp = runCli(projectDir, ["mcp", "doctor", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(mcpDoctorHelp.exitCode, mcpDoctorHelp.stderr).toBe(0);
    expect(mcpDoctorHelp.stdout).toContain(
      "Inspect the recommended project-scoped MCP wiring without writing host config"
    );
    expect(mcpDoctorHelp.stdout).toContain("Target host: codex, claude, gemini, generic, or all");

    const skillsHelp = runCli(projectDir, ["skills", "install", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(skillsHelp.exitCode, skillsHelp.stderr).toBe(0);
    expect(skillsHelp.stdout).toMatch(
      /Install a Codex skill that teaches search -> timeline -> details memory\s+retrieval/
    );
    expect(skillsHelp.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsHelp = runCli(projectDir, ["integrations", "install", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(integrationsHelp.exitCode, integrationsHelp.stderr).toBe(0);
    expect(integrationsHelp.stdout).toContain("Install the recommended project-scoped Codex integration stack");
    expect(integrationsHelp.stdout).toMatch(/without updating\s+AGENTS\.md/);
    expect(integrationsHelp.stdout).toContain("Target host: codex");
    expect(integrationsHelp.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsApplyHelp = runCli(projectDir, ["integrations", "apply", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(integrationsApplyHelp.exitCode, integrationsApplyHelp.stderr).toBe(0);
    expect(integrationsApplyHelp.stdout).toMatch(
      /Install the recommended Codex integration stack and safely apply the managed\s+AGENTS guidance block/
    );
    expect(integrationsApplyHelp.stdout).toContain("Target host: codex");
    expect(integrationsApplyHelp.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsDoctorHelp = runCli(projectDir, ["integrations", "doctor", "--help"], {
      entrypoint: "dist",
      env
    });
    expect(integrationsDoctorHelp.exitCode, integrationsDoctorHelp.stderr).toBe(0);
    expect(integrationsDoctorHelp.stdout).toMatch(
      /Inspect the current Codex integration stack without mutating memory or host\s+config/
    );
    expect(integrationsDoctorHelp.stdout).toContain("Target host: codex");
  });

  it("keeps key compiled --cwd command surfaces working across project boundaries", async () => {
    const homeDir = await tempDir("cam-dist-cwd-home-");
    const projectParentDir = await tempDir("cam-dist-cwd-project-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const callerDir = await tempDir("cam-dist-cwd-caller-");
    const env = { HOME: homeDir };

    await fs.mkdir(projectDir, { recursive: true });
    const realProjectDir = await fs.realpath(projectDir);

    const skillResult = runCli(
      callerDir,
      ["skills", "install", "--surface", "official-project", "--cwd", projectDir],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(skillResult.exitCode, skillResult.stderr).toBe(0);
    expect(
      await fs.readFile(
        path.join(realProjectDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const hooksResult = runCli(
      callerDir,
      ["hooks", "install", "--cwd", projectDir],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(hooksResult.exitCode, hooksResult.stderr).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"),
        "utf8"
      )
    ).toContain('PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"');
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh"),
        "utf8"
      )
    ).toContain('sync --cwd "$PROJECT_ROOT" "$@"');

    const guidanceResult = runCli(
      callerDir,
      ["mcp", "apply-guidance", "--host", "codex", "--cwd", projectDir, "--json"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(guidanceResult.exitCode, guidanceResult.stderr).toBe(0);
    expect(JSON.parse(guidanceResult.stdout)).toMatchObject({
      host: "codex",
      targetPath: path.join(realProjectDir, "AGENTS.md")
    });

    const integrationsResult = runCli(
      callerDir,
      ["integrations", "apply", "--host", "codex", "--cwd", projectDir, "--json"],
      {
        entrypoint: "dist",
        env
      }
    );
    expect(integrationsResult.exitCode, integrationsResult.stderr).toBe(0);
    expect(JSON.parse(integrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectDir
    });
  });
});
