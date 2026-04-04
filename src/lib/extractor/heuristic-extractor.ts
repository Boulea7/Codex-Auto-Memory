import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { slugify } from "../util/text.js";
import { commandSucceeded, extractCommand, isCommandToolCall } from "./command-utils.js";

interface ExplicitCorrection {
  scope: MemoryOperation["scope"];
  topic: "preferences" | "workflow" | "commands";
  summary: string;
  staleText: string;
}

const assistantStablePrefixes = [
  /^confirmed[:\s]+/iu,
  /^result[:\s]+/iu,
  /^stable note[:\s]+/iu,
  /^decision[:\s]+/iu,
  /^verified[:\s]+/iu,
  /^结论[:：\s]+/u,
  /^已确认[:：\s]+/u
] as const;

const assistantNoisePatterns = [
  /\breviewer\b/iu,
  /\bsubagent\b/iu,
  /\bnext step\b/iu,
  /\bresume here\b/iu,
  /\bcurrent worktree\b/iu,
  /\bcurrent branch\b/iu,
  /\bI will\b/iu,
  /\bI'll\b/iu,
  /\bI am going to\b/iu,
  /我会/u,
  /下一步/u
] as const;

function inferScope(message: string): MemoryOperation["scope"] {
  if (/(all projects|across projects|globally|every repo|所有项目|全局)/iu.test(message)) {
    return "global";
  }

  if (/(this worktree|this branch|locally|local only|当前分支|本地工作树)/iu.test(message)) {
    return "project-local";
  }

  return "project";
}

function inferTopic(message: string): string {
  if (
    /`[^`]*(?:pnpm|npm|bun|yarn|cargo|pytest|jest|vitest|go test|python(?:3)? -m|make)[^`]*`/iu.test(
      message
    ) ||
    /\b(?:command|run\s+(?:pnpm|npm|bun|yarn|cargo|pytest|jest|vitest|go test|python(?:3)? -m|make)|(?:pnpm|npm|bun|yarn|cargo)\s+(?:test|lint|build|install|check)|pytest|jest|vitest|go test|dotnet test|rake|tsc|vite build|next build|gradle|mvn|make)\b/iu.test(
      message
    )
  ) {
    return "commands";
  }

  if (
    /(https?:\/\/|grafana|linear|jira|slack|notion|confluence|runbook|playbook|wiki|dashboard|docs?\b|tracked in|board\b|channel\b)/iu.test(
      message
    )
  ) {
    return "reference";
  }

  if (/(pnpm|npm|bun|yarn|format|style|indent|naming|comment|typescript|always use)/iu.test(message)) {
    return "preferences";
  }

  if (/(debug|error|fix|fails|failing|redis|database|timeout|requires|must start|before running)/iu.test(message)) {
    return "debugging";
  }

  if (
    /(architecture|module|api|route|entity|service|controller|schema|markdown-first|db-first|database-first|source of truth|canonical)/iu.test(
      message
    )
  ) {
    return "architecture";
  }

  if (/(pattern|convention|reuse|shared)/iu.test(message)) {
    return "patterns";
  }

  return "workflow";
}

