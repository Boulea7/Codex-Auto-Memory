import fs from "node:fs/promises";
import realFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import {
  findLatestProjectRollout,
  findRelevantRollouts,
  matchesProjectContext,
  parseRolloutEvidence,
  readRolloutMeta
} from "../src/lib/domain/rollout.js";

const tempDirs: string[] = [];
const originalSessionsDir = process.env.CAM_CODEX_SESSIONS_DIR;

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.env.CAM_CODEX_SESSIONS_DIR = originalSessionsDir;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("rollout helpers", () => {
  it("skips corrupted JSONL lines without crashing", async () => {
    const projectDir = await tempDir("cam-rollout-corrupt-");
    const rolloutPath = path.join(projectDir, "rollout-corrupt.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "session-corrupt", timestamp: "2026-03-14T00:00:00.000Z", cwd: projectDir }
        }),
        "THIS IS NOT JSON {{{{",
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "remember that we use pnpm" }
        })
      ].join("\n"),
      "utf8"
    );

    const evidence = await parseRolloutEvidence(rolloutPath);
    expect(evidence).not.toBeNull();
    expect(evidence?.sessionId).toBe("session-corrupt");
    expect(evidence?.userMessages).toHaveLength(1);
  });

  it("parses nested session_meta payload format (payload.meta.id)", async () => {
    const projectDir = await tempDir("cam-rollout-nested-");
    const rolloutPath = path.join(projectDir, "rollout-nested.jsonl");
    await fs.writeFile(
      rolloutPath,
      JSON.stringify({
        type: "session_meta",
        payload: {
          meta: { id: "session-nested", timestamp: "2026-03-14T00:00:00.000Z", cwd: projectDir }
        }
      }),
      "utf8"
    );

    const meta = await readRolloutMeta(rolloutPath);
    expect(meta).not.toBeNull();
    expect(meta?.sessionId).toBe("session-nested");
    expect(meta?.cwd).toBeTruthy();
  });

  it("keeps tool outputs attached to the correct call_id", async () => {
    const projectDir = await tempDir("cam-rollout-project-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-1",
            timestamp: "2026-03-14T00:00:00.000Z",
            cwd: projectDir
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-1",
            arguments: "{\"cmd\":\"pnpm lint\"}"
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-2",
            arguments: "{\"cmd\":\"pnpm test\"}"
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-2",
            output: "test output"
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "lint output"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const evidence = await parseRolloutEvidence(rolloutPath);
    expect(evidence).not.toBeNull();
    expect(evidence?.toolCalls[0]?.callId).toBe("call-1");
    expect(evidence?.toolCalls[0]?.output).toBe("lint output");
    expect(evidence?.toolCalls[1]?.callId).toBe("call-2");
    expect(evidence?.toolCalls[1]?.output).toBe("test output");
  });

  it("keeps the first valid session_meta as rollout identity even when later meta lines exist", async () => {
    const projectDir = await tempDir("cam-rollout-subagent-project-");
    const rolloutPath = path.join(projectDir, "rollout-subagent.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-subagent",
            forked_from_id: "session-parent",
            timestamp: "2026-03-14T00:00:02.000Z",
            cwd: projectDir,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "session-parent"
                }
              }
            }
          }
        }),
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-parent",
            timestamp: "2026-03-14T00:00:01.000Z",
            cwd: projectDir,
            source: "cli"
          }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Reviewer prompt that should stay attached to the subagent rollout."
          }
        })
      ].join("\n"),
      "utf8"
    );

    const meta = await readRolloutMeta(rolloutPath);
    const evidence = await parseRolloutEvidence(rolloutPath);

    expect(meta?.sessionId).toBe("session-subagent");
    expect(meta?.isSubagent).toBe(true);
    expect(meta?.forkedFromSessionId).toBe("session-parent");
    expect(evidence?.sessionId).toBe("session-subagent");
    expect(evidence?.isSubagent).toBe(true);
    expect(evidence?.forkedFromSessionId).toBe("session-parent");
  });

  it("skips invalid session_meta entries and still detects nested subagent meta", async () => {
    const projectDir = await tempDir("cam-rollout-nested-subagent-project-");
    const rolloutPath = path.join(projectDir, "rollout-nested-subagent.jsonl");
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "broken-meta",
            timestamp: "2026-03-14T00:00:00.000Z"
          }
        }),
        JSON.stringify({
          type: "session_meta",
          payload: {
            meta: {
              id: "session-nested-subagent",
              forked_from_id: "session-parent",
              timestamp: "2026-03-14T00:00:02.000Z",
              cwd: projectDir,
              source: {
                subagent: {
                  thread_spawn: {
                    parent_thread_id: "session-parent"
                  }
                }
              }
            }
          }
        })
      ].join("\n"),
      "utf8"
    );

    const meta = await readRolloutMeta(rolloutPath);
    const evidence = await parseRolloutEvidence(rolloutPath);

    expect(meta?.sessionId).toBe("session-nested-subagent");
    expect(meta?.isSubagent).toBe(true);
    expect(meta?.forkedFromSessionId).toBe("session-parent");
    expect(evidence?.sessionId).toBe("session-nested-subagent");
    expect(evidence?.isSubagent).toBe(true);
    expect(evidence?.forkedFromSessionId).toBe("session-parent");
  });

  it("does not match sibling directory", () => {
    const ctx = { cwd: "/foo/bar", projectRoot: "/foo/bar", projectId: "p", worktreeId: "w" };
    expect(matchesProjectContext({ cwd: "/foo/bar-extra" }, ctx)).toBe(false);
  });

  it("matches subdirectory", () => {
    const ctx = { cwd: "/foo/bar", projectRoot: "/foo/bar", projectId: "p", worktreeId: "w" };
    expect(matchesProjectContext({ cwd: "/foo/bar/sub" }, ctx)).toBe(true);
  });

  it("matches exact directory", () => {
    const ctx = { cwd: "/foo/bar", projectRoot: "/foo/bar", projectId: "p", worktreeId: "w" };
    expect(matchesProjectContext({ cwd: "/foo/bar" }, ctx)).toBe(true);
  });

  it("normalizes trailing separators before matching", () => {
    const ctx = { cwd: "/foo/bar", projectRoot: "/foo/bar/", projectId: "p", worktreeId: "w" };
    expect(matchesProjectContext({ cwd: "/foo/bar/baz/" }, ctx)).toBe(true);
  });

  it("matches paths case-insensitively on case-insensitive platforms", () => {
    const ctx = {
      cwd: "/tmp/Example/Repo",
      projectRoot: "/tmp/Example/Repo",
      projectId: "p",
      worktreeId: "w"
    };
    const result = matchesProjectContext({ cwd: "/tmp/example/repo/src" }, ctx);
    if (process.platform === "darwin" || process.platform === "win32") {
      expect(result).toBe(true);
      return;
    }

    expect(result).toBe(false);
  });

  it("prefers newly added rollouts and otherwise falls back to the session time window", async () => {
    const sessionsDir = await tempDir("cam-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "14");
    const projectDir = await tempDir("cam-rollout-match-project-");
    await fs.mkdir(dayDir, { recursive: true });
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const beforeFile = path.join(dayDir, "rollout-before.jsonl");
    const addedFile = path.join(dayDir, "rollout-added.jsonl");
    const subagentFile = path.join(dayDir, "rollout-subagent.jsonl");
    const staleFile = path.join(dayDir, "rollout-stale.jsonl");

    await fs.writeFile(
      beforeFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "before",
          timestamp: "2026-03-14T00:00:01.000Z",
          cwd: projectDir
        }
      }),
      "utf8"
    );

    await fs.writeFile(
      staleFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "stale",
          timestamp: "2026-03-14T00:10:00.000Z",
          cwd: projectDir
        }
      }),
      "utf8"
    );

    const before = [beforeFile, staleFile];
    await fs.writeFile(
      addedFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "added",
          timestamp: "2026-03-14T00:00:03.000Z",
          cwd: projectDir
        }
      }),
      "utf8"
    );
    await fs.writeFile(
      subagentFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "subagent",
          forked_from_id: "parent",
          timestamp: "2026-03-14T00:00:04.000Z",
          cwd: projectDir,
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "parent"
              }
            }
          }
        }
      }),
      "utf8"
    );

    const project = detectProjectContext(projectDir);
    const relevantFromAdditions = await findRelevantRollouts(
      project,
      before,
      Date.parse("2026-03-14T00:00:00.000Z"),
      Date.parse("2026-03-14T00:00:05.000Z")
    );
    expect(relevantFromAdditions).toEqual([addedFile, subagentFile]);

    const relevantFromWindow = await findRelevantRollouts(
      project,
      [beforeFile, staleFile, addedFile, subagentFile],
      Date.parse("2026-03-14T00:09:58.000Z"),
      Date.parse("2026-03-14T00:10:02.000Z")
    );
    expect(relevantFromWindow).toEqual([staleFile]);

    const meta = await readRolloutMeta(addedFile);
    expect(meta?.sessionId).toBe("added");
    expect(meta?.cwd).toBe(realFs.realpathSync.native(projectDir));
  });

  it("skips subagent rollouts when auto-selecting the latest project rollout", async () => {
    const sessionsDir = await tempDir("cam-sessions-latest-");
    const dayDir = path.join(sessionsDir, "2026", "03", "14");
    const projectDir = await tempDir("cam-rollout-latest-project-");
    await fs.mkdir(dayDir, { recursive: true });
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const primaryFile = path.join(dayDir, "rollout-primary.jsonl");
    const subagentFile = path.join(dayDir, "rollout-subagent.jsonl");
    await fs.writeFile(
      primaryFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "primary",
          timestamp: "2026-03-14T00:00:01.000Z",
          cwd: projectDir,
          source: "cli"
        }
      }),
      "utf8"
    );
    await fs.writeFile(
      subagentFile,
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "subagent",
          forked_from_id: "primary",
          timestamp: "2026-03-14T00:00:02.000Z",
          cwd: projectDir,
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "primary"
              }
            }
          }
        }
      }),
      "utf8"
    );

    const latest = await findLatestProjectRollout(detectProjectContext(projectDir));
    expect(latest).toBe(primaryFile);
  });

  it("orders mtime-fallback relevant rollouts by recency, not pathname", async () => {
    const sessionsDir = await tempDir("cam-sessions-mtime-fallback-");
    const dayDir = path.join(sessionsDir, "2026", "03", "14");
    const projectDir = await tempDir("cam-rollout-mtime-fallback-project-");
    await fs.mkdir(dayDir, { recursive: true });
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const olderPath = path.join(dayDir, "rollout-zeta.jsonl");
    const newerPath = path.join(dayDir, "rollout-alpha.jsonl");
    const staleTimestamp = "2026-03-14T00:00:00.000Z";
    await fs.writeFile(
      olderPath,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "older", timestamp: staleTimestamp, cwd: projectDir, source: "cli" }
      }),
      "utf8"
    );
    await fs.writeFile(
      newerPath,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "newer", timestamp: staleTimestamp, cwd: projectDir, source: "cli" }
      }),
      "utf8"
    );

    await fs.utimes(olderPath, new Date("2026-03-14T00:59:58.000Z"), new Date("2026-03-14T00:59:58.000Z"));
    await fs.utimes(newerPath, new Date("2026-03-14T01:00:01.000Z"), new Date("2026-03-14T01:00:01.000Z"));

    const relevant = await findRelevantRollouts(
      detectProjectContext(projectDir),
      [olderPath, newerPath],
      Date.parse("2026-03-14T00:59:57.000Z"),
      Date.parse("2026-03-14T01:00:02.000Z")
    );

    expect(relevant).toEqual([olderPath, newerPath]);
  });

  it("uses mtime as a stable tie-breaker when primary rollout timestamps match", async () => {
    const sessionsDir = await tempDir("cam-sessions-latest-tie-");
    const dayDir = path.join(sessionsDir, "2026", "03", "14");
    const projectDir = await tempDir("cam-rollout-latest-tie-project-");
    await fs.mkdir(dayDir, { recursive: true });
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const olderPath = path.join(dayDir, "rollout-z-primary.jsonl");
    const newerPath = path.join(dayDir, "rollout-a-primary.jsonl");
    const tiedTimestamp = "2026-03-14T00:00:01.000Z";
    await fs.writeFile(
      olderPath,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "primary-older", timestamp: tiedTimestamp, cwd: projectDir, source: "cli" }
      }),
      "utf8"
    );
    await fs.writeFile(
      newerPath,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "primary-newer", timestamp: tiedTimestamp, cwd: projectDir, source: "cli" }
      }),
      "utf8"
    );
    await fs.utimes(olderPath, new Date("2026-03-14T00:00:02.000Z"), new Date("2026-03-14T00:00:02.000Z"));
    await fs.utimes(newerPath, new Date("2026-03-14T00:00:03.000Z"), new Date("2026-03-14T00:00:03.000Z"));

    const latest = await findLatestProjectRollout(detectProjectContext(projectDir));
    expect(latest).toBe(newerPath);
  });
});
