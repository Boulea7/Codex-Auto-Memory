import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID } from "../constants.js";
import type {
  AppConfig,
  ExistingSessionContinuityState,
  RolloutEvidence,
  SessionContinuityLayerSummary,
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
const UNTRIED_PATTERNS = [
  /(?:not yet tried|haven't tried|have not tried|didn't try|did not try|could try|can try|should try|next option(?: is|:)?|alternative(?: is|:)?|maybe use|might use)\s*[:,-]?\s*(.+)/iu,
  /(?:还没试|尚未尝试|未尝试|可以试试|可以试|下一种方案|另一个方案|也许可以用)\s*[:：,-]?\s*(.+)/u
];
const NEXT_STEP_PATTERNS = [
  /(?:next step|follow up by|follow-up|remaining work|still need to|left to do|continue by|continue with|resume by|todo)\s*[:,-]?\s*(.+)/iu,
  /^\s*(?:we|you|i)?\s*need(?:s)?\s+to\s+(.+)/iu,
  /(?:下一步|接下来|还需要|继续|待完成|剩下的工作)\s*[:：,-]?\s*(.+)/u
];
const PROJECT_NOTE_PATTERNS = [
  /\b(requires|must|must run|need to run|before running|use pnpm|use bun|use npm|prefer|service|redis|postgres|docker|environment|env var|setup)\b/iu,
  /(需要|必须|先启动|运行前|使用 pnpm|使用 bun|使用 npm|环境变量|服务|数据库|Redis|Docker)/u
];

function isFileWriteToolCall(toolCall: RolloutEvidence["toolCalls"][number]): boolean {
  const name = toolCall.name.toLowerCase();
  return FILE_WRITE_PATTERNS.some((pattern) => name.includes(pattern));
}

function extractFilePathFromPatch(patchText: string): string | null {
  // "diff --git a/path b/path" — most specific, captures destination path
  const diffMatch = /^diff --git a\/.+? b\/(.+)$/m.exec(patchText);
  const diffCapture = diffMatch?.[1];
  if (diffCapture) return diffCapture.trim();
  // "+++ b/path" or "+++ path" — after-change path in standard unified diff
  const pppMatch = /^\+{3} (?:b\/)?(.+)$/m.exec(patchText);
  const pppCapture = pppMatch?.[1];
  if (pppCapture) {
    const p = pppCapture.replace(/\t.*$/, "").trim();
    return p === "/dev/null" ? null : p;
  }
  return null;
}

function extractFilePath(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  // JSON args: write_file, create_file, edit_file
  try {
    const parsed = JSON.parse(toolCall.arguments) as {
      path?: string;
      file_path?: string;
      filename?: string;
    };
    const jsonPath = parsed.path ?? parsed.file_path ?? parsed.filename ?? null;
    if (jsonPath) return jsonPath;
  } catch {
    // fall through to patch text extraction
  }
  // Raw patch text: apply_patch, apply_patch_freeform
  return extractFilePathFromPatch(toolCall.arguments);
}

function summarizeFileWrite(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  const filePath = extractFilePath(toolCall);
  if (!filePath) {
    return null;
  }

  const basename = filePath.split("/").pop() ?? filePath;
  return `File modified: ${trimText(basename, 120)}`;
}

function normalizeMessage(message: string, maxLength = 240): string {
  return trimText(message.replace(/\s+/g, " ").trim(), maxLength);
}

function mergeItems(...groups: Array<string[] | undefined>): string[] {
  const deduped = new Set<string>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const normalized = normalizeMessage(item);
      if (!normalized) {
        continue;
      }
      deduped.add(normalized);
      if (deduped.size >= 8) {
        return [...deduped];
      }
    }
  }

  return [...deduped];
}

function extractPatternMatches(
  messages: string[],
  patterns: RegExp[],
  maxItems: number
): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      if (!match?.[1]) {
        continue;
      }
      matches.push(normalizeMessage(match[1]));
      break;
    }
    if (matches.length >= maxItems) {
      break;
    }
  }

  return mergeItems(matches).slice(0, maxItems);
}

