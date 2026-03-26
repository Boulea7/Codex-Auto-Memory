import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { restoreOptionalEnv } from "./helpers/env.js";
import { SyncService } from "../src/lib/domain/sync-service.js";
import {
  makeRolloutFixture,
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
  restoreOptionalEnv("HOME", originalHome);
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runRecall", () => {
  it("uses the recommended search preset by default when state and limit flags are omitted", async () => {
    const homeDir = await tempDir("cam-recall-default-preset-home-");
    const projectDir = await tempDir("cam-recall-default-preset-project-");
    const memoryRoot = await tempDir("cam-recall-default-preset-memory-");
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

    for (let index = 1; index <= 9; index += 1) {
      await store.remember(
        "project",
        "workflow",
        `historical-pnpm-${index}`,
        `Historical pnpm migration note ${index}.`,
        [`Historical archive note ${index}.`],
        "Manual note."
      );
    }
    await store.forget("project", "Historical pnpm migration note", { archive: true });

    const result = runCli(projectDir, ["recall", "search", "historical", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      retrievalMode: string;
      retrievalFallbackReason?: string;
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      retrievalMode: "index"
    });
    expect(output.results).toHaveLength(8);
    expect(output.results.every((result) => result.state === "archived")).toBe(true);
  });

  it("prefers active memory before archived fallback when search state is auto", async () => {
    const homeDir = await tempDir("cam-recall-auto-active-home-");
    const projectDir = await tempDir("cam-recall-auto-active-project-");
    const memoryRoot = await tempDir("cam-recall-auto-active-memory-");
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
    await store.remember(
      "project",
      "workflow",
      "historical-pnpm",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical pnpm", { archive: true });

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--state", "auto", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      retrievalMode: string;
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "active",
      fallbackUsed: false,
      retrievalMode: "index"
    });
    expect(output.results).toEqual([
      expect.objectContaining({
        ref: "project:active:workflow:prefer-pnpm",
        state: "active",
        topic: "workflow"
      })
    ]);
  });

  it("falls back to archived memory when search state is auto and active memory has no match", async () => {
    const homeDir = await tempDir("cam-recall-auto-archived-home-");
    const projectDir = await tempDir("cam-recall-auto-archived-project-");
    const memoryRoot = await tempDir("cam-recall-auto-archived-memory-");
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
      "historical-pnpm",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical pnpm", { archive: true });

    const searchResult = runCli(projectDir, [
      "recall",
      "search",
      "historical",
      "--state",
      "auto",
      "--json"
    ]);
    expect(searchResult.exitCode).toBe(0);

    const searchOutput = JSON.parse(searchResult.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      retrievalMode: string;
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(searchOutput).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      retrievalMode: "index"
    });
    expect(searchOutput.results).toEqual([
      expect.objectContaining({
        ref: "project:archived:workflow:historical-pnpm",
        state: "archived",
        topic: "workflow"
      })
    ]);
  });

  it("supports search, timeline, and details from the CLI surface for archived memory", async () => {
    const homeDir = await tempDir("cam-recall-home-");
    const projectDir = await tempDir("cam-recall-project-");
    const memoryRoot = await tempDir("cam-recall-memory-");
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
    await store.forget("project", "pnpm", { archive: true });

    const searchResult = runCli(projectDir, [
      "recall",
      "search",
      "pnpm",
      "--state",
      "archived",
      "--json"
    ]);
    expect(searchResult.exitCode).toBe(0);

    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(searchOutput.results).toHaveLength(1);
    expect(searchOutput.results[0]).toMatchObject({
      ref: "project:archived:workflow:prefer-pnpm",
      state: "archived",
      topic: "workflow"
    });

    const ref = searchOutput.results[0]!.ref;
    const timelineResult = runCli(projectDir, ["recall", "timeline", ref, "--json"]);
    expect(timelineResult.exitCode).toBe(0);
    const timelineOutput = JSON.parse(timelineResult.stdout) as {
      events: Array<{ action: string }>;
    };
    expect(timelineOutput.events.slice(0, 2).map((event) => event.action)).toEqual([
      "archive",
      "add"
    ]);

    const detailsResult = runCli(projectDir, ["recall", "details", ref, "--json"]);
    expect(detailsResult.exitCode).toBe(0);
    const detailsOutput = JSON.parse(detailsResult.stdout) as {
      ref: string;
      path: string;
      latestLifecycleAction: string;
      latestSessionId: string | null;
      latestRolloutPath: string | null;
      historyPath: string;
      entry: { summary: string };
    };
    expect(detailsOutput).toMatchObject({
      ref,
      path: store.getArchiveTopicFile("project", "workflow"),
      latestLifecycleAction: "archive",
      latestSessionId: null,
      latestRolloutPath: null,
      historyPath: store.getHistoryPath("project"),
      entry: {
        summary: "Prefer pnpm in this repository."
      }
    });
  });

  it("supports --cwd so recall can target another project directory from the current shell", async () => {
    const homeDir = await tempDir("cam-recall-cwd-home-");
    const projectParentDir = await tempDir("cam-recall-cwd-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const shellDir = await tempDir("cam-recall-cwd-shell-");
    const memoryRoot = await tempDir("cam-recall-cwd-memory-");
    process.env.HOME = homeDir;

    await fs.mkdir(projectDir, { recursive: true });

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
    await store.forget("project", "pnpm", { archive: true });

    const searchResult = runCli(
      shellDir,
      ["recall", "search", "pnpm", "--cwd", projectDir, "--state", "archived", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(searchResult.exitCode).toBe(0);

    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string }>;
    };
    expect(searchOutput.results).toHaveLength(1);

    const ref = searchOutput.results[0]!.ref;
    const timelineResult = runCli(
      shellDir,
      ["recall", "timeline", ref, "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    expect(timelineResult.exitCode).toBe(0);
    expect(JSON.parse(timelineResult.stdout)).toMatchObject({
      ref,
      events: expect.arrayContaining([expect.objectContaining({ action: "archive" })])
    });

    const detailsResult = runCli(
      shellDir,
      ["recall", "details", ref, "--cwd", projectDir, "--json"],
      { env: { HOME: homeDir } }
    );
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref,
      path: store.getArchiveTopicFile("project", "workflow")
    });
  });

  it("surfaces session provenance in timeline output after rollout sync", async () => {
    const homeDir = await tempDir("cam-recall-provenance-home-");
    const projectDir = await tempDir("cam-recall-provenance-project-");
    const memoryRoot = await tempDir("cam-recall-provenance-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(projectDir, "Remember that this repository prefers pnpm.", {
        sessionId: "session-provenance"
      }),
      "utf8"
    );

    const service = new SyncService(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await service.syncRollout(rolloutPath, true);
    const store = service.memoryStore;

    const searchResult = runCli(projectDir, ["recall", "search", "prefers pnpm", "--json"]);
    expect(searchResult.exitCode).toBe(0);
    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string }>;
    };
    expect(searchOutput.results).toHaveLength(1);

    const timelineResult = runCli(
      projectDir,
      ["recall", "timeline", searchOutput.results[0]!.ref, "--json"]
    );
    expect(timelineResult.exitCode).toBe(0);
    expect(JSON.parse(timelineResult.stdout)).toMatchObject({
      ref: searchOutput.results[0]!.ref,
      events: expect.arrayContaining([
        expect.objectContaining({
          sessionId: "session-provenance",
          rolloutPath
        })
      ])
    });

    const timelineTextResult = runCli(projectDir, ["recall", "timeline", searchOutput.results[0]!.ref]);
    expect(timelineTextResult.exitCode).toBe(0);
    expect(timelineTextResult.stdout).toContain("Session: session-provenance");
    expect(timelineTextResult.stdout).toContain(`Rollout: ${rolloutPath}`);

    const detailsResult = runCli(
      projectDir,
      ["recall", "details", searchOutput.results[0]!.ref, "--json"]
    );
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      latestLifecycleAction: "add",
      latestSessionId: "session-provenance",
      latestRolloutPath: rolloutPath,
      historyPath: store.getHistoryPath("project")
    });
  });

  it("keeps recall search read-only and does not create memory layout on first lookup", async () => {
    const homeDir = await tempDir("cam-recall-readonly-home-");
    const projectDir = await tempDir("cam-recall-readonly-project-");
    const memoryRootParent = await tempDir("cam-recall-readonly-memory-parent-");
    const memoryRoot = path.join(memoryRootParent, "memory-root");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--state", "auto", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      retrievalMode: string;
      retrievalFallbackReason?: string;
      results: unknown[];
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      retrievalMode: "markdown-fallback",
      retrievalFallbackReason: "missing",
      results: []
    });

    await expect(fs.access(memoryRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid memory refs for timeline and details lookups", async () => {
    const homeDir = await tempDir("cam-recall-invalid-ref-home-");
    const projectDir = await tempDir("cam-recall-invalid-ref-project-");
    process.env.HOME = homeDir;

    const timelineResult = runCli(projectDir, ["recall", "timeline", "not-a-valid-ref"], {
      env: { HOME: homeDir }
    });
    expect(timelineResult.exitCode).toBe(1);
    expect(timelineResult.stderr).toContain("Invalid memory ref");

    const detailsResult = runCli(projectDir, ["recall", "details", "not-a-valid-ref"], {
      env: { HOME: homeDir }
    });
    expect(detailsResult.exitCode).toBe(1);
    expect(detailsResult.stderr).toContain("Invalid memory ref");
  });

  it("surfaces markdown fallback diagnostics when the retrieval sidecar is invalid", async () => {
    const homeDir = await tempDir("cam-recall-invalid-sidecar-home-");
    const projectDir = await tempDir("cam-recall-invalid-sidecar-project-");
    const memoryRoot = await tempDir("cam-recall-invalid-sidecar-memory-");
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

    const result = runCli(projectDir, ["recall", "search", "prefer pnpm", "--state", "active", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      retrievalMode: "markdown-fallback",
      retrievalFallbackReason: "invalid",
      results: [expect.objectContaining({ ref: "project:active:workflow:prefer-pnpm" })]
    });
  });
});
