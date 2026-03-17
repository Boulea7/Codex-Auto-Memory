import type { RolloutToolCall } from "../types.js";

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

export function commandSucceeded(toolCall: RolloutToolCall): boolean {
  return Boolean(
    toolCall.output &&
      /(exit code 0|Process exited with code 0|done in |completed successfully|tests?\s+passed|\b0 errors?\b|all checks passed|0 failing|\bPASS\b|compiled successfully|build succeeded)/iu.test(
        toolCall.output
      )
  );
}

export function isCommandToolCall(toolCall: RolloutToolCall): boolean {
  return toolCall.name.includes("exec_command") || toolCall.name.toLowerCase().includes("bash");
}
