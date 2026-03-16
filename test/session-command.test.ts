import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSession } from "../src/lib/commands/session.js";
import { runWrappedCodex } from "../src/lib/commands/wrapper.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import type { AppConfig } from "../src/lib/types.js";

const tempDirs: string[] = [];
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(repoDir: string): Promise<void> {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Codex Auto Memory",
    GIT_AUTHOR_EMAIL: "cam@example.com",
    GIT_COMMITTER_NAME: "Codex Auto Memory",
    GIT_COMMITTER_EMAIL: "cam@example.com"
  };
  runCommandCapture("git", ["init", "-b", "main"], repoDir, gitEnv);
  await fs.writeFile(path.join(repoDir, "README.md"), "seed\n", "utf8");
  runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
  runCommandCapture("git", ["commit", "-m", "init"], repoDir, gitEnv);
}

function configJson(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    autoMemoryEnabled: true,
    extractorMode: "heuristic",
    defaultScope: "project",
    maxStartupLines: 200,
    sessionContinuityAutoLoad: false,
    sessionContinuityAutoSave: false,
    sessionContinuityLocalPathStyle: "codex",
    maxSessionContinuityLines: 60,
    codexBinary: "codex",
    ...overrides
  };
}

function rolloutFixture(projectDir: string, message: string): string {
  return [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: "session-1",
        timestamp: "2026-03-15T00:00:00.000Z",
        cwd: projectDir
      }
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message
      }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: "{\"cmd\":\"pnpm test\"}"
      }
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "Process exited with code 0"
      }
    })
  ].join("\n");
}

afterEach(async () => {
  process.env.CAM_CODEX_SESSIONS_DIR = originalSessionsDir;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runSession", () => {
  it("saves, loads, reports, and clears continuity state", async () => {
    const repoDir = await tempDir("cam-session-cmd-repo-");
    const memoryRoot = await tempDir("cam-session-cmd-memory-");
    await initRepo(repoDir);

    await fs.writeFile(
      path.join(repoDir, "codex-auto-memory.json"),
      JSON.stringify(configJson(), null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, ".codex-auto-memory.local.json"),
      JSON.stringify({ autoMemoryDirectory: memoryRoot }, null, 2),
      "utf8"
    );

    const rolloutPath = path.join(repoDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      rolloutFixture(repoDir, "Continue the login cookie work and add middleware."),
      "utf8"
    );

    const saveOutput = await runSession("save", {
      cwd: repoDir,
      rollout: rolloutPath,
      scope: "both"
    });
    expect(saveOutput).toContain("Saved session continuity");

    const loadJson = JSON.parse(
      await runSession("load", {
        cwd: repoDir,
        json: true,
        printStartup: true
      })
    ) as {
      projectState: { goal: string; confirmedWorking: string[] } | null;
      localState: { incompleteNext: string[]; filesDecisionsEnvironment: string[] } | null;
      mergedState: { goal: string; confirmedWorking: string[]; incompleteNext: string[] };
      startup: { text: string };
    };
    expect(loadJson.mergedState.goal).toContain("Continue the login cookie work");
    expect(loadJson.mergedState.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(loadJson.localState?.incompleteNext.length).toBeGreaterThan(0);
    expect(loadJson.startup.text).toContain("# Session Continuity");

    const statusJson = JSON.parse(
      await runSession("status", { cwd: repoDir, json: true })
    ) as { localPathStyle: string };
    expect(statusJson.localPathStyle).toBe("codex");

    const clearOutput = await runSession("clear", { cwd: repoDir, scope: "both" });
    expect(clearOutput).toContain("Cleared session continuity files");

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson(),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readMergedState()).toBeNull();
  }, 15_000);
});

describe("runWrappedCodex with session continuity", () => {
  it("injects continuity on startup and auto-saves it after the run", async () => {
    const repoDir = await tempDir("cam-wrapper-session-repo-");
    const memoryRoot = await tempDir("cam-wrapper-session-memory-");
    const sessionsDir = await tempDir("cam-wrapper-session-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const capturedArgsPath = path.join(repoDir, "captured-args.json");
    const mockCodexPath = path.join(repoDir, "mock-codex");
    const todayDir = path.join(sessionsDir, "2026", "03", "15");
    await fs.mkdir(todayDir, { recursive: true });
    await fs.writeFile(
      mockCodexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const sessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;
fs.writeFileSync(path.join(cwd, "captured-args.json"), JSON.stringify(process.argv.slice(2), null, 2));
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue the wrapper continuity migration." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await fs.writeFile(
      path.join(repoDir, "codex-auto-memory.json"),
      JSON.stringify(
        configJson({
          codexBinary: mockCodexPath
        }),
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, ".codex-auto-memory.local.json"),
      JSON.stringify(
        {
          autoMemoryDirectory: memoryRoot,
          sessionContinuityAutoLoad: true,
          sessionContinuityAutoSave: true
        },
        null,
        2
      ),
      "utf8"
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    await continuityStore.saveSummary(
      {
        project: {
          goal: "Resume the wrapper test continuity.",
          confirmedWorking: ["Previous startup block exists."],
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
          incompleteNext: ["Run wrapper auto-save."],
          filesDecisionsEnvironment: []
        }
      },
      "both"
    );

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];
    const baseInstructionsArg = capturedArgs.find((arg) => arg.startsWith("base_instructions="));
    expect(baseInstructionsArg).toContain("# Session Continuity");
    expect(baseInstructionsArg).toContain("# Codex Auto Memory");

    const merged = await continuityStore.readMergedState();
    expect(merged?.goal).toContain("Continue the wrapper continuity migration");
    expect(merged?.confirmedWorking.join("\n")).toContain("pnpm test");
  }, 15_000);
});
