import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { slugify } from "../util/text.js";
import { commandSucceeded, extractCommand, isCommandToolCall } from "./command-utils.js";

interface ExplicitCorrection {
  scope: MemoryOperation["scope"];
  topic: "preferences" | "workflow";
  summary: string;
  staleText: string;
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
  if (/(pnpm|npm|bun|yarn|format|style|indent|naming|comment|typescript|always use)/iu.test(message)) {
    return "preferences";
  }

  if (/(command|build|test|lint|install|pnpm |npm |bun |pytest|jest|vitest|cargo|go test|python -m)/iu.test(message)) {
    return "commands";
  }

  if (/(debug|error|fix|fails|failing|redis|database|timeout|requires|must start|before running)/iu.test(message)) {
    return "debugging";
  }

  if (/(architecture|module|api|route|entity|service|controller|schema)/iu.test(message)) {
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
  if (/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install)\b/u.test(normalized)) {
    return normalized.match(/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install)\b/u)?.[1] ?? null;
  }

  if (/\b(?:cargo)\s+(test|build|check)\b/u.test(normalized)) {
    return normalized.match(/\bcargo\s+(test|build|check)\b/u)?.[1] ?? null;
  }

  if (/\b(?:pytest|jest|vitest|go test|dotnet test|rake)\b/u.test(normalized)) {
    return "test";
  }

  if (/\b(?:tsc|vite build|next build|gradle|mvn|make)\b/u.test(normalized)) {
    return "build";
  }

  return null;
}

function overlappingEntryIds(existingEntries: MemoryEntry[], text: string): string[] {
  return overlappingEntryIdsWithThreshold(existingEntries, text, 2);
}

function overlappingEntryIdsWithThreshold(
  existingEntries: MemoryEntry[],
  text: string,
  minimumMatches: number
): string[] {
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
    })
    .map((entry) => entry.id);
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

function extractExplicitCorrection(message: string): ExplicitCorrection | null {
  const trimmed = trimTrailingPunctuation(stripRememberPrefix(message));
  const patterns = [
    /^(?:actually\s+)?we use\s+(.+?),\s*not\s+(.+)$/iu,
    /^(?:actually\s+)?use\s+(.+?),\s*not\s+(.+)$/iu,
    /^not\s+(.+?),\s*(?:actually\s+)?use\s+(.+)$/iu,
    /^(?:actually\s+)?use\s+(.+?)\s+instead of\s+(.+)$/iu,
    /^我们用\s*(.+?)\s*[,，]\s*不用\s*(.+)$/u,
    /^别用\s*(.+?)\s*[,，]\s*用\s*(.+)$/u,
    /^实际上用\s*(.+?)\s*[,，]\s*不要用\s*(.+)$/u
  ] as const;

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const rawTopic = inferTopic(trimmed);
    const topic =
      rawTopic === "preferences" || rawTopic === "workflow" ? rawTopic : null;
    if (!topic) {
      return null;
    }

    const staleText = pattern === patterns[2] || pattern === patterns[5]
      ? match[1]
      : match[2];

    return {
      scope: inferScope(trimmed),
      topic,
      summary: trimmed,
      staleText: trimTrailingPunctuation(staleText)
    };
  }

  return null;
}

function collectExplicitCorrectionDeletes(
  existingEntries: MemoryEntry[],
  correction: ExplicitCorrection
): string[] {
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
    return directCandidates.map((entry) => entry.id);
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
    })
    .map((entry) => entry.id);
}

function queueDelete(
  operations: MemoryOperation[],
  queuedDeleteIds: Set<string>,
  entry: MemoryEntry,
  reason: string,
  rolloutPath: string
): void {
  if (queuedDeleteIds.has(entry.id)) {
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
  queuedDeleteIds.add(entry.id);
}

function queueUpsert(
  operations: MemoryOperation[],
  knownSummaries: Set<string>,
  operation: MemoryOperation
): void {
  const normalizedSummary = operation.summary?.toLowerCase();
  if (!normalizedSummary || knownSummaries.has(normalizedSummary)) {
    return;
  }

  operations.push(operation);
  knownSummaries.add(normalizedSummary);
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
    const knownSummaries = new Set(existingEntries.map((entry) => entry.summary.toLowerCase()));
    const queuedDeleteIds = new Set<string>();
    const allowedTopics = new Set<string>(DEFAULT_MEMORY_TOPICS);

    for (const message of evidence.userMessages) {
      const explicitCorrection = extractExplicitCorrection(message);
      if (explicitCorrection) {
        for (const entryId of collectExplicitCorrectionDeletes(existingEntries, explicitCorrection)) {
          const entry = existingEntries.find((candidate) => candidate.id === entryId);
          if (!entry) {
            continue;
          }

          queueDelete(
            operations,
            queuedDeleteIds,
            entry,
            "Superseded by a newer explicit user correction.",
            evidence.rolloutPath
          );
        }

        queueUpsert(operations, knownSummaries, {
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
        const matchingIds = new Set<string>(
          overlappingEntryIdsWithThreshold(existingEntries, query, 1)
        );
        for (const entry of existingEntries) {
          const haystack = `${entry.id}\n${entry.summary}\n${entry.details.join("\n")}`.toLowerCase();
          if (
            !haystack.includes(query.toLowerCase()) &&
            !matchingIds.has(entry.id)
          ) {
            continue;
          }
          queueDelete(
            operations,
            queuedDeleteIds,
            entry,
            "Explicit forget instruction from the user.",
            evidence.rolloutPath
          );
        }
        continue;
      }

      if (rememberMatch?.[1]) {
        const summary = rememberMatch[1].trim().replace(/[。.]$/u, "");
        if (knownSummaries.has(summary.toLowerCase())) {
          continue;
        }

        const scope = inferScope(message);
        const topic = inferTopic(message);
        const correctionSignal =
          /(?:\bnot\b|\binstead of\b|\brather than\b|不用|别用|不要用)/iu.test(message);
        const shouldReplaceOverlaps =
          correctionSignal && (topic === "preferences" || topic === "workflow");
        if (shouldReplaceOverlaps) {
          for (const entryId of overlappingEntryIds(existingEntries, summary)) {
            const entry = existingEntries.find((candidate) => candidate.id === entryId);
            if (!entry || entry.summary.toLowerCase() === summary.toLowerCase()) {
              continue;
            }
            queueDelete(
              operations,
              queuedDeleteIds,
              entry,
              "Superseded by a newer user correction.",
              evidence.rolloutPath
            );
          }
        }

        queueUpsert(operations, knownSummaries, {
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
        if (!knownSummaries.has(summary.toLowerCase())) {
          queueUpsert(operations, knownSummaries, {
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
    }

    const commandCalls = evidence.toolCalls.filter(isCommandToolCall);

    const seenCommands = new Set<string>();
    for (const toolCall of commandCalls) {
      const command = extractCommand(toolCall);
      if (!command || seenCommands.has(command) || !commandSucceeded(toolCall)) {
        continue;
      }

      seenCommands.add(command);
      if (!/(pnpm|npm|bun|cargo|pytest|vitest|jest|go test|python -m|python3 -m|make|docker compose|gradle|mvn|dotnet test|rake)/u.test(command)) {
        continue;
      }

      const { summary, details } = commandSummary(command);
      const signature = commandSignature(command);
      if (knownSummaries.has(summary.toLowerCase())) {
        continue;
      }

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
              queuedDeleteIds,
              entry,
              "Superseded by a newer successful command extracted from the session.",
              evidence.rolloutPath
            );
          }
        }
      }

      queueUpsert(operations, knownSummaries, {
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

    return operations.slice(0, 8);
  }
}
