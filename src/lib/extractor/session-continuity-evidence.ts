import path from "node:path";
import type {
  RolloutEvidence,
  RolloutToolCall,
  SessionContinuityEvidenceCounts
} from "../types.js";
import { trimText } from "../util/text.js";
import {
  commandFailed,
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
  /(?:next step|follow up by|remaining work|still need to|left to do|continue by|continue with|resume by|todo)\s*[:,-]?\s*(.+)/iu,
  /follow(?: |-)?up(?:\s+(?:by|with|on)|\s*[:,-])\s*(.+)/iu,
  /^\s*(?:we|you|i)?\s*need(?:s)?\s+to\s+(.+)/iu,
  /(?:下一步|接下来|还需要|继续|待完成|剩下的工作)\s*[:：,-]?\s*(.+)/u
];

const CONTINUITY_PROMPT_PATTERNS = [
  /\breviewer sub-agent\b/iu,
  /\bwork read-only\b/iu,
  /\bfiles to review\b/iu,
  /\bprimary focus\b/iu,
  /\breview dimensions\b/iu,
  /\bforked workspace\b/iu,
  /\bwrite scope\b/iu,
  /\bdocs\/contract reviewer\b/iu,
  /(?:子 ?agent|子线程|审查范围|分域|取证|只读工作|官方文档|平行审查|并行审查)/u
];

const PROGRESS_NARRATION_PATTERNS = [
  /^(?:i|we)\s+(?:will|am going to|plan to|want to|can now|need to do)\b/iu,
  /^(?:我会|我们会|我先|我将|下面我会|现在我会|随后我会|最后我再|接下来我会|我会做)/u
];

const packageManagerValues = ["pnpm", "npm", "yarn", "bun"] as const;
const repoSearchValues = ["rg", "ripgrep", "grep"] as const;
const canonicalStoreValues = ["markdown", "database", "sqlite", "vector"] as const;
const debuggingDependencyValues = ["redis", "postgres", "docker"] as const;
const hedgedDirectivePattern =
  /(?:\bmaybe\b|\bperhaps\b|\bif possible\b|\bwhen possible\b|\bfor now\b|\bprobably\b|\busually\b|\bsometimes\b|\btry\b|\bconsider\b|\bmight\b|\bcould\b|尽量|如果可以|可能|暂时)/iu;

function isPromptLikeContinuityMessage(text: string): boolean {
  return CONTINUITY_PROMPT_PATTERNS.some((pattern) => pattern.test(text));
}