function extractCommandFromSummary(summary: string): string | null {
  const match = summary.match(/`([^`]+)`/u);
  return match?.[1] ?? null;
}

function commandSignature(command: string): string | null {
  const normalized = command.toLowerCase().trim();
  const normalizedCommand = normalized
    .replace(/^(pnpm|npm|bun|yarn)\s+-[cC]\s+\S+\s+/u, "$1 ")
    .replace(/^(pnpm|npm|bun|yarn)\s+exec\s+/u, "")
    .replace(/^uv\s+run\s+/u, "")
    .replace(/^cargo\s+nextest\s+run\b/u, "cargo-nextest run");
  const runScriptMatch = normalized.match(/^(pnpm|npm|bun|yarn)\s+run\s+([a-z0-9:_-]+)/u);
  if (runScriptMatch?.[1] && runScriptMatch[2]) {
    return `${runScriptMatch[1]}:run:${runScriptMatch[2]}`;
  }

  if (/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install|check)\b/u.test(normalized)) {
    const match = normalized.match(/\b(pnpm|npm|bun|yarn)\s+(test|lint|build|install|check)\b/u);
    const tool = match?.[1];
    const action = match?.[2];
    return tool && action ? `${tool}:${action}` : null;
  }

  if (/\b(?:cargo)\s+(test|build|check)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\bcargo\s+(test|build|check)\b/u);
    const action = match?.[1];
    return action ? `cargo:${action}` : null;
  }

  if (/\bcargo-nextest\s+run\b/u.test(normalizedCommand)) {
    return "cargo-nextest:test";
  }

  if (/\b(?:pytest|jest|vitest|go test|dotnet test|rake)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\b(pytest|jest|vitest|go test|dotnet test|rake)\b/u);
    const tool = match?.[1];
    if (!tool) {
      return null;
    }
    return `${tool.replace(/\s+/gu, "-")}:test`;
  }

  if (/\b(?:tsc|vite build|next build|gradle|mvn|make)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\b(tsc|vite build|next build|gradle|mvn|make)\b/u);
    const tool = match?.[1];
    if (!tool) {
      return null;
    }
    return `${tool.replace(/\s+/gu, "-")}:build`;
  }

  return null;
}

function buildEntryIdentityKey(entry: Pick<MemoryEntry, "scope" | "topic" | "id">): string {
  return `${entry.scope}:${entry.topic}:${entry.id}`;
}

function overlappingEntries(existingEntries: MemoryEntry[], text: string): MemoryEntry[] {
  return overlappingEntriesWithThreshold(existingEntries, text, 2);
}

function overlappingEntriesWithThreshold(
  existingEntries: MemoryEntry[],
  text: string,
  minimumMatches: number
): MemoryEntry[] {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length >= 4)
  );

  if (words.size === 0) {
    return [];
  }

  return existingEntries
    .filter((entry) => {
      const haystack = `${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
      let matches = 0;
      for (const word of words) {
        if (haystack.includes(word)) {
          matches += 1;
        }
      }
      return matches >= Math.min(minimumMatches, words.size);
    });
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function trimTrailingPunctuation(text: string): string {
  return text.trim().replace(/[。.!]+$/u, "");
}

function tokenizeForOverlap(text: string, minimumLength = 4): string[] {
  return normalizeForComparison(text)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= minimumLength);
}

function stripRememberPrefix(message: string): string {
  return message.replace(/^remember that\s+/iu, "").replace(/^记住/u, "").trim();
}

function isHighConfidenceExplicitCorrection(message: string): boolean {
  return !/(?:\bmaybe\b|\bperhaps\b|\bif possible\b|\bwhen possible\b|\bfor now\b|\bprobably\b|\busually\b|\bsometimes\b|\btry\b|\bconsider\b|\bmight\b|\bcould\b|尽量|如果可以|可能|暂时)/iu.test(
    message
  );
}

function extractExplicitCorrection(message: string): ExplicitCorrection | null {
  const trimmed = trimTrailingPunctuation(stripRememberPrefix(message));
  if (!isHighConfidenceExplicitCorrection(trimmed)) {
    return null;
  }

  const patterns = [
    {
      pattern: /^(?:actually\s+)?we use\s+(.+?),\s*not\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^(?:actually\s+)?use\s+(.+?),\s*not\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^not\s+(.+?),\s*(?:actually\s+)?use\s+(.+)$/iu,
      staleIndex: 1
    },
    {
      pattern: /^(?:actually\s+)?use\s+(.+?)\s+instead of\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^(?:actually\s+)?prefer\s+(.+?)\s+over\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^我们用\s*(.+?)\s*[,，]\s*不用\s*(.+)$/u,
      staleIndex: 2
    },
    {
      pattern: /^(?:先\s*)?别用\s*(.+?)\s*[,，]\s*用\s*(.+)$/u,
      staleIndex: 1
    },
    {
      pattern: /^实际上用\s*(.+?)\s*[,，]\s*不要用\s*(.+)$/u,
      staleIndex: 2
    }
  ] as const;

  for (const { pattern, staleIndex } of patterns) {
    const match = trimmed.match(pattern);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const rawTopic = inferTopic(trimmed);
    const topic =
      rawTopic === "preferences" || rawTopic === "workflow" || rawTopic === "commands"
        ? rawTopic
        : null;
    if (!topic) {
      return null;
    }

    const staleText = match[staleIndex];
    if (!staleText) {
      continue;
    }

    return {
      scope: inferScope(trimmed),
      topic,
      summary: trimmed,
      staleText: trimTrailingPunctuation(staleText)
    };
  }

  return null;
}

