import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { compileStartupMemory } from "../src/lib/domain/startup-memory.js";
import type { AppConfig } from "../src/lib/types.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function snapshotFiles(filePaths: string[]): Promise<Record<string, string | null>> {
  return Object.fromEntries(
    await Promise.all(
      filePaths.map(async (filePath) => [filePath, await readFileIfExists(filePath)] as const)
    )
  );
}

function createInjectedFileOps(target: {
  type: "write" | "delete";
  path: string;
  message: string;
}): {
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
} {
  let failed = false;

  return {
    async writeTextFile(filePath: string, contents: string): Promise<void> {
      if (!failed && target.type === "write" && filePath === target.path) {
        failed = true;
        throw new Error(target.message);
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents, "utf8");
    },
    async deleteFile(filePath: string): Promise<void> {
      if (!failed && target.type === "delete" && filePath === target.path) {
        failed = true;
        throw new Error(target.message);
      }

      await fs.rm(filePath, { force: true });
    }
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("MemoryStore", () => {
  it("survives corrupted entry metadata JSON without crashing", async () => {
    const projectDir = await tempDir("cam-store-corrupt-");
    const memoryRoot = await tempDir("cam-store-corrupt-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const brokenFile = path.join(memoryRoot, "global", "workflow.md");
    await fs.writeFile(
      brokenFile,
      [
        "# Workflow",
        "",
        "<!-- cam:topic workflow -->",
        "",
        "## good-entry",
        "<!-- cam:entry {\"id\":\"good-entry\",\"scope\":\"global\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
        "Summary: A valid entry.",
        "Details:",
        "- Works fine.",
        "",
        "## bad-entry",
        "<!-- cam:entry THIS IS NOT JSON -->",
        "Summary: Corrupted block.",
        "Details:",
        "- Should be skipped.",
        ""
      ].join("\n"),
      "utf8"
    );

    const entries = await store.listEntries("global");
    expect(entries.some((e) => e.id === "good-entry")).toBe(true);
    expect(entries.some((e) => e.id === "bad-entry")).toBe(false);
  });

  it("builds startup memory from indexes and topic file references without parsing topic entries", async () => {
    const projectDir = await tempDir("cam-store-startup-ref-");
    const memoryRoot = await tempDir("cam-store-startup-ref-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      [
        "# Workflow",
        "",
        "<!-- cam:topic workflow -->",
        "",
        "## broken-entry",
        "<!-- cam:entry THIS IS NOT JSON -->",
        "Summary: Broken entry that should not be parsed during startup compile.",
        "Details:",
        "- This file should still be referenced by path.",
        ""
      ].join("\n"),
      "utf8"
    );

    const startup = await compileStartupMemory(store, 200);

    expect(startup.text).toContain("### Topic files");
    expect(startup.text).toContain(store.getTopicFile("project", "workflow"));
    expect(startup.text).not.toContain("Broken entry that should not be parsed during startup compile.");
    expect(startup.sourceFiles).not.toContain(store.getTopicFile("project", "workflow"));
    expect(startup.sourceFiles).toEqual([
      store.getMemoryFile("project-local"),
      store.getMemoryFile("project"),
      store.getMemoryFile("global")
    ]);
    expect(startup.topicFiles).toContainEqual({
      scope: "project",
      topic: "workflow",
      path: store.getTopicFile("project", "workflow")
    });
  });

  it("skips partial scope blocks when the startup budget cannot fit quoted lines", async () => {
    const projectDir = await tempDir("cam-store-startup-header-only-");
    const memoryRoot = await tempDir("cam-store-startup-header-only-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const startup = await compileStartupMemory(store, 8);

    expect(startup.lineCount).toBeLessThanOrEqual(8);
    expect(startup.text).not.toContain("## Project Local");
    expect(startup.text).not.toContain("| # Project Local Memory");
    expect(startup.sourceFiles).toEqual([]);
  });

  it("caps the startup preamble when the budget is smaller than the static intro", async () => {
    const projectDir = await tempDir("cam-store-startup-preamble-");
    const memoryRoot = await tempDir("cam-store-startup-preamble-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const startup = await compileStartupMemory(store, 3);

    expect(startup.lineCount).toBeLessThanOrEqual(3);
    expect(startup.text).not.toContain("## Project Local");
    expect(startup.sourceFiles).toEqual([]);
  });

  it("skips valid-json entry metadata that does not match the expected shape", async () => {
    const projectDir = await tempDir("cam-store-entry-shape-");
    const memoryRoot = await tempDir("cam-store-entry-shape-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      [
        "# Workflow",
        "",
        "<!-- cam:topic workflow -->",
        "",
        "## valid-entry",
        "<!-- cam:entry {\"id\":\"valid-entry\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\",\"sources\":[\"manual\"]} -->",
        "Summary: Valid entry.",
        "Details:",
        "- Keep this.",
        "",
        "## wrong-scope",
        "<!-- cam:entry {\"id\":\"wrong-scope\",\"scope\":\"invalid\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
        "Summary: Wrong scope.",
        "Details:",
        "- Skip this.",
        "",
        "## wrong-sources",
        "<!-- cam:entry {\"id\":\"wrong-sources\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\",\"sources\":\"manual\"} -->",
        "Summary: Wrong sources.",
        "Details:",
        "- Skip this too.",
        ""
      ].join("\n"),
      "utf8"
    );

    const entries = await store.listEntries("project");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("valid-entry");
  });

  it("writes topic files, rebuilds MEMORY.md, and supports forgetting entries", async () => {
    const projectDir = await tempDir("cam-store-project-");
    const memoryRoot = await tempDir("cam-store-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };

    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Run `pnpm install` and `pnpm test` for local workflows."],
      "Manual note."
    );
    await store.remember(
      "project-local",
      "debugging",
      "redis-needed",
      "API tests require a local Redis instance.",
      ["Start Redis before running integration tests in this worktree."],
      "Manual note."
    );

    const startup = await compileStartupMemory(store, 200);
    const projectMemory = await store.readMemoryFile("project");
    const debuggingTopicFile = store.getTopicFile("project-local", "debugging");
    const deleted = await store.forget("all", "redis");

    expect(projectMemory).toContain("workflow.md");
    expect(startup.lineCount).toBeLessThanOrEqual(200);
    expect(startup.text).toContain("workflow.md");
    expect(startup.text).toContain("### Topic files");
    expect(startup.text).toContain(store.getTopicFile("project", "workflow"));
    expect(startup.text).not.toContain("Prefer pnpm in this repository.");
    expect(startup.text).toContain("\"scope\":\"project\"");
    expect(startup.text).toContain("\"topic\":\"workflow\"");
    expect(deleted).toHaveLength(1);
    expect(await store.listEntries("project-local")).toHaveLength(0);
    await expect(fs.stat(debuggingTopicFile)).rejects.toThrow();
  });

  it("truncates topic file references to the startup line budget", async () => {
    const projectDir = await tempDir("cam-store-trunc-");
    const memoryRoot = await tempDir("cam-store-trunc-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    for (let i = 0; i < 50; i++) {
      await store.remember(
        "project",
        `topic-${i}`,
        `entry-${i}`,
        `Workflow entry number ${i}.`,
        [`Detail for entry ${i}.`]
      );
    }
    const startup = await compileStartupMemory(store, 100);
    expect(startup.lineCount).toBeLessThanOrEqual(100);
    expect(startup.text).toContain("### Topic files");

    const topicLines = startup.text
      .split("\n")
      .filter((line) => line.startsWith("- {\"scope\":\"project\",\"topic\":\"topic-"));
    expect(topicLines.length).toBeGreaterThan(0);
    expect(topicLines.length).toBeLessThan(50);
    expect(startup.topicFiles).toHaveLength(topicLines.length);
  });

  it("archives entries outside startup recall and exposes archived refs for retrieval", async () => {
    const projectDir = await tempDir("cam-store-archive-project-");
    const memoryRoot = await tempDir("cam-store-archive-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const archived = await store.forget("project", "pnpm", { archive: true });
    const startup = await compileStartupMemory(store, 200);
    const archivedResults = await store.searchEntries("pnpm", {
      scope: "project",
      state: "archived"
    });

    expect(archived).toHaveLength(1);
    expect(await store.listEntries("project")).toEqual([]);
    expect(await store.listEntries("project", "archived")).toHaveLength(1);
    expect(await store.readMemoryFile("project", "archived")).toContain("workflow.md");
    expect(startup.text).not.toContain(store.getArchiveTopicFile("project", "workflow"));
    expect(startup.text).not.toContain("Prefer pnpm in this repository.");
    expect(await store.searchEntries("pnpm", { scope: "project" })).toEqual([]);
    expect(archivedResults).toHaveLength(1);
    expect(archivedResults[0]).toMatchObject({
      ref: "project:archived:workflow:prefer-pnpm",
      state: "archived",
      topic: "workflow"
    });

    const details = await store.getEntryByRef(archivedResults[0]!.ref);
    const timeline = await store.readTimeline(archivedResults[0]!.ref);

    expect(details).toMatchObject({
      ref: "project:archived:workflow:prefer-pnpm",
      path: store.getArchiveTopicFile("project", "workflow")
    });
    expect(timeline.map((event) => event.action)).toEqual(["archive", "add"]);
  });

  it("maintains thin retrieval sidecar indexes and falls back safely when one is invalid", async () => {
    const projectDir = await tempDir("cam-store-retrieval-index-project-");
    const memoryRoot = await tempDir("cam-store-retrieval-index-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
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
      "historical-note",
      "Historical pnpm migration note.",
      ["Old pnpm migration note kept for history."],
      "Manual note."
    );
    await store.forget("project", "historical", { archive: true });

    const activeIndexPath = store.getRetrievalIndexFile("project", "active");
    const archivedIndexPath = store.getRetrievalIndexFile("project", "archived");
    expect(JSON.parse(await fs.readFile(activeIndexPath, "utf8"))).toMatchObject({
      version: 1,
      scope: "project",
      state: "active",
      topicFiles: ["workflow.md"],
      topicFileCount: 1,
      entries: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          summary: "Prefer pnpm in this repository."
        })
      ]
    });
    expect(JSON.parse(await fs.readFile(archivedIndexPath, "utf8"))).toMatchObject({
      version: 1,
      scope: "project",
      state: "archived",
      topicFiles: ["workflow.md"],
      topicFileCount: 1,
      entries: [
        expect.objectContaining({
          ref: "project:archived:workflow:historical-note",
          summary: "Historical pnpm migration note."
        })
      ]
    });

    await fs.writeFile(activeIndexPath, "{not-json", "utf8");
    const fallbackResults = await store.searchEntries("prefer pnpm", {
      scope: "project",
      state: "active"
    });
    expect(fallbackResults).toEqual([
      expect.objectContaining({
        ref: "project:active:workflow:prefer-pnpm"
      })
    ]);

    await fs.rm(store.getTopicFile("project", "workflow"), { force: true });
    const staleResults = await store.searchEntries("prefer pnpm", {
      scope: "project",
      state: "active"
    });
    expect(staleResults).toEqual([]);

    await fs.rm(archivedIndexPath, { force: true });
    await store.ensureLayout();
    expect(JSON.parse(await fs.readFile(activeIndexPath, "utf8"))).toMatchObject({
      version: 1,
      state: "active"
    });
    expect(JSON.parse(await fs.readFile(archivedIndexPath, "utf8"))).toMatchObject({
      version: 1,
      state: "archived"
    });
  });

  it("fails closed across all scopes when all-scope archive forget hits an unsafe topic file", async () => {
    const projectDir = await tempDir("cam-store-unsafe-all-archive-project-");
    const memoryRoot = await tempDir("cam-store-unsafe-all-archive-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await store.remember(
      "global",
      "workflow",
      "global-pnpm",
      "Global pnpm preference.",
      ["Use pnpm globally."],
      "Manual note."
    );

    const globalSnapshot = await snapshotFiles([
      store.getTopicFile("global", "workflow"),
      store.getMemoryFile("global"),
      store.getHistoryPath("global"),
      store.getArchiveIndexFile("global"),
      store.getArchiveTopicFile("global", "workflow")
    ]);
    const unsafeProjectTopicFile = store.getTopicFile("project", "workflow");
    const unsafeProjectContents = [
      "# Workflow",
      "",
      "<!-- cam:topic workflow -->",
      "",
      "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
      "",
      "Manual note that cannot be round-tripped safely.",
      "",
      "## project-pnpm",
      "<!-- cam:entry {\"id\":\"project-pnpm\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
      "Summary: Project pnpm preference.",
      "Details:",
      "- Use pnpm in this repository.",
      "",
      "## malformed-entry",
      "<!-- cam:entry THIS IS NOT JSON -->",
      "Summary: Broken entry.",
      "Details:",
      "- Must not be deleted by rewrite.",
      ""
    ].join("\n");
    await fs.writeFile(unsafeProjectTopicFile, unsafeProjectContents, "utf8");
    const projectSnapshot = await snapshotFiles([
      unsafeProjectTopicFile,
      store.getMemoryFile("project"),
      store.getHistoryPath("project"),
      store.getArchiveIndexFile("project"),
      store.getArchiveTopicFile("project", "workflow")
    ]);
    const projectLocalSnapshot = await snapshotFiles([
      store.getTopicFile("project-local", "workflow"),
      store.getMemoryFile("project-local"),
      store.getHistoryPath("project-local"),
      store.getArchiveIndexFile("project-local"),
      store.getArchiveTopicFile("project-local", "workflow")
    ]);

    await expect(store.forget("all", "pnpm", { archive: true })).rejects.toThrow(
      /Cannot rewrite topic file/
    );

    expect(await store.listEntries("global")).toHaveLength(1);
    expect(await store.listEntries("global", "archived")).toEqual([]);
    expect(await snapshotFiles(Object.keys(globalSnapshot))).toEqual(globalSnapshot);
    expect(await snapshotFiles(Object.keys(projectSnapshot))).toEqual(projectSnapshot);
    expect(await snapshotFiles(Object.keys(projectLocalSnapshot))).toEqual(projectLocalSnapshot);
  });

  it("rolls back archive changes when commit fails while deleting the active topic file", async () => {
    const projectDir = await tempDir("cam-store-archive-rollback-project-");
    const memoryRoot = await tempDir("cam-store-archive-rollback-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const baselineStore = new MemoryStore(detectProjectContext(projectDir), config);
    await baselineStore.ensureLayout();
    await baselineStore.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const snapshot = await snapshotFiles([
      baselineStore.getTopicFile("project", "workflow"),
      baselineStore.getMemoryFile("project"),
      baselineStore.getHistoryPath("project"),
      baselineStore.getArchiveIndexFile("project"),
      baselineStore.getArchiveTopicFile("project", "workflow")
    ]);

    const injectedStore = new MemoryStore(
      detectProjectContext(projectDir),
      config,
      createInjectedFileOps({
        type: "delete",
        path: baselineStore.getTopicFile("project", "workflow"),
        message: "Injected active delete failure"
      })
    );

    await expect(injectedStore.forget("project", "pnpm", { archive: true })).rejects.toThrow(
      /Injected active delete failure/
    );
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("rolls back resurrecting an archived entry when commit fails while deleting the archived topic file", async () => {
    const projectDir = await tempDir("cam-store-upsert-rollback-project-");
    const memoryRoot = await tempDir("cam-store-upsert-rollback-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const baselineStore = new MemoryStore(detectProjectContext(projectDir), config);
    await baselineStore.ensureLayout();
    await baselineStore.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );
    await baselineStore.forget("project", "pnpm", { archive: true });

    const snapshot = await snapshotFiles([
      baselineStore.getTopicFile("project", "workflow"),
      baselineStore.getMemoryFile("project"),
      baselineStore.getHistoryPath("project"),
      baselineStore.getArchiveIndexFile("project"),
      baselineStore.getArchiveTopicFile("project", "workflow")
    ]);

    const injectedStore = new MemoryStore(
      detectProjectContext(projectDir),
      config,
      createInjectedFileOps({
        type: "delete",
        path: baselineStore.getArchiveTopicFile("project", "workflow"),
        message: "Injected archived delete failure"
      })
    );

    await expect(
      injectedStore.applyMutations([
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Prefer pnpm in this repository.",
          details: ["Use pnpm instead of npm in this repository."],
          sources: ["manual"],
          reason: "Manual note."
        }
      ])
    ).rejects.toThrow(/Injected archived delete failure/);
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("rolls back earlier scope writes when a later scope delete fails in the same batch", async () => {
    const projectDir = await tempDir("cam-store-batch-rollback-project-");
    const memoryRoot = await tempDir("cam-store-batch-rollback-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const baselineStore = new MemoryStore(detectProjectContext(projectDir), config);
    await baselineStore.ensureLayout();
    await baselineStore.remember(
      "global",
      "workflow",
      "global-pnpm",
      "Global pnpm preference.",
      ["Use pnpm globally."],
      "Manual note."
    );
    await baselineStore.remember(
      "project",
      "workflow",
      "project-pnpm",
      "Project pnpm preference.",
      ["Use pnpm in this repository."],
      "Manual note."
    );

    const snapshot = await snapshotFiles([
      baselineStore.getTopicFile("global", "workflow"),
      baselineStore.getMemoryFile("global"),
      baselineStore.getHistoryPath("global"),
      baselineStore.getTopicFile("project", "workflow"),
      baselineStore.getMemoryFile("project"),
      baselineStore.getHistoryPath("project")
    ]);

    const injectedStore = new MemoryStore(
      detectProjectContext(projectDir),
      config,
      createInjectedFileOps({
        type: "delete",
        path: baselineStore.getTopicFile("project", "workflow"),
        message: "Injected later scope delete failure"
      })
    );

    await expect(
      injectedStore.applyMutations([
        {
          action: "delete",
          scope: "global",
          topic: "workflow",
          id: "global-pnpm",
          sources: ["manual"],
          reason: "Delete request."
        },
        {
          action: "delete",
          scope: "project",
          topic: "workflow",
          id: "project-pnpm",
          sources: ["manual"],
          reason: "Delete request."
        }
      ])
    ).rejects.toThrow(/Injected later scope delete failure/);
    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("returns explicit noop lifecycle records for identical upserts and missing active deletes", async () => {
    const projectDir = await tempDir("cam-store-noop-project-");
    const memoryRoot = await tempDir("cam-store-noop-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const identicalUpsert = await store.applyMutations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "prefer-pnpm",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."],
        sources: ["manual"],
        reason: "Manual note."
      }
    ]);
    const missingDelete = await store.applyMutations([
      {
        action: "delete",
        scope: "project",
        topic: "workflow",
        id: "missing-memory",
        sources: ["manual"],
        reason: "Explicit delete request."
      }
    ]);
    const history = await store.readHistory("project");

    expect(identicalUpsert).toHaveLength(1);
    expect(identicalUpsert[0]).toMatchObject({
      lifecycleAction: "noop",
      previousState: "active",
      nextState: "active"
    });
    expect(missingDelete).toHaveLength(1);
    expect(missingDelete[0]).toMatchObject({
      lifecycleAction: "noop",
      previousState: undefined,
      nextState: undefined
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe("add");
  });

  it("fails fast when an upsert mutation is missing its summary", async () => {
    const projectDir = await tempDir("cam-store-missing-summary-project-");
    const memoryRoot = await tempDir("cam-store-missing-summary-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const snapshot = await snapshotFiles([
      store.getMemoryFile("project"),
      store.getTopicFile("project", "workflow"),
      store.getHistoryPath("project")
    ]);

    await expect(
      store.applyMutations([
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "missing-summary",
          details: ["This upsert should fail before any writes."],
          sources: ["manual"],
          reason: "Broken mutation."
        }
      ])
    ).rejects.toThrow(/summary is required/i);

    expect(await snapshotFiles(Object.keys(snapshot))).toEqual(snapshot);
  });

  it("fails closed when a topic file contains unsupported manual or malformed content during upsert", async () => {
    const projectDir = await tempDir("cam-store-unsafe-upsert-project-");
    const memoryRoot = await tempDir("cam-store-unsafe-upsert-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    const originalContents = [
      "# Workflow",
      "",
      "<!-- cam:topic workflow -->",
      "",
      "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
      "",
      "Manual note that cannot be round-tripped safely.",
      "",
      "## keep-entry",
      "<!-- cam:entry {\"id\":\"keep-entry\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
      "Summary: Keep this valid entry.",
      "Details:",
      "- Preserve this.",
      "",
      "## malformed-entry",
      "<!-- cam:entry THIS IS NOT JSON -->",
      "Summary: Broken entry.",
      "Details:",
      "- Must not be deleted by rewrite.",
      ""
    ].join("\n");
    await fs.writeFile(topicFile, originalContents, "utf8");

    await expect(
      store.applyMutations([
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "new-entry",
          summary: "Do not rewrite unsafe files.",
          details: ["Unsafe file should stay untouched."],
          sources: ["manual"],
          reason: "Manual note."
        }
      ])
    ).rejects.toThrow(/Cannot rewrite topic file/);

    expect(await fs.readFile(topicFile, "utf8")).toBe(originalContents);
  });

  it("fails closed when details contain unsupported non-bullet content", async () => {
    const projectDir = await tempDir("cam-store-unsafe-details-project-");
    const memoryRoot = await tempDir("cam-store-unsafe-details-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    const originalContents = [
      "# Workflow",
      "",
      "<!-- cam:topic workflow -->",
      "",
      "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
      "",
      "## keep-entry",
      "<!-- cam:entry {\"id\":\"keep-entry\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
      "Summary: Keep this valid entry.",
      "Details:",
      "Plain text that cannot be round-tripped safely.",
      ""
    ].join("\n");
    await fs.writeFile(topicFile, originalContents, "utf8");

    await expect(
      store.applyMutations([
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "new-entry",
          summary: "Do not rewrite mixed detail blocks.",
          details: ["Unsafe detail block should stay untouched."],
          sources: ["manual"],
          reason: "Manual note."
        }
      ])
    ).rejects.toThrow(/Cannot rewrite topic file/);

    expect(await fs.readFile(topicFile, "utf8")).toBe(originalContents);
  });

  it("fails closed when a topic file contains unsupported manual or malformed content during delete", async () => {
    const projectDir = await tempDir("cam-store-unsafe-delete-project-");
    const memoryRoot = await tempDir("cam-store-unsafe-delete-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const topicFile = store.getTopicFile("project", "workflow");
    const originalContents = [
      "# Workflow",
      "",
      "<!-- cam:topic workflow -->",
      "",
      "This file is maintained by Codex Auto Memory. You may edit summaries or details directly.",
      "",
      "## keep-entry",
      "<!-- cam:entry {\"id\":\"keep-entry\",\"scope\":\"project\",\"updatedAt\":\"2026-03-14T00:00:00.000Z\"} -->",
      "Summary: Keep this valid entry.",
      "Details:",
      "- Preserve this.",
      "",
      "## malformed-entry",
      "<!-- cam:entry THIS IS NOT JSON -->",
      "Summary: Broken entry.",
      "Details:",
      "- Must not be deleted by rewrite.",
      ""
    ].join("\n");
    await fs.writeFile(topicFile, originalContents, "utf8");

    await expect(
      store.applyMutations([
        {
          action: "delete",
          scope: "project",
          topic: "workflow",
          id: "keep-entry",
          sources: ["manual"],
          reason: "Delete request."
        }
      ])
    ).rejects.toThrow(/Cannot rewrite topic file/);

    expect(await fs.readFile(topicFile, "utf8")).toBe(originalContents);
  });

  it("fails closed when planned index or history files change after the commit plan is built", async () => {
    const projectDir = await tempDir("cam-store-drift-project-");
    const memoryRoot = await tempDir("cam-store-drift-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const topicFile = store.getTopicFile("project", "workflow");
    const memoryFile = store.getMemoryFile("project");
    const historyFile = store.getHistoryPath("project");
    const originalBuildMutationCommitPlan = (store as unknown as {
      buildMutationCommitPlan: (mutations: unknown[]) => Promise<unknown>;
    }).buildMutationCommitPlan.bind(store);
    const driftedIndexContents = [
      "# Project Memories",
      "",
      "<!-- cam:memory-index scope=project -->",
      "",
      "- workflow | Concurrent index edit should be preserved."
    ].join("\n");
    const driftedHistoryContents =
      '{"at":"2026-03-14T00:00:02.000Z","action":"update","scope":"project","state":"active","topic":"workflow","id":"prefer-pnpm","ref":"project:active:workflow:prefer-pnpm","summary":"Concurrent history edit should be preserved."}\n';

    (store as unknown as {
      buildMutationCommitPlan: (mutations: unknown[]) => Promise<unknown>;
    }).buildMutationCommitPlan = async (mutations) => {
      const plan = await originalBuildMutationCommitPlan(mutations);
      await fs.writeFile(memoryFile, driftedIndexContents, "utf8");
      await fs.writeFile(historyFile, driftedHistoryContents, "utf8");
      return plan;
    };

    const topicSnapshot = await fs.readFile(topicFile, "utf8");
    const memorySnapshot = await readFileIfExists(memoryFile);
    const historySnapshot = await readFileIfExists(historyFile);

    await expect(
      store.applyMutations([
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "prefer-pnpm",
          summary: "Planned update should fail closed on drift.",
          details: ["The commit phase must notice topic-file drift."],
          sources: ["manual"],
          reason: "Manual note."
        }
      ])
    ).rejects.toThrow(/changed since the mutation plan was built/i);

    expect(await fs.readFile(topicFile, "utf8")).toBe(topicSnapshot);
    expect(await fs.readFile(memoryFile, "utf8")).toBe(driftedIndexContents);
    expect(await fs.readFile(historyFile, "utf8")).toBe(driftedHistoryContents);
    expect(await readFileIfExists(memoryFile)).not.toBe(memorySnapshot);
    expect(await readFileIfExists(historyFile)).not.toBe(historySnapshot);
  });

  it("treats source-only or reason-only changes as updates instead of noop", async () => {
    const projectDir = await tempDir("cam-store-metadata-update-project-");
    const memoryRoot = await tempDir("cam-store-metadata-update-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm",
      "Prefer pnpm in this repository.",
      ["Use pnpm instead of npm in this repository."],
      "Manual note."
    );

    const updated = await store.applyMutations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "prefer-pnpm",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."],
        sources: ["/tmp/rollout-source-update.jsonl"],
        reason: "Updated provenance."
      }
    ]);
    const details = await store.getEntryByRef("project:active:workflow:prefer-pnpm");
    const history = await store.readHistory("project");

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      lifecycleAction: "update",
      previousState: "active",
      nextState: "active"
    });
    expect(details?.entry.sources).toEqual(["/tmp/rollout-source-update.jsonl"]);
    expect(details?.entry.reason).toBe("Updated provenance.");
    expect(await fs.readFile(store.getTopicFile("project", "workflow"), "utf8")).toContain(
      "/tmp/rollout-source-update.jsonl"
    );
    expect(history.slice(0, 2).map((event) => event.action)).toEqual(["update", "add"]);
  });

  it("rejects topic traversal, skips invalid sync audit lines, and normalizes legacy audit entries", async () => {
    const projectDir = await tempDir("cam-store-guardrails-");
    const memoryRoot = await tempDir("cam-store-guardrails-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    expect(() => store.getTopicFile("project", "../escape")).toThrow(/Topic names must use lowercase kebab-case/);

    await fs.writeFile(
      path.join(store.paths.auditDir, "sync-log.jsonl"),
      [
        JSON.stringify({
          appliedAt: "2026-03-14T00:00:00.000Z",
          projectId: "project-1",
          worktreeId: "worktree-1",
          rolloutPath: "/tmp/rollout-1.jsonl",
          sessionId: "session-1",
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
              id: "entry-1",
              summary: "Prefer pnpm.",
              details: ["Use pnpm."],
              sources: ["manual"]
            }
          ]
        }),
        "THIS IS NOT JSON",
        "\"not an object\"",
        "[]",
        JSON.stringify({
          appliedAt: "2026-03-14T00:01:00.000Z",
          resultSummary: "missing required fields"
        }),
        JSON.stringify({
          appliedAt: "2026-03-14T00:02:00.000Z",
          projectId: "project-1",
          worktreeId: "worktree-1",
          rolloutPath: "/tmp/rollout-2.jsonl",
          configuredExtractorMode: "codex",
          configuredExtractorName: "codex-ephemeral",
          actualExtractorMode: "heuristic",
          actualExtractorName: "heuristic",
          extractorMode: "heuristic",
          extractorName: "heuristic",
          sessionSource: "rollout-jsonl",
          status: "skipped",
          skipReason: "already-processed",
          appliedCount: 0,
          scopesTouched: [],
          resultSummary: "Skipped rollout; it was already processed",
          operations: []
        })
      ].join("\n"),
      "utf8"
    );

    const auditEntries = await store.readRecentSyncAuditEntries(10);
    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[0]).toMatchObject({
      resultSummary: "Skipped rollout; it was already processed",
      configuredExtractorMode: "codex",
      actualExtractorMode: "heuristic"
    });
    expect(auditEntries[1]).toMatchObject({
      resultSummary: "1 operation(s) applied",
      configuredExtractorMode: "heuristic",
      actualExtractorMode: "heuristic"
    });
  });

  it("normalizes the legacy empty MEMORY.md template without rewriting user-edited files", async () => {
    const projectDir = await tempDir("cam-store-legacy-index-");
    const memoryRoot = await tempDir("cam-store-legacy-index-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    const projectMemoryFile = store.getMemoryFile("project");
    await fs.writeFile(
      projectMemoryFile,
      [
        "# Project Memory",
        "",
        "This file is the concise startup index for this scope.",
        "It is intentionally short so it can be injected into Codex at session start.",
        "",
        "## Topics",
        "- No topic files yet.",
        "",
        "## Highlights",
        "- No memory entries yet.",
        ""
      ].join("\n"),
      "utf8"
    );
    const projectLocalFile = store.getMemoryFile("project-local");
    await fs.writeFile(projectLocalFile, "# Project Local Memory\n\nCustom note.\n", "utf8");

    await store.ensureLayout();

    expect(await store.readMemoryFile("project")).not.toContain("## Highlights");
    expect(await store.readMemoryFile("project-local")).toContain("Custom note.");
  });

  it("fails closed when sync state or recovery records are malformed", async () => {
    const projectDir = await tempDir("cam-store-invalid-state-project-");
    const memoryRoot = await tempDir("cam-store-invalid-state-memory-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    await fs.writeFile(store.paths.stateFile, '{"processedRollouts":["wrong-shape"]}', "utf8");
    await expect(store.getSyncState()).rejects.toThrow(/Invalid sync state file/);

    await fs.mkdir(path.dirname(store.getSyncRecoveryPath()), { recursive: true });
    await fs.writeFile(store.getSyncRecoveryPath(), '{"recordedAt":123}', "utf8");
    await expect(store.readSyncRecoveryRecord()).rejects.toThrow(/Invalid sync recovery record/);
  });
});
