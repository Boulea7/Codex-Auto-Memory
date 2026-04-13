import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDream } from "../src/lib/commands/dream.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import {
  initGitRepo,
  makeAppConfig,
  makeRolloutFixture,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function subagentRolloutFixture(
  projectDir: string,
  message = "remember that reviewer subagents always use npm",
  sessionId = "session-subagent",
  parentSessionId = "session-primary"
): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-14T00:40:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        forked_from_id: parentSessionId,
        timestamp: "2026-03-14T00:40:00.000Z",
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
      timestamp: "2026-03-14T00:40:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message
      }
    })
  ].join("\n");
}

function teamWorkflowContents(entryId: string, summary: string, detail: string): string {
  return [
    "# Workflow",
    "",
    "<!-- cam:team-topic workflow -->",
    "",
    `## ${entryId}`,
    `<!-- cam:team-entry {"id":"${entryId}","scopeHint":"project","updatedAt":"2026-03-15T00:00:00.000Z"} -->`,
    `Summary: ${summary}`,
    "Details:",
    `- ${detail}`,
    ""
  ].join("\n");
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("dream sidecar", () => {
  it("builds an auditable snapshot without mutating canonical durable memory", async () => {
    const homeDir = await tempDir("cam-dream-home-");
    const repoDir = await tempDir("cam-dream-repo-");
    const memoryRoot = await tempDir("cam-dream-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "CLAUDE.md"), "# Local instructions\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const project = detectProjectContext(repoDir);
    const store = new MemoryStore(project, makeAppConfig({
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    }));
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const memoryBefore = await fs.readFile(store.getMemoryFile("project"), "utf8");
    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(
        repoDir,
        "Continue the middleware work and remember that this repository prefers pnpm."
      ),
      "utf8"
    );

    const buildPayload = JSON.parse(
      await runDream("build", {
        cwd: repoDir,
        rollout: rolloutPath,
        json: true
      })
    ) as {
      action: "build";
      enabled: boolean;
      snapshotPaths: string[];
      auditPath: string;
      recoveryPath: string;
      snapshot: {
        rolloutPath: string;
        continuityCompaction: {
          project: { goal: string };
          projectLocal: { incompleteNext: string[] };
        };
        relevantMemoryRefs: Array<{ ref: string; reason: string }>;
        promotionCandidates: {
          instructionLikeCandidates: unknown[];
          durableMemoryCandidates: unknown[];
        };
        teamMemory: { available: boolean };
      };
    };

    expect(buildPayload.action).toBe("build");
    expect(buildPayload.enabled).toBe(true);
    expect(buildPayload.snapshot.rolloutPath).toBe(rolloutPath);
    expect(buildPayload.snapshot.continuityCompaction.project.goal).toContain("middleware work");
    expect(buildPayload.snapshot.relevantMemoryRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(buildPayload.snapshot.promotionCandidates.instructionLikeCandidates).toBeDefined();
    expect(buildPayload.snapshot.promotionCandidates.durableMemoryCandidates).toBeDefined();
    expect(buildPayload.snapshot.teamMemory).toMatchObject({
      available: false,
      status: "missing",
      entryCount: 0,
      topicCount: 0
    });
    await Promise.all(buildPayload.snapshotPaths.map((filePath) => expect(fs.stat(filePath)).resolves.toBeDefined()));
    expect(await fs.readFile(store.getMemoryFile("project"), "utf8")).toBe(memoryBefore);

    const inspectPayload = JSON.parse(
      await runDream("inspect", {
        cwd: repoDir,
        json: true
      })
    ) as {
      enabled: boolean;
      snapshots: {
        project: { status: string; latestPath: string | null; relevantMemoryRefCount: number };
        projectLocal: { status: string; latestPath: string | null };
      };
      auditPath: string;
      recoveryPath: string;
    };

    expect(inspectPayload.enabled).toBe(true);
    expect(inspectPayload.snapshots.project.status).toBe("available");
    expect(inspectPayload.snapshots.project.latestPath).toBe(buildPayload.snapshotPaths[0]);
    expect(inspectPayload.snapshots.project.relevantMemoryRefCount).toBeGreaterThan(0);
    expect(inspectPayload.auditPath).toBe(buildPayload.auditPath);
    expect(inspectPayload.recoveryPath).toBe(buildPayload.recoveryPath);
  });

  it("surfaces shared team memory availability in dream snapshots", async () => {
    const homeDir = await tempDir("cam-dream-team-home-");
    const repoDir = await tempDir("cam-dream-team-repo-");
    const memoryRoot = await tempDir("cam-dream-team-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "TEAM_MEMORY.md"), "# Team Memory\n", "utf8");
    await fs.mkdir(path.join(repoDir, "team-memory"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "team-memory", "workflow.md"),
      teamWorkflowContents(
        "prefer-pnpm-shared",
        "Prefer pnpm from the shared workflow memory.",
        "Use pnpm across the shared project workflow."
      ),
      "utf8"
    );
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "team-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "Continue the shared pnpm workflow review."),
      "utf8"
    );

    const buildPayload = JSON.parse(
      await runDream("build", {
        cwd: repoDir,
        rollout: rolloutPath,
        json: true
      })
    ) as {
      snapshot: {
        teamMemory: {
          available: boolean;
          status: string;
          topicCount: number;
          entryCount: number;
          sourceRoot: string | null;
        };
      };
    };

    expect(buildPayload.snapshot.teamMemory).toMatchObject({
      available: true,
      status: "available",
      topicCount: 1,
      entryCount: 1,
      sourceRoot: expect.stringContaining(`${path.sep}team-memory`)
    });
  });

  it("requires TEAM_MEMORY.md before surfacing team-memory entries", async () => {
    const homeDir = await tempDir("cam-dream-team-manifest-home-");
    const repoDir = await tempDir("cam-dream-team-manifest-repo-");
    const memoryRoot = await tempDir("cam-dream-team-manifest-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.mkdir(path.join(repoDir, "team-memory"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "team-memory", "workflow.md"),
      teamWorkflowContents(
        "prefer-pnpm-shared",
        "Prefer pnpm from the shared workflow memory.",
        "Use pnpm across the shared project workflow."
      ),
      "utf8"
    );
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "team-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "Continue the shared pnpm workflow review."),
      "utf8"
    );

    const buildPayload = JSON.parse(
      await runDream("build", {
        cwd: repoDir,
        rollout: rolloutPath,
        json: true
      })
    ) as {
      snapshot: {
        teamMemory: {
          available: boolean;
          status: string;
          topicCount: number;
          entryCount: number;
        };
      };
    };

    expect(buildPayload.snapshot.teamMemory).toMatchObject({
      available: false,
      status: "missing",
      topicCount: 0,
      entryCount: 0
    });
  });

  it("reconciles candidates into an explicit review queue and only promotes durable memory after approval", async () => {
    const homeDir = await tempDir("cam-dream-review-home-");
    const repoDir = await tempDir("cam-dream-review-repo-");
    const memoryRoot = await tempDir("cam-dream-review-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Project instructions\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const project = detectProjectContext(repoDir);
    const store = new MemoryStore(project, makeAppConfig({
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    }));
    await store.ensureLayout();

    const durableRolloutPath = path.join(repoDir, "durable-rollout.jsonl");
    await fs.writeFile(
      durableRolloutPath,
      makeRolloutFixture(
        repoDir,
        "The runbook lives at https://docs.example.com/runbook. Continue the middleware work."
      ),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: durableRolloutPath,
      json: true
    });

    const durableCandidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: "durable-memory" | "instruction-memory";
        status: string;
        summary: string;
      }>;
    };
    const durableCandidate = durableCandidatesPayload.entries.find(
      (entry) =>
        entry.targetSurface === "durable-memory" &&
        entry.summary.includes("runbook lives")
    );
    expect(durableCandidate).toBeDefined();

    const approvedDurable = JSON.parse(
      await runDream("review", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        approve: true,
        note: "Looks stable enough for learned durable memory.",
        json: true
      })
    ) as {
      entry: {
        candidateId: string;
        status: string;
      };
    };
    expect(approvedDurable.entry).toMatchObject({
      candidateId: durableCandidate!.candidateId,
      status: "approved"
    });

    const promoteDurable = JSON.parse(
      await runDream("promote", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        json: true
      })
    ) as {
      promotionOutcome: "applied" | "noop";
      entry: {
        status: string;
        targetSurface: string;
      };
      durableMemory?: {
        ref: string;
        reviewRefState: string;
      };
    };
    expect(["applied", "noop"]).toContain(promoteDurable.promotionOutcome);
    expect(promoteDurable.entry).toMatchObject({
      status: "promoted",
      targetSurface: "durable-memory"
    });
    expect(promoteDurable.durableMemory?.ref).toContain("project:active:");

    const instructionRolloutPath = path.join(repoDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      instructionRolloutPath,
      makeRolloutFixture(
        repoDir,
        "Always run pnpm test before build in this repository."
      ),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: instructionRolloutPath,
      json: true
    });

    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: "durable-memory" | "instruction-memory";
        status: string;
        summary: string;
      }>;
      summary: {
        totalCount: number;
        statusCounts: Record<string, number>;
      };
      registryPath: string;
    };

    expect(candidatesPayload.summary.totalCount).toBeGreaterThanOrEqual(2);
    expect(candidatesPayload.summary.statusCounts.pending).toBeGreaterThanOrEqual(1);
    await expect(fs.stat(candidatesPayload.registryPath)).resolves.toBeDefined();

    const promotedEntries = await store.listEntries("project");
    expect(
      promotedEntries.some((entry) =>
        entry.summary.includes("runbook lives at https://docs.example.com/runbook")
      )
    ).toBe(true);

    const instructionCandidate = candidatesPayload.entries.find(
      (entry) =>
        entry.targetSurface === "instruction-memory" &&
        entry.summary.includes("Always run pnpm test before build")
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: repoDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      note: "Keep this as a proposal-only instruction candidate.",
      json: true
    });

    const beforeInstructionPromote = await store.listEntries("project");
    const agentsPath = path.join(repoDir, "AGENTS.md");
    const beforeInstructionFile = await fs.readFile(agentsPath, "utf8");
    const promoteInstruction = JSON.parse(
      await runDream("promote", {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      promotionOutcome: string;
      entry: {
        status: string;
        targetSurface: string;
      };
      instructionProposal?: {
        schemaVersion: number;
        proposalOnly: boolean;
        neverAutoEditsInstructionFiles: boolean;
        artifactDir: string;
        selectedTargetByPolicy: {
          path: string;
          kind: string;
          exists: boolean;
          selectionReason: string;
        };
        resolvedApplyTarget: {
          path: string;
          kind: string;
          exists: boolean;
        } | null;
        selectedTarget: {
          path: string;
          kind: string;
          exists: boolean;
          selectionReason: string;
        };
        applyReadiness?: {
          status: string;
          recommendedOperation: string;
        };
        patchPlan?: {
          operation: string;
          anchor: string;
          unifiedDiff: string;
        } | null;
        manualWorkflow?: {
          summaryPath: string;
          diffPath: string;
          applyPrepPath: string;
          nextRecommendedActions: string[];
        };
        rankedTargets: Array<{
          path: string;
          kind: string;
          exists: boolean;
        }>;
        managedBlock?: {
          startMarker: string;
          endMarker: string;
        };
        guidanceBlock: string;
        patchPreview: string;
        artifactPath: string;
      };
    };
    expect(promoteInstruction).toMatchObject({
      promotionOutcome: "proposal-only",
      entry: {
        status: "manual-apply-pending",
        targetSurface: "instruction-memory"
      },
      instructionProposal: {
        schemaVersion: 2,
        proposalOnly: true,
        neverAutoEditsInstructionFiles: true
      }
    });
    expect(promoteInstruction.instructionProposal?.selectedTargetByPolicy).toMatchObject({
      path: expect.stringContaining(`${path.sep}AGENTS.md`),
      kind: "agents-root",
      exists: true
    });
    expect(promoteInstruction.instructionProposal?.resolvedApplyTarget).toMatchObject({
      path: expect.stringContaining(`${path.sep}AGENTS.md`),
      kind: "agents-root",
      exists: true
    });
    expect(promoteInstruction.instructionProposal?.selectedTarget).toMatchObject({
      path: expect.stringContaining(`${path.sep}AGENTS.md`),
      kind: "agents-root",
      exists: true
    });
    expect(promoteInstruction.instructionProposal?.rankedTargets[0]).toMatchObject({
      path: expect.stringContaining(`${path.sep}AGENTS.md`),
      kind: "agents-root"
    });
    expect(promoteInstruction.instructionProposal?.guidanceBlock).toContain(
      "Always run pnpm test before build"
    );
    expect(promoteInstruction.instructionProposal?.managedBlock).toMatchObject({
      startMarker: "<!-- codex-auto-memory:instruction-proposal:start -->",
      endMarker: "<!-- codex-auto-memory:instruction-proposal:end -->"
    });
    expect(promoteInstruction.instructionProposal?.applyReadiness).toMatchObject({
      status: "safe"
    });
    expect(promoteInstruction.instructionProposal?.patchPlan).toMatchObject({
      operation: expect.stringMatching(/append-block|replace-block/),
      unifiedDiff: expect.stringContaining("AGENTS.md")
    });
    expect(promoteInstruction.instructionProposal?.manualWorkflow?.diffPath).toContain(
      `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
    );
    expect(promoteInstruction.instructionProposal?.patchPreview).toContain("AGENTS.md");
    expect(promoteInstruction.instructionProposal?.artifactPath).toContain(
      `${path.sep}dream${path.sep}review${path.sep}proposals${path.sep}`
    );
    await expect(
      fs.stat(promoteInstruction.instructionProposal!.artifactDir)
    ).resolves.toBeDefined();
    await expect(
      fs.stat(promoteInstruction.instructionProposal!.artifactPath)
    ).resolves.toBeDefined();
    await expect(
      fs.stat(promoteInstruction.instructionProposal!.manualWorkflow!.summaryPath)
    ).resolves.toBeDefined();
    await expect(
      fs.stat(promoteInstruction.instructionProposal!.manualWorkflow!.diffPath)
    ).resolves.toBeDefined();
    expect(await fs.readFile(agentsPath, "utf8")).toBe(beforeInstructionFile);
    expect(await store.listEntries("project")).toEqual(beforeInstructionPromote);
  });

  it("supports apply-prep for instruction proposals and reports stale targets without editing files", async () => {
    const homeDir = await tempDir("cam-dream-apply-prep-home-");
    const repoDir = await tempDir("cam-dream-apply-prep-repo-");
    const memoryRoot = await tempDir("cam-dream-apply-prep-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "Always run pnpm lint before pnpm build."),
      "utf8"
    );

    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });

    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
      }>;
    };
    const instructionCandidate = candidatesPayload.entries.find(
      (entry) => entry.targetSurface === "instruction-memory"
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: repoDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });
    await runDream("promote", {
      cwd: repoDir,
      candidateId: instructionCandidate!.candidateId,
      json: true
    });

    const beforeApplyPrepContents = await fs.readFile(path.join(repoDir, "AGENTS.md"), "utf8");
    const applyPrepPayload = JSON.parse(
      await runDream("apply-prep" as never, {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      action: string;
      applyReadiness: {
        status: string;
      };
      instructionProposal: {
        neverAutoEditsInstructionFiles: boolean;
      };
    };
    expect(applyPrepPayload).toMatchObject({
      action: "apply-prep",
      applyReadiness: {
        status: "safe"
      },
      instructionProposal: {
        neverAutoEditsInstructionFiles: true
      }
    });
    expect(await fs.readFile(path.join(repoDir, "AGENTS.md"), "utf8")).toBe(beforeApplyPrepContents);

    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo rules\n\nManual drift.\n", "utf8");
    const staleApplyPrepPayload = JSON.parse(
      await runDream("apply-prep" as never, {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      applyReadiness: {
        status: string;
        staleReason?: string;
      };
      instructionProposal: {
        applyReadiness: {
          status: string;
        };
      };
    };
    expect(staleApplyPrepPayload.applyReadiness).toMatchObject({
      status: "stale"
    });
    expect(staleApplyPrepPayload.applyReadiness.staleReason).toBeTruthy();
    expect(staleApplyPrepPayload.instructionProposal.applyReadiness).toMatchObject({
      status: "stale"
    });
    const staleCandidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        promotion: {
          applyReadinessStatus?: string;
        };
      }>;
    };
    expect(
      staleCandidatesPayload.entries.find((entry) => entry.candidateId === instructionCandidate!.candidateId)
    ).toMatchObject({
      promotion: {
        applyReadinessStatus: "stale"
      }
    });

    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "", "utf8");
    const emptyFileApplyPrepPayload = JSON.parse(
      await runDream("apply-prep" as never, {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      applyReadiness: {
        status: string;
      };
    };
    expect(emptyFileApplyPrepPayload.applyReadiness).toMatchObject({
      status: "stale"
    });
  });

  it("lets reviewers reject a manual-apply-pending instruction proposal", async () => {
    const homeDir = await tempDir("cam-dream-manual-apply-review-home-");
    const repoDir = await tempDir("cam-dream-manual-apply-review-repo-");
    const memoryRoot = await tempDir("cam-dream-manual-apply-review-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "instruction-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "Always run pnpm lint before pnpm build."),
      "utf8"
    );

    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });
    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
      }>;
    };
    const instructionCandidate = candidatesPayload.entries.find(
      (entry) => entry.targetSurface === "instruction-memory"
    );
    expect(instructionCandidate).toBeDefined();

    await runDream("review", {
      cwd: repoDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });
    const promotePayload = JSON.parse(
      await runDream("promote", {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        json: true
      })
    ) as {
      entry: {
        status: string;
      };
    };
    expect(promotePayload.entry.status).toBe("manual-apply-pending");

    const rejectedPayload = JSON.parse(
      await runDream("review", {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        reject: true,
        json: true
      })
    ) as {
      entry: {
        candidateId: string;
        status: string;
      };
    };
    expect(rejectedPayload.entry).toMatchObject({
      candidateId: instructionCandidate!.candidateId,
      status: "rejected"
    });
  });

  it("keeps shared and project-local candidates active when builds target different scopes", async () => {
    const homeDir = await tempDir("cam-dream-scope-home-");
    const repoDir = await tempDir("cam-dream-scope-repo-");
    const memoryRoot = await tempDir("cam-dream-scope-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const sharedRolloutPath = path.join(repoDir, "shared-rollout.jsonl");
    await fs.writeFile(
      sharedRolloutPath,
      makeRolloutFixture(repoDir, "The shared runbook lives at https://docs.example.com/runbook."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: sharedRolloutPath,
      scope: "project",
      json: true
    });

    const localRolloutPath = path.join(repoDir, "local-rollout.jsonl");
    await fs.writeFile(
      localRolloutPath,
      makeRolloutFixture(repoDir, "Keep the worktree-local scratch command handy for this branch."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: localRolloutPath,
      scope: "project-local",
      json: true
    });

    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        summary: string;
        status: string;
        targetSurface: string;
      }>;
    };

    expect(
      candidatesPayload.entries.find((entry) => entry.summary.includes("shared runbook lives"))
    ).toMatchObject({
      status: "pending",
      targetSurface: "durable-memory"
    });
    expect(
      candidatesPayload.entries.find((entry) => entry.summary.includes("worktree-local scratch command"))
    ).toMatchObject({
      status: "pending",
      targetSurface: "durable-memory"
    });
  });

  it("does not reopen stale or promoted candidates through review", async () => {
    const homeDir = await tempDir("cam-dream-terminal-home-");
    const repoDir = await tempDir("cam-dream-terminal-repo-");
    const memoryRoot = await tempDir("cam-dream-terminal-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "terminal-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "The runbook lives at https://docs.example.com/runbook."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });
    const firstCandidates = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; targetSurface: string; summary: string }>;
    };
    const durableCandidate = firstCandidates.entries.find(
      (entry) => entry.targetSurface === "durable-memory"
    );
    expect(durableCandidate).toBeDefined();

    await runDream("review", {
      cwd: repoDir,
      candidateId: durableCandidate!.candidateId,
      approve: true,
      json: true
    });
    await runDream("promote", {
      cwd: repoDir,
      candidateId: durableCandidate!.candidateId,
      json: true
    });

    await expect(
      runDream("review", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        defer: true,
        json: true
      })
    ).rejects.toThrow(/cannot be reviewed/i);

    const staleRolloutPath = path.join(repoDir, "stale-rollout.jsonl");
    await fs.writeFile(
      staleRolloutPath,
      makeRolloutFixture(repoDir, "Keep the temporary debug shell alias handy while this branch is active."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: staleRolloutPath,
      json: true
    });
    const staleCandidatesBeforeReplacement = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; summary: string; status: string }>;
    };
    const reviewableStaleCandidate = staleCandidatesBeforeReplacement.entries.find(
      (entry) =>
        entry.summary.includes("temporary debug shell alias") &&
        entry.status === "pending"
    );
    expect(reviewableStaleCandidate).toBeDefined();

    const replacementRolloutPath = path.join(repoDir, "replacement-rollout.jsonl");
    await fs.writeFile(
      replacementRolloutPath,
      makeRolloutFixture(repoDir, "Prefer pnpm in this repository."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: replacementRolloutPath,
      json: true
    });

    const secondCandidates = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{ candidateId: string; targetSurface: string; summary: string; status: string }>;
    };
    const staleCandidate = secondCandidates.entries.find(
      (entry) => entry.candidateId === reviewableStaleCandidate!.candidateId
    );
    expect(staleCandidate).toBeDefined();
    expect(staleCandidate?.status).toBe("stale");

    await expect(
      runDream("review", {
        cwd: repoDir,
        candidateId: reviewableStaleCandidate!.candidateId,
        approve: true,
        json: true
      })
    ).rejects.toThrow(/cannot be reviewed/i);
  });

  it("supports explicit instruction target override without changing the default ranking", async () => {
    const homeDir = await tempDir("cam-dream-target-home-");
    const repoDir = await tempDir("cam-dream-target-repo-");
    const memoryRoot = await tempDir("cam-dream-target-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await fs.writeFile(path.join(repoDir, "AGENTS.md"), "# Repo rules\n", "utf8");
    await fs.writeFile(path.join(repoDir, "CLAUDE.md"), "# Claude rules\n", "utf8");
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "instruction-target-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(repoDir, "Always run pnpm lint before pnpm build."),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });

    const candidatePayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
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
      cwd: repoDir,
      candidateId: instructionCandidate!.candidateId,
      approve: true,
      json: true
    });

    const previewPayload = JSON.parse(
      await runDream("promote-prep", {
        cwd: repoDir,
        candidateId: instructionCandidate!.candidateId,
        targetFile: path.join(repoDir, "CLAUDE.md"),
        json: true
      } as never)
    ) as {
      entry: {
        status: string;
      };
      preview: {
        selectedTargetByPolicy: {
          path: string;
        };
        selectedTarget: {
          path: string;
          kind: string;
        };
      };
    };

    expect(previewPayload.entry.status).toBe("approved");
    expect(previewPayload.preview.selectedTargetByPolicy.path).toContain(`${path.sep}AGENTS.md`);
    expect(previewPayload.preview.selectedTarget).toMatchObject({
      path: expect.stringContaining(`${path.sep}CLAUDE.md`),
      kind: "claude-project"
    });
  });

  it("keeps subagent-derived candidates in a blocked reviewer lane", async () => {
    const homeDir = await tempDir("cam-dream-subagent-home-");
    const repoDir = await tempDir("cam-dream-subagent-repo-");
    const memoryRoot = await tempDir("cam-dream-subagent-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "subagent-rollout.jsonl");
    await fs.writeFile(rolloutPath, subagentRolloutFixture(repoDir), "utf8");

    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });

    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        originKind: string;
        status: string;
      }>;
    };

    expect(candidatesPayload.entries.length).toBeGreaterThan(0);
    expect(candidatesPayload.entries.every((entry) => entry.originKind === "subagent")).toBe(true);
    expect(candidatesPayload.entries.every((entry) => entry.status === "blocked")).toBe(true);

    await expect(
      runDream("review", {
        cwd: repoDir,
        candidateId: candidatesPayload.entries[0]!.candidateId,
        approve: true,
        json: true
      })
    ).rejects.toThrow("cannot be approved directly");

    await expect(
      runDream("promote", {
        cwd: repoDir,
        candidateId: candidatesPayload.entries[0]!.candidateId,
        json: true
      })
    ).rejects.toThrow("is blocked and cannot be promoted");
  });

  it("allows explicit adopt and promote-prep for blocked subagent durable candidates", async () => {
    const homeDir = await tempDir("cam-dream-subagent-adopt-home-");
    const repoDir = await tempDir("cam-dream-subagent-adopt-repo-");
    const memoryRoot = await tempDir("cam-dream-subagent-adopt-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const project = detectProjectContext(repoDir);
    const store = new MemoryStore(project, {
      ...makeAppConfig({
        dreamSidecarEnabled: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();

    const rolloutPath = path.join(repoDir, "subagent-durable-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      subagentRolloutFixture(
        repoDir,
        "The runbook lives at https://docs.example.com/runbook.",
        "session-subagent-durable"
      ),
      "utf8"
    );

    await runDream("build", {
      cwd: repoDir,
      rollout: rolloutPath,
      json: true
    });

    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
        originKind: string;
        status: string;
        summary: string;
      }>;
    };
    const durableCandidate = candidatesPayload.entries.find(
      (entry) =>
        entry.originKind === "subagent" &&
        entry.targetSurface === "durable-memory" &&
        entry.summary.includes("runbook lives")
    );
    expect(durableCandidate).toBeDefined();

    const adoptPayload = JSON.parse(
      await runDream("adopt", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        note: "Escalate this subagent note into the primary review lane.",
        json: true
      })
    ) as {
      action: string;
      entry: {
        candidateId: string;
        status: string;
        originKind: string;
        adoption?: {
          adoptionKind: string;
        };
      };
    };
    expect(adoptPayload).toMatchObject({
      action: "adopt",
      entry: {
        candidateId: durableCandidate!.candidateId,
        status: "pending",
        originKind: "subagent",
        adoption: {
          adoptionKind: "manual"
        }
      }
    });

    const reviewPayload = JSON.parse(
      await runDream("review", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        approve: true,
        json: true
      })
    ) as {
      entry: {
        status: string;
      };
    };
    expect(reviewPayload.entry.status).toBe("approved");

    const beforePromotePrep = await store.listEntries("project");
    const previewPayload = JSON.parse(
      await runDream("promote-prep", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        json: true
      })
    ) as {
      action: string;
      entry: {
        candidateId: string;
        promotion: {
          preparedAt?: string;
          preparedPreviewDigest?: string;
        };
      };
      resolvedTarget: {
        targetSurface: string;
        scope: string;
        topic: string;
        id: string;
      };
      preview: {
        lifecycleAction: string;
        wouldWrite: boolean;
        ref: string;
        targetPath: string;
      };
    };
    expect(previewPayload).toMatchObject({
      action: "promote-prep",
      entry: {
        candidateId: durableCandidate!.candidateId,
        promotion: {
          preparedAt: expect.any(String),
          preparedPreviewDigest: expect.any(String)
        }
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
    expect(await store.listEntries("project")).toEqual(beforePromotePrep);
  });

  it("marks disappeared candidates as stale on a later build", async () => {
    const homeDir = await tempDir("cam-dream-stale-home-");
    const repoDir = await tempDir("cam-dream-stale-repo-");
    const memoryRoot = await tempDir("cam-dream-stale-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const firstRolloutPath = path.join(repoDir, "first-rollout.jsonl");
    await fs.writeFile(
      firstRolloutPath,
      makeRolloutFixture(
        repoDir,
        "The runbook lives at https://docs.example.com/runbook. Continue the middleware work."
      ),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: firstRolloutPath,
      json: true
    });

    const initialCandidates = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
        status: string;
        summary: string;
      }>;
    };
    const durableCandidate = initialCandidates.entries.find(
      (entry) =>
        entry.targetSurface === "durable-memory" && entry.summary.includes("runbook lives")
    );
    expect(durableCandidate?.status).toBe("pending");

    const secondRolloutPath = path.join(repoDir, "second-rollout.jsonl");
    await fs.writeFile(
      secondRolloutPath,
      makeRolloutFixture(
        repoDir,
        "Always run pnpm test before build in this repository."
      ),
      "utf8"
    );
    await runDream("build", {
      cwd: repoDir,
      rollout: secondRolloutPath,
      json: true
    });

    const nextCandidates = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        status: string;
        summary: string;
      }>;
    };
    expect(
      nextCandidates.entries.find((entry) => entry.candidateId === durableCandidate?.candidateId)
    ).toMatchObject({
      candidateId: durableCandidate?.candidateId,
      status: "stale"
    });
  });

  it("writes candidate recovery markers when review or promote audit append fails", async () => {
    const homeDir = await tempDir("cam-dream-recovery-home-");
    const repoDir = await tempDir("cam-dream-recovery-repo-");
    const memoryRoot = await tempDir("cam-dream-recovery-memory-");
    process.env.HOME = homeDir;
    await initGitRepo(repoDir);
    await writeCamConfig(
      repoDir,
      makeAppConfig({
        dreamSidecarEnabled: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        dreamSidecarEnabled: true
      }
    );

    const rolloutPath = path.join(repoDir, "recovery-rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(
        repoDir,
        "The runbook lives at https://docs.example.com/runbook. Continue the middleware work."
      ),
      "utf8"
    );
    const buildPayload = JSON.parse(
      await runDream("build", {
        cwd: repoDir,
        rollout: rolloutPath,
        json: true
      })
    ) as {
      candidateAuditPath: string;
      candidateRecoveryPath: string;
    };
    const candidatesPayload = JSON.parse(
      await runDream("candidates", {
        cwd: repoDir,
        json: true
      })
    ) as {
      entries: Array<{
        candidateId: string;
        targetSurface: string;
      }>;
    };
    const durableCandidate = candidatesPayload.entries.find(
      (entry) => entry.targetSurface === "durable-memory"
    );
    expect(durableCandidate).toBeDefined();

    await fs.rm(buildPayload.candidateAuditPath, { force: true });
    await fs.mkdir(buildPayload.candidateAuditPath, { recursive: true });

    await expect(
      runDream("review", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        approve: true,
        json: true
      })
    ).rejects.toThrow();
    const reviewRecovery = JSON.parse(
      await fs.readFile(buildPayload.candidateRecoveryPath, "utf8")
    ) as {
      failedStage: string;
      candidateId?: string;
    };
    expect(reviewRecovery).toMatchObject({
      failedStage: "candidate-audit-write",
      candidateId: durableCandidate!.candidateId
    });

    await fs.rm(buildPayload.candidateAuditPath, { recursive: true, force: true });
    await fs.writeFile(buildPayload.candidateAuditPath, "", "utf8");

    await runDream("review", {
      cwd: repoDir,
      candidateId: durableCandidate!.candidateId,
      approve: true,
      json: true
    });

    await fs.rm(buildPayload.candidateAuditPath, { force: true });
    await fs.mkdir(buildPayload.candidateAuditPath, { recursive: true });

    await expect(
      runDream("promote", {
        cwd: repoDir,
        candidateId: durableCandidate!.candidateId,
        json: true
      })
    ).rejects.toThrow();
    const promoteRecovery = JSON.parse(
      await fs.readFile(buildPayload.candidateRecoveryPath, "utf8")
    ) as {
      failedStage: string;
      candidateId?: string;
    };
    expect(promoteRecovery).toMatchObject({
      failedStage: "promotion-bridge",
      candidateId: durableCandidate!.candidateId
    });
  });
});
