import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySessionContinuityLayerSummary,
  compileSessionContinuity,
  createEmptySessionContinuityState,
  mergeSessionContinuityStates,
  parseSessionContinuity,
  renderSessionContinuity,
  sanitizeSessionContinuitySummary
} from "../src/lib/domain/session-continuity.js";
import { parseRolloutEvidence } from "../src/lib/domain/rollout.js";
import { SessionContinuityStore } from "../src/lib/domain/session-continuity-store.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import { collectSessionContinuityEvidenceBuckets } from "../src/lib/extractor/session-continuity-evidence.js";
import { buildSessionContinuityPrompt } from "../src/lib/extractor/session-continuity-prompt.js";
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

async function writeMockCodexBinary(tempRoot: string, body: string): Promise<string> {
  const mockBinary = path.join(tempRoot, "mock-codex");
  await fs.writeFile(
    mockBinary,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputPath = args[outputIndex + 1];
${body}
`,
    "utf8"
  );
  await fs.chmod(mockBinary, 0o755);
  return mockBinary;
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
          arguments:
            "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -10,3 +10,4 @@\n function login(user) {\n-  return false;\n+  return authenticate(user);\n }",
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
    expect(summary.project.goal).toContain("Fix the login bug");
    expect(summary.project.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(summary.project.confirmedWorking.join("\n")).not.toContain("auth.ts");
    expect(summary.project.triedAndFailed.join("\n")).toContain("pnpm build");
    expect(summary.projectLocal.filesDecisionsEnvironment.join("\n")).toContain("auth.ts");
  });

  it("heuristic summarizer extracts file path from apply_patch_freeform raw patch text", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-patch-text",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Fix imports"],
      agentMessages: [],
      toolCalls: [
        {
          name: "apply_patch_freeform",
          arguments:
            "diff --git a/src/utils.ts b/src/utils.ts\nindex abc..def 100644\n--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,3 +1,4 @@\n+import { x } from './x.js';\n export {};",
          output: undefined
        },
        {
          name: "apply_patch_freeform",
          arguments: "--- a/src/db.ts\n+++ b/src/db.ts\n@@ -5,3 +5,4 @@\n+const pool = createPool();",
          output: undefined
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
    const fde = summary.projectLocal.filesDecisionsEnvironment.join("\n");
    expect(fde).toContain("utils.ts");
    expect(fde).toContain("db.ts");
    expect(summary.project.confirmedWorking).toHaveLength(0);
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
    expect(summary.project.confirmedWorking.length).toBe(3);
    expect(summary.project.triedAndFailed).toHaveLength(0);
  });

  it("heuristic summarizer ignores in-progress command output instead of classifying it as failed", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-in-progress-command",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Keep checking the command output"],
      agentMessages: [],
      toolCalls: [
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output: "Process running with session ID 12345"
        }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence);

    expect(summary.project.confirmedWorking).toEqual([]);
    expect(summary.project.triedAndFailed).toEqual([]);
  });

  it("heuristic summarizer preserves existing shared notYetTried", async () => {
    const existing = {
      project: {
        ...createEmptySessionContinuityState("project", "p1", "w1"),
        notYetTried: ["Try Redis cache"]
      },
      projectLocal: createEmptySessionContinuityState("project-local", "p1", "w1")
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
    expect(summary.project.notYetTried).toContain("Try Redis cache");
  });

  it("heuristic summarizer drops historical in-progress pseudo-failures from existing state", async () => {
    const existing = {
      project: {
        ...createEmptySessionContinuityState("project", "p1", "w1"),
        triedAndFailed: [
          "Command failed: `pnpm test` — Process running with session ID 12345"
        ]
      },
      projectLocal: createEmptySessionContinuityState("project-local", "p1", "w1")
    };
    const evidence: RolloutEvidence = {
      sessionId: "session-clean-old-failure",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Continue"],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence, existing);

    expect(summary.project.triedAndFailed).toEqual([]);
  });

  it("heuristic summarizer splits shared and local continuity heuristically", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-layered",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: [
        "We haven't tried switching the login route to cookies() yet.",
        "Next step: update src/auth/login.ts to set an httpOnly cookie.",
        "Redis must be running before integration tests."
      ],
      agentMessages: ["Remaining work: add middleware for the protected route redirect."],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence);

    expect(summary.project.notYetTried.join("\n")).toContain("switching the login route to cookies()");
    expect(summary.project.filesDecisionsEnvironment.join("\n")).toContain("Redis must be running");
    expect(summary.projectLocal.incompleteNext.join("\n")).toContain("add middleware");
    expect(summary.projectLocal.incompleteNext.join("\n")).toContain("update src/auth/login.ts");
  });

  it("heuristic summarizer extracts layered continuity from a real rollout fixture", async () => {
    const evidence = await parseRolloutEvidence(
      path.join(process.cwd(), "test/fixtures/rollouts/session-continuity-layered.jsonl")
    );
    expect(evidence).not.toBeNull();

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence!);

    expect(summary.project.notYetTried.join("\n")).toContain("switching the login route to cookies()");
    expect(summary.project.filesDecisionsEnvironment.join("\n")).toContain("Redis must be running");
    expect(summary.projectLocal.filesDecisionsEnvironment.join("\n")).toContain("login.ts");
    expect(summary.projectLocal.incompleteNext.join("\n")).toContain("add middleware");
  });

  it("heuristic summarizer keeps version-slash notes in shared layer, not local", async () => {
    // "Redis 7.0/7.1" contains a slash but is NOT a file path.
    // looksLocalSpecific() must not misclassify it, so the note should land
    // in shared project.filesDecisionsEnvironment, not in projectLocal.
    const evidence: RolloutEvidence = {
      sessionId: "session-slash-version",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: [
        "Redis 7.0/7.1 must be running before integration tests.",
        "OAuth2/token compatibility must remain intact for the auth proxy.",
        "v1/v2 migration must stay compatible with the API gateway."
      ],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence);

    const projectNotes = summary.project.filesDecisionsEnvironment.join("\n");
    const localNotes = summary.projectLocal.filesDecisionsEnvironment.join("\n");
    expect(projectNotes).toContain("Redis");
    expect(projectNotes).toContain("OAuth2/token");
    expect(projectNotes).toContain("v1/v2");
    expect(localNotes).not.toContain("Redis 7.0/7.1");
    expect(localNotes).not.toContain("OAuth2/token");
    expect(localNotes).not.toContain("v1/v2");
  });

  it("heuristic summarizer keeps anchored need-to sentences as next steps", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-need-to",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: [
        "Need to update src/auth/login.ts to set an httpOnly cookie.",
        "We need to add middleware after that."
      ],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const summary = await summarizer.summarize(evidence);

    const localNext = summary.projectLocal.incompleteNext.join("\n");
    expect(localNext).toContain("update src/auth/login.ts");
    expect(localNext).toContain("add middleware");
  });

  it("prompt includes evidence buckets for commands, file writes, and next steps", () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-prompt-buckets",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: [
        "We haven't tried switching the login route to cookies() yet.",
        "Next step: update src/auth/login.ts to set an httpOnly cookie."
      ],
      agentMessages: ["Remaining work: add middleware for the protected route redirect."],
      toolCalls: [
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output: "Process exited with code 0"
        },
        {
          name: "apply_patch_freeform",
          arguments:
            "diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex abc..def 100644\n--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1,3 +1,4 @@\n+setCookie(token);\n export {};",
          output: undefined
        }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const prompt = buildSessionContinuityPrompt(
      evidence,
      undefined,
      collectSessionContinuityEvidenceBuckets(evidence)
    );

    expect(prompt).toContain("Evidence buckets:");
    expect(prompt).toContain("Recent successful commands:");
    expect(prompt).toContain("Detected file writes:");
    expect(prompt).toContain("Candidate explicit next-step phrases:");
    expect(prompt).toContain("Candidate explicit untried phrases:");
    expect(prompt).toContain("pnpm test");
    expect(prompt).toContain("login.ts");
  });

  it("collects successful and failed bash tool calls in continuity evidence buckets", () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-bash-buckets",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Run shell checks"],
      agentMessages: [],
      toolCalls: [
        {
          name: "Bash",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output: "PASS"
        },
        {
          name: "bash_runner",
          arguments: JSON.stringify({ cmd: "pnpm build" }),
          output: "Process exited with code 1"
        }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const buckets = collectSessionContinuityEvidenceBuckets(evidence);

    expect(buckets.recentSuccessfulCommands.join("\n")).toContain("pnpm test");
    expect(buckets.recentFailedCommands.join("\n")).toContain("pnpm build");
  });

  it("codex mode returns valid layered output from a mocked codex binary", async () => {
    const temp = await tempDir("cam-session-codex-valid-");
    const mockBinary = await writeMockCodexBinary(
      temp,
      `fs.writeFileSync(outputPath, JSON.stringify({
  project: {
    goal: "Keep the auth rollout moving.",
    confirmedWorking: ["Command succeeded: pnpm test"],
    triedAndFailed: ["Command failed: pnpm build - Missing env var"],
    notYetTried: ["Try switching the login route to cookies()."],
    incompleteNext: [],
    filesDecisionsEnvironment: ["Redis must be running before integration tests."]
  },
  projectLocal: {
    goal: "",
    confirmedWorking: [],
    triedAndFailed: [],
    notYetTried: [],
    incompleteNext: ["Update src/auth/login.ts to set an httpOnly cookie."],
    filesDecisionsEnvironment: ["File modified: login.ts"]
  }
}));`
    );
    const evidence: RolloutEvidence = {
      sessionId: "session-codex-valid",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: temp,
      userMessages: ["Continue the auth rollout."],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(
      baseConfig("/tmp/memory-root", {
        extractorMode: "codex",
        codexBinary: mockBinary
      })
    );
    const result = await summarizer.summarizeWithDiagnostics(evidence);
    const { summary, diagnostics } = result;

    expect(summary.sourceSessionId).toBe("session-codex-valid");
    expect(summary.project.confirmedWorking).toEqual(["Command succeeded: pnpm test"]);
    expect(summary.project.triedAndFailed).toEqual([
      "Command failed: pnpm build - Missing env var"
    ]);
    expect(summary.projectLocal.incompleteNext).toEqual([
      "Update src/auth/login.ts to set an httpOnly cookie."
    ]);
    expect(summary.projectLocal.filesDecisionsEnvironment).toEqual([
      "File modified: login.ts"
    ]);
    expect(diagnostics.preferredPath).toBe("codex");
    expect(diagnostics.actualPath).toBe("codex");
    expect(diagnostics.fallbackReason).toBeUndefined();
    expect(diagnostics.codexExitCode).toBe(0);
  });

  it("codex mode falls back to heuristic when the mocked codex output is invalid", async () => {
    const invalidCases = [
      {
        body: `fs.writeFileSync(outputPath, "{not valid json");`,
        reason: "invalid-json"
      },
      {
        body: `fs.writeFileSync(outputPath, JSON.stringify({ project: { goal: "" } }));`,
        reason: "invalid-structure"
      },
      {
        body: `fs.writeFileSync(outputPath, JSON.stringify({
  project: {
    goal: "",
    confirmedWorking: "bad",
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
}));`,
        reason: "invalid-structure"
      }
    ];

    for (const [index, invalidCase] of invalidCases.entries()) {
      const temp = await tempDir(`cam-session-codex-invalid-${index}-`);
      const mockBinary = await writeMockCodexBinary(temp, invalidCase.body);
      const evidence: RolloutEvidence = {
        sessionId: `session-codex-invalid-${index}`,
        createdAt: "2026-03-15T00:00:00.000Z",
        cwd: temp,
        userMessages: [
          "We haven't tried switching the login route to cookies() yet.",
          "Next step: update src/auth/login.ts to set an httpOnly cookie."
        ],
        agentMessages: [],
        toolCalls: [
          {
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "pnpm test" }),
            output: "Process exited with code 0"
          },
          {
            name: "apply_patch_freeform",
            arguments:
              "diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex abc..def 100644\n--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1,3 +1,4 @@\n+setCookie(token);\n export {};",
            output: undefined
          }
        ],
        rolloutPath: "/tmp/rollout.jsonl"
      };

      const summarizer = new SessionContinuitySummarizer(
        baseConfig("/tmp/memory-root", {
          extractorMode: "codex",
          codexBinary: mockBinary
        })
      );
      const result = await summarizer.summarizeWithDiagnostics(evidence);
      const { summary, diagnostics } = result;

      expect(summary.project.confirmedWorking.join("\n")).toContain("pnpm test");
      expect(summary.project.notYetTried.join("\n")).toContain("switching the login route to cookies()");
      expect(summary.projectLocal.incompleteNext.join("\n")).toContain(
        "update src/auth/login.ts"
      );
      expect(summary.projectLocal.filesDecisionsEnvironment.join("\n")).toContain("login.ts");
      expect(diagnostics.preferredPath).toBe("codex");
      expect(diagnostics.actualPath).toBe("heuristic");
      expect(diagnostics.codexExitCode).toBe(0);
      expect(diagnostics.fallbackReason).toBe(invalidCase.reason);
    }
  });

  it("codex mode falls back to heuristic when the mocked codex output is low-signal", async () => {
    const temp = await tempDir("cam-session-codex-low-signal-");
    const mockBinary = await writeMockCodexBinary(
      temp,
      `fs.writeFileSync(outputPath, JSON.stringify({
  project: {
    goal: "",
    confirmedWorking: [],
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
}));`
    );
    const evidence: RolloutEvidence = {
      sessionId: "session-codex-low-signal",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: temp,
      userMessages: [
        "We haven't tried switching the login route to cookies() yet.",
        "Next step: update src/auth/login.ts to set an httpOnly cookie."
      ],
      agentMessages: ["Remaining work: add middleware for the protected route redirect."],
      toolCalls: [
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output: "Process exited with code 0"
        },
        {
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm build" }),
          output: "Error: missing env var"
        },
        {
          name: "apply_patch_freeform",
          arguments:
            "diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex abc..def 100644\n--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1,3 +1,4 @@\n+setCookie(token);\n export {};",
          output: undefined
        }
      ],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(
      baseConfig("/tmp/memory-root", {
        extractorMode: "codex",
        codexBinary: mockBinary
      })
    );
    const result = await summarizer.summarizeWithDiagnostics(evidence);
    const { summary, diagnostics } = result;

    expect(summary.project.confirmedWorking.join("\n")).toContain("pnpm test");
    expect(summary.project.triedAndFailed.join("\n")).toContain("pnpm build");
    expect(summary.projectLocal.incompleteNext.join("\n")).toContain("add middleware");
    expect(summary.projectLocal.filesDecisionsEnvironment.join("\n")).toContain("login.ts");
    expect(diagnostics.preferredPath).toBe("codex");
    expect(diagnostics.actualPath).toBe("heuristic");
    expect(diagnostics.fallbackReason).toBe("low-signal");
  });

  it("codex mode records command failure diagnostics when the codex command exits non-zero", async () => {
    const temp = await tempDir("cam-session-codex-command-failed-");
    const mockBinary = await writeMockCodexBinary(
      temp,
      `process.exit(17);`
    );
    const evidence: RolloutEvidence = {
      sessionId: "session-codex-command-failed",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: temp,
      userMessages: ["Continue the auth rollout."],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(
      baseConfig("/tmp/memory-root", {
        extractorMode: "codex",
        codexBinary: mockBinary
      })
    );
    const result = await summarizer.summarizeWithDiagnostics(evidence);

    expect(result.summary.sourceSessionId).toBe("session-codex-command-failed");
    expect(result.diagnostics.preferredPath).toBe("codex");
    expect(result.diagnostics.actualPath).toBe("heuristic");
    expect(result.diagnostics.fallbackReason).toBe("codex-command-failed");
    expect(result.diagnostics.codexExitCode).toBe(17);
  });

  it("heuristic mode reports configured-heuristic diagnostics", async () => {
    const evidence: RolloutEvidence = {
      sessionId: "session-configured-heuristic",
      createdAt: "2026-03-15T00:00:00.000Z",
      cwd: "/tmp/project",
      userMessages: ["Need to update src/auth/login.ts to set an httpOnly cookie."],
      agentMessages: [],
      toolCalls: [],
      rolloutPath: "/tmp/rollout.jsonl"
    };

    const summarizer = new SessionContinuitySummarizer(baseConfig("/tmp/memory-root"));
    const result = await summarizer.summarizeWithDiagnostics(evidence);

    expect(result.diagnostics.preferredPath).toBe("heuristic");
    expect(result.diagnostics.actualPath).toBe("heuristic");
    expect(result.diagnostics.fallbackReason).toBe("configured-heuristic");
    expect(result.diagnostics.evidenceCounts.nextSteps).toBeGreaterThan(0);
  });

  it("applySessionContinuityLayerSummary merges summary into base state", () => {
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

    const merged = applySessionContinuityLayerSummary(base, summary, "session-2");
    expect(merged.confirmedWorking).toContain("New success");
    expect(merged.confirmedWorking).toContain("Old success");
    expect(merged.filesDecisionsEnvironment).toContain("New file note");
    expect(merged.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(merged.status).toBe("active");
    expect(merged.sourceSessionId).toBe("session-2");
  });

  it("sanitizeSessionContinuitySummary strips sensitive items", () => {
    const syntheticBearer = `Bearer ${["sk", "12345678901234567890"].join("-")}`;
    const summary = {
      project: {
        goal: "Fix auth",
        confirmedWorking: ["Clean item", syntheticBearer],
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
    };

    const sanitized = sanitizeSessionContinuitySummary(summary);
    expect(sanitized.project.confirmedWorking).toContain("Clean item");
    expect(sanitized.project.confirmedWorking.join("\n")).not.toContain("12345678901234567890");
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
        project: {
          goal: "Finish auth continuity.",
          confirmedWorking: ["Register works"],
          triedAndFailed: ["LocalStorage JWT caused hydration mismatch."],
          notYetTried: ["Try middleware after cookies land."],
          incompleteNext: [],
          filesDecisionsEnvironment: ["Use pnpm."]
        },
        projectLocal: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: ["Use cookies().set in the login route."],
          incompleteNext: ["Add middleware."],
          filesDecisionsEnvironment: ["File modified: auth.ts"]
        }
      },
      "both"
    );

    expect(written).toContain(store.paths.sharedFile);
    expect(written).toContain(store.paths.localFile);
    expect((await store.getLocation("project")).exists).toBe(true);
    expect((await store.getLocation("project-local")).exists).toBe(true);

    const excludePath = path.join(detectProjectContext(repoDir).gitDir!, "info", "exclude");
    expect(await fs.readFile(excludePath, "utf8")).toContain(".codex-auto-memory/");
    expect((await store.readState("project"))?.filesDecisionsEnvironment).toContain("Use pnpm.");
    expect((await store.readState("project-local"))?.incompleteNext).toContain("Add middleware.");
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
        project: {
          goal: "",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: [],
          filesDecisionsEnvironment: []
        },
        projectLocal: {
          goal: "Continue Claude-compatible session state.",
          confirmedWorking: [],
          triedAndFailed: [],
          notYetTried: [],
          incompleteNext: ["Resume from the latest session file."],
          filesDecisionsEnvironment: []
        }
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
