import { DEFAULT_MEMORY_TOPICS } from "../constants.js";
import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import type { MemoryExtractorAdapter } from "../runtime/contracts.js";
import { slugify } from "../util/text.js";

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

function extractCommand(toolCall: RolloutEvidence["toolCalls"][number]): string | null {
  try {
    const parsed = JSON.parse(toolCall.arguments) as { cmd?: string; command?: string };
    return parsed.cmd ?? parsed.command ?? null;
  } catch {
    const match =
      toolCall.arguments.match(/"cmd":"([^"]+)"/) ??
      toolCall.arguments.match(/"command":"([^"]+)"/);
    return match?.[1] ?? null;
  }
}

function commandSucceeded(toolCall: RolloutEvidence["toolCalls"][number]): boolean {
  if (!toolCall.output) {
    return true;
  }

  return /(exit code 0|Process exited with code 0|done in |completed successfully)/iu.test(
    toolCall.output
  );
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

  if (/\b(build|tsc|vite build|next build)\b/u.test(command)) {
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
    const existingSummaries = new Set(existingEntries.map((entry) => entry.summary.toLowerCase()));
    const allowedTopics = new Set<string>(DEFAULT_MEMORY_TOPICS);

    for (const message of evidence.userMessages) {
      const normalized = message.toLowerCase();
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
          operations.push({
            action: "delete",
            scope: entry.scope,
            topic: entry.topic,
            id: entry.id,
            reason: "Explicit forget instruction from the user.",
            sources: [evidence.rolloutPath]
          });
        }
        continue;
      }

      if (rememberMatch?.[1]) {
        const summary = rememberMatch[1].trim().replace(/[。.]$/u, "");
        if (existingSummaries.has(summary.toLowerCase())) {
          continue;
        }

        const scope = inferScope(message);
        const topic = inferTopic(message);
        for (const entryId of overlappingEntryIds(existingEntries, summary)) {
          const entry = existingEntries.find((candidate) => candidate.id === entryId);
          if (!entry || entry.summary.toLowerCase() === summary.toLowerCase()) {
            continue;
          }
          operations.push({
            action: "delete",
            scope: entry.scope,
            topic: entry.topic,
            id: entry.id,
            reason: "Superseded by a newer user correction.",
            sources: [evidence.rolloutPath]
          });
        }

        operations.push({
          action: "upsert",
          scope,
          topic: allowedTopics.has(topic) ? topic : "workflow",
          id: slugify(summary),
          summary,
          details: [summary],
          reason: /not\s+/iu.test(message)
            ? "Explicit user correction that should replace stale memory."
            : "Explicit remember instruction from the user.",
          sources: [evidence.rolloutPath]
        });
      }

      const insightMatch = message.match(
        /\b(?:requires|needs|must start|must run|before running)\b(.+)/iu
      );
      if (insightMatch?.[0]) {
        const summary = message.trim().replace(/[。.]$/u, "");
        if (!existingSummaries.has(summary.toLowerCase())) {
          operations.push({
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

    const commandCalls = evidence.toolCalls.filter((toolCall) =>
      toolCall.name.includes("exec_command") || toolCall.name.toLowerCase().includes("bash")
    );

    const seenCommands = new Set<string>();
    for (const toolCall of commandCalls) {
      const command = extractCommand(toolCall);
      if (!command || seenCommands.has(command) || !commandSucceeded(toolCall)) {
        continue;
      }

      seenCommands.add(command);
      if (!/(pnpm|npm|bun|cargo|pytest|vitest|jest|go test|python -m|python3 -m)/u.test(command)) {
        continue;
      }

      const { summary, details } = commandSummary(command);
      if (existingSummaries.has(summary.toLowerCase())) {
        continue;
      }

      operations.push({
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
