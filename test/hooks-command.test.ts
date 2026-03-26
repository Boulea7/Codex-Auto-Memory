import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { MemoryStore } from "../src/lib/domain/memory-store.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import { makeAppConfig, writeCamConfig } from "./helpers/cam-test-fixtures.js";
import { resolveCliInvocation, runCli } from "./helpers/cli-runner.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const shellOnlyIt = process.platform === "win32" ? it.skip : it;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeCamShim(binDir: string): Promise<string> {
  const invocation = resolveCliInvocation("source");
  const shimPath = path.join(binDir, "cam");
  const commandAndArgs = [invocation.command, ...invocation.args]
    .map((value) => JSON.stringify(value))
    .join(" ");
  await fs.writeFile(
    shimPath,
    `#!/bin/sh\nexec ${commandAndArgs} "$@"\n`,
    "utf8"
  );
  await fs.chmod(shimPath, 0o755);
  return shimPath;
}

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("hooks command", () => {
  it("supports --cwd and pins generated hook helpers to the targeted project root", async () => {
    const homeDir = await tempDir("cam-hooks-cwd-home-");
    const projectParentDir = await tempDir("cam-hooks-cwd-parent-");
    const projectDir = path.join(projectParentDir, "project with spaces");
    const shellDir = await tempDir("cam-hooks-cwd-shell-");
    const memoryRoot = await tempDir("cam-hooks-cwd-memory-");
    const binDir = await tempDir("cam-hooks-cwd-bin-");
    process.env.HOME = homeDir;

    await fs.mkdir(projectDir, { recursive: true });
    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...makeAppConfig(),
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

    const installResult = runCli(
      shellDir,
      ["hooks", "install", "--cwd", projectDir],
      { env: { HOME: homeDir } }
    );
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    await writeCamShim(binDir);
    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const recallScriptPath = path.join(hooksDir, "memory-recall.sh");
    const postWorkReviewScriptPath = path.join(hooksDir, "post-work-memory-review.sh");
    const env = {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    };

    const searchResult = runCommandCapture(
      recallScriptPath,
      ["search", "pnpm", "--json"],
      shellDir,
      env
    );
    expect(searchResult.exitCode, searchResult.stderr).toBe(0);
    expect(JSON.parse(searchResult.stdout)).toMatchObject({
      results: [
        expect.objectContaining({
          ref: "project:active:workflow:prefer-pnpm"
        })
      ]
    });

    const recallScript = await fs.readFile(recallScriptPath, "utf8");
    const postWorkReviewScript = await fs.readFile(postWorkReviewScriptPath, "utf8");
    expect(recallScript).toContain(
      `PROJECT_ROOT=${JSON.stringify(await fs.realpath(projectDir))}`
    );
    expect(postWorkReviewScript).toContain(
      `cam sync --cwd ${JSON.stringify(await fs.realpath(projectDir))}`
    );
    expect(postWorkReviewScript).toContain(
      `exec cam memory --recent --cwd ${JSON.stringify(await fs.realpath(projectDir))}`
    );
  });

  it("generates recall helper assets for hook and skill bridge flows", async () => {
    const homeDir = await tempDir("cam-hooks-home-");
    const projectDir = await tempDir("cam-hooks-project-");
    process.env.HOME = homeDir;

    const result = runCli(projectDir, ["hooks", "install"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Generated hook bridge bundle");
    expect(result.stdout).toContain("memory-recall.sh");
    expect(result.stdout).toContain("memory-search.sh");
    expect(result.stdout).toContain("memory-timeline.sh");
    expect(result.stdout).toContain("memory-details.sh");
    expect(result.stdout).toContain("post-work-memory-review.sh");
    expect(result.stdout).toContain("recall-bridge.md");
    expect(result.stdout).toContain("search -> timeline -> details");
    expect(result.stdout).toContain("read-only");
    expect(result.stdout).toContain("--state auto");
    expect(result.stdout).toContain("--limit 8");
    expect(result.stdout).toContain("search_memories");
    expect(result.stdout).toContain("cam mcp serve");
    expect(result.stdout).toContain("cam mcp doctor");
    expect(result.stdout).toContain("cam memory");
    expect(result.stdout).toContain("cam session");
    expect(result.stdout).toContain("local bridge");
    expect(result.stdout).toContain("not an official Codex hook surface");

    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const recallScript = await fs.readFile(path.join(hooksDir, "memory-recall.sh"), "utf8");
    const searchScript = await fs.readFile(path.join(hooksDir, "memory-search.sh"), "utf8");
    const timelineScript = await fs.readFile(path.join(hooksDir, "memory-timeline.sh"), "utf8");
    const detailsScript = await fs.readFile(path.join(hooksDir, "memory-details.sh"), "utf8");
    const postWorkReviewScript = await fs.readFile(
      path.join(hooksDir, "post-work-memory-review.sh"),
      "utf8"
    );
    const recallGuide = await fs.readFile(path.join(hooksDir, "recall-bridge.md"), "utf8");
    const realProjectDir = await fs.realpath(projectDir);

    expect(recallScript).toContain('exec cam recall search "$@"');
    expect(recallScript).toContain(`PROJECT_ROOT=${JSON.stringify(realProjectDir)}`);
    expect(recallScript).toContain("--state");
    expect(recallScript).toContain("auto");
    expect(recallScript).toContain("--limit");
    expect(recallScript).toContain("8");
    expect(searchScript).toContain('exec "$SCRIPT_DIR/memory-recall.sh" search "$@"');
    expect(timelineScript).toContain('exec "$SCRIPT_DIR/memory-recall.sh" timeline "$@"');
    expect(detailsScript).toContain('exec "$SCRIPT_DIR/memory-recall.sh" details "$@"');
    expect(postWorkReviewScript).toContain(
      `cam sync --cwd ${JSON.stringify(realProjectDir)} "$@"`
    );
    expect(postWorkReviewScript).toContain(
      `exec cam memory --recent --cwd ${JSON.stringify(realProjectDir)}`
    );
    expect(recallGuide).toContain("search_memories");
    expect(recallGuide).toContain("memory-recall.sh search");
    expect(recallGuide).toContain(
      `cam recall search "pnpm" --state auto --limit 8 --cwd ${JSON.stringify(realProjectDir)}`
    );
    expect(recallGuide).toContain("cam memory");
    expect(recallGuide).toContain("cam session");
    expect(recallGuide).toContain("local bridge");
    expect(recallGuide).toContain("not an official Codex hook surface");
  });

  shellOnlyIt("executes the recall bridge bundle without overriding explicit state or limit flags", async () => {
    const homeDir = await tempDir("cam-hooks-exec-home-");
    const projectDir = await tempDir("cam-hooks-exec-project-");
    const memoryRoot = await tempDir("cam-hooks-exec-memory-");
    const binDir = await tempDir("cam-hooks-exec-bin-");
    process.env.HOME = homeDir;

    await writeCamConfig(projectDir, makeAppConfig(), {
      autoMemoryDirectory: memoryRoot
    });

    const store = new MemoryStore(detectProjectContext(projectDir), {
      ...makeAppConfig(),
      autoMemoryDirectory: memoryRoot
    });
    await store.ensureLayout();
    await store.remember(
      "project",
      "workflow",
      "historical-note-one",
      "Historical note one.",
      ["Historical archive note one."],
      "Manual note."
    );
    await store.remember(
      "project",
      "workflow",
      "historical-note-two",
      "Historical note two.",
      ["Historical archive note two."],
      "Manual note."
    );
    await store.forget("project", "historical", { archive: true });

    const installResult = runCli(projectDir, ["hooks", "install"], {
      env: { HOME: homeDir }
    });
    expect(installResult.exitCode, installResult.stderr).toBe(0);

    await writeCamShim(binDir);
    const hooksDir = path.join(homeDir, ".codex-auto-memory", "hooks");
    const recallScriptPath = path.join(hooksDir, "memory-recall.sh");
    const searchScriptPath = path.join(hooksDir, "memory-search.sh");
    const env = {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    };

    const defaultResult = runCommandCapture(
      recallScriptPath,
      ["search", "historical", "--json"],
      projectDir,
      env
    );
    expect(defaultResult.exitCode, defaultResult.stderr).toBe(0);
    const defaultPayload = JSON.parse(defaultResult.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      results: Array<{ ref: string }>;
    };
    expect(defaultPayload).toMatchObject({
      state: "auto",
      resolvedState: "archived",
      fallbackUsed: true
    });
    expect(defaultPayload.results).toHaveLength(2);
    expect(defaultPayload.results.map((result) => result.ref)).toEqual(
      expect.arrayContaining([
        "project:archived:workflow:historical-note-one",
        "project:archived:workflow:historical-note-two"
      ])
    );

    const explicitResult = runCommandCapture(
      searchScriptPath,
      ["historical", "--state=all", "--limit=1", "--json"],
      projectDir,
      env
    );
    expect(explicitResult.exitCode, explicitResult.stderr).toBe(0);
    const explicitPayload = JSON.parse(explicitResult.stdout) as {
      state: string;
      resolvedState: string;
      fallbackUsed: boolean;
      results: Array<{ ref: string }>;
    };
    expect(explicitPayload).toMatchObject({
      state: "all",
      resolvedState: "all",
      fallbackUsed: false
    });
    expect(explicitPayload.results).toHaveLength(1);
  });
});
