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
});
