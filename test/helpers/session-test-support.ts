import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempDir(
  tempDirs: string[],
  prefix: string
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupTempDirs(tempDirs: string[]): Promise<void> {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
}

export async function writeSessionRolloutFile(
  rolloutPath: string,
  contents: string
): Promise<string> {
  await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
  await fs.writeFile(rolloutPath, contents, "utf8");
  return rolloutPath;
}

export function makeEvidenceCounts(successfulCommands = 1): {
  successfulCommands: number;
  failedCommands: number;
  fileWrites: number;
  nextSteps: number;
  untried: number;
} {
  return {
    successfulCommands,
    failedCommands: 0,
    fileWrites: 0,
    nextSteps: 1,
    untried: 0
  };
}

export async function writeWrapperMockCodex(
  repoDir: string,
  sessionsDir: string,
  options: {
    sessionId: string;
    message: string;
    callOutput?: string;
  }
): Promise<{ capturedArgsPath: string; mockCodexPath: string }> {
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
  JSON.stringify({ type: "session_meta", payload: { id: ${JSON.stringify(options.sessionId)}, timestamp: "2026-03-15T00:00:00.000Z", cwd } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: ${JSON.stringify(options.message)} } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: "{\\"cmd\\":\\"pnpm test\\"}" } }),
  JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: ${JSON.stringify(options.callOutput ?? "Process exited with code 0")} } })
].join("\\n"));
`,
    "utf8"
  );
  await fs.chmod(mockCodexPath, 0o755);

  return {
    capturedArgsPath,
    mockCodexPath
  };
}

export async function writeMockCodexBinary(
  tempRoot: string,
  body: string
): Promise<string> {
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
