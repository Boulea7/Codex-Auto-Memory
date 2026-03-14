import { buildRuntimeContext } from "./common.js";
import { listRolloutFiles, matchesProjectContext, parseRolloutEvidence } from "../domain/rollout.js";

interface SyncOptions {
  cwd?: string;
  rollout?: string;
  force?: boolean;
}

export async function runSync(options: SyncOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  let rolloutPath = options.rollout;

  if (!rolloutPath) {
    const rollouts = (await listRolloutFiles()).sort().reverse();
    for (const candidate of rollouts) {
      const evidence = await parseRolloutEvidence(candidate);
      if (!evidence) {
        continue;
      }

      if (matchesProjectContext(evidence, runtime.project)) {
        rolloutPath = candidate;
        break;
      }
    }
  }

  if (!rolloutPath) {
    return "No rollout file could be found for the current project.";
  }

  const result = await runtime.syncService.syncRollout(rolloutPath, options.force);
  return result.message;
}

