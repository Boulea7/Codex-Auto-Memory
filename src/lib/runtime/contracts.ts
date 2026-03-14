import type { MemoryEntry, MemoryOperation, ProjectContext, RolloutEvidence } from "../types.js";

export interface SessionSource {
  readonly name: string;
  listRelevantRollouts(
    project: ProjectContext,
    before: string[],
    startedAtMs: number,
    endedAtMs: number
  ): Promise<string[]>;
  parseEvidence(rolloutPath: string): Promise<RolloutEvidence | null>;
}

export interface MemoryExtractorAdapter {
  readonly name: string;
  extract(
    evidence: RolloutEvidence,
    existingEntries: MemoryEntry[]
  ): Promise<MemoryOperation[] | null>;
}

export interface RuntimeInjector {
  readonly name: string;
  buildArgs(
    mode: "run" | "exec" | "resume",
    forwardedArgs: string[],
    existingBaseInstructions: string,
    startupMemory: string
  ): Promise<string[]>;
}

