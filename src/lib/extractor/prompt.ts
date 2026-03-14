import type { MemoryEntry, RolloutEvidence } from "../types.js";
import { trimText } from "../util/text.js";

function formatExistingEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "No existing entries.";
  }

  return entries
    .slice(0, 50)
    .map(
      (entry) =>
        `- [${entry.scope}] ${entry.topic}/${entry.id}: ${entry.summary} (${entry.updatedAt})`
    )
    .join("\n");
}

function formatToolCalls(evidence: RolloutEvidence): string {
  if (evidence.toolCalls.length === 0) {
    return "No tool calls recorded.";
  }

  return evidence.toolCalls
    .slice(0, 40)
    .map((toolCall) => {
      const parts = [
        `- Tool: ${toolCall.name}`,
        `  Args: ${trimText(toolCall.arguments, 280)}`
      ];
      if (toolCall.output) {
        parts.push(`  Output: ${trimText(toolCall.output, 280)}`);
      }
      return parts.join("\n");
    })
    .join("\n");
}

export function buildExtractorPrompt(
  evidence: RolloutEvidence,
  existingEntries: MemoryEntry[]
): string {
  const userMessages = evidence.userMessages.map((message) => `- ${trimText(message, 600)}`).join("\n");
  const agentMessages = evidence.agentMessages
    .slice(-20)
    .map((message) => `- ${trimText(message, 400)}`)
    .join("\n");

  return `
You are extracting auto memory updates for Codex Auto Memory.

Your job is to imitate Claude Code auto memory as closely as possible.

Product rules:
- Auto memory is an AI-maintained local markdown note system.
- Save only information that is likely to be useful in a future conversation.
- Good candidates: stable build commands, debugging insights, architecture decisions, coding preferences, workflow habits, repeated corrections from the user.
- Bad candidates: temporary task state, one-off plans, speculative conclusions, long raw transcripts, sensitive tokens, secrets, session-only logistics.
- Use scope "global" for cross-project personal preferences.
- Use scope "project" for repository-wide knowledge shared across worktrees.
- Use scope "project-local" for worktree-specific or personal-in-this-repo knowledge.
- Prefer updating or deleting an existing memory instead of creating near-duplicates.
- If the user clearly corrected an older memory, emit a delete for the stale one and an upsert for the new one.
- Topic names should usually be one of: commands, debugging, architecture, workflow, preferences, patterns. Use another short kebab-case topic only if necessary.
- Return at most 12 operations.
- If you are unsure whether something is stable or reusable, do not save it.
- Do not store direct secrets, raw bearer tokens, cookie values, long environment variable values, or private key material.
- Prefer concise durable summaries over verbatim conversation snippets.

Output style guidance:
- Use \`upsert\` for new or corrected memory.
- Use \`delete\` when an existing entry is clearly stale, contradicted, or explicitly forgotten.
- Keep summaries short and reusable.
- Details should be concrete and task-relevant, not narrative.

Examples:
- Good: "Run \`pnpm test\` to verify this repository."
- Good: "API tests require a local Redis instance before running integration checks."
- Good: "Use pnpm instead of npm in this repository."
- Bad: "The agent plans to update the parser tomorrow."
- Bad: "User was frustrated about a failing command."
- Bad: "Bearer sk-abc123..."

Current rollout:
- Session id: ${evidence.sessionId}
- Created at: ${evidence.createdAt}
- CWD: ${evidence.cwd}
- Rollout path: ${evidence.rolloutPath}

User messages:
${userMessages || "- None"}

Agent messages:
${agentMessages || "- None"}

Tool calls:
${formatToolCalls(evidence)}

Existing memory snapshot:
${formatExistingEntries(existingEntries)}

Return JSON only, matching the provided schema.
`.trim();
}
