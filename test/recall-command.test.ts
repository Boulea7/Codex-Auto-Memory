import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { runDream } from "../src/lib/commands/dream.js";
import type { MemorySearchResponse } from "../src/lib/types.js";
import {
  makeRolloutFixture,
  makeAppConfig,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import { runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildUnsafeWorkflowTopicContents(entryId: string, summary: string, detail: string): string {
  return [
    "# Workflow Memory",
    "",
    "This file is managed by codex-auto-memory.",
    "",
    "Manual note outside managed entries.",
    "",
    "---",
    `id: ${entryId}`,
    "scope: project",
    `summary: ${summary}`,
    "updatedAt: 2026-03-14T00:00:00.000Z",
    "sources:",
    "  - manual",
    "",
    detail,
    "",
    "```",
    "malformed block",
    "```",
    ""
  ].join("\n");
}

function buildParseableUnsafeWorkflowTopicContents(
  entryId: string,
  summary: string,
  detail: string
): string {
  return [
    "# Workflow",
    "",
    "<!-- cam:topic workflow -->",
    "",
    "Manual notes outside managed entries.",
    "",
    `## ${entryId}`,
    `<!-- cam:entry {"id":"${entryId}","scope":"project","updatedAt":"2026-03-14T00:00:00.000Z"} -->`,
    `Summary: ${summary}`,
    "Details:",
    `- ${detail}`,
    ""
  ].join("\n");
}

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.CAM_CODEX_SESSIONS_DIR = originalSessionsDir;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

interface RecallSearchDiagnostics {
  anyMarkdownFallback: boolean;
  fallbackReasons: string[];
  executionModes?: string[];
  checkedPaths: Array<{
    scope: string;
    state: string;
    retrievalMode: string;
    retrievalFallbackReason?: string;
    matchedCount: number;
    returnedCount?: number;
    droppedCount?: number;
    indexPath: string;
    generatedAt: string | null;
  }>;
}

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
      stateFallbackUsed: boolean;
      markdownFallbackUsed: boolean;
      retrievalMode: string;
      retrievalFallbackReason?: string;
      stateResolution: {
        outcome: string;
        searchedStates: string[];
        resolutionReason: string;
      };
      executionSummary: {
        mode: string;
        retrievalModes: string[];
        fallbackReasons: string[];
      };
      diagnostics: RecallSearchDiagnostics;
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      stateFallbackUsed: true,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      stateResolution: {
        outcome: "archived-hit",
        searchedStates: ["active", "archived"],
        resolutionReason: "active-empty-archived-match-found"
      },
      executionSummary: {
        mode: "index-only",
        retrievalModes: ["index"],
        fallbackReasons: []
      }
    });
    expect(output.diagnostics).toMatchObject({
      anyMarkdownFallback: false,
      fallbackReasons: [],
      executionModes: ["index"]
    });
    expect(output.diagnostics.checkedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "archived",
          retrievalMode: "index",
          matchedCount: 9,
          returnedCount: 8,
          indexPath: store.getRetrievalIndexFile("project", "archived"),
          generatedAt: expect.any(String)
        })
      ])
    );
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
      stateFallbackUsed: boolean;
      markdownFallbackUsed: boolean;
      retrievalMode: string;
      stateResolution: {
        outcome: string;
        searchedStates: string[];
        resolutionReason: string;
      };
      executionSummary: {
        mode: string;
        retrievalModes: string[];
        fallbackReasons: string[];
      };
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "active",
      fallbackUsed: false,
      stateFallbackUsed: false,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      stateResolution: {
        outcome: "active-hit",
        searchedStates: ["active"],
        resolutionReason: "active-match-found"
      },
      executionSummary: {
        mode: "index-only",
        retrievalModes: ["index"],
        fallbackReasons: []
      }
    });
    expect(output.results).toEqual([
      expect.objectContaining({
        ref: "project:active:workflow:prefer-pnpm",
        state: "active",
        topic: "workflow"
      })
    ]);
  });

  it("matches recall search terms even when the query includes trailing punctuation", async () => {
    const homeDir = await tempDir("cam-recall-punctuated-query-home-");
    const projectDir = await tempDir("cam-recall-punctuated-query-project-");
    const memoryRoot = await tempDir("cam-recall-punctuated-query-memory-");
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

    const result = runCli(projectDir, ["recall", "search", "pnpm,", "--state", "active", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      retrievalMode: string;
      results: Array<{ ref: string; summary: string }>;
    };
    expect(output).toMatchObject({
      retrievalMode: "index",
      results: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          summary: "Prefer pnpm in this repository."
        })
      ]
    });
  });

  it("matches recall search terms when natural separators split shared query terms", async () => {
    const homeDir = await tempDir("cam-recall-separated-query-home-");
    const projectDir = await tempDir("cam-recall-separated-query-project-");
    const memoryRoot = await tempDir("cam-recall-separated-query-memory-");
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

    const result = runCli(projectDir, [
      "recall",
      "search",
      "pnpm/npm",
      "--state",
      "active",
      "--json"
    ]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      retrievalMode: string;
      results: Array<{ ref: string; summary: string }>;
    };
    expect(output).toMatchObject({
      retrievalMode: "index",
      results: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm",
          summary: "Prefer pnpm in this repository."
        })
      ]
    });
  });

  it("matches recall search terms across topic and content fields with shared query semantics", async () => {
    const homeDir = await tempDir("cam-recall-topic-query-home-");
    const projectDir = await tempDir("cam-recall-topic-query-project-");
    const memoryRoot = await tempDir("cam-recall-topic-query-memory-");
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

    const result = runCli(projectDir, [
      "recall",
      "search",
      "workflow pnpm",
      "--state",
      "active",
      "--json"
    ]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      results: Array<{ ref: string }>;
    };
    expect(output.results).toEqual([
      expect.objectContaining({
        ref: "project:active:workflow:prefer-pnpm"
      })
    ]);
  });

  it("surfaces unsafe topic diagnostics in recall search output", async () => {
    const homeDir = await tempDir("cam-recall-unsafe-search-home-");
    const projectDir = await tempDir("cam-recall-unsafe-search-project-");
    const memoryRoot = await tempDir("cam-recall-unsafe-search-memory-");
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

    const unsafeTopicPath = store.getTopicFile("project", "workflow");
    await fs.writeFile(
      unsafeTopicPath,
      buildUnsafeWorkflowTopicContents(
        "prefer-pnpm",
        "Prefer pnpm in this repository.",
        "Use pnpm instead of npm in this repository."
      ),
      "utf8"
    );
    await store.rebuildIndex("project");
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{bad-json", "utf8");

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--state", "active", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      diagnostics: RecallSearchDiagnostics & {
        topicDiagnostics?: Array<{
          scope: string;
          state: string;
          topic: string;
          safeToRewrite: boolean;
          invalidEntryBlockCount: number;
          manualContentDetected: boolean;
          unsafeReason?: string;
        }>;
      };
      results: Array<{ ref: string }>;
    };

    expect(output.results).toEqual([]);
    expect(output.diagnostics.topicDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          topic: "workflow",
          safeToRewrite: false,
          invalidEntryBlockCount: 0,
          manualContentDetected: true,
          unsafeReason: expect.stringContaining(
            "unsupported manual content outside managed memory entries"
          )
        })
      ])
    );
  });

  it("fails closed for unsafe topics even when the retrieval index is healthy", async () => {
    const homeDir = await tempDir("cam-recall-unsafe-index-home-");
    const projectDir = await tempDir("cam-recall-unsafe-index-project-");
    const memoryRoot = await tempDir("cam-recall-unsafe-index-memory-");
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

    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      buildUnsafeWorkflowTopicContents(
        "prefer-pnpm",
        "Prefer pnpm in this repository.",
        "Use pnpm instead of npm in this repository."
      ),
      "utf8"
    );
    await store.rebuildRetrievalIndex("project", "active");

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--state", "active", "--json"]);
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      retrievalMode: string;
      results: Array<{ ref: string }>;
    };

    expect(output.retrievalMode).toBe("index");
    expect(output.results).toEqual([]);
  });

  it("fails closed for explicit details reads when the referenced topic is unsafe", async () => {
    const homeDir = await tempDir("cam-recall-unsafe-details-home-");
    const projectDir = await tempDir("cam-recall-unsafe-details-project-");
    const memoryRoot = await tempDir("cam-recall-unsafe-details-memory-");
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

    await fs.writeFile(
      store.getTopicFile("project", "workflow"),
      buildParseableUnsafeWorkflowTopicContents(
        "prefer-pnpm",
        "Prefer pnpm in this repository.",
        "Use pnpm instead of npm in this repository."
      ),
      "utf8"
    );

    const result = runCli(projectDir, [
      "recall",
      "details",
      "project:active:workflow:prefer-pnpm"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No memory details were found");
  });

  it("does not surface healthy topic files as unsafe diagnostics during recall search", async () => {
    const homeDir = await tempDir("cam-recall-safe-search-home-");
    const projectDir = await tempDir("cam-recall-safe-search-project-");
    const memoryRoot = await tempDir("cam-recall-safe-search-memory-");
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

    const jsonResult = runCli(projectDir, [
      "recall",
      "search",
      "pnpm",
      "--state",
      "active",
      "--json"
    ]);
    expect(jsonResult.exitCode).toBe(0);

    const jsonOutput = JSON.parse(jsonResult.stdout) as {
      diagnostics: RecallSearchDiagnostics & {
        topicDiagnostics?: Array<{
          scope: string;
          state: string;
          topic: string;
          safeToRewrite: boolean;
        }>;
      };
    };

    expect(jsonOutput.diagnostics.topicDiagnostics ?? []).toEqual([]);

    const textResult = runCli(projectDir, ["recall", "search", "pnpm", "--state", "active"]);
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).not.toContain("Unsafe topic diagnostics:");
  });

  it("surfaces explicit-state contract for state=all searches and keeps checkedPaths ordered", async () => {
    const homeDir = await tempDir("cam-recall-state-all-home-");
    const projectDir = await tempDir("cam-recall-state-all-project-");
    const memoryRoot = await tempDir("cam-recall-state-all-memory-");
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
      "prefer-pnpm-active",
      "Active pnpm workflow note.",
      ["Use pnpm in this repository now."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm-archived",
      "Archived pnpm migration note.",
      ["Historical pnpm migration note."],
      "Manual note."
    );
    await store.forget("project", "Archived pnpm migration note", { archive: true });

    const result = runCli(
      projectDir,
      ["recall", "search", "pnpm", "--state", "all", "--limit", "1", "--json"],
      { env: { HOME: homeDir } }
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout) as {
      state: string;
      resolvedState: string;
      searchOrder: string[];
      totalMatchedCount: number;
      returnedCount: number;
      globalLimitApplied: boolean;
      truncatedCount: number;
      resultWindow: {
        start: number;
        end: number;
        limit: number;
      };
      stateResolution: {
        outcome: string;
        searchedStates: string[];
        resolutionReason: string;
      };
      executionSummary: {
        mode: string;
        retrievalModes: string[];
        fallbackReasons: string[];
      };
      diagnostics: RecallSearchDiagnostics;
      results: Array<{ ref: string; state: string; globalRank?: number }>;
    };

    expect(output).toMatchObject({
      state: "all",
      resolvedState: "all",
      searchOrder: [
        "global:active",
        "global:archived",
        "project:active",
        "project:archived",
        "project-local:active",
        "project-local:archived"
      ],
      totalMatchedCount: 2,
      returnedCount: 1,
      globalLimitApplied: true,
      truncatedCount: 1,
      resultWindow: {
        start: 1,
        end: 1,
        limit: 1
      },
      stateResolution: {
        outcome: "explicit-state",
        searchedStates: ["active", "archived"],
        resolutionReason: "explicit-all-state-requested"
      },
      executionSummary: {
        mode: "index-only",
        retrievalModes: ["index"],
        fallbackReasons: []
      }
    });
    const projectChecks = output.diagnostics.checkedPaths.filter((check) => check.scope === "project");
    expect(projectChecks).toMatchObject([
      {
        scope: "project",
        state: "active",
        retrievalMode: "index",
        matchedCount: 1
      },
      {
        scope: "project",
        state: "archived",
        retrievalMode: "index",
        matchedCount: 1
      }
    ]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.globalRank).toBe(1);
    const returnedState = output.results[0]?.state;
    expect(returnedState === "active" || returnedState === "archived").toBe(true);
    const activeCheck = projectChecks.find((check) => check.state === "active");
    const archivedCheck = projectChecks.find((check) => check.state === "archived");
    expect((activeCheck?.returnedCount ?? 0) + (archivedCheck?.returnedCount ?? 0)).toBe(1);
    expect(
      returnedState === "active" ? activeCheck?.returnedCount : archivedCheck?.returnedCount
    ).toBe(1);
    expect(
      returnedState === "active" ? activeCheck?.droppedCount : archivedCheck?.droppedCount
    ).toBe(0);
    expect(
      returnedState === "active" ? archivedCheck?.droppedCount : activeCheck?.droppedCount
    ).toBe(1);
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
      stateFallbackUsed: boolean;
      markdownFallbackUsed: boolean;
      retrievalMode: string;
      stateResolution: {
        outcome: string;
        searchedStates: string[];
        resolutionReason: string;
      };
      executionSummary: {
        mode: string;
        retrievalModes: string[];
        fallbackReasons: string[];
      };
      results: Array<{ ref: string; state: string; topic: string }>;
    };
    expect(searchOutput).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      stateFallbackUsed: true,
      markdownFallbackUsed: false,
      retrievalMode: "index",
      stateResolution: {
        outcome: "archived-hit",
        searchedStates: ["active", "archived"],
        resolutionReason: "active-empty-archived-match-found"
      },
      executionSummary: {
        mode: "index-only",
        retrievalModes: ["index"],
        fallbackReasons: []
      }
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

  it("matches multi-term queries across summary and details fields", async () => {
    const homeDir = await tempDir("cam-recall-cross-field-home-");
    const projectDir = await tempDir("cam-recall-cross-field-project-");
    const memoryRoot = await tempDir("cam-recall-cross-field-memory-");
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
      "Prefer pnpm.",
      ["Use it in this repository."],
      "Manual note."
    );

    const searchResult = runCli(projectDir, [
      "recall",
      "search",
      "pnpm repository",
      "--state",
      "active",
      "--json"
    ]);
    expect(searchResult.exitCode).toBe(0);

    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string; matchedFields: string[] }>;
    };
    expect(searchOutput.results).toEqual([
      expect.objectContaining({
        ref: "project:active:workflow:prefer-pnpm",
        matchedFields: expect.arrayContaining(["summary", "details"])
      })
    ]);
  });

  it("does not return deleted active entries from the retrieval sidecar after forget", async () => {
    const homeDir = await tempDir("cam-recall-delete-sidecar-home-");
    const projectDir = await tempDir("cam-recall-delete-sidecar-project-");
    const memoryRoot = await tempDir("cam-recall-delete-sidecar-memory-");
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
      "project-local",
      "workflow",
      "test-memory-for-contract-inspection",
      "test memory for contract inspection",
      ["test memory for contract inspection"],
      "Manual note."
    );
    await store.forget("project-local", "test memory for contract inspection");

    const searchResult = runCli(projectDir, [
      "recall",
      "search",
      "test memory for contract inspection",
      "--state",
      "active",
      "--json"
    ]);
    expect(searchResult.exitCode).toBe(0);

    const searchOutput = JSON.parse(searchResult.stdout) as {
      totalMatchedCount: number;
      returnedCount: number;
      results: Array<{ ref: string }>;
    };
    expect(searchOutput.totalMatchedCount).toBe(0);
    expect(searchOutput.returnedCount).toBe(0);
    expect(searchOutput.results).toEqual([]);
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
      warnings: [],
      latestAudit: {
        auditPath: store.getSyncAuditPath(),
        rolloutPath,
        sessionId: "session-provenance",
        status: "applied",
        resultSummary: expect.stringContaining("operation(s) applied"),
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        rejectedOperations: []
      },
      lineageSummary: expect.objectContaining({
        eventCount: 1,
        latestAction: "add",
        latestState: "active",
        latestAuditStatus: "applied",
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        conflictCount: 0
      }),
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
    expect(timelineTextResult.stdout).toContain(`Latest audit path: ${store.getSyncAuditPath()}`);

    const detailsResult = runCli(
      projectDir,
      ["recall", "details", searchOutput.results[0]!.ref, "--json"]
    );
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      latestLifecycleAction: "add",
      latestState: "active",
      latestSessionId: "session-provenance",
      latestRolloutPath: rolloutPath,
      historyPath: store.getHistoryPath("project"),
      timelineWarningCount: 0,
      lineageSummary: expect.objectContaining({
        eventCount: 1,
        latestAction: "add",
        latestState: "active",
        latestAuditStatus: "applied",
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        conflictCount: 0
      }),
      warnings: [],
      latestAudit: {
        auditPath: store.getSyncAuditPath(),
        rolloutPath,
        sessionId: "session-provenance",
        status: "applied",
        resultSummary: expect.stringContaining("operation(s) applied"),
        noopOperationCount: 0,
        suppressedOperationCount: 0,
        rejectedOperations: []
      }
    });
  });

  it("labels rejected reviewer counts as rollout-level in timeline and details text output", async () => {
    const homeDir = await tempDir("cam-recall-rejected-rollout-home-");
    const projectDir = await tempDir("cam-recall-rejected-rollout-project-");
    const memoryRoot = await tempDir("cam-recall-rejected-rollout-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const store = new MemoryStore(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    const rolloutPath = path.join(projectDir, "rejected-rollout.jsonl");
    await store.ensureLayout();
    await store.applyMutations([
      {
        action: "upsert",
        scope: "project",
        topic: "workflow",
        id: "prefer-pnpm",
        summary: "Prefer pnpm in this repository.",
        details: ["Use pnpm instead of npm in this repository."]
      }
    ], {
      sessionId: "session-rejected-rollout",
      rolloutPath
    });
    await store.appendSyncAuditEntry({
      appliedAt: "2026-03-18T00:00:00.000Z",
      projectId: project.projectId,
      worktreeId: project.worktreeId,
      rolloutPath,
      sessionId: "session-rejected-rollout",
      configuredExtractorMode: "heuristic",
      configuredExtractorName: "heuristic",
      actualExtractorMode: "heuristic",
      actualExtractorName: "heuristic",
      extractorMode: "heuristic",
      extractorName: "heuristic",
      sessionSource: "rollout-jsonl",
      status: "applied",
      appliedCount: 1,
      rejectedOperationCount: 1,
      rejectedReasonCounts: {
        "unknown-topic": 1
      },
      rejectedOperations: [
        {
          action: "upsert",
          scope: "project",
          topic: "workflow",
          id: "dropped-topic",
          reason: "unknown-topic"
        }
      ],
      scopesTouched: ["project"],
      resultSummary: "1 operation(s) applied, 1 rejected",
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

    const auditEntries = await store.readRecentSyncAuditEntries(1);
    expect(auditEntries[0]).toMatchObject({
      rolloutPath,
      rejectedOperationCount: 1
    });

    const ref = "project:active:workflow:prefer-pnpm";
    const timelineTextResult = runCli(projectDir, ["recall", "timeline", ref]);
    expect(timelineTextResult.exitCode).toBe(0);
    expect(timelineTextResult.stdout).toContain("Rollout rejected count: 1");
    expect(timelineTextResult.stdout).toContain("Latest audit rejected operations: [unknown-topic] project/workflow/dropped-topic");

    const detailsTextResult = runCli(projectDir, ["recall", "details", ref]);
    expect(detailsTextResult.exitCode).toBe(0);
    expect(detailsTextResult.stdout).toContain("Latest audit rollout rejected operations: 1");
    expect(detailsTextResult.stdout).toContain("Latest audit rejected operations: [unknown-topic] project/workflow/dropped-topic");
    expect(detailsTextResult.stdout).toContain("Rollout rejected count: 1");

    const detailsJsonResult = runCli(projectDir, ["recall", "details", ref, "--json"]);
    expect(detailsJsonResult.exitCode).toBe(0);
    expect(JSON.parse(detailsJsonResult.stdout)).toMatchObject({
      latestAudit: {
        rejectedOperationCount: 1,
        rejectedOperations: [
          {
            action: "upsert",
            scope: "project",
            topic: "workflow",
            id: "dropped-topic",
            reason: "unknown-topic"
          }
        ]
      }
    });
  });

  it("surfaces additive timeline and details warnings when lifecycle history contains bad lines", async () => {
    const homeDir = await tempDir("cam-recall-history-warning-home-");
    const projectDir = await tempDir("cam-recall-history-warning-project-");
    const memoryRoot = await tempDir("cam-recall-history-warning-memory-");
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

    await fs.appendFile(
      store.getHistoryPath("project"),
      `${JSON.stringify({ bad: "event" })}\n{not-json}\n`,
      "utf8"
    );

    const ref = "project:active:workflow:prefer-pnpm";
    const timelineResult = runCli(projectDir, ["recall", "timeline", ref, "--json"]);
    expect(timelineResult.exitCode).toBe(0);
    expect(JSON.parse(timelineResult.stdout)).toMatchObject({
      ref,
      warnings: expect.arrayContaining([
        expect.stringContaining("invalid JSONL lifecycle history line"),
        expect.stringContaining("malformed lifecycle event")
      ]),
      lineageSummary: expect.objectContaining({
        eventCount: 1,
        latestAction: "add",
        latestState: "active"
      }),
      events: [expect.objectContaining({ action: "add" })]
    });

    const detailsResult = runCli(projectDir, ["recall", "details", ref, "--json"]);
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref,
      latestState: "active",
      timelineWarningCount: 2,
      warnings: expect.arrayContaining([
        expect.stringContaining("invalid JSONL lifecycle history line"),
        expect.stringContaining("malformed lifecycle event")
      ]),
      lineageSummary: expect.objectContaining({
        eventCount: 1,
        latestAction: "add",
        latestState: "active"
      })
    });
  });

  it("does not backfill latestAudit from an older sync after a later manual archive", async () => {
    const homeDir = await tempDir("cam-recall-manual-archive-audit-home-");
    const projectDir = await tempDir("cam-recall-manual-archive-audit-project-");
    const memoryRoot = await tempDir("cam-recall-manual-archive-audit-memory-");
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
    await service.memoryStore.forget("project", "prefers pnpm", { archive: true });

    const searchResult = runCli(projectDir, ["recall", "search", "prefers pnpm", "--state", "archived", "--json"]);
    expect(searchResult.exitCode).toBe(0);
    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string }>;
    };
    expect(searchOutput.results).toHaveLength(1);

    const ref = searchOutput.results[0]!.ref;
    const detailsResult = runCli(projectDir, ["recall", "details", ref, "--json"]);
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref,
      latestLifecycleAction: "archive",
      latestState: "archived",
      latestSessionId: null,
      latestRolloutPath: null,
      latestAudit: null,
      warnings: expect.arrayContaining([
        expect.stringContaining("latestAudit was not backfilled from an older sync audit entry")
      ]),
      lineageSummary: expect.objectContaining({
        latestAction: "archive",
        latestState: "archived",
        latestAuditStatus: null
      })
    });
  });

  it("keeps details provenance aligned with the latest noop attempt from sync history", async () => {
    const homeDir = await tempDir("cam-recall-noop-provenance-home-");
    const projectDir = await tempDir("cam-recall-noop-provenance-project-");
    const memoryRoot = await tempDir("cam-recall-noop-provenance-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(projectDir, "Remember that this repository prefers pnpm.", {
        sessionId: "session-noop-provenance"
      }),
      "utf8"
    );

    const project = detectProjectContext(projectDir);
    const service = new SyncService(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });
    await service.syncRollout(rolloutPath, true);
    const existingEntry = (await service.memoryStore.listEntries("project")).find(
      (entry) => entry.topic === "preferences" && entry.id === "this-repository-prefers-pnpm"
    );
    expect(existingEntry).toBeTruthy();
    await service.memoryStore.applyMutations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "preferences",
          id: "this-repository-prefers-pnpm",
          summary: existingEntry!.summary,
          details: existingEntry!.details,
          sources: existingEntry!.sources,
          reason: existingEntry!.reason
        }
      ],
      {
        sessionId: "session-noop-provenance",
        rolloutPath
      }
    );

    const searchResult = runCli(projectDir, ["recall", "search", "prefers pnpm", "--json"]);
    expect(searchResult.exitCode).toBe(0);
    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string }>;
    };
    const ref = searchOutput.results[0]?.ref;
    expect(ref).toBeTruthy();

    const detailsResult = runCli(projectDir, ["recall", "details", ref!, "--json"]);
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref,
      latestLifecycleAction: "add",
      latestLifecycleAttempt: {
        action: "noop",
        outcome: "noop",
        sessionId: "session-noop-provenance",
        rolloutPath
      },
      latestSessionId: "session-noop-provenance",
      latestRolloutPath: rolloutPath,
      latestAudit: {
        sessionId: "session-noop-provenance",
        rolloutPath,
        status: "applied",
        matchedOperationCount: 1
      },
      lineageSummary: {
        latestAction: "add",
        latestAttemptedAction: "noop",
        latestAttemptedOutcome: "noop",
        refNoopCount: 1
      }
    });
  });

  it("does not attach an unrelated noop audit to the current ref when only provenance matches", async () => {
    const homeDir = await tempDir("cam-recall-noop-audit-mismatch-home-");
    const projectDir = await tempDir("cam-recall-noop-audit-mismatch-project-");
    const memoryRoot = await tempDir("cam-recall-noop-audit-mismatch-memory-");
    const firstRolloutPath = path.join(projectDir, "rollout-primary.jsonl");
    const secondRolloutPath = path.join(projectDir, "rollout-secondary.jsonl");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig();
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot
    });

    const project = detectProjectContext(projectDir);
    const service = new SyncService(project, {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot
    });

    await fs.writeFile(
      firstRolloutPath,
      makeRolloutFixture(projectDir, "Remember that this repository prefers pnpm.", {
        sessionId: "session-primary"
      }),
      "utf8"
    );
    await service.syncRollout(firstRolloutPath, true);

    await service.memoryStore.remember(
      "project",
      "workflow",
      "prefer-rg",
      "Prefer rg for repo search.",
      ["Use rg instead of grep when searching this repository."],
      "Manual note."
    );

    await fs.writeFile(
      secondRolloutPath,
      makeRolloutFixture(projectDir, "Remember that prefer rg for repo search.", {
        sessionId: "session-secondary"
      }),
      "utf8"
    );
    await service.syncRollout(secondRolloutPath, true);

    const existingEntry = (await service.memoryStore.listEntries("project")).find(
      (entry) => entry.topic === "preferences" && entry.id === "this-repository-prefers-pnpm"
    );
    expect(existingEntry).toBeTruthy();

    await service.memoryStore.applyMutations(
      [
        {
          action: "upsert",
          scope: "project",
          topic: "preferences",
          id: "this-repository-prefers-pnpm",
          summary: existingEntry!.summary,
          details: existingEntry!.details,
          sources: existingEntry!.sources,
          reason: existingEntry!.reason
        }
      ],
      {
        sessionId: "session-secondary",
        rolloutPath: secondRolloutPath
      }
    );

    const searchResult = runCli(projectDir, ["recall", "search", "prefers pnpm", "--json"]);
    expect(searchResult.exitCode).toBe(0);
    const searchOutput = JSON.parse(searchResult.stdout) as {
      results: Array<{ ref: string }>;
    };
    const ref = searchOutput.results[0]?.ref;
    expect(ref).toBeTruthy();

    const detailsResult = runCli(projectDir, ["recall", "details", ref!, "--json"]);
    expect(detailsResult.exitCode).toBe(0);
    expect(JSON.parse(detailsResult.stdout)).toMatchObject({
      ref,
      latestLifecycleAttempt: {
        action: "noop",
        outcome: "noop",
        sessionId: "session-secondary",
        rolloutPath: secondRolloutPath
      },
      latestAudit: null,
      warnings: expect.arrayContaining([
        expect.stringContaining("no matching sync audit entry was found")
      ]),
      lineageSummary: expect.objectContaining({
        latestAuditStatus: null,
        matchedAuditOperationCount: 0
      })
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
      stateFallbackUsed: boolean;
      markdownFallbackUsed: boolean;
      retrievalMode: string;
      retrievalFallbackReason?: string;
      stateResolution: {
        outcome: string;
        searchedStates: string[];
        resolutionReason: string;
      };
      executionSummary: {
        mode: string;
        retrievalModes: string[];
        fallbackReasons: string[];
      };
      diagnostics: RecallSearchDiagnostics;
      results: unknown[];
    };
    expect(output).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true,
      stateFallbackUsed: true,
      markdownFallbackUsed: true,
      retrievalMode: "markdown-fallback",
      retrievalFallbackReason: "missing",
      stateResolution: {
        outcome: "miss-after-both",
        searchedStates: ["active", "archived"],
        resolutionReason: "no-match-after-auto-search"
      },
      executionSummary: {
        mode: "markdown-fallback-only",
        retrievalModes: ["markdown-fallback"],
        fallbackReasons: ["missing"]
      },
      results: []
    });
    expect(output.diagnostics).toMatchObject({
      anyMarkdownFallback: true,
      fallbackReasons: ["missing"],
      executionModes: ["markdown-fallback"]
    });
    expect(output.diagnostics.checkedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "project",
          state: "active",
          retrievalMode: "markdown-fallback",
          retrievalFallbackReason: "missing",
          matchedCount: 0,
          returnedCount: 0
        }),
        expect.objectContaining({
          scope: "project",
          state: "archived",
          retrievalMode: "markdown-fallback",
          retrievalFallbackReason: "missing",
          matchedCount: 0,
          returnedCount: 0
        })
      ])
    );

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
      diagnostics: {
        checkedPaths: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            retrievalMode: "markdown-fallback",
            retrievalFallbackReason: "invalid",
            matchedCount: 1,
            indexPath: store.getRetrievalIndexFile("project", "active"),
            generatedAt: null
          })
        ])
      },
      results: [expect.objectContaining({ ref: "project:active:workflow:prefer-pnpm" })]
    });
  });

  it("surfaces markdown fallback diagnostics when the retrieval sidecar is stale", async () => {
    const homeDir = await tempDir("cam-recall-stale-sidecar-home-");
    const projectDir = await tempDir("cam-recall-stale-sidecar-project-");
    const memoryRoot = await tempDir("cam-recall-stale-sidecar-memory-");
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

    const topicPath = store.getTopicFile("project", "workflow");
    const staleAt = new Date(Date.now() + 60_000);
    await fs.utimes(topicPath, staleAt, staleAt);

    const result = runCli(projectDir, ["recall", "search", "prefer pnpm", "--state", "active", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalRetrievalMode: "markdown-fallback",
      retrievalMode: "markdown-fallback",
      retrievalFallbackReason: "stale",
      executionSummary: {
        mode: "mixed",
        retrievalModes: ["index", "markdown-fallback"],
        fallbackReasons: ["stale"]
      },
      diagnostics: {
        executionModes: ["index", "markdown-fallback"],
        checkedPaths: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            retrievalMode: "markdown-fallback",
            retrievalFallbackReason: "stale",
            matchedCount: 1,
            returnedCount: 1,
            indexPath: store.getRetrievalIndexFile("project", "active"),
            generatedAt: expect.any(String)
          })
        ])
      },
      results: [expect.objectContaining({ ref: "project:active:workflow:prefer-pnpm" })]
    });
  });

  it("reports mixed execution summary when auto search falls back from markdown active lookup to archived index results", async () => {
    const homeDir = await tempDir("cam-recall-mixed-execution-home-");
    const projectDir = await tempDir("cam-recall-mixed-execution-project-");
    const memoryRoot = await tempDir("cam-recall-mixed-execution-memory-");
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
    await fs.writeFile(store.getRetrievalIndexFile("project", "active"), "{not-json", "utf8");

    const result = runCli(projectDir, ["recall", "search", "historical", "--state", "auto", "--json"]);
    expect(result.exitCode).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      stateResolution: {
        outcome: "archived-hit",
        searchedStates: ["active", "archived"],
        resolutionReason: "active-empty-archived-match-found"
      },
      finalRetrievalMode: "index",
      retrievalMode: "index",
      markdownFallbackUsed: true,
      executionSummary: {
        mode: "mixed",
        retrievalModes: ["index", "markdown-fallback"],
        fallbackReasons: ["invalid"]
      },
      diagnostics: {
        anyMarkdownFallback: true,
        fallbackReasons: ["invalid"],
        executionModes: ["index", "markdown-fallback"],
        checkedPaths: expect.arrayContaining([
          expect.objectContaining({
            scope: "project",
            state: "active",
            retrievalMode: "markdown-fallback",
            retrievalFallbackReason: "invalid",
            matchedCount: 0,
            returnedCount: 0
          }),
          expect.objectContaining({
            scope: "project",
            state: "archived",
            retrievalMode: "index",
            matchedCount: 1,
            returnedCount: 1
          })
        ])
      },
      results: [expect.objectContaining({ ref: "project:archived:workflow:historical-pnpm" })]
    });
  });

  it("adds query-time surfacing hints from the dream sidecar without changing search results", async () => {
    const homeDir = await tempDir("cam-recall-dream-home-");
    const projectDir = await tempDir("cam-recall-dream-project-");
    const memoryRoot = await tempDir("cam-recall-dream-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig({
      dreamSidecarEnabled: true
    });
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
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

    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(
        projectDir,
        "Continue the middleware work and keep using pnpm in this repository."
      ),
      "utf8"
    );
    await runDream("build", {
      cwd: projectDir,
      rollout: rolloutPath,
      json: true
    });

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--json"]);
    expect(result.exitCode).toBe(0);

    const response = JSON.parse(result.stdout) as MemorySearchResponse & {
      querySurfacing: {
        suggestedDreamRefs: Array<{ ref: string; reason: string }>;
      };
    };

    expect(response.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(response.querySurfacing.suggestedDreamRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
  });

  it("merges shared and local dream snapshots when building query surfacing hints", async () => {
    const homeDir = await tempDir("cam-recall-dream-merge-home-");
    const projectDir = await tempDir("cam-recall-dream-merge-project-");
    const memoryRoot = await tempDir("cam-recall-dream-merge-memory-");
    process.env.HOME = homeDir;

    const projectConfig = makeAppConfig({
      dreamSidecarEnabled: true
    });
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...projectConfig,
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "prefer-pnpm-shared",
      "Prefer pnpm from the shared workflow memory.",
      ["Use pnpm across the shared project workflow."],
      "Manual note."
    );

    const sharedRolloutPath = path.join(projectDir, "shared-rollout.jsonl");
    await fs.writeFile(
      sharedRolloutPath,
      makeRolloutFixture(projectDir, "Keep using pnpm for the shared middleware workflow."),
      "utf8"
    );
    await runDream("build", {
      cwd: projectDir,
      rollout: sharedRolloutPath,
      scope: "project",
      json: true
    });

    await store.remember(
      "project-local",
      "workflow",
      "prefer-pnpm-local",
      "Prefer pnpm for this local worktree retry loop.",
      ["Use pnpm for the local worktree retry workflow."],
      "Manual note."
    );

    const localRolloutPath = path.join(projectDir, "local-rollout.jsonl");
    await fs.writeFile(
      localRolloutPath,
      makeRolloutFixture(projectDir, "Keep using pnpm for the local retry workflow."),
      "utf8"
    );
    await runDream("build", {
      cwd: projectDir,
      rollout: localRolloutPath,
      scope: "project-local",
      json: true
    });

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--json"]);
    expect(result.exitCode).toBe(0);

    const response = JSON.parse(result.stdout) as MemorySearchResponse & {
      querySurfacing: {
        suggestedDreamRefs: Array<{ ref: string; reason: string }>;
        topDurableRefs?: Array<{ ref: string }>;
      };
    };

    expect(response.querySurfacing.suggestedDreamRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm-shared"
        }),
        expect.objectContaining({
          ref: "project-local:active:workflow:prefer-pnpm-local"
        })
      ])
    );
    expect(response.querySurfacing.topDurableRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm-shared"
        })
      ])
    );
  });

  it("auto-builds dream surfacing and includes team memory suggestions when enabled", async () => {
    const homeDir = await tempDir("cam-recall-autobuild-home-");
    const projectDir = await tempDir("cam-recall-autobuild-project-");
    const memoryRoot = await tempDir("cam-recall-autobuild-memory-");
    const sessionsDir = await tempDir("cam-recall-autobuild-sessions-");
    process.env.HOME = homeDir;
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const projectConfig = makeAppConfig({
      dreamSidecarEnabled: true,
      dreamSidecarAutoBuild: true
    });
    await writeCamConfig(projectDir, projectConfig, {
      autoMemoryDirectory: memoryRoot,
      dreamSidecarEnabled: true,
      dreamSidecarAutoBuild: true
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

    await fs.writeFile(path.join(projectDir, "TEAM_MEMORY.md"), "# Team Memory\n", "utf8");
    await fs.mkdir(path.join(projectDir, "team-memory"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "team-memory", "workflow.md"),
      [
        "# Workflow",
        "",
        "<!-- cam:team-topic workflow -->",
        "",
        "## prefer-pnpm-shared",
        '<!-- cam:team-entry {"id":"prefer-pnpm-shared","scopeHint":"project","updatedAt":"2026-03-15T00:00:00.000Z"} -->',
        "Summary: Prefer pnpm from the shared workflow memory.",
        "Details:",
        "- Use pnpm across the shared project workflow.",
        ""
      ].join("\n"),
      "utf8"
    );

    const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-primary.jsonl");
    await fs.writeFile(
      rolloutPath,
      makeRolloutFixture(projectDir, "Continue the middleware work and keep using pnpm in this repository."),
      "utf8"
    );

    const result = runCli(projectDir, ["recall", "search", "pnpm", "--json"]);
    expect(result.exitCode).toBe(0);

    const response = JSON.parse(result.stdout) as MemorySearchResponse & {
      querySurfacing: {
        suggestedDreamRefs: Array<{ ref: string; reason: string }>;
        suggestedTeamEntries: Array<{ key: string; summary: string; path: string }>;
      };
    };

    expect(response.querySurfacing.suggestedDreamRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ])
    );
    expect(response.querySurfacing.suggestedTeamEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "team:workflow:prefer-pnpm-shared",
          summary: "Prefer pnpm from the shared workflow memory.",
          path: expect.stringContaining(`${path.sep}team-memory${path.sep}workflow.md`)
        })
      ])
    );
  });
});