function looksLocalSpecific(text: string): boolean {
  const repoRelativePathPatterns = [
    /(?:^|[\s"'`(])\.[./][\w]/u,
    /(?:^|[\s"'`(])\.\.\/[\w]/u,
    /(?:^|[\s"'`(])(?:src|app|lib|test|tests|docs|scripts|server|client|components|routes|pages|api|schemas|migrations|styles|config)\/[\w.-]+/iu
  ];

  return (
    repoRelativePathPatterns.some((pattern) => pattern.test(text)) ||
    /(?:^[A-Za-z]:|[\s"'`(])\\[\w.-]+/u.test(text) ||
    /\b[a-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|css|scss|sql|py|go|rs|sh)\b/iu.test(
      text
    ) ||
    /\b(worktree|branch|this branch|local only|locally|current branch|当前分支|本地工作树)\b/iu.test(
      text
    )
  );
}

function extractProjectNotes(messages: string[]): { project: string[]; projectLocal: string[] } {
  const project: string[] = [];
  const projectLocal: string[] = [];

  for (const message of messages) {
    if (!PROJECT_NOTE_PATTERNS.some((pattern) => pattern.test(message))) {
      continue;
    }
    const normalized = normalizeMessage(message);
    if (!normalized) {
      continue;
    }
    if (looksLocalSpecific(normalized)) {
      projectLocal.push(normalized);
    } else {
      project.push(normalized);
    }
  }

  return {
    project: mergeItems(project).slice(0, 6),
    projectLocal: mergeItems(projectLocal).slice(0, 6)
  };
}

function buildLayerSummary(
  existing: SessionContinuityLayerSummary | null | undefined,
  next: Partial<SessionContinuityLayerSummary>
): SessionContinuityLayerSummary {
  return {
    goal: next.goal || existing?.goal || "",
    confirmedWorking: mergeItems(next.confirmedWorking, existing?.confirmedWorking),
    triedAndFailed: mergeItems(next.triedAndFailed, existing?.triedAndFailed),
    notYetTried: mergeItems(next.notYetTried, existing?.notYetTried),
    incompleteNext: mergeItems(next.incompleteNext, existing?.incompleteNext),
    filesDecisionsEnvironment: mergeItems(
      next.filesDecisionsEnvironment,
      existing?.filesDecisionsEnvironment
    )
  };
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
  existingState?: ExistingSessionContinuityState
): SessionContinuitySummary {
  const recentUserMessages = evidence.userMessages.map((message) => trimText(message, 240));
  const recentAgentMessages = evidence.agentMessages.map((message) => trimText(message, 240));
  const recentMessages = [...recentAgentMessages.slice(-10), ...recentUserMessages.slice(-10)];
  const recentMessagesReversed = [...recentMessages].reverse();
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
  const untriedCandidates = extractPatternMatches(recentMessagesReversed, UNTRIED_PATTERNS, 6);
  const projectUntried = untriedCandidates.filter((item) => !looksLocalSpecific(item));
  const localUntried = untriedCandidates.filter(looksLocalSpecific);
  const nextSteps = extractPatternMatches(recentMessagesReversed, NEXT_STEP_PATTERNS, 4);
  const fallbackNext =
    nextSteps.length > 0
      ? nextSteps
      : recentUserMessages.length > 0
        ? [`Continue with the latest request: ${recentUserMessages.at(-1)}`]
        : [];
  const notes = extractProjectNotes(recentMessages);
  const existingProject = existingState?.project;
  const existingLocal = existingState?.projectLocal;
  const sharedGoal = recentUserMessages.at(-1) ?? existingProject?.goal ?? existingLocal?.goal ?? "";

  return {
    sourceSessionId: evidence.sessionId,
    project: buildLayerSummary(existingProject, {
      goal: sharedGoal,
      confirmedWorking: successfulCommands,
      triedAndFailed: failedCommands,
      notYetTried: projectUntried,
      filesDecisionsEnvironment: notes.project
    }),
    projectLocal: buildLayerSummary(existingLocal, {
      goal: existingLocal?.goal ?? "",
      notYetTried: localUntried,
      incompleteNext: fallbackNext,
      filesDecisionsEnvironment: [...dedupedFileWrites, ...notes.projectLocal]
    })
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
    existingState?: ExistingSessionContinuityState
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
    existingState?: ExistingSessionContinuityState
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
