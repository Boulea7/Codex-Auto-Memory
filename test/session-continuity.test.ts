import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySessionContinuitySummary,
  compileSessionContinuity,
  createEmptySessionContinuityState,
  mergeSessionContinuityStates,
  parseSessionContinuity,
  renderSessionContinuity,
  sanitizeSessionContinuitySummary
} from "../src/lib/domain/session-continuity.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { SessionContinuitySummarizer } from "../src/lib/extractor/session-continuity-summarizer.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import type { AppConfig, RolloutEvidence } from "../src/lib/types.js";

const tempDirs: string[] = [];

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

function baseConfig(memoryRoot: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    autoMemoryEnabled: true,
    autoMemoryDirectory: memoryRoot,
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("session continuity domain", () => {
  it("round-trips markdown rendering and parsing", () => {
    const state = {
      ...createEmptySessionContinuityState("project", "project-1", "worktree-1"),
      goal: "Finish authentication cookie support.",
      confirmedWorking: ["Register endpoint returns 200."],
      triedAndFailed: ["NextAuth conflicted with the Prisma adapter."],
      notYetTried: ["Use an httpOnly cookie in the login route."],
      incompleteNext: ["Add middleware to protect private routes."],
      filesDecisionsEnvironment: ["Redis must be running for API integration tests."]
    };
    const rendered = renderSessionContinuity(state);
    const parsed = parseSessionContinuity(rendered, state);

    expect(parsed.goal).toBe(state.goal);
    expect(parsed.confirmedWorking).toEqual(state.confirmedWorking);
    expect(parsed.triedAndFailed).toEqual(state.triedAndFailed);
    expect(parsed.notYetTried).toEqual(state.notYetTried);
    expect(parsed.incompleteNext).toEqual(state.incompleteNext);
  });

  it("does not treat placeholder text as real continuity content", () => {
    const state = createEmptySessionContinuityState("project-local", "project-1", "worktree-1");
    const rendered = renderSessionContinuity(state);
    const parsed = parseSessionContinuity(rendered, state);

    expect(parsed.goal).toBe("");
    expect(parsed.confirmedWorking).toEqual([]);
    expect(parsed.triedAndFailed).toEqual([]);
    expect(parsed.notYetTried).toEqual([]);
    expect(parsed.incompleteNext).toEqual([]);
  });

  it("merges local continuity over shared continuity", () => {
    const shared = {
      ...createEmptySessionContinuityState("project", "project-1", "worktree-1"),
      goal: "Shared goal",
      confirmedWorking: ["Shared success"],
      incompleteNext: ["Shared next"]
    };
    const local = {
      ...createEmptySessionContinuityState("project-local", "project-1", "worktree-1"),
      goal: "Local goal",
      confirmedWorking: ["Local success"],
      incompleteNext: ["Local next"]
    };

    const merged = mergeSessionContinuityStates(local, shared);
    expect(merged.goal).toBe("Local goal");
    expect(merged.confirmedWorking).toEqual(["Local success", "Shared success"]);
    expect(merged.incompleteNext[0]).toBe("Local next");
  });

  it("heuristic summarizer extracts commands and file writes from rollout evidence", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-heuristic",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Fix the login bug"],
      agentMessages: [],
      toolCalls: [
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output: "Process exited with code 0"
        },
        {
          name: "apply_patch_freeform",
          arguments: JSON.stringify({ path: "src/auth.ts" }),
          output: undefined
        },
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm build" }),
          output: "Error: test failed"
        }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer({
      autoMemoryEnabled: true,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    });

    const summary = await summarizer.summarize(evidence);
    expect(summary.goal).toContain("Fix the login bug");
    expect(summary.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(summary.confirmedWorking.join("\n")).toContain("auth.ts");
    expect(summary.triedAndFailed.join("\n")).toContain("pnpm build");
    expect(summary.filesDecisionsEnvironment.join("\n")).toContain("auth.ts");
  });

  it("heuristic summarizer recognizes expanded success patterns", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-success-patterns",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Run checks"],
      agentMessages: [],
      toolCalls: [
        { name: "exec_command", arguments: JSON.stringify({ cmd: "jest" }), output: "Tests passed" },
        { name: "exec_command", arguments: JSON.stringify({ cmd: "tsc" }), output: "0 errors" },
        { name: "exec_command", arguments: JSON.stringify({ cmd: "vitest" }), output: "PASS" }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer({
      autoMemoryEnabled: true,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    });

    const summary = await summarizer.summarize(evidence);
    expect(summary.confirmedWorking.length).toBe(3);
    expect(summary.triedAndFailed).toHaveLength(0);
  });

  it("heuristic summarizer preserves existing notYetTried", async () => {
    const existing = {
      ...createEmptySessionContinuityState("project", "p1", "w1"),
      notYetTried: ["Try Redis cache"]
    };
    const evidence: RolloutEvidence = {
      sessionId: "session-preserve",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Continue"],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer({
      autoMemoryEnabled: true,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      sessionContinuityAutoLoad: false,
      sessionContinuityAutoSave: false,
      sessionContinuityLocalPathStyle: "codex",
      maxSessionContinuityLines: 60,
      codexBinary: "codex"
    });

    const summary = await summarizer.summarize(evidence, existing);
    expect(summary.notYetTried).toContain("Try Redis cache");
  });

  it("applySessionContinuitySummary merges summary into base state", () => {
    const base = {
      ...createEmptySessionContinuityState("project", "p1", "w1"),
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedWorking: ["Old success"],
      triedAndFailed: ["Old failure"]
    };

    const summary = {
      goal: "New goal",
      confirmedWorking: ["New success"],
      triedAndFailed: [],
      notYetTried: [],
      incompleteNext: [],
      filesDecisionsEnvironment: ["New file note"]
    };

    const merged = applySessionContinuitySummary(base, summary);
    expect(merged.confirmedWorking).toContain("New success");
    expect(merged.confirmedWorking).toContain("Old success");
    expect(merged.filesDecisionsEnvironment).toContain("New file note");
    expect(merged.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(merged.status).toBe("active");
  });

  it("sanitizeSessionContinuitySummary strips sensitive items", () => {
    const summary = {
      goal: "Fix auth",
      confirmedWorking: ["Clean item", "Bearer sk-12345678901234567890"],
      triedAndFailed: [],
      notYetTried: [],
      incompleteNext: [],
      filesDecisionsEnvironment: []
    };

    const sanitized = sanitizeSessionContinuitySummary(summary);
    expect(sanitized.confirmedWorking).toContain("Clean item");
    expect(sanitized.confirmedWorking.join("\n")).not.toContain("sk-12345678901234567890");
  });

  it("compiled startup block includes filesDecisionsEnvironment section", () => {
    const state = {
      ...createEmptySessionContinuityState("project-local", "project-1", "worktree-1"),
      filesDecisionsEnvironment: ["Redis must be running"]
    };

    const compiled = compileSessionContinuity(state, [], 60);
    expect(compiled.text).toContain("Files / Decisions / Environment");
    expect(compiled.text).toContain("Redis must be running");
  });

  it("compiles a bounded startup continuity block", () => {
    const state = {
      ...createEmptySessionContinuityState("project-local", "project-1", "worktree-1"),
      goal: "Continue the rollout-backed continuity work.",
      confirmedWorking: Array.from({ length: 8 }, (_, index) => `Working item ${index}`),
      triedAndFailed: Array.from({ length: 8 }, (_, index) => `Failed item ${index}`),
      notYetTried: ["Not tried yet"],
      incompleteNext: ["Do the next thing"]
    };

    const compiled = compileSessionContinuity(
      state,
      ["/tmp/project/shared.md", "/tmp/project/local.md"],
      12
    );

    expect(compiled.lineCount).toBeLessThanOrEqual(12);
    expect(compiled.text).toContain("# Session Continuity");
    expect(compiled.text).toContain("Source");
  });
});

