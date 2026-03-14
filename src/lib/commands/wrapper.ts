import { compileStartupMemory } from "../domain/startup-memory.js";
import { findNewRollouts, listRolloutFiles, matchesProjectContext, parseRolloutEvidence } from "../domain/rollout.js";
import { readCodexBaseInstructions, buildInjectedBaseInstructions } from "../runtime/codex-config.js";
import { runCommand } from "../util/process.js";
import { buildRuntimeContext } from "./common.js";

async function syncRecentRollouts(
  cwd: string,
  before: string[],
  startedAtMs: number
): Promise<string[]> {
  const runtime = await buildRuntimeContext(cwd);
  if (!runtime.loadedConfig.config.autoMemoryEnabled) {
    return [];
  }

  const candidates = await findNewRollouts(before, startedAtMs);
  const synced: string[] = [];
  for (const candidate of candidates) {
    const evidence = await parseRolloutEvidence(candidate);
    if (!evidence || !matchesProjectContext(evidence, runtime.project)) {
      continue;
    }

    const result = await runtime.syncService.syncRollout(candidate);
    if (!result.skipped) {
      synced.push(result.message);
    }
  }

  return synced;
}

export async function runWrappedCodex(
  cwd: string,
  mode: "run" | "exec" | "resume",
  forwardedArgs: string[]
): Promise<number> {
  const runtime = await buildRuntimeContext(cwd);
  const startup = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );
  const existingBaseInstructions = await readCodexBaseInstructions();
  const injectedBaseInstructions = buildInjectedBaseInstructions(
    existingBaseInstructions,
    startup.text
  );
  const before = await listRolloutFiles();
  const startedAtMs = Date.now();

  const args = [
    "-c",
    `base_instructions=${JSON.stringify(injectedBaseInstructions)}`,
    ...(mode === "run" ? [] : [mode]),
    ...forwardedArgs
  ];

  const exitCode = await runCommand(
    runtime.loadedConfig.config.codexBinary,
    args,
    cwd
  );

  const synced = await syncRecentRollouts(cwd, before, startedAtMs);
  if (synced.length > 0) {
    process.stderr.write(`\n${synced.join("\n")}\n`);
  }

  return exitCode;
}

