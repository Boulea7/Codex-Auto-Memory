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
        message: "remember that reviewer subagents always use npm"
      }
    })
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
    expect(buildPayload.snapshot.teamMemory).toEqual({ available: false });
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
    expect(candidatesPayload.summary.statusCounts.pending).toBeGreaterThanOrEqual(2);
    await expect(fs.stat(candidatesPayload.registryPath)).resolves.toBeDefined();

    const durableCandidate = candidatesPayload.entries.find(
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
        proposalOnly: boolean;
        suggestedTargetFile: string | null;
        suggestedBlock: string;
      };
    };
    expect(promoteInstruction).toMatchObject({
      promotionOutcome: "proposal-only",
      entry: {
        status: "approved",
        targetSurface: "instruction-memory"
      },
      instructionProposal: {
        proposalOnly: true
      }
    });
    expect(promoteInstruction.instructionProposal?.suggestedBlock).toContain(
      "Always run pnpm test before build"
    );
    expect(await store.listEntries("project")).toEqual(beforeInstructionPromote);
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
