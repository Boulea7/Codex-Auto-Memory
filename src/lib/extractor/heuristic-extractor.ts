import type { MemoryEntry, MemoryOperation, RolloutEvidence } from "../types.js";
import { slugify } from "../util/text.js";

export class HeuristicExtractor {
  public async extract(
    evidence: RolloutEvidence,
    existingEntries: MemoryEntry[]
  ): Promise<MemoryOperation[]> {
    const operations: MemoryOperation[] = [];
    const existingSummaries = new Set(existingEntries.map((entry) => entry.summary.toLowerCase()));

    for (const message of evidence.userMessages) {
      const normalized = message.toLowerCase();
      const rememberMatch =
        message.match(/remember that\s+(.+)/i) ??
        message.match(/记住(.+)/u) ??
        message.match(/always use\s+(.+)/i);

      if (rememberMatch?.[1]) {
        const summary = rememberMatch[1].trim().replace(/[。.]$/u, "");
        if (existingSummaries.has(summary.toLowerCase())) {
          continue;
        }

        operations.push({
          action: "upsert",
          scope: normalized.includes("all projects") ? "global" : "project",
          topic: normalized.includes("use ") ? "preferences" : "workflow",
          id: slugify(summary),
          summary,
          details: [summary],
          reason: "Explicit remember instruction from the user.",
          sources: [evidence.rolloutPath]
        });
      }
    }

    const commandCalls = evidence.toolCalls.filter((toolCall) =>
      toolCall.name.includes("exec_command") || toolCall.name.toLowerCase().includes("bash")
    );

    for (const toolCall of commandCalls) {
      const commandMatch = toolCall.arguments.match(/"cmd":"([^"]+)"/);
      const command = commandMatch?.[1];
      if (!command) {
        continue;
      }

      if (!/(pnpm|npm|bun|cargo|pytest|vitest|jest|go test|python -m|python3 -m)/u.test(command)) {
        continue;
      }

      const summary = `Useful command in this repo: ${command}`;
      if (existingSummaries.has(summary.toLowerCase())) {
        continue;
      }

      operations.push({
        action: "upsert",
        scope: "project",
        topic: "commands",
        id: slugify(command),
        summary,
        details: [
          `Run \`${command}\` when working in this repository.`,
          "This command appeared in a successful Codex session and is likely reusable."
        ],
        reason: "Stable command inferred from recent tool usage.",
        sources: [evidence.rolloutPath]
      });
    }

    return operations.slice(0, 8);
  }
}