describe("SessionContinuityStore", () => {
  it("writes shared and codex-local continuity files and updates git exclude", async () => {
    const repoDir = await tempDir("cam-continuity-repo-");
    const memoryRoot = await tempDir("cam-continuity-memory-");
    await initRepo(repoDir);

    const store = new SessionContinuityStore(
      detectProjectContext(repoDir),
      baseConfig(memoryRoot)
    );

    const written = await store.saveSummary(
      {
        goal: "Finish auth continuity.",
        confirmedWorking: ["Register works"],
        triedAndFailed: ["LocalStorage JWT caused hydration mismatch."],
        notYetTried: ["Use cookies().set in the login route."],
        incompleteNext: ["Add middleware."],
        filesDecisionsEnvironment: ["Use pnpm."]
      },
      "both"
    );

    expect(written).toContain(store.paths.sharedFile);
    expect(written).toContain(store.paths.localFile);
    expect((await store.getLocation("project")).exists).toBe(true);
    expect((await store.getLocation("project-local")).exists).toBe(true);

    const excludePath = path.join(detectProjectContext(repoDir).gitDir!, "info", "exclude");
    expect(await fs.readFile(excludePath, "utf8")).toContain(".codex-auto-memory/");
  });

  it("supports claude-style local files and clears all active local session tmp files", async () => {
    const repoDir = await tempDir("cam-continuity-claude-repo-");
    const memoryRoot = await tempDir("cam-continuity-claude-memory-");
    await initRepo(repoDir);

    const store = new SessionContinuityStore(
      detectProjectContext(repoDir),
      baseConfig(memoryRoot, { sessionContinuityLocalPathStyle: "claude" })
    );
    await store.saveSummary(
      {
        goal: "Continue Claude-compatible session state.",
        confirmedWorking: [],
        triedAndFailed: [],
        notYetTried: [],
        incompleteNext: ["Resume from the latest session file."],
        filesDecisionsEnvironment: []
      },
      "project-local"
    );
    await store.ensureLocalLayout();
    const olderFile = path.join(store.paths.localDir, "2026-03-01-old-session.tmp");
    await fs.writeFile(olderFile, "stale\n", "utf8");

    const location = await store.getLocation("project-local");
    expect(location.path.endsWith("-session.tmp")).toBe(true);

    const cleared = await store.clear("project-local");
    expect(cleared).toContain(olderFile);
    expect((await fs.readdir(store.paths.localDir)).filter((name) => name.endsWith("-session.tmp"))).toHaveLength(0);
  });
});
