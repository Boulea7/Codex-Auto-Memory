import fs from "node:fs/promises";
import realFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import {
  findRelevantRollouts,
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

  it("prefers newly added rollouts and otherwise falls back to the session time window", async () => {
    const sessionsDir = await tempDir("cam-sessions-");
    const dayDir = path.join(sessionsDir, "2026", "03", "14");
    const projectDir = await tempDir("cam-rollout-match-project-");
    await fs.mkdir(dayDir, { recursive: true });
    process.env.CAM_CODEX_SESSIONS_DIR = sessionsDir;

    const beforeFile = path.join(dayDir, "rollout-before.jsonl");
    const addedFile = path.join(dayDir, "rollout-added.jsonl");
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

    const project = detectProjectContext(projectDir);
    const relevantFromAdditions = await findRelevantRollouts(
      project,
      before,
      Date.parse("2026-03-14T00:00:00.000Z"),
      Date.parse("2026-03-14T00:00:05.000Z")
    );
    expect(relevantFromAdditions).toEqual([addedFile]);

    const relevantFromWindow = await findRelevantRollouts(
      project,
      [beforeFile, staleFile, addedFile],
      Date.parse("2026-03-14T00:09:58.000Z"),
      Date.parse("2026-03-14T00:10:02.000Z")
    );
    expect(relevantFromWindow).toEqual([staleFile]);

    const meta = await readRolloutMeta(addedFile);
    expect(meta?.sessionId).toBe("added");
    expect(meta?.cwd).toBe(realFs.realpathSync.native(projectDir));
  });
});