function isProgressNarration(text: string): boolean {
  return PROGRESS_NARRATION_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldRejectContinuityCapture(message: string, captured: string): boolean {
  if (isPromptLikeContinuityMessage(message) || isPromptLikeContinuityMessage(captured)) {
    return true;
  }

  if (isProgressNarration(captured)) {
    return true;
  }

  if (
    /(?:按你要求跑完整校验命令|分域取证|审查计划|reviewer 线程|根据官方文档对代码进行审查|实现功能，而是)/u.test(
      captured
    )
  ) {
    return true;
  }

  return false;
}

export interface SessionContinuityEvidenceBuckets {
  recentSuccessfulCommands: string[];
  recentFailedCommands: string[];
  detectedFileWrites: string[];
  explicitNextSteps: string[];
  explicitUntried: string[];
  warningHints: string[];
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
      const captured = normalizeMessage(match[1]);
      if (captured.length < 10) continue;
      if (/^(?:而是|但是|因为|所以|不过|然后|其实|就是|也就是说)/u.test(captured)) continue;
      if (shouldRejectContinuityCapture(message, captured)) continue;
      matches.push(captured);
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
  const managedPatchMatch = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(patchText);
  const managedPatchCapture = managedPatchMatch?.[1];
  if (managedPatchCapture) {
    return managedPatchCapture.trim();
  }

  const movedPatchMatch = /^\*\*\* Move to: (.+)$/m.exec(patchText);
  const movedPatchCapture = movedPatchMatch?.[1];
  if (movedPatchCapture) {
    return movedPatchCapture.trim();
  }

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

function formatContinuityFilePath(filePath: string, cwd?: string): string {
  const normalized = filePath.replace(/\\/gu, "/").trim();
  if (!normalized) {
    return "";
  }

  if (!path.isAbsolute(normalized)) {
    return normalized.replace(/^\.\/+/u, "");
  }

  if (!cwd) {
    return normalized;
  }

  const relative = path.relative(cwd, normalized).replace(/\\/gu, "/");
  if (
    relative.length > 0 &&
    !relative.startsWith("../") &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  ) {
    return relative.replace(/^\.\/+/u, "");
  }

  return normalized;
}

export function summarizeFileWrite(toolCall: RolloutToolCall, cwd?: string): string | null {
  const filePath = extractFilePath(toolCall);
  if (!filePath) {
    return null;
  }

  const displayPath = formatContinuityFilePath(filePath, cwd);
  if (!displayPath) {
    return null;
  }

  return `File modified: ${trimText(displayPath, 120)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface DirectiveSignal {
  key: string;
  value: string;
  authoritative: boolean;
}

function shouldWarnForConflictingDirectiveKey(key: string): boolean {
  return (
    key === "package-manager" ||
    key === "repo-search" ||
    key === "canonical-store" ||
    key === "retrieval-flow" ||
    key === "route-order" ||
    key === "required-service" ||
    key.startsWith("reference-pointer:") ||
    key.startsWith("required-service:")
  );
}

function extractReferenceSignal(text: string): DirectiveSignal | null {
  const normalized = text.toLowerCase();
  const urlMatch = text.match(/https?:\/\/[^\s)]+/iu)?.[0];
  const url = urlMatch?.replace(/[),.;]+$/u, "").trim().toLowerCase();
  const category =
    /\bdashboard\b|仪表盘/u.test(normalized)
      ? "dashboard"
      : /\brunbook\b|操作手册|run book/u.test(normalized)
        ? "runbook"
        : /\bdoc(?:s|umentation)?\b|文档/u.test(normalized)
          ? "docs"
          : /\b(?:linear|jira|issue tracker|issues?)\b|缺陷追踪|问题追踪/u.test(normalized)
            ? "issue-tracker"
            : "pointer";

  if (url) {
    return {
      key: `reference-pointer:${category}`,
      value: url,
      authoritative: false
    };
  }

  return null;
}

function extractArchitectureSignal(text: string): DirectiveSignal | null {
  const normalized = text.toLowerCase();
  if (
    !/\b(canonical|source of truth|db-first|markdown-first|database-first)\b|规范存储|主真相/u.test(
      text
    )
  ) {
    return null;
  }

  if (/markdown-first|markdown.*source of truth|markdown.*canonical/u.test(normalized)) {
    return {
      key: "canonical-store",
      value: "markdown",
      authoritative: false
    };
  }

  if (/db-first|database-first|数据库优先/u.test(normalized)) {
    return {
      key: "canonical-store",
      value: "database",
      authoritative: false
    };
  }

  return extractDirectiveChoice(text, canonicalStoreValues, "canonical-store");
}

function extractDebuggingSignal(text: string): DirectiveSignal | null {
  const normalized = text.toLowerCase();
  if (
    !/\b(requires?|needs?|start|before running|must be running|running before)\b|需要|必须|先启动/u.test(
      text
    )
  ) {
    return null;
  }

  for (const value of debuggingDependencyValues) {
    const pattern = new RegExp(`\\b${escapeRegExp(value)}\\b`, "iu");
    if (pattern.test(normalized)) {
      return {
        key: "required-service",
        value,
        authoritative: false
      };
    }
  }

  return null;
}

function extractOrderedSignal(
  text: string,
  tokens: ReadonlyArray<{ pattern: RegExp; value: string }>,
  key: string
): DirectiveSignal | null {
  const positions = tokens
    .map((token) => {
      const match = token.pattern.exec(text);
      return match ? { index: match.index, value: token.value } : null;
    })
    .filter((entry): entry is { index: number; value: string } => entry !== null)
    .sort((left, right) => left.index - right.index);

  if (positions.length !== tokens.length) {
    return null;
  }

  return {
    key,
    value: positions.map((entry) => entry.value).join("->"),
    authoritative: false
  };
}

function extractPatternSignals(text: string): DirectiveSignal[] {
  const retrievalFlow = extractOrderedSignal(
    text,
    [
      { pattern: /\bsearch\b/iu, value: "search" },
      { pattern: /\btimeline\b/iu, value: "timeline" },
      { pattern: /\bdetails\b/iu, value: "details" }
    ],
    "retrieval-flow"
  );
  const routeOrder = extractOrderedSignal(
    text,
    [
      { pattern: /\bmcp\b/iu, value: "mcp" },
      { pattern: /\blocal bridge\b/iu, value: "local-bridge" },
      { pattern: /\bresolved cli\b/iu, value: "resolved-cli" }
    ],
    "route-order"
  );

  return [retrievalFlow, routeOrder].filter((signal): signal is DirectiveSignal => Boolean(signal));
}

function extractDirectiveChoice(
  text: string,
  values: readonly string[],
  key: string
): DirectiveSignal | null {
  const normalized = text.toLowerCase();
  const hedged = hedgedDirectivePattern.test(text);

  for (const value of values) {
    const escaped = escapeRegExp(value);
    const authoritativePatterns = [
      new RegExp(`\\b(?:actually\\s+)?use\\s+${escaped}\\s*,\\s*not\\s+[^,.]+`, "iu"),
      new RegExp(`\\b(?:actually\\s+)?use\\s+${escaped}\\s+instead of\\s+[^,.]+`, "iu"),
      new RegExp(`\\bprefer\\s+${escaped}\\s+over\\s+[^,.]+`, "iu"),
      new RegExp(`\\bnot\\s+[^,.]+[,，]\\s*(?:actually\\s+)?use\\s+${escaped}\\b`, "iu"),
      new RegExp(`我们用\\s*${escaped}\\s*[,，]\\s*不用\\s*.+`, "u"),
      new RegExp(`(?:别用|不要用).+[，,]\\s*用\\s*${escaped}\\b`, "u"),
      new RegExp(`实际上用\\s*${escaped}\\s*[,，]\\s*不要用\\s*.+`, "u")
    ];
    const genericPatterns = [
      new RegExp(`\\b(?:we\\s+)?use\\s+${escaped}\\b`, "iu"),
      new RegExp(`\\bprefer\\s+${escaped}\\b`, "iu"),
      new RegExp(`\\balways\\s+use\\s+${escaped}\\b`, "iu"),
      new RegExp(`(?:使用|用|优先用|优先使用)\\s*${escaped}\\b`, "u")
    ];

    if (!hedged && authoritativePatterns.some((pattern) => pattern.test(text))) {
      return {
        key,
        value,
        authoritative: true
      };
    }

    if (genericPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        key,
        value,
        authoritative: false
      };
    }
  }

  return null;
}

function collectWarningHints(agentMessages: string[], userMessages: string[]): string[] {
  const warnings = new Set<string>();
  const directiveValues = new Map<string, Set<string>>();
  let promptNoiseDetected = false;

  const applySignal = (signal: DirectiveSignal) => {
    const values = directiveValues.get(signal.key) ?? new Set<string>();
    if (signal.authoritative) {
      values.clear();
    }
    values.add(signal.value);
    directiveValues.set(signal.key, values);
  };

  for (const message of agentMessages) {
    if (isPromptLikeContinuityMessage(message)) {
      promptNoiseDetected = true;
      continue;
    }
    const choices = [
      extractDirectiveChoice(message, packageManagerValues, "package-manager"),
      extractDirectiveChoice(message, repoSearchValues, "repo-search"),
      extractReferenceSignal(message),
      extractArchitectureSignal(message),
      extractDebuggingSignal(message),
      ...extractPatternSignals(message)
    ].filter((choice): choice is DirectiveSignal => Boolean(choice));

    for (const choice of choices) {
      applySignal(choice);
    }
  }

  for (const message of userMessages) {
    if (isPromptLikeContinuityMessage(message)) {
      promptNoiseDetected = true;
      continue;
    }

    const choices = [
      extractDirectiveChoice(message, packageManagerValues, "package-manager"),
      extractDirectiveChoice(message, repoSearchValues, "repo-search"),
      extractReferenceSignal(message),
      extractArchitectureSignal(message),
      extractDebuggingSignal(message),
      ...extractPatternSignals(message)
    ].filter((choice): choice is DirectiveSignal => Boolean(choice));

    for (const choice of choices) {
      applySignal(choice);
    }
  }

  if (promptNoiseDetected) {
    warnings.add(
      "Reviewer or subagent prompt noise was detected in the rollout; continuity extraction ignored non-product transcript lines."
    );
  }

  for (const [key, values] of directiveValues) {
    if (values.size <= 1) {
      continue;
    }

    if (!shouldWarnForConflictingDirectiveKey(key)) {
      continue;
    }

    warnings.add(
      `Conflicting ${key.replace(/-/g, " ")} signals were detected in the rollout; verify the current preference before trusting this continuity summary.`
    );
  }

  return [...warnings];
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
    .filter(commandFailed)
    .map((toolCall) => summarizeCommandResult(toolCall, false))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);

  const detectedFileWrites = [
    ...new Set(
      evidence.toolCalls
        .filter(isFileWriteToolCall)
        .map((toolCall) => summarizeFileWrite(toolCall, evidence.cwd))
        .filter((item): item is string => Boolean(item))
    )
  ].slice(0, 6);

  return {
    recentSuccessfulCommands,
    recentFailedCommands,
    detectedFileWrites,
    explicitNextSteps: extractPatternMatches(recentMessagesReversed, NEXT_STEP_PATTERNS, 4),
    explicitUntried: extractPatternMatches(recentMessagesReversed, UNTRIED_PATTERNS, 6),
    warningHints: collectWarningHints(recentAgentMessages, recentUserMessages)
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
