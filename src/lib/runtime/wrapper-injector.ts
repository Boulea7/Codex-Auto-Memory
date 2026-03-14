import { buildInjectedBaseInstructions } from "./codex-config.js";
import type { RuntimeInjector } from "./contracts.js";

export class WrapperRuntimeInjector implements RuntimeInjector {
  public readonly name = "wrapper-base-instructions";

  public async buildArgs(
    mode: "run" | "exec" | "resume",
    forwardedArgs: string[],
    existingBaseInstructions: string,
    startupMemory: string
  ): Promise<string[]> {
    const injectedBaseInstructions = buildInjectedBaseInstructions(
      existingBaseInstructions,
      startupMemory
    );

    return [
      "-c",
      `base_instructions=${JSON.stringify(injectedBaseInstructions)}`,
      ...(mode === "run" ? [] : [mode]),
      ...forwardedArgs
    ];
  }
}

