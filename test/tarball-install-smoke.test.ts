import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as toml from "smol-toml";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function camBinaryPath(installDir: string): string {
  return path.join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "cam.cmd" : "cam"
  );
}

function isolatedEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    ...(process.platform === "win32" ? { USERPROFILE: homeDir } : {})
  };
}

function subagentRolloutFixture(
  projectDir: string,
  message: string,
  sessionId: string,
  parentSessionId = "session-tarball-primary"
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

describe("tarball install smoke", () => {
  it("installs and runs the packaged cam bin shim from a local tarball", async () => {
    const homeDir = await tempDir("cam-tarball-home-");
    const packDir = await tempDir("cam-tarball-pack-");
    const installDir = await tempDir("cam-tarball-install-");
    const realInstallDir = await fs.realpath(installDir);
    const env = isolatedEnv(homeDir);
    const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as {
      version: string;
    };

    const packResult = runCommandCapture(
      npmCommand(),
      ["pack", "--pack-destination", packDir],
      process.cwd(),
      env
    );
    expect(packResult.exitCode, packResult.stderr).toBe(0);

    const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarballName).toBeTruthy();
    const tarballPath = path.join(packDir, tarballName!);

    const initResult = runCommandCapture(npmCommand(), ["init", "-y"], installDir, env);
    expect(initResult.exitCode).toBe(0);

    const installResult = runCommandCapture(
      npmCommand(),
      ["install", "--no-package-lock", tarballPath],
      installDir,
      env
    );
    expect(installResult.exitCode).toBe(0);

    const versionResult = runCommandCapture(camBinaryPath(installDir), ["--version"], installDir, env);
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout.trim()).toBe(packageJson.version);

    const envWithBin = {
      ...env,
      PATH: `${path.join(installDir, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`
    };

    const sessionStatusResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "status", "--json"],
      installDir,
      envWithBin
    );
    const sessionLoadResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "load", "--json", "--print-startup"],
      installDir,
      envWithBin
    );
    expect(sessionStatusResult.exitCode).toBe(0);
    expect(sessionLoadResult.exitCode).toBe(0);

    const payload = JSON.parse(sessionStatusResult.stdout) as {
      projectLocation: { exists: boolean };
      latestContinuityAuditEntry: object | null;
      pendingContinuityRecovery: object | null;
      latestContinuityDiagnostics: object | null;
    };
    const loadPayload = JSON.parse(sessionLoadResult.stdout) as {
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
    };
    expect(payload.projectLocation.exists).toBe(false);
    expect(payload.latestContinuityAuditEntry).toBeNull();
    expect(payload.latestContinuityDiagnostics).toBeNull();
    expect(payload.pendingContinuityRecovery).toBeNull();
    expect(loadPayload.startup).toMatchObject({
      continuityMode: "startup",
      continuityProvenanceKind: "temporary-continuity",
      continuitySectionKinds: expect.arrayContaining(["goal"]),
      continuitySourceKinds: [],
      sectionsRendered: {
        sources: false,
        goal: true
      },
      omissionCounts: {},
      futureCompactionSeam: {
        kind: "session-summary-placeholder",
        rebuildsStartupSections: true
      }
    });
    expect(loadPayload.startup.sourceFiles).toEqual([]);
    expect(loadPayload.startup.candidateSourceFiles).toEqual([]);

    const doctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["doctor", "--json"],
      installDir,
      {
        ...envWithBin,
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`
      }
    );
    expect(doctorResult.exitCode, doctorResult.stderr).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({
      recommendedRoute: "companion",
      recommendedActionCommand: expect.stringContaining("mcp doctor --host codex"),
      recommendedDoctorCommand: expect.stringContaining("doctor --json"),
      readiness: {
        appServer: null
      }
    });

    const memoryRoot = await tempDir("cam-tarball-memory-root-");
    const appConfig = makeAppConfig({
      dreamSidecarEnabled: true
    });
    await writeCamConfig(installDir, appConfig, {
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });
    await fs.writeFile(path.join(installDir, "CLAUDE.md"), "# Installed package rules\n", "utf8");

    const project = detectProjectContext(installDir);
    const memoryStore = new MemoryStore(project, {
      ...appConfig,
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
      appliedAt: "2026-03-27T08:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath: "/tmp/rollout-tarball-recall-contract.jsonl",
      sessionId: "session-tarball-recall-contract",
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

    const rolloutPath = path.join(installDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-tarball-dream",
          timestamp: "2026-04-12T10:30:00.000Z",
          cwd: installDir
        }
      }) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Continue the installed-package smoke review and keep using pnpm in this repository."
          }
        }) +
        "\n",
      "utf8"
    );

    const sessionSaveResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "save", "--rollout", rolloutPath, "--scope", "both"],
      installDir,
      envWithBin
    );
    expect(sessionSaveResult.exitCode, sessionSaveResult.stderr).toBe(0);

    const dreamBuildResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "build", "--rollout", rolloutPath, "--json"],
      installDir,
      envWithBin
    );
    expect(dreamBuildResult.exitCode, dreamBuildResult.stderr).toBe(0);
    const dreamInspectResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "inspect", "--json"],
      installDir,
      envWithBin
    );
    expect(dreamInspectResult.exitCode, dreamInspectResult.stderr).toBe(0);
    expect(JSON.parse(dreamInspectResult.stdout)).toMatchObject({
      enabled: true,
      snapshots: {
        project: {
          status: "available",
          latestPath: expect.any(String)
        }
      },
      queueSummary: {
        totalCount: expect.any(Number)
      },
      candidateRegistryPath: expect.stringContaining(
        `${path.sep}dream${path.sep}review${path.sep}registry.json`
      ),
      candidateAuditPath: expect.stringContaining(
        `${path.sep}audit${path.sep}dream-candidate-log.jsonl`
      ),
      candidateRecoveryPath: expect.stringContaining(
        `${path.sep}audit${path.sep}dream-candidate-recovery.json`
      ),
      reviewerSummary: {
        queueSummary: {
          totalCount: expect.any(Number)
        }
      },
      nextRecommendedActions: expect.any(Array),
      helperCommands: expect.any(Array)
    });

    const recallSearchResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "search", "pnpm", "--json"],
      installDir,
      envWithBin
    );
    expect(recallSearchResult.exitCode, recallSearchResult.stderr).toBe(0);
    expect(JSON.parse(recallSearchResult.stdout)).toMatchObject({
      state: "auto",
      resolvedState: "active",
      fallbackUsed: false,
      stateFallbackUsed: false,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      querySurfacing: {
        suggestedDreamRefs: expect.arrayContaining([
          expect.objectContaining({
            ref: "project:active:workflow:prefer-pnpm"
          })
        ]),
        suggestedInstructionFiles: expect.arrayContaining([expect.stringContaining("CLAUDE.md")])
      },
      diagnostics: {
        anyMarkdownFallback: false,
        fallbackReasons: [],
        checkedPaths: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            retrievalMode: "index",
            matchedCount: 1,
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String)
          })
        ])
      },
      results: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          state: "active",
          topic: "workflow"
        })
      ]
    });

    const sessionStatusAfterDreamResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "status", "--json"],
      installDir,
      envWithBin
    );
    expect(sessionStatusAfterDreamResult.exitCode, sessionStatusAfterDreamResult.stderr).toBe(0);
    expect(JSON.parse(sessionStatusAfterDreamResult.stdout)).toMatchObject({
      resumeContext: {
        goal: expect.stringContaining("installed-package smoke review"),
        suggestedDurableRefs: expect.arrayContaining([
          expect.objectContaining({
            ref: "project:active:workflow:prefer-pnpm"
          })
        ]),
        instructionFiles: expect.arrayContaining([expect.stringContaining("CLAUDE.md")])
      },
      dreamSidecar: {
        enabled: true,
        status: "available"
      }
    });

    expect(JSON.parse(dreamBuildResult.stdout)).toMatchObject({
      action: "build",
      snapshot: {
        promotionCandidates: {
          instructionLikeCandidates: expect.any(Array),
          durableMemoryCandidates: expect.any(Array)
        }
      }
    });

    const dreamInspectResultAfterFlow = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "inspect", "--json"],
      installDir,
      envWithBin
    );
    expect(dreamInspectResultAfterFlow.exitCode, dreamInspectResultAfterFlow.stderr).toBe(0);
    expect(JSON.parse(dreamInspectResultAfterFlow.stdout)).toMatchObject({
      enabled: true,
      snapshots: {
        project: {
          status: "available",
          latestPath: expect.any(String)
        }
      }
    });

    const durableDreamRolloutPath = path.join(installDir, "dream-durable-rollout.jsonl");
    await fs.writeFile(
      durableDreamRolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-tarball-dream-durable",
          timestamp: "2026-03-15T00:05:00.000Z",
          cwd: installDir
        }
      }) +
        "\n" +
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "The runbook lives at https://docs.example.com/runbook. Continue the installed-package smoke review."
          }
        }) +
        "\n",
      "utf8"
    );
    const durableDreamBuildResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "build", "--rollout", durableDreamRolloutPath, "--json"],
      installDir,
      envWithBin
    );
    expect(durableDreamBuildResult.exitCode, durableDreamBuildResult.stderr).toBe(0);

    const dreamCandidatesResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "candidates", "--json"],
      installDir,
      envWithBin
    );
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

    const dreamReviewResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "review", "--candidate-id", durableCandidate!.candidateId, "--approve", "--json"],
      installDir,
      envWithBin
    );
    expect(dreamReviewResult.exitCode, dreamReviewResult.stderr).toBe(0);

    const dreamPromoteResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote", "--candidate-id", durableCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
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

    const blockedSubagentRolloutPath = path.join(installDir, "dream-subagent-rollout.jsonl");
    await fs.writeFile(
      blockedSubagentRolloutPath,
      subagentRolloutFixture(
        installDir,
        "The subagent runbook lives at https://docs.example.com/subagent-runbook.",
        "session-tarball-dream-subagent"
      ),
      "utf8"
    );
    const blockedSubagentBuildResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "build", "--rollout", blockedSubagentRolloutPath, "--json"],
      installDir,
      envWithBin
    );
    expect(blockedSubagentBuildResult.exitCode, blockedSubagentBuildResult.stderr).toBe(0);

    const blockedSubagentCandidatesResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "dream",
        "candidates",
        "--origin-kind",
        "subagent",
        "--target-surface",
        "durable-memory",
        "--json"
      ],
      installDir,
      envWithBin
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

    const dreamAdoptResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "adopt", "--candidate-id", blockedSubagentCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
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

    const adoptedSubagentReviewResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "review", "--candidate-id", blockedSubagentCandidate!.candidateId, "--approve", "--json"],
      installDir,
      envWithBin
    );
    expect(adoptedSubagentReviewResult.exitCode, adoptedSubagentReviewResult.stderr).toBe(0);
    expect(JSON.parse(adoptedSubagentReviewResult.stdout)).toMatchObject({
      action: "review",
      entry: {
        candidateId: blockedSubagentCandidate!.candidateId,
        status: "approved"
      }
    });

    const adoptedSubagentPromotePrepResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote-prep", "--candidate-id", blockedSubagentCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
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

    const instructionDreamRolloutPath = path.join(installDir, "dream-instruction-rollout.jsonl");
    await fs.writeFile(
      instructionDreamRolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-tarball-dream-instruction",
          timestamp: "2026-03-15T00:06:00.000Z",
          cwd: installDir
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
    const instructionDreamBuildResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "build", "--rollout", instructionDreamRolloutPath, "--json"],
      installDir,
      envWithBin
    );
    expect(instructionDreamBuildResult.exitCode, instructionDreamBuildResult.stderr).toBe(0);

    const instructionCandidatesResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "candidates", "--json"],
      installDir,
      envWithBin
    );
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

    const instructionReviewResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "review", "--candidate-id", instructionCandidate!.candidateId, "--approve", "--json"],
      installDir,
      envWithBin
    );
    expect(instructionReviewResult.exitCode, instructionReviewResult.stderr).toBe(0);

    const instructionPromotePrepResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote-prep", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
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
        targetHost: string;
        selectedTargetByPolicy: {
          kind: string;
        };
        selectedTarget: {
          path: string;
          kind: string;
        };
        rankedTargets: Array<{
          kind: string;
        }>;
        applyReadiness: {
          status: string;
          recommendedOperation: string;
        };
        patchPlan: {
          operation: string;
          anchor: string;
        } | null;
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
        targetHost: "shared",
        selectedTargetByPolicy: {
          kind: "claude-project"
        },
        selectedTarget: {
          kind: "claude-project"
        },
        applyReadiness: {
          status: "safe",
          recommendedOperation: "append-block"
        },
        patchPlan: {
          operation: "append-block",
          anchor: "end-of-file"
        },
        artifactDir: expect.stringContaining(
          `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
        ),
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });
    expect(instructionPromotePrepPayload.preview.rankedTargets.map((target) => target.kind)).toEqual(
      expect.arrayContaining(["agents-root", "claude-project"])
    );

    await fs.mkdir(path.join(installDir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(installDir, ".claude", "CLAUDE.md"), "# Hidden Claude rules\n", "utf8");
    await fs.writeFile(path.join(installDir, "GEMINI.md"), "# Gemini rules\n", "utf8");
    const instructionTargetOverrideResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "dream",
        "promote-prep",
        "--candidate-id",
        instructionCandidate!.candidateId,
        "--target-host",
        "gemini",
        "--target-file",
        ".claude/CLAUDE.md",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(instructionTargetOverrideResult.exitCode, instructionTargetOverrideResult.stderr).toBe(0);
    expect(JSON.parse(instructionTargetOverrideResult.stdout)).toMatchObject({
      action: "promote-prep",
      resolvedTarget: {
        targetSurface: "instruction-memory",
        path: expect.stringContaining(`${path.sep}.claude${path.sep}CLAUDE.md`),
        kind: "claude-hidden"
      },
      preview: {
        targetHost: "gemini",
        selectedTargetByPolicy: {
          kind: "gemini-project"
        },
        selectedTarget: {
          kind: "claude-hidden"
        }
      }
    });
    const instructionPromotePrepResetResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote-prep", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
    );
    expect(instructionPromotePrepResetResult.exitCode, instructionPromotePrepResetResult.stderr).toBe(0);

    const instructionApplyPrepResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "apply-prep", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
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
        selectedTarget: {
          path: string;
          kind: string;
        };
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
        selectedTarget: {
          kind: "claude-project"
        },
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });
    await expect(
      fs.stat(instructionApplyPrepPayload.instructionProposal.manualWorkflow.applyPrepPath)
    ).resolves.toBeDefined();

    const instructionPromoteResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
    );
    expect(instructionPromoteResult.exitCode, instructionPromoteResult.stderr).toBe(0);
    const instructionPromotePayload = JSON.parse(instructionPromoteResult.stdout) as {
      action: string;
      promotionOutcome: string;
      entry: {
        candidateId: string;
        status: string;
        targetSurface: string;
      };
      instructionProposal: {
        proposalOnly: boolean;
        schemaVersion: number;
        neverAutoEditsInstructionFiles: boolean;
        artifactDir: string;
        targetHost: string;
        selectedTarget: {
          path: string;
          kind: string;
        };
        guidanceBlock: string;
        patchPlan: {
          operation: string;
        } | null;
        manualWorkflow: {
          applyPrepPath: string;
        };
      };
    };
    expect(instructionPromotePayload).toMatchObject({
      action: "promote",
      promotionOutcome: "proposal-only",
      entry: {
        candidateId: instructionCandidate!.candidateId,
        status: "manual-apply-pending",
        targetSurface: "instruction-memory"
      },
      instructionProposal: {
        proposalOnly: true,
        schemaVersion: 2,
        neverAutoEditsInstructionFiles: true,
        artifactDir: expect.stringContaining(
          `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
        ),
        targetHost: "shared",
        selectedTarget: {
          kind: "claude-project"
        },
        patchPlan: {
          operation: "append-block"
        },
        manualWorkflow: {
          applyPrepPath: expect.stringContaining(`${path.sep}apply-prep.json`)
        }
      }
    });

    const instructionProposalResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "proposal", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
    );
    expect(instructionProposalResult.exitCode, instructionProposalResult.stderr).toBe(0);
    expect(JSON.parse(instructionProposalResult.stdout)).toMatchObject({
      action: "proposal",
      entry: {
        status: "manual-apply-pending"
      },
      instructionProposal: {
        artifactPath: instructionPromotePayload.instructionProposal.artifactDir + `${path.sep}manifest.json`,
        targetHost: "shared"
      }
    });

    await fs.writeFile(
      path.join(installDir, "CLAUDE.md"),
      `# Project rules\n\n${instructionPromotePayload.instructionProposal.guidanceBlock}\n`,
      "utf8"
    );
    const instructionVerifyApplyResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "verify-apply", "--candidate-id", instructionCandidate!.candidateId, "--json"],
      installDir,
      envWithBin
    );
    expect(instructionVerifyApplyResult.exitCode, instructionVerifyApplyResult.stderr).toBe(0);
    expect(JSON.parse(instructionVerifyApplyResult.stdout)).toMatchObject({
      action: "verify-apply",
      entry: {
        candidateId: instructionCandidate!.candidateId,
        status: "manual-applied",
        targetSurface: "instruction-memory"
      }
    });

    const recallInstructionLaneResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "search", "pnpm", "--json"],
      installDir,
      envWithBin
    );
    expect(recallInstructionLaneResult.exitCode, recallInstructionLaneResult.stderr).toBe(0);
    expect(JSON.parse(recallInstructionLaneResult.stdout)).toMatchObject({
      querySurfacing: {
        instructionReviewLane: {
          latestCandidateId: null,
          selectedTargetKind: null,
          targetHost: null
        }
      }
    });

    const recallDetailsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "details", "project:active:workflow:prefer-pnpm", "--json"],
      installDir,
      envWithBin
    );
    expect(recallDetailsResult.exitCode, recallDetailsResult.stderr).toBe(0);
    expect(JSON.parse(recallDetailsResult.stdout)).toMatchObject({
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

    const mcpInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(mcpInstallResult.exitCode).toBe(0);
    expect(JSON.parse(mcpInstallResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      readOnlyRetrieval: true
    });
    expect(
      await fs.readFile(path.join(installDir, ".codex", "config.toml"), "utf8")
    ).toContain("[mcp_servers.codex_auto_memory]");

    const codexPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(codexPrintConfigResult.exitCode).toBe(0);
    const codexPrintConfigPayload = JSON.parse(codexPrintConfigResult.stdout) as {
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
    expect(codexPrintConfigPayload).toMatchObject({
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
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realInstallDir}'`
        }
      },
      agentsGuidance: {
        targetFileHint: "AGENTS.md",
        snippetFormat: "markdown"
      }
    });
    const claudePrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "claude", "--json"],
      installDir,
      envWithBin
    );
    expect(claudePrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(claudePrintConfigResult.stdout)).toMatchObject({
      host: "claude",
      readOnlyRetrieval: true,
      targetFileHint: ".mcp.json"
    });
    expect(JSON.parse(claudePrintConfigResult.stdout).workflowContract).toBeUndefined();
    const geminiPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "gemini", "--json"],
      installDir,
      envWithBin
    );
    expect(geminiPrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(geminiPrintConfigResult.stdout)).toMatchObject({
      host: "gemini",
      readOnlyRetrieval: true,
      targetFileHint: ".gemini/settings.json"
    });
    expect(JSON.parse(geminiPrintConfigResult.stdout).workflowContract).toBeUndefined();
    const genericPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "generic", "--json"],
      installDir,
      envWithBin
    );
    expect(genericPrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(genericPrintConfigResult.stdout)).toMatchObject({
      host: "generic",
      readOnlyRetrieval: true,
      targetFileHint: "Your MCP client's stdio server config"
    });
    expect(JSON.parse(genericPrintConfigResult.stdout).workflowContract).toBeUndefined();
    const applyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(applyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(applyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    expect(
      await fs.readFile(path.join(installDir, "AGENTS.md"), "utf8")
    ).toContain(codexPrintConfigPayload.agentsGuidance.snippet);

    const shellDir = await tempDir("cam-tarball-shell-");
    const projectWithSpacesDir = path.join(shellDir, "project with spaces");
    await fs.mkdir(projectWithSpacesDir, { recursive: true });
    const realProjectWithSpacesDir = await fs.realpath(projectWithSpacesDir);

    const cwdSkillResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-project", "--cwd", projectWithSpacesDir],
      shellDir,
      envWithBin
    );
    expect(cwdSkillResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(
          realProjectWithSpacesDir,
          ".agents",
          "skills",
          "codex-auto-memory-recall",
          "SKILL.md"
        ),
        "utf8"
    )
    ).toContain("cam:asset-version");

    const cwdHooksResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install", "--cwd", projectWithSpacesDir],
      shellDir,
      envWithBin
    );
    expect(cwdHooksResult.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain('PROJECT_ROOT="${CAM_PROJECT_ROOT:-$PWD}"');
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh"),
        "utf8"
      )
    ).toContain('cam sync --cwd "$PROJECT_ROOT" "$@"');

    const cwdApplyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--cwd", projectWithSpacesDir, "--json"],
      shellDir,
      envWithBin
    );
    expect(cwdApplyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(cwdApplyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      targetPath: path.join(realProjectWithSpacesDir, "AGENTS.md")
    });

    const cwdIntegrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--cwd", projectWithSpacesDir, "--json"],
      shellDir,
      envWithBin
    );
    expect(cwdIntegrationsResult.exitCode).toBe(0);
    expect(JSON.parse(cwdIntegrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realProjectWithSpacesDir
    });

    const genericInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "generic"],
      installDir,
      envWithBin
    );
    expect(genericInstallResult.exitCode).toBe(1);
    expect(genericInstallResult.stderr).toContain("generic");
    expect(genericInstallResult.stderr).toContain("manual-only");

    const geminiInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "gemini", "--json"],
      installDir,
      envWithBin
    );
    expect(geminiInstallResult.exitCode).toBe(1);
    expect(geminiInstallResult.stderr).toContain("gemini");
    expect(geminiInstallResult.stderr).toContain("Codex-only");

    const claudeInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "claude", "--json"],
      installDir,
      envWithBin
    );
    expect(claudeInstallResult.exitCode).toBe(1);
    expect(claudeInstallResult.stderr).toContain("claude");
    expect(claudeInstallResult.stderr).toContain("Codex-only");

    const hooksResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install"],
      installDir,
      envWithBin
    );
    expect(hooksResult.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain("cam:asset-version");
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex-auto-memory", "hooks", "post-work-memory-review.sh"),
        "utf8"
      )
    ).toContain("cam memory --recent");

    const skillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install"],
      installDir,
      envWithBin
    );
    expect(skillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const officialSkillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-user"],
      installDir,
      envWithBin
    );
    expect(officialSkillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const officialProjectSkillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-project"],
      installDir,
      envWithBin
    );
    expect(officialProjectSkillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(installDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const integrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realInstallDir}'`
        }
      },
      subactions: {
        mcp: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsApplyResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsApplyResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      workflowContract: {
        recommendedPreset: "state=auto, limit=8",
        cliFallback: {
          searchCommand: `cam recall search "<query>" --state auto --limit 8 --cwd '${realInstallDir}'`
        }
      },
      subactions: {
        mcp: { action: "unchanged" },
        agents: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsOfficialProjectResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "install",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsOfficialProjectResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsOfficialProjectResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-project",
          targetDir: path.join(realInstallDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsOfficialUserResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "install",
        "--host",
        "codex",
        "--skill-surface",
        "official-user",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsOfficialUserResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsOfficialUserResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsApplyOfficialUserResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "apply",
        "--host",
        "codex",
        "--skill-surface",
        "official-user",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsApplyOfficialUserResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyOfficialUserResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-user",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-user",
          targetDir: path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsApplyOfficialProjectResult = runCommandCapture(
      camBinaryPath(installDir),
      [
        "integrations",
        "apply",
        "--host",
        "codex",
        "--skill-surface",
        "official-project",
        "--json"
      ],
      installDir,
      envWithBin
    );
    expect(integrationsApplyOfficialProjectResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyOfficialProjectResult.stdout)).toMatchObject({
      host: "codex",
      skillsSurface: "official-project",
      subactions: {
        skills: {
          action: "unchanged",
          surface: "official-project",
          targetDir: path.join(realInstallDir, ".agents", "skills", "codex-auto-memory-recall")
        }
      }
    });

    const integrationsDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsDoctorResult.stdout)).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      applyReadiness: {
        status: "safe"
      },
      retrievalSidecar: {
        status: "ok",
        repairCommand: "cam memory reindex --scope all --state all",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "ok",
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String),
            topicFileCount: expect.any(Number)
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
      installedSkillSurfaces: ["runtime", "official-user", "official-project"],
      readySkillSurfaces: ["runtime", "official-user", "official-project"],
      subchecks: {
        mcp: { status: "ok" },
        agents: { status: "ok" },
        hookCapture: { status: "ok" },
        hookRecall: { status: "ok" },
        skill: { status: "ok" },
        workflowConsistency: { status: "ok" }
      }
    });

    const mcpDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "doctor", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(mcpDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(mcpDoctorResult.stdout)).toMatchObject({
      readOnlyRetrieval: true,
      fallbackAssets: {
        runtimeSkillPresent: true,
        postWorkReviewInstalled: true,
        anySkillSurfaceInstalled: true,
        anySkillSurfaceReady: true,
        officialUserSkillMatchesCanonical: true,
        officialProjectSkillMatchesCanonical: true
      },
      retrievalSidecar: {
        status: "ok",
        repairCommand: "cam memory reindex --scope all --state all",
        checks: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            status: "ok",
            indexPath: memoryStore.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String),
            topicFileCount: expect.any(Number)
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
      }
    });

    const blockedProjectDir = await tempDir("cam-tarball-blocked-project-");
    const realBlockedProjectDir = await fs.realpath(blockedProjectDir);
    await fs.writeFile(
      path.join(realBlockedProjectDir, "AGENTS.md"),
      [
        "# Project Notes",
        "",
        "<!-- cam:codex-agents-guidance:start -->",
        "<!-- cam:agents-guidance-version codex-agents-guidance-v0 -->",
        "- stale guidance"
      ].join("\n"),
      "utf8"
    );
    const blockedBefore = await fs.readFile(path.join(realBlockedProjectDir, "AGENTS.md"), "utf8");

    const blockedApplyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedApplyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(blockedApplyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
      action: "blocked"
    });
    expect(await fs.readFile(path.join(realBlockedProjectDir, "AGENTS.md"), "utf8")).toBe(
      blockedBefore
    );

    const blockedIntegrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedIntegrationsResult.exitCode).toBe(0);
    expect(JSON.parse(blockedIntegrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
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

    const failedProjectDir = await tempDir("cam-tarball-failed-project-");
    const realFailedProjectDir = await fs.realpath(failedProjectDir);
    await fs.mkdir(path.join(realFailedProjectDir, ".codex", "config.toml"), { recursive: true });

    const failedIntegrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      failedProjectDir,
      envWithBin
    );
    expect(failedIntegrationsResult.exitCode).toBe(0);
    expect(JSON.parse(failedIntegrationsResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realFailedProjectDir,
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

    const blockedIntegrationsDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--host", "codex", "--json"],
      blockedProjectDir,
      envWithBin
    );
    expect(blockedIntegrationsDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(blockedIntegrationsDoctorResult.stdout)).toMatchObject({
      host: "codex",
      projectRoot: realBlockedProjectDir,
      applyReadiness: {
        status: "blocked",
        reason: expect.stringContaining("managed guidance block"),
        recommendedFix: expect.stringContaining("cam mcp apply-guidance --host codex")
      }
    });

    for (const command of [
      ["integrations", "apply", "--host", "codex"] as const,
      ["integrations", "doctor", "--host", "codex"] as const
    ]) {
      for (const cwd of ["", "   ", path.join(realBlockedProjectDir, "missing-project")]) {
        const invalidResult = runCommandCapture(
          camBinaryPath(installDir),
          [...command, "--cwd", cwd],
          blockedProjectDir,
          envWithBin
        );
        expect(invalidResult.exitCode).toBe(1);
        expect(invalidResult.stderr).toContain(
          "--cwd must be a non-empty path to an existing directory."
        );
      }
    }

    const recallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["recall", "search", "--help"],
      installDir,
      envWithBin
    );
    expect(recallHelpResult.exitCode).toBe(0);
    expect(recallHelpResult.stdout).toContain("Search compact memory candidates without loading full details");
    expect(recallHelpResult.stdout).toContain("Limit memory state: active, archived, all, or auto");

    const dreamHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamHelpResult.exitCode).toBe(0);
    expect(dreamHelpResult.stdout).toContain("candidates");
    expect(dreamHelpResult.stdout).toContain("review");
    expect(dreamHelpResult.stdout).toContain("adopt");
    expect(dreamHelpResult.stdout).toContain("proposal");
    expect(dreamHelpResult.stdout).toContain("promote-prep");
    expect(dreamHelpResult.stdout).toContain("apply-prep");
    expect(dreamHelpResult.stdout).toContain("verify-apply");
    expect(dreamHelpResult.stdout).toContain("promote");

    const dreamBuildHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "build", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamBuildHelpResult.exitCode).toBe(0);
    expect(dreamBuildHelpResult.stdout).toContain("Build a dream sidecar snapshot from the selected rollout");

    const dreamInspectHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "inspect", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamInspectHelpResult.exitCode).toBe(0);
    expect(dreamInspectHelpResult.stdout).toContain(
      "Inspect the latest dream sidecar snapshots and audit paths"
    );

    const dreamCandidatesHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "candidates", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamCandidatesHelpResult.exitCode).toBe(0);
    expect(dreamCandidatesHelpResult.stdout).toContain(
      "List explicit dream promotion candidates from the reviewer queue"
    );

    const dreamReviewHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "review", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamReviewHelpResult.exitCode).toBe(0);
    expect(dreamReviewHelpResult.stdout).toContain(
      "Review a dream candidate without mutating canonical memory"
    );

    const dreamAdoptHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "adopt", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamAdoptHelpResult.exitCode).toBe(0);
    expect(dreamAdoptHelpResult.stdout).toContain(
      "Adopt a blocked subagent dream candidate into the primary review lane"
    );

    const dreamPromotePrepHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote-prep", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamPromotePrepHelpResult.exitCode).toBe(0);
    expect(dreamPromotePrepHelpResult.stdout).toContain(
      "Preview the outcome of promoting an approved dream candidate"
    );
    expect(dreamPromotePrepHelpResult.stdout).toContain("--target-host");
    expect(dreamPromotePrepHelpResult.stdout).toContain("--target-file");

    const dreamApplyPrepHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "apply-prep", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamApplyPrepHelpResult.exitCode).toBe(0);
    expect(dreamApplyPrepHelpResult.stdout).toContain(
      "Re-check a proposal-only instruction artifact without editing instruction files"
    );
    expect(dreamApplyPrepHelpResult.stdout).not.toContain("--target-file");

    const dreamPromoteHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "promote", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamPromoteHelpResult.exitCode).toBe(0);
    expect(dreamPromoteHelpResult.stdout).toContain("Explicitly promote an approved dream candidate");
    expect(dreamPromoteHelpResult.stdout).toContain("--target-host");
    expect(dreamPromoteHelpResult.stdout).toContain("--target-file");

    const dreamProposalHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "proposal", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamProposalHelpResult.exitCode).toBe(0);
    expect(dreamProposalHelpResult.stdout).toContain(
      "Read a proposal-only instruction artifact without changing reviewer state"
    );

    const dreamVerifyApplyHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["dream", "verify-apply", "--help"],
      installDir,
      envWithBin
    );
    expect(dreamVerifyApplyHelpResult.exitCode).toBe(0);
    expect(dreamVerifyApplyHelpResult.stdout).toContain(
      "Verify a manual instruction apply against the proposal artifact"
    );
    expect(dreamVerifyApplyHelpResult.stdout).toContain("reviewer lane");

    const hooksHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(hooksHelpResult.exitCode).toBe(0);
    expect(hooksHelpResult.stdout).toContain(
      "Generate the local bridge / fallback helper bundle"
    );
    expect(hooksHelpResult.stdout).toContain("Project directory to anchor generated hook helpers to");

    const mcpHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpHelpResult.exitCode).toBe(0);
    expect(mcpHelpResult.stdout).toContain(
      "Print a ready-to-paste MCP config snippet for a supported host"
    );
    expect(mcpHelpResult.stdout).toContain("Target host: codex, claude, gemini, or generic");

    const mcpInstallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpInstallHelpResult.exitCode).toBe(0);
    expect(mcpInstallHelpResult.stdout).toContain(
      "Install the recommended project-scoped MCP wiring for a supported host"
    );
    expect(mcpInstallHelpResult.stdout).toContain("Target host: codex");

    const mcpApplyGuidanceHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpApplyGuidanceHelpResult.exitCode).toBe(0);
    expect(mcpApplyGuidanceHelpResult.stdout).toContain(
      "Safely create or update the managed Codex Auto Memory block inside AGENTS.md"
    );
    expect(mcpApplyGuidanceHelpResult.stdout).toContain("Target host: codex");

    const mcpDoctorHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "doctor", "--help"],
      installDir,
      envWithBin
    );
    expect(mcpDoctorHelpResult.exitCode).toBe(0);
    expect(mcpDoctorHelpResult.stdout).toContain(
      "Inspect the recommended project-scoped MCP wiring without writing host config"
    );
    expect(mcpDoctorHelpResult.stdout).toContain(
      "Target host: codex, claude, gemini, generic, or all"
    );

    const skillsHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(skillsHelpResult.exitCode).toBe(0);
    expect(skillsHelpResult.stdout).toMatch(
      /Install a Codex skill that teaches search -> timeline -> details memory\s+retrieval/
    );
    expect(skillsHelpResult.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsInstallHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "install", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsInstallHelpResult.exitCode).toBe(0);
    expect(integrationsInstallHelpResult.stdout).toContain(
      "Install the recommended project-scoped Codex integration stack"
    );
    expect(integrationsInstallHelpResult.stdout).toMatch(/without updating\s+AGENTS\.md/);
    expect(integrationsInstallHelpResult.stdout).toContain("Target host: codex");
    expect(integrationsInstallHelpResult.stdout).toMatch(
      /Skill install surface: runtime, official-user, or\s+official-project/
    );

    const integrationsApplyHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsApplyHelpResult.exitCode).toBe(0);
    expect(integrationsApplyHelpResult.stdout).toMatch(
      /Install the recommended Codex integration stack and safely apply the managed\s+AGENTS guidance block/
    );
    expect(integrationsApplyHelpResult.stdout).toContain("Target host: codex");

    const integrationsDoctorHelpResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--help"],
      installDir,
      envWithBin
    );
    expect(integrationsDoctorHelpResult.exitCode).toBe(0);
    expect(integrationsDoctorHelpResult.stdout).toMatch(
      /Inspect the current Codex integration stack without mutating memory or host\s+config/
    );
    expect(integrationsDoctorHelpResult.stdout).toContain("Target host: codex");
  }, 180_000);

  it("preserves custom fields on the codex_auto_memory install entry from the packed tarball", async () => {
    const homeDir = await tempDir("cam-tarball-preserve-home-");
    const packDir = await tempDir("cam-tarball-preserve-pack-");
    const installDir = await tempDir("cam-tarball-preserve-install-");
    const realInstallDir = await fs.realpath(installDir);
    const env = isolatedEnv(homeDir);

    const packResult = runCommandCapture(
      npmCommand(),
      ["pack", "--pack-destination", packDir],
      process.cwd(),
      env
    );
    expect(packResult.exitCode, packResult.stderr).toBe(0);

    const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarballName).toBeTruthy();
    const tarballPath = path.join(packDir, tarballName!);

    expect(runCommandCapture(npmCommand(), ["init", "-y"], installDir, env).exitCode).toBe(0);
    expect(
      runCommandCapture(
        npmCommand(),
        ["install", "--no-package-lock", tarballPath],
        installDir,
        env
      ).exitCode
    ).toBe(0);

    const envWithBin = {
      ...env,
      PATH: `${path.join(installDir, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`
    };

    await fs.mkdir(path.join(installDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(installDir, ".codex", "config.toml"),
      [
        "[mcp_servers.codex_auto_memory]",
        'command = "cam"',
        'args = ["mcp", "serve"]',
        `cwd = ${JSON.stringify(realInstallDir)}`,
        'label = "keep-me"'
      ].join("\n"),
      "utf8"
    );

    const result = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      host: "codex",
      action: "unchanged",
      preservedCustomFields: ["label"]
    });
    expect(
      toml.parse(await fs.readFile(path.join(installDir, ".codex", "config.toml"), "utf8"))
    ).toMatchObject({
      mcp_servers: {
        codex_auto_memory: {
          command: "cam",
          args: ["mcp", "serve"],
          cwd: realInstallDir,
          label: "keep-me"
        }
      }
    });
  }, 180_000);
});
