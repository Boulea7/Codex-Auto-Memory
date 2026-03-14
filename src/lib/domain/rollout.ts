import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ProjectContext, RolloutEvidence, RolloutToolCall } from "../types.js";

interface JsonLine {
  type: string;
  payload?: Record<string, unknown>;
}

async function collectRolloutFiles(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectRolloutFiles(fullPath)));
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

export async function listRolloutFiles(): Promise<string[]> {
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  return collectRolloutFiles(sessionsDir);
}

export async function findNewRollouts(before: string[], startedAtMs: number): Promise<string[]> {
  const after = await listRolloutFiles();
  const beforeSet = new Set(before);
  const additions = after.filter((filePath) => !beforeSet.has(filePath));
  if (additions.length > 0) {
    return additions.sort();
  }

  const recent: string[] = [];
  for (const filePath of after) {
    const stats = await fs.stat(filePath);
    if (stats.mtimeMs >= startedAtMs - 1_000) {
      recent.push(filePath);
    }
  }

  return recent.sort();
}

export async function parseRolloutEvidence(filePath: string): Promise<RolloutEvidence | null> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const callOutputs = new Map<string, string>();
  const toolCalls: RolloutToolCall[] = [];
  const userMessages: string[] = [];
  const agentMessages: string[] = [];
  let sessionId = "";
  let createdAt = "";
  let cwd = "";

  for (const line of lines) {
    const item = JSON.parse(line) as JsonLine;
    const payload = item.payload ?? {};
    if (item.type === "session_meta") {
      sessionId = String(payload.id ?? "");
      createdAt = String(payload.timestamp ?? "");
      cwd = String(payload.cwd ?? "");
      continue;
    }

    if (item.type === "event_msg" && payload.type === "user_message") {
      userMessages.push(String(payload.message ?? ""));
      continue;
    }

    if (item.type === "event_msg" && payload.type === "agent_message") {
      agentMessages.push(String(payload.message ?? ""));
      continue;
    }

    if (item.type === "response_item" && payload.type === "function_call") {
      const call = {
        name: String(payload.name ?? ""),
        arguments: String(payload.arguments ?? "")
      };
      toolCalls.push(call);
      if (typeof payload.call_id === "string") {
        callOutputs.set(payload.call_id, "");
      }
      continue;
    }

    if (item.type === "response_item" && payload.type === "function_call_output") {
      const callId = String(payload.call_id ?? "");
      const output = String(payload.output ?? "");
      callOutputs.set(callId, output);
    }
  }

  const stitchedToolCalls = toolCalls.map((call, index) => {
    const line = lines.find((candidate) => candidate.includes(`"name":"${call.name}"`));
    const match = line?.match(/"call_id":"([^"]+)"/);
    const callId = match?.[1];
    return {
      ...call,
      output: callId ? callOutputs.get(callId) : undefined
    };
  });

  if (!sessionId || !cwd) {
    return null;
  }

  return {
    sessionId,
    createdAt,
    cwd,
    userMessages,
    agentMessages,
    toolCalls: stitchedToolCalls,
    rolloutPath: filePath
  };
}

export function matchesProjectContext(
  evidence: RolloutEvidence,
  project: ProjectContext
): boolean {
  return evidence.cwd.startsWith(project.projectRoot);
}
