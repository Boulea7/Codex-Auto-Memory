import { compileStartupMemory } from "../domain/startup-memory.js";
import { formatSessionContinuityDiagnostics } from "../domain/session-continuity-diagnostics.js";
import { persistSessionContinuity } from "../domain/session-continuity-persistence.js";
import {
  listRolloutFiles,
  parseRolloutEvidence,
  readRolloutMeta
} from "../domain/rollout.js";
import { compileSessionContinuity } from "../domain/session-continuity.js";
import { readCodexBaseInstructions } from "../runtime/codex-config.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import { runCommand } from "../util/process.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { WrapperRuntimeInjector } from "../runtime/wrapper-injector.js";

const sessionSource = new RolloutSessionSource();
const runtimeInjector = new WrapperRuntimeInjector();

async function selectLatestPrimaryRollout(candidates: string[]): Promise<string | null> {
  const metas = await Promise.all(candidates.map((candidate) => readRolloutMeta(candidate)));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (metas[index]?.isSubagent === true) {
      continue;
    }
    return candidates[index] ?? null;
  }

  return null;
}

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

async function compileStartupPayload(cwd: string): Promise<string> {
  const runtime = await buildRuntimeContext(cwd);
  const durable = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );
  if (!runtime.loadedConfig.config.sessionContinuityAutoLoad) {
    return durable.text;
  }

  const merged = await runtime.sessionContinuityStore.readMergedState();
  if (!merged) {
    return durable.text;
  }

  const projectLocation = await runtime.sessionContinuityStore.getLocation("project");
  const localLocation = await runtime.sessionContinuityStore.getLocation("project-local");
  const continuity = compileSessionContinuity(
    merged,
    [projectLocation, localLocation]
      .filter((location) => location.exists)
      .map((location) => location.path),
    runtime.loadedConfig.config.maxSessionContinuityLines
  );
  return `${continuity.text.trimEnd()}\n\n${durable.text.trimStart()}`;
}

async function saveSessionContinuity(
  cwd: string,
  before: string[],
  startedAtMs: number,
  endedAtMs: number
): Promise<string | null> {
  const runtime = await buildRuntimeContext(cwd);
  if (!runtime.loadedConfig.config.sessionContinuityAutoSave) {
    return null;
  }

  const candidates = await sessionSource.listRelevantRollouts(
    runtime.project,
    before,
    startedAtMs,
    endedAtMs
  );
  const rolloutPath = await selectLatestPrimaryRollout(candidates);
  if (!rolloutPath) {
    return null;
  }

  if (!(await parseRolloutEvidence(rolloutPath))) {
    return null;
  }

  const persisted = await persistSessionContinuity({
    runtime,
    rolloutPath,
    scope: "both",
    trigger: "wrapper-auto-save",
    writeMode: "merge"
  });

  return persisted.written.length > 0
    ? [
        `Updated session continuity from ${rolloutPath}:`,
        formatSessionContinuityDiagnostics(persisted.diagnostics),
        ...persisted.written.map((filePath) => `- ${filePath}`)
      ].join("\n")
    : null;
}

export async function runWrappedCodex(
  cwd: string,
  mode: "run" | "exec" | "resume",
  forwardedArgs: string[]
): Promise<number> {
  const runtime = await buildRuntimeContext(cwd);
  const startup = await compileStartupPayload(cwd);
  const existingBaseInstructions = await readCodexBaseInstructions();
  const before = await listRolloutFiles();
  const startedAtMs = Date.now();

  const args = await runtimeInjector.buildArgs(
    mode,
    forwardedArgs,
    existingBaseInstructions,
    startup
  );

  const exitCode = await runCommand(
    runtime.loadedConfig.config.codexBinary,
    args,
    cwd
  );
  const endedAtMs = Date.now();

  const messages: string[] = [];
  let syncError: unknown = null;
  let continuityError: unknown = null;

  try {
    messages.push(...await syncRecentRollouts(cwd, before, startedAtMs, endedAtMs));
  } catch (error) {
    syncError = error;
  }

  try {
    const continuity = await saveSessionContinuity(cwd, before, startedAtMs, endedAtMs);
    if (continuity) {
      messages.push(continuity);
    }
  } catch (error) {
    continuityError = error;
  }

  if (messages.length > 0) {
    process.stderr.write(`\n${messages.join("\n")}\n`);
  }

  if (syncError && continuityError) {
    throw new AggregateError(
      [syncError, continuityError],
      `Post-run persistence failed: durable sync: ${syncError instanceof Error ? syncError.message : String(syncError)}; continuity: ${continuityError instanceof Error ? continuityError.message : String(continuityError)}`
    );
  }
  if (syncError) {
    throw syncError;
  }
  if (continuityError) {
    throw continuityError;
  }

  return exitCode;
}
