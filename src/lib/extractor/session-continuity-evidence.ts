import type {
  RolloutEvidence,
  RolloutToolCall,
  SessionContinuityEvidenceCounts
} from "../types.js";
import { trimText } from "../util/text.js";
import {
  commandSucceeded,
  extractCommand,
  isCommandToolCall
} from "./command-utils.js";

const FILE_WRITE_PATTERNS = ["apply_patch", "write_file", "create_file", "edit_file"];

export const UNTRIED_PATTERNS = [
  /(?:not yet tried|haven't tried|have not tried|didn't try|did not try|could try|can try|should try|next option(?: is|:)?|alternative(?: is|:)?|maybe use|might use)\s*[:,-]?\s*(.+)/iu,
  /(?:还没试|尚未尝试|未尝试|可以试试|可以试|下一种方案|另一个方案|也许可以用)\s*[:：,-]?\s*(.+)/u
];

export const NEXT_STEP_PATTERNS = [
  /(?:next step|follow up by|follow-up|remaining work|still need to|left to do|continue by|continue with|resume by|todo)\s*[:,-]?\s*(.+)/iu,
  /^\s*(?:we|you|i)?\s*need(?:s)?\s+to\s+(.+)/iu,
  /(?:下一步|接下来|还需要|继续|待完成|剩下的工作)\s*[:：,-]?\s*(.+)/u
];

export interface SessionContinuityEvidenceBuckets {
  recentSuccessfulCommands: string[];
  recentFailedCommands: string[];
  detectedFileWrites: string[];
  explicitNextSteps: string[];
  explicitUntried: string[];
}

export function normalizeMessage(message: string, maxLength = 240): string {
  return trimText(message.replace(/\s+/g, " ").trim(), maxLength);
}

export function mergeItems(...groups: Array<string[] | undefined>): string[] {
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

export function extractPatternMatches(
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

export function looksLocalSpecific(text: string): boolean {
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

export function summarizeCommandResult(toolCall: RolloutToolCall, success: boolean): string | null {
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

export function isFileWriteToolCall(toolCall: RolloutToolCall): boolean {
  const name = toolCall.name.toLowerCase();
  return FILE_WRITE_PATTERNS.some((pattern) => name.includes(pattern));
}

function extractFilePathFromPatch(patchText: string): string | null {
  const diffMatch = /^diff --git a\/.+? b\/(.+)$/m.exec(patchText);
  const diffCapture = diffMatch?.[1];
  if (diffCapture) {
    return diffCapture.trim();
  }

  const plusPlusPlusMatch = /^\+{3} (?:b\/)?(.+)$/m.exec(patchText);
  const plusPlusPlusCapture = plusPlusPlusMatch?.[1];
  if (!plusPlusPlusCapture) {
    return null;
  }

  const filePath = plusPlusPlusCapture.replace(/\t.*$/, "").trim();
  return filePath === "/dev/null" ? null : filePath;
}

function extractFilePath(toolCall: RolloutToolCall): string | null {
  try {
    const parsed = JSON.parse(toolCall.arguments) as {
      path?: string;
      file_path?: string;
      filename?: string;
    };
    const jsonPath = parsed.path ?? parsed.file_path ?? parsed.filename ?? null;
    if (jsonPath) {
      return jsonPath;
    }
  } catch {
    return extractFilePathFromPatch(toolCall.arguments);
  }

  return extractFilePathFromPatch(toolCall.arguments);
}

export function summarizeFileWrite(toolCall: RolloutToolCall): string | null {
  const filePath = extractFilePath(toolCall);
  if (!filePath) {
    return null;
  }

  const basename = filePath.split("/").pop() ?? filePath;
  return `File modified: ${trimText(basename, 120)}`;
}

export function collectSessionContinuityEvidenceBuckets(
  evidence: RolloutEvidence
): SessionContinuityEvidenceBuckets {
  const recentUserMessages = evidence.userMessages.map((message) => trimText(message, 240));
  const recentAgentMessages = evidence.agentMessages.map((message) => trimText(message, 240));
  const recentMessages = [...recentAgentMessages.slice(-10), ...recentUserMessages.slice(-10)];
  const recentMessagesReversed = [...recentMessages].reverse();

  const recentSuccessfulCommands = evidence.toolCalls
    .filter(isCommandToolCall)
    .filter(commandSucceeded)
    .map((toolCall) => summarizeCommandResult(toolCall, true))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);

  const recentFailedCommands = evidence.toolCalls
    .filter(isCommandToolCall)
    .filter((toolCall) => toolCall.output && !commandSucceeded(toolCall))
    .map((toolCall) => summarizeCommandResult(toolCall, false))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);

  const detectedFileWrites = [
    ...new Set(
      evidence.toolCalls
        .filter(isFileWriteToolCall)
        .map(summarizeFileWrite)
        .filter((item): item is string => Boolean(item))
    )
  ].slice(0, 6);

  return {
    recentSuccessfulCommands,
    recentFailedCommands,
    detectedFileWrites,
    explicitNextSteps: extractPatternMatches(recentMessagesReversed, NEXT_STEP_PATTERNS, 4),
    explicitUntried: extractPatternMatches(recentMessagesReversed, UNTRIED_PATTERNS, 6)
  };
}

export function hasEvidenceBuckets(
  buckets: SessionContinuityEvidenceBuckets
): boolean {
  return (
    buckets.recentSuccessfulCommands.length > 0 ||
    buckets.recentFailedCommands.length > 0 ||
    buckets.detectedFileWrites.length > 0 ||
    buckets.explicitNextSteps.length > 0 ||
    buckets.explicitUntried.length > 0
  );
}

export function buildSessionContinuityEvidenceCounts(
  buckets: SessionContinuityEvidenceBuckets
): SessionContinuityEvidenceCounts {
  return {
    successfulCommands: buckets.recentSuccessfulCommands.length,
    failedCommands: buckets.recentFailedCommands.length,
    fileWrites: buckets.detectedFileWrites.length,
    nextSteps: buckets.explicitNextSteps.length,
    untried: buckets.explicitUntried.length
  };
}
