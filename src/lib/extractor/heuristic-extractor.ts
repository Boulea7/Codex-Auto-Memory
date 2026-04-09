import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import { matchesAllMemoryQueryTerms } from "../domain/memory-query.js";
import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { slugify } from "../util/text.js";
import { commandSucceeded, extractCommand, isCommandToolCall } from "./command-utils.js";
import { canonicalCommandSignature } from "./command-signatures.js";
import { extractReferenceResourceKey, inferReferenceCategory } from "./directive-utils.js";

interface ExplicitCorrection {
  scope: MemoryOperation["scope"];
  topic: string;
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

const stableDirectiveTopics = new Set([
  "reference",
  "architecture",
  "debugging",
  "patterns",
  "preferences",
  "commands"
]);

function isAllowedMemoryTopic(topic: string): topic is (typeof DEFAULT_MEMORY_TOPICS)[number] {
  return DEFAULT_MEMORY_TOPICS.includes(topic as (typeof DEFAULT_MEMORY_TOPICS)[number]);
}

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
    /search\s*->\s*timeline\s*->\s*details/iu.test(message) ||
    /mcp\s*->\s*local bridge\s*->\s*resolved cli/iu.test(message)
  ) {
    return "patterns";
  }

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

  if (
    /(architecture|module|api|route|entity|service|controller|schema|markdown-first|db-first|database-first|source of truth|canonical)/iu.test(
      message
    )
  ) {
    return "architecture";
  }

  if (/(debug|error|fix|fails|failing|redis|database|timeout|requires|must start|before running)/iu.test(message)) {
    return "debugging";
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

function isCorrectionSignal(message: string): boolean {
  return /(?:\bnot\b|\binstead of\b|\brather than\b|不用|别用|不要用)/iu.test(message);
}

function isStableDirectiveSummary(topic: string, summary: string): boolean {
  switch (topic) {
    case "reference":
      return /(https?:\/\/|tracked in|lives at|runbook|dashboard|docs?\b|linear|jira|issue tracker)/iu.test(
        summary
      );
    case "architecture":
      return /(markdown-first|db-first|database-first|source of truth|canonical)|主真相|规范存储/iu.test(
        summary
      );
    case "debugging":
      return /\b(requires?|needs?|must be running|must run|must start|before running|before integration tests)\b|需要|必须|先启动/u.test(
        summary
      );
    case "preferences":
      return (
        /\b(?:we\s+use|use|prefer|always use)\b.*\b(?:pnpm|npm|yarn|bun|rg|ripgrep|grep)\b/iu.test(
          summary
        ) || /(?:使用|用|优先用|优先使用).*(?:pnpm|npm|yarn|bun|rg|ripgrep|grep)/u.test(summary)
      );
    case "commands":
      return (
        /^run\s+`[^`]+`/iu.test(summary) ||
        /^use\s+`[^`]+`/iu.test(summary) ||
        /^运行\s*`[^`]+`/u.test(summary)
      );
    case "patterns":
      return (
        /search\s*->\s*timeline\s*->\s*details/iu.test(summary) ||
        /mcp\s*->\s*local bridge\s*->\s*resolved cli/iu.test(summary)
      );
    default:
      return false;
  }
}

function extractStableDirectiveOperation(
  message: string,
  rolloutPath: string
): MemoryOperation | null {
  const summary = trimTrailingPunctuation(message.trim());
  if (!summary || /[?？]$/u.test(summary) || !isHighConfidenceExplicitCorrection(summary)) {
    return null;
  }

  const topic = inferTopic(summary);
  if (!stableDirectiveTopics.has(topic) || !isStableDirectiveSummary(topic, summary)) {
    return null;
  }

  return {
    action: "upsert",
    scope: inferScope(summary),
    topic,
    id: slugify(summary),
    summary,
    details: [summary],
    reason: isCorrectionSignal(summary)
      ? "Explicit user correction that should replace stale memory."
      : "Stable directive extracted from the session.",
    sources: [rolloutPath]
  };
}

function stableDirectiveReplacementKey(topic: string, summary: string): string | null {
  if (topic === "reference") {
    const urlMatch = summary.match(/https?:\/\/[^\s)]+/iu)?.[0];
    const url = urlMatch?.replace(/[),.;]+$/u, "").trim().toLowerCase();
    const category = inferReferenceCategory(summary);
    return `reference:${category}:${extractReferenceResourceKey(summary, category, url) ?? category}`;
  }

  if (
    topic === "architecture" &&
    /\b(canonical|source of truth|db-first|markdown-first|database-first)\b|规范存储|主真相/u.test(
      summary
    )
  ) {
    return "architecture:canonical-store";
  }

  if (topic === "patterns") {
    if (/search\s*->\s*timeline\s*->\s*details/iu.test(summary)) {
      return "patterns:retrieval-flow";
    }

    if (/mcp\s*->\s*local bridge\s*->\s*resolved cli/iu.test(summary)) {
      return "patterns:route-order";
    }
  }

  return null;
}

function collectStableDirectiveDeleteTargets(
  existingEntries: MemoryEntry[],
  operation: MemoryOperation
): MemoryEntry[] {
  if (operation.action !== "upsert" || !operation.summary) {
    return [];
  }

  const replacementKey = stableDirectiveReplacementKey(operation.topic, operation.summary);
  if (!replacementKey) {
    return [];
  }

  const candidates = existingEntries.filter((entry) => {
    if (
      entry.scope !== operation.scope ||
      entry.topic !== operation.topic ||
      normalizeForComparison(entry.summary) === normalizeForComparison(operation.summary ?? "")
    ) {
      return false;
    }

    return stableDirectiveReplacementKey(entry.topic, entry.summary) === replacementKey;
  });

  return candidates.length === 1 ? candidates : [];
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
      pattern: /^(?:actually\s+)?run\s+(.+?),\s*not\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^(?:actually\s+)?keep\s+(.+?),\s*not\s+(.+)$/iu,
      staleIndex: 2
    },
    {
      pattern: /^(?:actually\s+)?(.+?\b(?:lives? at|is at)\s+.+?),\s*not\s+(.+)$/iu,
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
    const topic = isAllowedMemoryTopic(rawTopic) ? rawTopic : null;
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

  if (correction.topic === "commands") {
    return directCandidates;
  }

  const contextTokens = summaryTokens.filter((token) => !staleTokens.has(token));
  if (directCandidates.length <= 1) {
    if (directCandidates.length === 0 || contextTokens.length === 0) {
      return directCandidates;
    }

    return directCandidates.filter((entry) => {
      const haystack = normalizeForComparison(`${entry.summary}\n${entry.details.join("\n")}`);
      return contextTokens.some((token) => haystack.includes(token));
    });
  }

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

  if (!isHighConfidenceExplicitCorrection(summary)) {
    return null;
  }

  const topic = inferTopic(summary);
  if (!stableDirectiveTopics.has(topic) || !isStableDirectiveSummary(topic, summary)) {
    return null;
  }

  return {
    scope: inferScope(summary),
    topic,
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
        for (const entry of existingEntries) {
          const haystack = [entry.id, entry.topic, entry.summary, entry.details.join("\n")].join(
            "\n"
          );
          if (!matchesAllMemoryQueryTerms(haystack, query)) {
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
        const correctionSignal = isCorrectionSignal(message);
        const shouldReplaceOverlaps =
          correctionSignal && isAllowedMemoryTopic(topic);
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

      const stableDirective = extractStableDirectiveOperation(message, evidence.rolloutPath);
      if (stableDirective) {
        const deleteTargets = collectStableDirectiveDeleteTargets(existingEntries, stableDirective);
        for (const entry of deleteTargets) {
          queueDelete(
            operations,
            queuedDeleteKeys,
            entry,
            "Superseded by a newer stable directive.",
            evidence.rolloutPath
          );
        }

        queueUpsert(operations, knownOperationKeys, {
          ...stableDirective,
          reason:
            deleteTargets.length > 0
              ? "Stable directive that should replace stale memory."
              : stableDirective.reason
        });
        continue;
      }

      const insightMatch = message.match(
        /\b(?:requires|needs|must be running|must start|must run|before running|before integration tests)\b(.+)/iu
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
      const signature = canonicalCommandSignature(command);

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
            canonicalCommandSignature(existingCommand) === signature &&
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
