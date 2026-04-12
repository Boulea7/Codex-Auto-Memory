import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWrappedCodex } from "../src/lib/commands/wrapper.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import { SyncService } from "../src/lib/domain/sync-service.js";
import {
  initGitRepo,
  makeAppConfig,
  writeCamConfig
} from "./helpers/cam-test-fixtures.js";
import {
  cleanupTempDirs,
  createTempDir,
  writeWrapperMockCodex
} from "./helpers/session-test-support.js";

const tempDirs: string[] = [];
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;

async function tempDir(prefix: string): Promise<string> {
  return createTempDir(tempDirs, prefix);
}

const initRepo = initGitRepo;
const configJson = makeAppConfig;
const writeProjectConfig = writeCamConfig;

afterEach(async () => {
  process.env.CAM_CODEX_SESSIONS_DIR = originalSessionsDir;
  await cleanupTempDirs(tempDirs);
});

describe("runWrappedCodex with session continuity", () => {
  it("does not inject or auto-save continuity when both wrapper flags are disabled", async () => {
    const repoDir = await tempDir("cam-wrapper-no-continuity-repo-");
    const memoryRoot = await tempDir("cam-wrapper-no-continuity-memory-");
    const sessionsDir = await tempDir("cam-wrapper-no-continuity-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const { capturedArgsPath, mockCodexPath } = await writeWrapperMockCodex(repoDir, sessionsDir, {
      sessionId: "session-wrapper-no-continuity",
      message: "Continue without continuity automation."
    });

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: false
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: false
      }
    );

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];
    const baseInstructionsArg = capturedArgs.find((arg) => arg.startsWith("base_instructions="));
    expect(baseInstructionsArg).toContain("# Codex Auto Memory");
    expect(baseInstructionsArg).not.toContain("# Session Continuity");

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: false
      }),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readLatestAuditEntry()).toBeNull();
    expect(await store.readMergedState()).toBeNull();
    expect(await store.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("injects continuity without auto-saving when autoLoad is enabled and autoSave is disabled", async () => {
    const repoDir = await tempDir("cam-wrapper-load-only-repo-");
    const memoryRoot = await tempDir("cam-wrapper-load-only-memory-");
    const sessionsDir = await tempDir("cam-wrapper-load-only-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const { capturedArgsPath, mockCodexPath } = await writeWrapperMockCodex(repoDir, sessionsDir, {
      sessionId: "session-wrapper-load-only",
      message: "Continue but do not auto-save continuity."
    });

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }),
      autoMemoryDirectory: memoryRoot
    });
    await continuityStore.saveSummary(
      {
        project: {
          goal: "Seeded continuity goal.",
          confirmedWorking: ["Seeded continuity still exists."],
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
          incompleteNext: ["Seeded local next step."],
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
    expect(baseInstructionsArg).toContain("Seeded continuity goal.");

    const merged = await continuityStore.readMergedState();
    expect(merged?.goal).toBe("Seeded continuity goal.");
    expect(merged?.goal).not.toContain("do not auto-save continuity");
    expect(await continuityStore.readLatestAuditEntry()).toBeNull();
    expect(await continuityStore.readRecoveryRecord()).toBeNull();
  }, 30_000);

  it("injects only continuity source files that actually exist", async () => {
    const repoDir = await tempDir("cam-wrapper-existing-sources-repo-");
    const memoryRoot = await tempDir("cam-wrapper-existing-sources-memory-");
    const sessionsDir = await tempDir("cam-wrapper-existing-sources-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const { capturedArgsPath, mockCodexPath } = await writeWrapperMockCodex(repoDir, sessionsDir, {
      sessionId: "session-wrapper-existing-sources",
      message: "Continue with shared-only continuity."
    });

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: false
      }),
      autoMemoryDirectory: memoryRoot
    });
    await continuityStore.saveSummary(
      {
        project: {
          goal: "Shared-only continuity goal.",
          confirmedWorking: ["Shared-only continuity exists."],
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
          incompleteNext: [],
          filesDecisionsEnvironment: []
        }
      },
      "project"
    );

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];
    const baseInstructionsArg = capturedArgs.find((arg) => arg.startsWith("base_instructions="));
    expect(baseInstructionsArg).toContain(continuityStore.paths.sharedFile);
    expect(baseInstructionsArg).not.toContain(continuityStore.paths.localFile);
  }, 30_000);

  it("auto-saves continuity without injecting it when autoLoad is disabled and autoSave is enabled", async () => {
    const repoDir = await tempDir("cam-wrapper-save-only-repo-");
    const memoryRoot = await tempDir("cam-wrapper-save-only-memory-");
    const sessionsDir = await tempDir("cam-wrapper-save-only-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const { capturedArgsPath, mockCodexPath } = await writeWrapperMockCodex(repoDir, sessionsDir, {
      sessionId: "session-wrapper-save-only",
      message: "Continue with save-only continuity handling."
    });

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const capturedArgs = JSON.parse(await fs.readFile(capturedArgsPath, "utf8")) as string[];
    const baseInstructionsArg = capturedArgs.find((arg) => arg.startsWith("base_instructions="));
    expect(baseInstructionsArg).toContain("# Codex Auto Memory");
    expect(baseInstructionsArg).not.toContain("# Session Continuity");

    const latestAudit = await continuityStore.readLatestAuditEntry();
    expect(latestAudit?.rolloutPath).toContain("rollout-2026-03-15T00-00-00-000Z-session.jsonl");
    const merged = await continuityStore.readMergedState();
    expect(merged?.goal).toContain("Continue with save-only continuity handling");
  }, 30_000);

  it("prefers the primary rollout over a newer subagent rollout during wrapper auto-save", async () => {
    const repoDir = await tempDir("cam-wrapper-primary-rollout-repo-");
    const memoryRoot = await tempDir("cam-wrapper-primary-rollout-memory-");
    const sessionsDir = await tempDir("cam-wrapper-primary-rollout-sessions-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

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
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const primaryPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
const subagentPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-01-000Z-subagent.jsonl");
fs.writeFileSync(primaryPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-primary", timestamp: "2026-03-15T00:00:00.000Z", cwd, source: "cli" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue the primary wrapper continuity path." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
fs.writeFileSync(subagentPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-subagent", forked_from_id: "session-wrapper-primary", timestamp: "2026-03-15T00:00:01.000Z", cwd, source: { subagent: { thread_spawn: { parent_thread_id: "session-wrapper-primary" } } } } }),
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-primary", timestamp: "2026-03-15T00:00:00.000Z", cwd, source: "cli" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "You are reviewer sub-agent 4. Work read-only. Focus on docs and contract surfaces only." } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const latestAudit = await continuityStore.readLatestAuditEntry();
    const merged = await continuityStore.readMergedState();

    expect(latestAudit?.rolloutPath).toContain("rollout-2026-03-15T00-00-00-000Z-session.jsonl");
    expect(latestAudit?.sourceSessionId).toBe("session-wrapper-primary");
    expect(merged?.goal).toContain("primary wrapper continuity path");
    expect(merged?.goal).not.toContain("reviewer sub-agent");
    expect(merged?.incompleteNext.join("\n")).not.toContain("reviewer sub-agent");
  }, 30_000);

  it("chooses the newest primary rollout deterministically when multiple primaries tie on timestamp", async () => {
    const repoDir = await tempDir("cam-wrapper-primary-tie-repo-");
    const memoryRoot = await tempDir("cam-wrapper-primary-tie-memory-");
    const sessionsDir = await tempDir("cam-wrapper-primary-tie-sessions-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

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
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const olderPrimaryPath = path.join(rolloutDir, "rollout-z-primary.jsonl");
const newerPrimaryPath = path.join(rolloutDir, "rollout-a-primary.jsonl");
const subagentPath = path.join(rolloutDir, "rollout-subagent.jsonl");
const tiedTimestamp = "2026-03-15T00:00:00.000Z";
fs.writeFileSync(olderPrimaryPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-primary-older", timestamp: tiedTimestamp, cwd, source: "cli" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Use the older primary continuity path." } })
].join("\\n"));
fs.writeFileSync(newerPrimaryPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-primary-newer", timestamp: tiedTimestamp, cwd, source: "cli" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Use the newer primary continuity path." } })
].join("\\n"));
fs.writeFileSync(subagentPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-subagent", forked_from_id: "session-wrapper-primary-newer", timestamp: "2026-03-15T00:00:01.000Z", cwd, source: { subagent: { thread_spawn: { parent_thread_id: "session-wrapper-primary-newer" } } } } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Reviewer subagent noise." } })
].join("\\n"));
const olderTime = new Date("2026-03-15T00:00:02.000Z");
const newerTime = new Date("2026-03-15T00:00:03.000Z");
fs.utimesSync(olderPrimaryPath, olderTime, olderTime);
fs.utimesSync(newerPrimaryPath, newerTime, newerTime);
fs.utimesSync(subagentPath, newerTime, newerTime);
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }
    );

    const continuityStore = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoLoad: false,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });

    const exitCode = await runWrappedCodex(repoDir, "exec", ["continue"]);
    expect(exitCode).toBe(0);

    const latestAudit = await continuityStore.readLatestAuditEntry();
    const merged = await continuityStore.readMergedState();

    expect(latestAudit?.rolloutPath).toContain("rollout-a-primary.jsonl");
    expect(latestAudit?.sourceSessionId).toBe("session-wrapper-primary-newer");
    expect(merged?.goal).toContain("newer primary continuity path");
    expect(merged?.goal).not.toContain("older primary continuity path");
    expect(merged?.goal).not.toContain("Reviewer subagent noise");
  }, 30_000);

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

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoLoad: true,
        sessionContinuityAutoSave: true
      }
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

    const latestAudit = await continuityStore.readLatestAuditEntry();
    expect(latestAudit?.actualPath).toBe("heuristic");
    expect(latestAudit?.fallbackReason).toBe("configured-heuristic");
    expect(latestAudit?.writtenPaths.length).toBeGreaterThan(0);
  }, 30_000);

  it("writes a continuity recovery marker when wrapper auto-save cannot append audit", async () => {
    const repoDir = await tempDir("cam-wrapper-recovery-repo-");
    const memoryRoot = await tempDir("cam-wrapper-recovery-memory-");
    const sessionsDir = await tempDir("cam-wrapper-recovery-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

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
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-recovery", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue wrapper recovery handling." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoSave: true
      }
    );

    const appendAuditSpy = vi
      .spyOn(SessionContinuityStore.prototype, "appendAuditLog")
      .mockRejectedValueOnce(new Error("wrapper continuity audit write failed"));

    await expect(runWrappedCodex(repoDir, "exec", ["continue"])).rejects.toThrow(
      "wrapper continuity audit write failed"
    );
    appendAuditSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    expect(await store.readRecoveryRecord()).toMatchObject({
      failedStage: "audit-write",
      failureMessage: "wrapper continuity audit write failed",
      scope: "both"
    });
  }, 30_000);

  it("still saves continuity when wrapper durable sync fails", async () => {
    const repoDir = await tempDir("cam-wrapper-sync-fail-repo-");
    const memoryRoot = await tempDir("cam-wrapper-sync-fail-memory-");
    const sessionsDir = await tempDir("cam-wrapper-sync-fail-rollouts-");
    await initRepo(repoDir);
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

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
const rolloutDir = path.join(sessionsDir, "2026", "03", "15");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-2026-03-15T00-00-00-000Z-session.jsonl");
fs.writeFileSync(rolloutPath, [
  JSON.stringify({ type: "session_meta", payload: { id: "session-wrapper-sync-fail", timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Continue after durable sync sidecar failure." } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" } })
].join("\\n"));
`,
      "utf8"
    );
    await fs.chmod(mockCodexPath, 0o755);

    await writeProjectConfig(
      repoDir,
      configJson({
        codexBinary: mockCodexPath
      }),
      {
        autoMemoryDirectory: memoryRoot,
        sessionContinuityAutoSave: true
      }
    );

    const syncSpy = vi
      .spyOn(SyncService.prototype, "syncRollout")
      .mockRejectedValueOnce(new Error("sync audit write failed"));

    await expect(runWrappedCodex(repoDir, "exec", ["continue"])).rejects.toThrow(
      "sync audit write failed"
    );
    syncSpy.mockRestore();

    const store = new SessionContinuityStore(detectProjectContext(repoDir), {
      ...configJson({
        codexBinary: mockCodexPath,
        sessionContinuityAutoSave: true
      }),
      autoMemoryDirectory: memoryRoot
    });
    const latestAudit = await store.readLatestAuditEntry();
    expect(latestAudit?.rolloutPath).toContain("rollout-2026-03-15T00-00-00-000Z-session.jsonl");
    expect(latestAudit?.writtenPaths.length).toBeGreaterThan(0);
    expect((await store.readMergedState())?.confirmedWorking.join("\n")).toContain("pnpm test");
  }, 30_000);
});
