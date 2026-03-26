import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ProjectContext, RolloutEvidence, RolloutMeta, RolloutToolCall } from "../types.js";

interface JsonLine {
  type: string;
  payload?: Record<string, unknown>;
}

interface ParsedSessionMeta {
  sessionId: string;
  createdAt: string;
  cwd: string;
  isSubagent: boolean;
  forkedFromSessionId?: string;
}

interface RolloutMetaWithMtime {
  meta: RolloutMeta;
  mtimeMs: number;
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
  return (await collectRolloutFiles(sessionsDir)).sort((left, right) => left.localeCompare(right));
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
  const nestedRecord = sessionMetaRecord(payload);
  return String(payload[key] ?? nestedRecord?.[key] ?? "");
}

function sessionMetaRecord(
  payload: Record<string, unknown>
): Record<string, unknown> | undefined {
  const nested = payload.meta;
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : undefined;
}

function isSubagentSource(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "subagent" in (value as Record<string, unknown>));
}

function parseSessionMeta(payload: Record<string, unknown>): ParsedSessionMeta | null {
  const sessionId = sessionMetaValue(payload, "id");
  const createdAt = sessionMetaValue(payload, "timestamp");
  const cwd = sessionMetaValue(payload, "cwd");
  if (!sessionId || !createdAt || !cwd) {
    return null;
  }

  const nestedRecord = sessionMetaRecord(payload);
  const forkedFromValue =
    payload.forked_from_id ?? nestedRecord?.forked_from_id;
  const sourceValue = payload.source ?? nestedRecord?.source;
  const forkedFromSessionId =
    typeof forkedFromValue === "string" && forkedFromValue.length > 0
      ? forkedFromValue
      : undefined;

  return {
    sessionId,
    createdAt,
    cwd,
    isSubagent: Boolean(forkedFromSessionId) || isSubagentSource(sourceValue),
    forkedFromSessionId
  };
}

function isPrimaryRolloutMeta(meta: RolloutMeta): boolean {
  return meta.isSubagent !== true;
}

async function attachRolloutMtime(metas: RolloutMeta[]): Promise<RolloutMetaWithMtime[]> {
  return Promise.all(
    metas.map(async (meta) => ({
      meta,
      mtimeMs: (await fs.stat(meta.rolloutPath)).mtimeMs
    }))
  );
}

function compareByCreatedAtThenMtime(
  left: RolloutMetaWithMtime,
  right: RolloutMetaWithMtime
): number {
  if (left.meta.createdAtMs !== right.meta.createdAtMs) {
    return left.meta.createdAtMs - right.meta.createdAtMs;
  }

  if (left.mtimeMs !== right.mtimeMs) {
    return left.mtimeMs - right.mtimeMs;
  }

  return left.meta.rolloutPath.localeCompare(right.meta.rolloutPath);
}

function compareByMtimeThenPath(left: RolloutMetaWithMtime, right: RolloutMetaWithMtime): number {
  if (left.mtimeMs !== right.mtimeMs) {
    return left.mtimeMs - right.mtimeMs;
  }

  if (left.meta.createdAtMs !== right.meta.createdAtMs) {
    return left.meta.createdAtMs - right.meta.createdAtMs;
  }

  return left.meta.rolloutPath.localeCompare(right.meta.rolloutPath);
}

async function sortRolloutsByCreatedAtThenMtime(metas: RolloutMeta[]): Promise<RolloutMeta[]> {
  return (await attachRolloutMtime(metas))
    .sort(compareByCreatedAtThenMtime)
    .map((item) => item.meta);
}

async function sortRolloutsByMtimeThenPath(metas: RolloutMeta[]): Promise<RolloutMeta[]> {
  return (await attachRolloutMtime(metas))
    .sort(compareByMtimeThenPath)
    .map((item) => item.meta);
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

    const parsedMeta = parseSessionMeta(payload);
    if (!parsedMeta) {
      continue;
    }

    return {
      sessionId: parsedMeta.sessionId,
      createdAt: parsedMeta.createdAt,
      createdAtMs: parseTimestamp(parsedMeta.createdAt),
      cwd: await normalizeFsPath(parsedMeta.cwd),
      rolloutPath: filePath,
      isSubagent: parsedMeta.isSubagent,
      forkedFromSessionId: parsedMeta.forkedFromSessionId
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

  const readMetas = async (files: string[]): Promise<RolloutMeta[]> =>
    (
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
      .map((item) => item.meta);

  const additionMetas = await readMetas(additions);
  if (additionMetas.length > 0) {
    return (await sortRolloutsByCreatedAtThenMtime(additionMetas)).map((meta) => meta.rolloutPath);
  }

  const metas = await readMetas(after);

  const windowStart = startedAtMs - 5_000;
  const windowEnd = endedAtMs + 5_000;
  const inWindow = metas
    .filter((meta) => meta.createdAtMs >= windowStart && meta.createdAtMs <= windowEnd);

  if (inWindow.length > 0) {
    return (await sortRolloutsByCreatedAtThenMtime(inWindow)).map((meta) => meta.rolloutPath);
  }

  const recentMtimeMatches = (await attachRolloutMtime(metas))
    .filter((item) => item.mtimeMs >= windowStart && item.mtimeMs <= windowEnd)
    .sort(compareByMtimeThenPath)
    .map((item) => item.meta.rolloutPath);

  return recentMtimeMatches;
}

export async function selectLatestPrimaryRolloutFromCandidates(
  candidates: string[]
): Promise<string | null> {
  const metas = (
    await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        meta: await readRolloutMeta(candidate)
      }))
    )
  )
    .filter(
      (item): item is { candidate: string; meta: RolloutMeta } =>
        item.meta !== null && isPrimaryRolloutMeta(item.meta)
    )
    .map((item) => item.meta);

  const sorted = await sortRolloutsByCreatedAtThenMtime(metas);
  return sorted.at(-1)?.rolloutPath ?? null;
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
        item.meta !== null &&
        matchesProjectContext(item.meta, project) &&
        isPrimaryRolloutMeta(item.meta)
    )
    .map((item) => item.meta)
  const sorted = await sortRolloutsByCreatedAtThenMtime(metas);

  return sorted.at(-1)?.rolloutPath ?? null;
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
  let isSubagent = false;
  let forkedFromSessionId: string | undefined;
  let seenPrimaryMeta = false;

  for (const line of lines) {
    let item: JsonLine;
    try {
      item = JSON.parse(line) as JsonLine;
    } catch {
      continue;
    }
    const payload = item.payload ?? {};
    if (item.type === "session_meta") {
      if (seenPrimaryMeta) {
        continue;
      }

      const parsedMeta = parseSessionMeta(payload);
      if (!parsedMeta) {
        continue;
      }

      sessionId = parsedMeta.sessionId;
      createdAt = parsedMeta.createdAt;
      cwd = await normalizeFsPath(parsedMeta.cwd);
      isSubagent = parsedMeta.isSubagent;
      forkedFromSessionId = parsedMeta.forkedFromSessionId;
      seenPrimaryMeta = true;
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
    rolloutPath: filePath,
    isSubagent,
    forkedFromSessionId
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