function collectExplicitCorrectionDeleteTargets(
  existingEntries: MemoryEntry[],
  correction: ExplicitCorrection
): MemoryEntry[] {
  const scopedEntries = existingEntries.filter(
    (entry) => entry.scope === correction.scope && entry.topic === correction.topic
  );
  if (scopedEntries.length === 0) {
    return [];
  }

  const staleNeedle = normalizeForComparison(correction.staleText);
  if (staleNeedle.length < 2) {
    return [];
  }

  const summaryTokens = tokenizeForOverlap(correction.summary);
  const staleTokens = new Set(tokenizeForOverlap(correction.staleText));
  const directCandidates = scopedEntries.filter((entry) => {
    if (normalizeForComparison(entry.summary) === normalizeForComparison(correction.summary)) {
      return false;
    }

    const haystack = normalizeForComparison(`${entry.summary}\n${entry.details.join("\n")}`);
    return haystack.includes(staleNeedle);
  });

  if (directCandidates.length <= 1) {
    return directCandidates;
  }

  const contextTokens = summaryTokens.filter((token) => !staleTokens.has(token));
  if (contextTokens.length < 2) {
    return [];
  }

  return directCandidates
    .filter((entry) => {
      const haystack = normalizeForComparison(`${entry.summary}\n${entry.details.join("\n")}`);
      const contextMatches = contextTokens.filter((token) => haystack.includes(token)).length;
      return contextMatches >= Math.min(2, contextTokens.length);
    });
}

function queueDelete(
  operations: MemoryOperation[],
  queuedDeleteKeys: Set<string>,
  entry: MemoryEntry,
  reason: string,
  rolloutPath: string
): void {
  const deleteKey = buildEntryIdentityKey(entry);
  if (queuedDeleteKeys.has(deleteKey)) {
    return;
  }

  operations.push({
    action: "delete",
    scope: entry.scope,
    topic: entry.topic,
    id: entry.id,
    reason,
    sources: [rolloutPath]
  });
  queuedDeleteKeys.add(deleteKey);
}

function queueUpsert(
  operations: MemoryOperation[],
  knownOperationKeys: Set<string>,
  operation: MemoryOperation
): void {
  const normalizedSummary = normalizeForComparison(operation.summary ?? "");
  if (!normalizedSummary) {
    return;
  }

  const operationKey = [
    operation.scope,
    operation.topic,
    operation.id,
    normalizedSummary
  ].join(":");
  if (knownOperationKeys.has(operationKey)) {
    return;
  }

  operations.push(operation);
  knownOperationKeys.add(operationKey);
}

function extractStableAssistantSummary(message: string): {
  scope: MemoryOperation["scope"];
  topic: string;
  summary: string;
  details: string[];
  reason: string;
} | null {
  const normalizedMessage = trimTrailingPunctuation(message.trim());
  if (!normalizedMessage) {
    return null;
  }

  if (assistantNoisePatterns.some((pattern) => pattern.test(normalizedMessage))) {
    return null;
  }

  const matchingPrefix = assistantStablePrefixes.find((pattern) => pattern.test(normalizedMessage));
  if (!matchingPrefix) {
    return null;
  }

  const summary = trimTrailingPunctuation(normalizedMessage.replace(matchingPrefix, "").trim());
  if (summary.length < 24) {
    return null;
  }

  return {
    scope: inferScope(summary),
    topic: inferTopic(summary),
    summary,
    details: [summary],
    reason: "Stable assistant summary extracted from the session."
  };
}

