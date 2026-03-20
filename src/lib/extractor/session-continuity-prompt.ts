import type {
  ExistingSessionContinuityState,
  RolloutEvidence,
  SessionContinuityState
} from "../types.js";
import type { SessionContinuityEvidenceBuckets } from "./session-continuity-evidence.js";
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

function formatStateBlock(title: string, state?: SessionContinuityState | null): string {
  if (!state) {
    return `${title}:\n- None`;
  }

  return [
    `${title}:`,
    `- Goal: ${state.goal || "None"}`,
    `- Confirmed working: ${state.confirmedWorking.join(" | ") || "None"}`,
    `- Tried and failed: ${state.triedAndFailed.join(" | ") || "None"}`,
    `- Not yet tried: ${state.notYetTried.join(" | ") || "None"}`,
    `- Incomplete / next: ${state.incompleteNext.join(" | ") || "None"}`,
    `- Files / decisions / environment: ${state.filesDecisionsEnvironment.join(" | ") || "None"}`
  ].join("\n");
}

function formatExistingState(existingState?: ExistingSessionContinuityState): string {
  return [
    formatStateBlock("Existing shared project continuity", existingState?.project),
    "",
    formatStateBlock("Existing project-local continuity", existingState?.projectLocal)
  ].join("\n");
}

function formatBucket(title: string, items: string[]): string {
  if (items.length === 0) {
    return `${title}:\n- None`;
  }

  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatEvidenceBuckets(buckets: SessionContinuityEvidenceBuckets): string {
  return [
    formatBucket("Recent successful commands", buckets.recentSuccessfulCommands),
    "",
    formatBucket("Recent failed commands", buckets.recentFailedCommands),
    "",
    formatBucket("Detected file writes", buckets.detectedFileWrites),
    "",
    formatBucket("Candidate explicit next-step phrases", buckets.explicitNextSteps),
    "",
    formatBucket("Candidate explicit untried phrases", buckets.explicitUntried),
    "",
    formatBucket("Reviewer warning hints", buckets.warningHints)
  ].join("\n");
}

export function buildSessionContinuityPrompt(
  evidence: RolloutEvidence,
  existingState?: ExistingSessionContinuityState,
  buckets?: SessionContinuityEvidenceBuckets
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

Return TWO summaries:
- project: shared repository continuity that should be useful across worktrees
- projectLocal: worktree-local continuity for the current working tree only

Do NOT output:
- raw transcript summaries
- long narrative recaps
- secrets, tokens, keys, cookies, URLs with credentials
- durable coding preferences that belong in long-term memory

Important product rule:
- Keep this practical and resume-oriented.
- Prefer concise bullet-like items that help the next conversation continue work without re-trying dead ends.
- If something is uncertain, omit it rather than guessing.
- If the existing continuity state contains useful items that still apply, preserve them in the right layer.
- Return no more than 8 items per section.
- Put exact next-step instructions in projectLocal unless they are clearly repository-wide.
- Put file-modification notes in projectLocal by default.
- Put project-wide prerequisites or decisions in project.
- Do not guess untried options; only include them when the rollout explicitly suggests them.
- Do not mark something as confirmed working unless there is concrete evidence in tool output or clear confirmation in the conversation.
- Reviewer warning hints are reviewer-only confidence context. Do not copy those warning phrases into project or projectLocal continuity items.

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

Evidence buckets:
${formatEvidenceBuckets(
  buckets ?? {
    recentSuccessfulCommands: [],
    recentFailedCommands: [],
      detectedFileWrites: [],
      explicitNextSteps: [],
      explicitUntried: [],
      warningHints: []
    }
  )}

Return JSON only, matching the provided schema.
`.trim();
}
