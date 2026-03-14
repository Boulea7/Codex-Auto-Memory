import type { ProjectContext, RolloutEvidence } from "../types.js";
import { findRelevantRollouts, parseRolloutEvidence } from "../domain/rollout.js";
import type { SessionSource } from "./contracts.js";

export class RolloutSessionSource implements SessionSource {
  public readonly name = "rollout-jsonl";

  public async listRelevantRollouts(
    project: ProjectContext,
    before: string[],
    startedAtMs: number,
    endedAtMs: number
  ): Promise<string[]> {
    return findRelevantRollouts(project, before, startedAtMs, endedAtMs);
  }

  public async parseEvidence(rolloutPath: string): Promise<RolloutEvidence | null> {
    return parseRolloutEvidence(rolloutPath);
  }
}

