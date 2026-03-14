import { compileStartupMemory } from "../domain/startup-memory.js";
import { listRolloutFiles } from "../domain/rollout.js";
import { readCodexBaseInstructions } from "../runtime/codex-config.js";
import { runCommand } from "../util/process.js";
import { buildRuntimeContext } from "./common.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { WrapperRuntimeInjector } from "../runtime/wrapper-injector.js";

const sessionSource = new RolloutSessionSource();
const runtimeInjector = new WrapperRuntimeInjector();

async function syncRecentRollouts(
  cwd: string,
  before: string[],
  startedAtMs: number,
  endedAtMs: number
): Promise<string[]> {
  const runtime = await buildRuntimeContext(cwd);
  if (!runtime.loadedConfig.config.autoMemoryEnabled) {
    return [];
  }

  const candidates = await sessionSource.listRelevantRollouts(
    runtime.project,
    before,
    startedAtMs,
    endedAtMs
  );
  const synced: string[] = [];
  for (const candidate of candidates) {
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
  const before = await listRolloutFiles();
  const startedAtMs = Date.now();

  const args = await runtimeInjector.buildArgs(
    mode,
    forwardedArgs,
    existingBaseInstructions,
    startup.text
  );

  const exitCode = await runCommand(
    runtime.loadedConfig.config.codexBinary,
    args,
    cwd
  );
  const endedAtMs = Date.now();

  const synced = await syncRecentRollouts(cwd, before, startedAtMs, endedAtMs);
  if (synced.length > 0) {
    process.stderr.write(`\n${synced.join("\n")}\n`);
  }

  return exitCode;
}
