import type { RolloutEvidence, SessionContinuityState } from "../types.js";
import { trimText } from "../util/text.js";

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

function formatExistingState(existingState?: SessionContinuityState | null): string {
  if (!existingState) {
    return "No existing session continuity state.";
  }

  return [
    `Goal: ${existingState.goal || "None"}`,
    `Confirmed working: ${existingState.confirmedWorking.join(" | ") || "None"}`,
    `Tried and failed: ${existingState.triedAndFailed.join(" | ") || "None"}`,
    `Not yet tried: ${existingState.notYetTried.join(" | ") || "None"}`,
    `Incomplete / next: ${existingState.incompleteNext.join(" | ") || "None"}`,
    `Files / decisions / environment: ${existingState.filesDecisionsEnvironment.join(" | ") || "None"}`
  ].join("\n");
}

export function buildSessionContinuityPrompt(
  evidence: RolloutEvidence,
  existingState?: SessionContinuityState | null
): string {
  const userMessages = evidence.userMessages
    .slice(-20)
    .map((message) => `- ${trimText(message, 500)}`)
    .join("\n");
  const agentMessages = evidence.agentMessages
    .slice(-20)
    .map((message) => `- ${trimText(message, 320)}`)
    .join("\n");

  return `
You are updating temporary session continuity for Codex Auto Memory.

This is NOT durable memory.
It is a temporary, cross-session working-state file for resuming work after context loss or a new conversation.

Capture only the current working state that should survive into the next conversation:
- what is confirmed working, with concrete evidence
- what has been tried and failed, with the reason
- what has not yet been tried
- what is incomplete or should happen next
- important file, decision, or environment notes only when needed for continuity

Do NOT output:
- raw transcript summaries
- long narrative recaps
- secrets, tokens, keys, cookies, URLs with credentials
- durable coding preferences that belong in long-term memory

Important product rule:
- Keep this practical and resume-oriented.
- Prefer concise bullet-like items that help the next conversation continue work without re-trying dead ends.
- If something is uncertain, omit it rather than guessing.
- If the existing continuity state contains useful items that still apply, preserve them.
- Return no more than 8 items per section.

Current rollout:
- Session id: ${evidence.sessionId}
- Created at: ${evidence.createdAt}
- CWD: ${evidence.cwd}
- Rollout path: ${evidence.rolloutPath}

Existing continuity state:
${formatExistingState(existingState)}

User messages:
${userMessages || "- None"}

Agent messages:
${agentMessages || "- None"}

Tool calls:
${formatToolCalls(evidence)}

Return JSON only, matching the provided schema.
`.trim();
}