function commandSummary(command: string): { summary: string; details: string[] } {
  if (/\b(test|vitest|jest|pytest|go test)\b/u.test(command)) {
    return {
      summary: `Run \`${command}\` to verify this repository.`,
      details: [
        `Use \`${command}\` as a repeatable verification command for this project.`,
        "This command appeared in a successful Codex session."
      ]
    };
  }

  if (/\b(build|tsc|vite build|next build|make|gradle|mvn|dotnet build)\b/u.test(command)) {
    return {
      summary: `Run \`${command}\` to build this repository.`,
      details: [
        `Use \`${command}\` as the project build command.`,
        "This command appeared in a successful Codex session."
      ]
    };
  }

  if (/\b(install|pnpm i|npm install|bun install)\b/u.test(command)) {
    return {
      summary: `Use \`${command}\` to install project dependencies.`,
      details: [
        `Run \`${command}\` when you need to install or refresh dependencies for this repository.`
      ]
    };
  }

  return {
    summary: `Use \`${command}\` when working in this repository.`,
    details: [
      `The command \`${command}\` appeared in a successful Codex session and is likely reusable.`
    ]
  };
}

export class HeuristicExtractor implements MemoryExtractorAdapter {
  public readonly name = "heuristic";

  public async extract(
    evidence: RolloutEvidence,
    existingEntries: MemoryEntry[]
  ): Promise<MemoryOperation[]> {
    const operations: MemoryOperation[] = [];
    const knownOperationKeys = new Set(
      existingEntries.map((entry) =>
        [entry.scope, entry.topic, entry.id, normalizeForComparison(entry.summary)].join(":")
      )
    );
    const queuedDeleteKeys = new Set<string>();
    const allowedTopics = new Set<string>(DEFAULT_MEMORY_TOPICS);

    for (const message of evidence.userMessages) {
      const explicitCorrection = extractExplicitCorrection(message);
      if (explicitCorrection) {
        for (const entry of collectExplicitCorrectionDeleteTargets(existingEntries, explicitCorrection)) {
          queueDelete(
            operations,
            queuedDeleteKeys,
            entry,
            "Superseded by a newer explicit user correction.",
            evidence.rolloutPath
          );
        }

        queueUpsert(operations, knownOperationKeys, {
          action: "upsert",
          scope: explicitCorrection.scope,
          topic: explicitCorrection.topic,
          id: slugify(explicitCorrection.summary),
          summary: explicitCorrection.summary,
          details: [explicitCorrection.summary],
          reason: "Explicit user correction that should replace stale memory.",
          sources: [evidence.rolloutPath]
        });
        continue;
      }

      const rememberMatch =
        message.match(/remember that\s+(.+)/i) ??
        message.match(/save to memory that\s+(.+)/i) ??
        message.match(/记住(.+)/u) ??
        message.match(/always use\s+(.+)/i) ??
        message.match(/we use\s+(.+?),\s*not\s+(.+)/i);
      const forgetMatch =
        message.match(/forget\s+(.+)/i) ??
        message.match(/stop remembering\s+(.+)/i) ??
        message.match(/忘记(.+)/u);

      if (forgetMatch?.[1]) {
        const query = forgetMatch[1].trim().replace(/[。.]$/u, "");
        const matchingEntryKeys = new Set<string>(
          overlappingEntriesWithThreshold(existingEntries, query, 1).map((entry) =>
            buildEntryIdentityKey(entry)
          )
        );
        for (const entry of existingEntries) {
          const haystack = `${entry.id}\n${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
          if (
            !haystack.includes(query.toLowerCase()) &&
            !matchingEntryKeys.has(buildEntryIdentityKey(entry))
          ) {
            continue;
          }
          queueDelete(
            operations,
            queuedDeleteKeys,
            entry,
            "Explicit forget instruction from the user.",
            evidence.rolloutPath
          );
        }
        continue;
      }

      if (rememberMatch?.[1]) {
        const summary = rememberMatch[1].trim().replace(/[。.]$/u, "");

        const scope = inferScope(message);
        const topic = inferTopic(message);
        const correctionSignal =
          /(?:\bnot\b|\binstead of\b|\brather than\b|不用|别用|不要用)/iu.test(message);
        const shouldReplaceOverlaps =
          correctionSignal &&
          (topic === "preferences" || topic === "workflow" || topic === "commands");
        if (shouldReplaceOverlaps) {
          for (const entry of overlappingEntries(existingEntries, summary)) {
            if (entry.summary.toLowerCase() === summary.toLowerCase()) {
              continue;
            }
            queueDelete(
              operations,
              queuedDeleteKeys,
              entry,
              "Superseded by a newer user correction.",
              evidence.rolloutPath
            );
          }
        }

        queueUpsert(operations, knownOperationKeys, {
          action: "upsert",
          scope,
          topic: allowedTopics.has(topic) ? topic : "workflow",
          id: slugify(summary),
          summary,
          details: [summary],
          reason: shouldReplaceOverlaps
            ? "Explicit user correction that should replace stale memory."
            : "Explicit remember instruction from the user.",
          sources: [evidence.rolloutPath]
        });
        continue;
      }

      const insightMatch = message.match(
        /\b(?:requires|needs|must start|must run|before running)\b(.+)/iu
      );
      if (insightMatch?.[0]) {
        const summary = message.trim().replace(/[。.]$/u, "");
        queueUpsert(operations, knownOperationKeys, {
          action: "upsert",
          scope: inferScope(message),
          topic: "debugging",
          id: slugify(summary),
          summary,
          details: [summary],
          reason: "Repeated prerequisite or debugging constraint extracted from the session.",
          sources: [evidence.rolloutPath]
        });
      }
    }

    for (const message of evidence.agentMessages) {
      const extracted = extractStableAssistantSummary(message);
      if (!extracted) {
        continue;
      }

      queueUpsert(operations, knownOperationKeys, {
        action: "upsert",
        scope: extracted.scope,
        topic: allowedTopics.has(extracted.topic) ? extracted.topic : "workflow",
        id: slugify(extracted.summary),
        summary: extracted.summary,
        details: extracted.details,
        reason: extracted.reason,
        sources: [evidence.rolloutPath]
      });
    }

    const commandCalls = evidence.toolCalls.filter(isCommandToolCall);

    const seenCommands = new Set<string>();
    for (const toolCall of commandCalls) {
      const command = extractCommand(toolCall);
      if (!command || seenCommands.has(command) || !commandSucceeded(toolCall)) {
        continue;
      }

      seenCommands.add(command);
      if (!/(pnpm|npm|bun|cargo|pytest|vitest|jest|go test|python -m|python3 -m|make|docker compose|gradle|mvn|dotnet test|rake|uv run|nextest)/u.test(command)) {
        continue;
      }

      const { summary, details } = commandSummary(command);
      const signature = commandSignature(command);

      if (signature) {
        for (const entry of existingEntries) {
          if (entry.scope !== "project" || entry.topic !== "commands") {
            continue;
          }
          const existingCommand = extractCommandFromSummary(entry.summary);
          if (!existingCommand) {
            continue;
          }
          if (
            commandSignature(existingCommand) === signature &&
            entry.summary.toLowerCase() !== summary.toLowerCase()
          ) {
            queueDelete(
              operations,
              queuedDeleteKeys,
              entry,
              "Superseded by a newer successful command extracted from the session.",
              evidence.rolloutPath
            );
          }
        }
      }

      queueUpsert(operations, knownOperationKeys, {
        action: "upsert",
        scope: "project",
        topic: "commands",
        id: slugify(command),
        summary,
        details,
        reason: "Stable command inferred from recent tool usage.",
        sources: [evidence.rolloutPath]
      });
    }

    return operations;
  }
}
