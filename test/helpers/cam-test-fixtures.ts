import fs from "node:fs/promises";
import path from "node:path";
import { runCommandCapture } from "../../src/lib/util/process.js";
import type { AppConfig } from "../../src/lib/types.js";

export function makeAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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

export async function initGitRepo(repoDir: string): Promise<void> {
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

export async function writeCamConfig(
  repoDir: string,
  projectConfig: AppConfig | Record<string, unknown>,
  localConfig: Record<string, unknown>
): Promise<void> {
  await fs.writeFile(
    path.join(repoDir, "codex-auto-memory.json"),
    JSON.stringify(projectConfig, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoDir, ".codex-auto-memory.local.json"),
    JSON.stringify(localConfig, null, 2),
    "utf8"
  );
}

interface RolloutFixtureOptions {
  sessionId?: string;
  timestamp?: string;
  callOutput?: string;
}

export function makeRolloutFixture(
  projectDir: string,
  message: string,
  options: RolloutFixtureOptions = {}
): string {
  return [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: options.sessionId ?? "session-1",
        timestamp: options.timestamp ?? "2026-03-15T00:00:00.000Z",
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
        output: options.callOutput ?? "Process exited with code 0"
      }
    })
  ].join("\n");
}
