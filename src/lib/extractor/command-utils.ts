import type { RolloutToolCall } from "../types.js";

const commandSuccessPattern =
  /(exit code 0|Process exited with code 0|done in |completed successfully|tests?\s+passed|\b0 errors?\b|all checks passed|0 failing|\bPASS\b|compiled successfully|build succeeded)/iu;
const commandFailurePattern =
  /(Process exited with code [1-9]\d*|\bexit(?:ed)? code [1-9]\d*\b|\b(?:error|errors|failed|failure|exception|traceback|assertionerror|not ok|ELIFECYCLE)\b|\bFAIL\b|command not found|No such file or directory)/iu;

export function extractCommand(toolCall: RolloutToolCall): string | null {
  try {
    const parsed = JSON.parse(toolCall.arguments) as { cmd?: string; command?: string };
    return parsed.cmd ?? parsed.command ?? null;
  } catch {
    const match =
      toolCall.arguments.match(/"cmd":"([^"]+)"/u) ??
      toolCall.arguments.match(/"command":"([^"]+)"/u);
    return match?.[1] ?? null;
  }
}

function classifyCommandOutcome(toolCall: RolloutToolCall): "success" | "failure" | "unknown" {
  if (!toolCall.output) {
    return "unknown";
  }

  if (commandSuccessPattern.test(toolCall.output)) {
    return "success";
  }

  if (commandFailurePattern.test(toolCall.output)) {
    return "failure";
  }

  return "unknown";
}

export function commandSucceeded(toolCall: RolloutToolCall): boolean {
  return classifyCommandOutcome(toolCall) === "success";
}

export function commandFailed(toolCall: RolloutToolCall): boolean {
  return classifyCommandOutcome(toolCall) === "failure";
}

export function isCommandToolCall(toolCall: RolloutToolCall): boolean {
  return toolCall.name.includes("exec_command") || toolCall.name.toLowerCase().includes("bash");
}
