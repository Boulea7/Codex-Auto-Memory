import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID } from "../constants.js";
import type {
  AppConfig,
  RolloutEvidence,
  SessionContinuityState,
  SessionContinuitySummary
} from "../types.js";
import { runCommandCapture } from "../util/process.js";
import { trimText } from "../util/text.js";
import { buildSessionContinuityPrompt } from "./session-continuity-prompt.js";

function extractCommand(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  try {
    const parsed = JSON.parse(toolCall.arguments) as { cmd?: string; command?: string };
    return parsed.cmd ?? parsed.command ?? null;
  } catch {
    return null;
  }
}

function commandSucceeded(toolCall: RolloutEvidence["toolCalls"][number]): boolean {
  return Boolean(
    toolCall.output &&
      /(exit code 0|Process exited with code 0|done in |completed successfully|tests?\s+passed|\b0 errors?\b|all checks passed|0 failing|\bPASS\b|compiled successfully|build succeeded)/iu.test(
        toolCall.output
      )
  );
}

const FILE_WRITE_PATTERNS = ["apply_patch", "write_file", "create_file", "edit_file"];

function isFileWriteToolCall(toolCall: RolloutEvidence["toolCalls"][number]): boolean {
  const name = toolCall.name.toLowerCase();
  return FILE_WRITE_PATTERNS.some((pattern) => name.includes(pattern));
}

function extractFilePath(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  try {
    const parsed = JSON.parse(toolCall.arguments) as {
      path?: string;
      file_path?: string;
      filename?: string;
    };
    return parsed.path ?? parsed.file_path ?? parsed.filename ?? null;
  } catch {
    return null;
  }
}

function summarizeFileWrite(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  const filePath = extractFilePath(toolCall);
  if (!filePath) {
    return null;
  }

  const basename = filePath.split("/").pop() ?? filePath;
  return `File modified: ${trimText(basename, 120)}`;
}

function summarizeCommandResult(
  toolCall: RolloutEvidence["toolCalls"][number],
  success: boolean
): string | null {
  const command = extractCommand(toolCall);
  if (!command) {
    return null;
  }

  const normalized = trimText(command, 120);
  if (success) {
    return `Command succeeded: \`${normalized}\``;
  }

  const reason = trimText(toolCall.output ?? "Tool output did not indicate success.", 140);
  return `Command failed: \`${normalized}\` — ${reason}`;
}

function heuristicSummary(
  evidence: RolloutEvidence,
  existingState?: SessionContinuityState | null
): SessionContinuitySummary {
  const recentUserMessages = evidence.userMessages.map((message) => trimText(message, 240));
  const successfulCommands = evidence.toolCalls
    .filter((toolCall) => toolCall.name.includes("exec_command"))
    .filter(commandSucceeded)
    .map((toolCall) => summarizeCommandResult(toolCall, true))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
  const failedCommands = evidence.toolCalls
    .filter((toolCall) => toolCall.name.includes("exec_command"))
    .filter((toolCall) => toolCall.output && !commandSucceeded(toolCall))
    .map((toolCall) => summarizeCommandResult(toolCall, false))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
  const fileWrites = evidence.toolCalls
    .filter(isFileWriteToolCall)
    .map(summarizeFileWrite)
    .filter((item): item is string => Boolean(item));
  const dedupedFileWrites = [...new Set(fileWrites)].slice(0, 6);

  return {
    sourceSessionId: evidence.sessionId,
    goal: recentUserMessages.at(-1) ?? existingState?.goal ?? "",
    confirmedWorking: [
      ...successfulCommands,
      ...dedupedFileWrites.slice(0, 3),
      ...(existingState?.confirmedWorking ?? [])
    ].slice(0, 8),
    triedAndFailed: [...failedCommands, ...(existingState?.triedAndFailed ?? [])].slice(0, 8),
    notYetTried: existingState?.notYetTried ?? [],
    incompleteNext:
      recentUserMessages.length > 0
        ? [`Continue with the latest request: ${recentUserMessages.at(-1)}`]
        : (existingState?.incompleteNext ?? []),
    filesDecisionsEnvironment: [
      ...dedupedFileWrites,
      ...(existingState?.filesDecisionsEnvironment ?? [])
    ].slice(0, 8)
  };
}

export class SessionContinuitySummarizer {
  private readonly schemaPath: string;

  public constructor(
    private readonly config: AppConfig,
    schemaPath = fileURLToPath(new URL("../../../schemas/session-continuity.schema.json", import.meta.url))
  ) {
    this.schemaPath = schemaPath;
  }

  public async summarize(
    evidence: RolloutEvidence,
    existingState?: SessionContinuityState | null
  ): Promise<SessionContinuitySummary> {
    if (this.config.extractorMode === "codex") {
      const modelSummary = await this.codexSummary(evidence, existingState);
      if (modelSummary) {
        return modelSummary;
      }
    }

    return heuristicSummary(evidence, existingState);
  }

  private async codexSummary(
    evidence: RolloutEvidence,
    existingState?: SessionContinuityState | null
  ): Promise<SessionContinuitySummary | null> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${APP_ID}-session-`));
    const outputPath = path.join(tempDir, "session-continuity.json");
    const prompt = buildSessionContinuityPrompt(evidence, existingState);

    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--output-schema",
      this.schemaPath,
      "-o",
      outputPath,
      "-"
    ];

    const result = runCommandCapture(this.config.codexBinary, args, evidence.cwd, process.env, prompt);
    if (result.exitCode !== 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }

    try {
      const raw = await fs.readFile(outputPath, "utf8");
      const parsed = JSON.parse(raw) as SessionContinuitySummary;
      await fs.rm(tempDir, { recursive: true, force: true });
      return parsed;
    } catch {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }
  }
}
