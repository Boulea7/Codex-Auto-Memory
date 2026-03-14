import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SyncService } from "../src/lib/domain/sync-service.js";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
import type { AppConfig } from "../src/lib/types.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function rolloutFixture(projectDir: string): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-14T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-1",
        timestamp: "2026-03-14T00:00:00.000Z",
        cwd: projectDir
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "remember that we always use pnpm in this repo"
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: "{\"cmd\":\"pnpm test\",\"workdir\":\"" + projectDir.replace(/\\/g, "\\\\") + "\"}"
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-14T00:00:03.000Z",
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SyncService", () => {
  it("extracts memory updates from rollout evidence and writes audit state", async () => {
    const projectDir = await tempDir("cam-sync-project-");
    const memoryRoot = await tempDir("cam-sync-memory-");
    const rolloutPath = path.join(projectDir, "rollout.jsonl");
    await fs.writeFile(rolloutPath, rolloutFixture(projectDir), "utf8");

    const config: AppConfig = {
      autoMemoryEnabled: true,
      autoMemoryDirectory: memoryRoot,
      extractorMode: "heuristic",
      defaultScope: "project",
      maxStartupLines: 200,
      codexBinary: "codex"
    };

    const service = new SyncService(detectProjectContext(projectDir), config, path.resolve("schemas/memory-operations.schema.json"));
    const result = await service.syncRollout(rolloutPath, true);
    const projectEntries = await service.memoryStore.listEntries("project");

    expect(result.skipped).toBe(false);
    expect(projectEntries.map((entry) => entry.summary).join("\n")).toContain("pnpm");
    expect(await service.memoryStore.hasProcessedRollout(rolloutPath)).toBe(true);
  });
});
