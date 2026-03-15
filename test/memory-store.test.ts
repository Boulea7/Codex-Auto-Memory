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
    expect(startup.sourceFiles).toContain(store.getTopicFile("project", "workflow"));
    expect(startup.topicFiles).toContainEqual({
      scope: "project",
      topic: "workflow",
      path: store.getTopicFile("project", "workflow")
    });
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

  it("rejects topic traversal and skips corrupted audit log lines", async () => {
    const projectDir = await tempDir("cam-store-guardrails-");
    const memoryRoot = await tempDir("cam-store-guardrails-mem-");
    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      codexBinary: "codex"
    };
    const store = new MemoryStore(detectProjectContext(projectDir), config);
    await store.ensureLayout();

    expect(() => store.getTopicFile("project", "../escape")).toThrow(/Topic names must use lowercase kebab-case/);

    await fs.writeFile(
      path.join(store.paths.auditDir, "sync-log.jsonl"),
      [
        "{\"appliedAt\":\"2026-03-14T00:00:00.000Z\",\"resultSummary\":\"ok\"}",
        "THIS IS NOT JSON",
        "{\"appliedAt\":\"2026-03-14T00:01:00.000Z\",\"resultSummary\":\"still ok\"}"
      ].join("\n"),
      "utf8"
    );

    const auditEntries = await store.readRecentAuditEntries(5);
    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[0]?.resultSummary).toBe("still ok");
    expect(auditEntries[1]?.resultSummary).toBe("ok");
  });
});
