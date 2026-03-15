import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ProjectContext, RolloutEvidence, RolloutMeta, RolloutToolCall } from "../types.js";

interface JsonLine {
  type: string;
  payload?: Record<string, unknown>;
}

async function normalizeFsPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
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
  const sessionsDir = process.env.CAM_CODEX_SESSIONS_DIR
    ? path.resolve(process.env.CAM_CODEX_SESSIONS_DIR)
    : path.join(os.homedir(), ".codex", "sessions");
  return collectRolloutFiles(sessionsDir);
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeComparisonPath(input: string): string {
  const resolved = path.resolve(input);
  const trimmed =
    resolved.length > 1 ? resolved.replace(new RegExp(`${escapePathSep()}+$`, "u"), "") : resolved;
  return isCaseInsensitiveFs() ? trimmed.toLowerCase() : trimmed;
}

function escapePathSep(): string {
  return path.sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCaseInsensitiveFs(): boolean {
  return process.platform === "win32" || process.platform === "darwin";
}

// Reads a scalar field from session_meta payload, supporting both flat and nested (payload.meta) formats.
function sessionMetaValue(
  payload: Record<string, unknown>,
  key: "id" | "cwd" | "timestamp"
): string {
  const nested = payload.meta;
  const nestedRecord = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : undefined;
  return String(payload[key] ?? nestedRecord?.[key] ?? "");
}

export async function readRolloutMeta(filePath: string): Promise<RolloutMeta | null> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let item: JsonLine;
    try {
      item = JSON.parse(line) as JsonLine;
    } catch {
      continue;
    }
    const payload = item.payload ?? {};
    if (item.type !== "session_meta") {
      continue;
    }

    const sessionId = sessionMetaValue(payload, "id");
    const createdAt = sessionMetaValue(payload, "timestamp");
    const cwdValue = sessionMetaValue(payload, "cwd");
    const cwd = cwdValue ? await normalizeFsPath(cwdValue) : "";
    if (!sessionId || !createdAt || !cwd) {
      return null;
    }

    return {
      sessionId,
      createdAt,
      createdAtMs: parseTimestamp(createdAt),
      cwd,
      rolloutPath: filePath
    };
  }

  return null;
}

export async function findRelevantRollouts(
  project: ProjectContext,
  before: string[],
  startedAtMs: number,
  endedAtMs: number
): Promise<string[]> {
  const after = await listRolloutFiles();
  const beforeSet = new Set(before);
  const additions = after.filter((filePath) => !beforeSet.has(filePath));

  const candidates = additions.length > 0 ? additions : after;
  const metas = (
    await Promise.all(
      candidates.map(async (filePath) => ({
        filePath,
        meta: await readRolloutMeta(filePath)
      }))
    )
  )
    .filter(
      (item): item is { filePath: string; meta: RolloutMeta } =>
        item.meta !== null && matchesProjectContext(item.meta, project)
    )
    .map((item) => item.meta);

  if (additions.length > 0) {
    return metas
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((meta) => meta.rolloutPath);
  }

  const windowStart = startedAtMs - 5_000;
  const windowEnd = endedAtMs + 5_000;
  const inWindow = metas
    .filter((meta) => meta.createdAtMs >= windowStart && meta.createdAtMs <= windowEnd)
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .map((meta) => meta.rolloutPath);

  if (inWindow.length > 0) {
    return inWindow;
  }

  const recentMtimeMatches: string[] = [];
  for (const meta of metas) {
    const stats = await fs.stat(meta.rolloutPath);
    if (stats.mtimeMs >= windowStart && stats.mtimeMs <= windowEnd) {
      recentMtimeMatches.push(meta.rolloutPath);
    }
  }

  return recentMtimeMatches.sort();
}

export async function findLatestProjectRollout(
  project: ProjectContext
): Promise<string | null> {
  const files = await listRolloutFiles();
  const metas = (
    await Promise.all(
      files.map(async (filePath) => ({
        filePath,
        meta: await readRolloutMeta(filePath)
      }))
    )
  )
    .filter(
      (item): item is { filePath: string; meta: RolloutMeta } =>
        item.meta !== null && matchesProjectContext(item.meta, project)
    )
    .map((item) => item.meta)
    .sort((left, right) => right.createdAtMs - left.createdAtMs);

  return metas[0]?.rolloutPath ?? null;
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
    let item: JsonLine;
    try {
      item = JSON.parse(line) as JsonLine;
    } catch {
      continue;
    }
    const payload = item.payload ?? {};
    if (item.type === "session_meta") {
      sessionId = sessionMetaValue(payload, "id");
      createdAt = sessionMetaValue(payload, "timestamp");
      const cwdValue = sessionMetaValue(payload, "cwd");
      cwd = cwdValue ? await normalizeFsPath(cwdValue) : "";
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
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const call = {
        callId,
        name: String(payload.name ?? ""),
        arguments: String(payload.arguments ?? "")
      };
      toolCalls.push(call);
      if (callId) {
        callOutputs.set(callId, "");
      }
      continue;
    }

    if (item.type === "response_item" && payload.type === "function_call_output") {
      const callId = String(payload.call_id ?? "");
      const output = String(payload.output ?? "");
      callOutputs.set(callId, output);
    }
  }

  const stitchedToolCalls = toolCalls.map((call) => ({
    ...call,
    output: call.callId ? callOutputs.get(call.callId) : undefined
  }));

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
  evidence: Pick<RolloutEvidence, "cwd"> | Pick<RolloutMeta, "cwd">,
  project: ProjectContext
): boolean {
  const normalizedEvidence = normalizeComparisonPath(evidence.cwd);
  const normalizedProjectRoot = normalizeComparisonPath(project.projectRoot);
  const childPrefix =
    normalizedProjectRoot === path.sep
      ? normalizedProjectRoot
      : `${normalizedProjectRoot}${isCaseInsensitiveFs() ? path.sep.toLowerCase() : path.sep}`;

  return (
    normalizedEvidence === normalizedProjectRoot ||
    normalizedEvidence.startsWith(childPrefix)
  );
}
