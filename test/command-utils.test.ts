import { describe, expect, it } from "vitest";
import {
  commandFailed,
  commandSucceeded,
  extractCommand,
  isCommandToolCall
} from "../src/lib/extractor/command-utils.js";

describe("command-utils", () => {
  it("extracts a command from the cmd field", () => {
    expect(
      extractCommand({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "pnpm test" })
      })
    ).toBe("pnpm test");
  });

  it("extracts a command from the command field", () => {
    expect(
      extractCommand({
        name: "exec_command",
        arguments: JSON.stringify({ command: "pnpm build" })
      })
    ).toBe("pnpm build");
  });

  it("falls back to regex extraction when arguments are not valid json", () => {
    expect(
      extractCommand({
        name: "exec_command",
        arguments: "{\"cmd\":\"pnpm lint\""
      })
    ).toBe("pnpm lint");
  });

  it("recognizes expanded command success patterns", () => {
    const successfulOutputs = [
      "Process exited with code 0",
      "Tests passed",
      "0 errors",
      "PASS",
      "compiled successfully"
    ];

    for (const output of successfulOutputs) {
      expect(
        commandSucceeded({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
          output
        })
      ).toBe(true);
    }
  });

  it("rejects missing or failed command output", () => {
    expect(
      commandSucceeded({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "pnpm test" }),
        output: undefined
      })
    ).toBe(false);

    expect(
      commandSucceeded({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "pnpm test" }),
        output: "Process exited with code 1"
      })
    ).toBe(false);

    expect(
      commandFailed({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "pnpm test" }),
        output: "Process exited with code 1"
      })
    ).toBe(true);
  });

  it("treats in-progress command output as unknown instead of failed", () => {
    const toolCall = {
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "pnpm test" }),
      output: "Process running with session ID 12345"
    };

    expect(commandSucceeded(toolCall)).toBe(false);
    expect(commandFailed(toolCall)).toBe(false);
  });

  it("matches command tool calls consistently", () => {
    expect(
      isCommandToolCall({
        name: "exec_command",
        arguments: "{}"
      })
    ).toBe(true);
    expect(
      isCommandToolCall({
        name: "Bash",
        arguments: "{}"
      })
    ).toBe(true);
    expect(
      isCommandToolCall({
        name: "bash_runner",
        arguments: "{}"
      })
    ).toBe(true);
    expect(
      isCommandToolCall({
        name: "apply_patch_freeform",
        arguments: "{}"
      })
    ).toBe(false);
  });
});
