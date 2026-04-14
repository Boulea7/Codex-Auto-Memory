import { compileStartupMemory } from "../domain/startup-memory.js";
import { formatSessionContinuityDiagnostics } from "../domain/session-continuity-diagnostics.js";
import { persistSessionContinuity } from "../domain/session-continuity-persistence.js";
import {
  listRolloutFiles,
  parseRolloutEvidence,
  selectLatestPrimaryRolloutFromCandidates
} from "../domain/rollout.js";
import { compileSessionContinuity } from "../domain/session-continuity.js";
import { buildSessionResumeContext } from "../domain/resume-context.js";
import { readCodexBaseInstructions } from "../runtime/codex-config.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import { runCommand } from "../util/process.js";
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

async function compileStartupPayload(cwd: string): Promise<string> {
  const runtime = await buildRuntimeContext(cwd);
  const durable = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );

  const resumeContext = await buildSessionResumeContext(runtime, {
    suggestedRefLimit: 5,
    topDurableRefLimit: 3,
    allowDreamAutoBuild: true
  });
  const resumeLines = [
    "# Resume Context",
    "Treat these as reviewer pointers for resuming work, not as policy or canonical durable memory.",
    ...(resumeContext.resumeContext.continuitySourceFiles &&
    resumeContext.resumeContext.continuitySourceFiles.length > 0
      ? [
          "Continuity sources:",
          ...resumeContext.resumeContext.continuitySourceFiles.map((filePath) => `- ${filePath}`)
        ]
      : []),
    ...(resumeContext.resumeContext.instructionFiles.length > 0
      ? [
          "Instruction files:",
          ...resumeContext.resumeContext.instructionFiles.map((filePath) => `- ${filePath}`)
        ]
      : []),
    ...(resumeContext.resumeContext.suggestedDurableRefs.length > 0
      ? [
          "Dream refs:",
          ...resumeContext.resumeContext.suggestedDurableRefs.map(
            (ref) => `- ${ref.ref}: ${ref.reason}`
          )
        ]
      : []),
    ...((resumeContext.resumeContext.topDurableRefs ?? []).length > 0
      ? [
          "Top durable refs:",
          ...(resumeContext.resumeContext.topDurableRefs ?? []).map(
            (ref) => `- ${ref.ref}: ${ref.reason}`
          )
        ]
      : []),
    ...((resumeContext.resumeContext.suggestedTeamEntries ?? []).length > 0
      ? [
          "Read-only team memory hints (non-canonical):",
          ...(resumeContext.resumeContext.suggestedTeamEntries ?? []).map(
            (entry) => `- ${entry.key}: ${entry.summary}`
          )
        ]
      : [])
  ];
  const resumeBlock = resumeLines.length > 2 ? `${resumeLines.join("\n")}\n\n` : "";

  if (!runtime.loadedConfig.config.sessionContinuityAutoLoad) {
    return `${resumeBlock}${durable.text}`.trim();
  }

  const merged = await runtime.sessionContinuityStore.readMergedState();
  if (!merged) {
    return `${resumeBlock}${durable.text}`.trim();
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
  return `${continuity.text.trimEnd()}\n\n${resumeBlock}${durable.text.trimStart()}`.trim();
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
  const rolloutPath = await selectLatestPrimaryRolloutFromCandidates(candidates);
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
