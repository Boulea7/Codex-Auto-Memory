import { compileStartupMemory } from "../domain/startup-memory.js";
import { listRolloutFiles, parseRolloutEvidence } from "../domain/rollout.js";
import { compileSessionContinuity } from "../domain/session-continuity.js";
import { readCodexBaseInstructions } from "../runtime/codex-config.js";
import { runCommand } from "../util/process.js";
import { buildRuntimeContext } from "./common.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { WrapperRuntimeInjector } from "../runtime/wrapper-injector.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";

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
    [projectLocation.path, localLocation.path].filter(Boolean),
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
  const rolloutPath = candidates.at(-1) ?? null;
  if (!rolloutPath) {
    return null;
  }

  const evidence = await parseRolloutEvidence(rolloutPath);
  if (!evidence) {
    return null;
  }

  const existing = {
    project: await runtime.sessionContinuityStore.readState("project"),
    projectLocal: await runtime.sessionContinuityStore.readState("project-local")
  };
  const summarizer = new SessionContinuitySummarizer(runtime.loadedConfig.config);
  const summary = await summarizer.summarize(evidence, existing);
  const written = await runtime.sessionContinuityStore.saveSummary(summary, "both");
  return written.length > 0
    ? `Updated session continuity from ${rolloutPath}:\n${written.map((filePath) => `- ${filePath}`).join("\n")}`
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

  const synced = await syncRecentRollouts(cwd, before, startedAtMs, endedAtMs);
  const continuity = await saveSessionContinuity(cwd, before, startedAtMs, endedAtMs);
  const messages = [
    ...synced,
    ...(continuity ? [continuity] : [])
  ];
  if (messages.length > 0) {
    process.stderr.write(`\n${messages.join("\n")}\n`);
  }

  return exitCode;
}
