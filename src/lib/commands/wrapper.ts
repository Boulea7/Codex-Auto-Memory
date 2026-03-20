import { compileStartupMemory } from "../domain/startup-memory.js";
import {
  buildSessionContinuityAuditEntry,
  formatSessionContinuityDiagnostics
} from "../domain/session-continuity-diagnostics.js";
import {
  buildContinuityRecoveryRecord,
  matchesContinuityRecoveryRecord
} from "../domain/recovery-records.js";
import { listRolloutFiles, parseRolloutEvidence, readRolloutMeta } from "../domain/rollout.js";
import { compileSessionContinuity } from "../domain/session-continuity.js";
import { readCodexBaseInstructions } from "../runtime/codex-config.js";
import { runCommand } from "../util/process.js";
import { buildRuntimeContext } from "./common.js";
import { RolloutSessionSource } from "../runtime/rollout-session-source.js";
import { WrapperRuntimeInjector } from "../runtime/wrapper-injector.js";
import { SessionContinuitySummarizer } from "../extractor/session-continuity-summarizer.js";

const sessionSource = new RolloutSessionSource();
const runtimeInjector = new WrapperRuntimeInjector();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  const rolloutPath = await selectLatestPrimaryRollout(candidates);
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
  const generation = await summarizer.summarizeWithDiagnostics(evidence, existing);
  const written = await runtime.sessionContinuityStore.saveSummary(generation.summary, "both");
  const auditEntry = buildSessionContinuityAuditEntry(
    runtime.project,
    runtime.loadedConfig.config,
    generation.diagnostics,
    written,
    "both",
    {
      trigger: "wrapper-auto-save",
      writeMode: "merge"
    }
  );
  try {
    await runtime.sessionContinuityStore.appendAuditLog(auditEntry);
  } catch (error) {
    try {
      await runtime.sessionContinuityStore.writeRecoveryRecord(
        buildContinuityRecoveryRecord({
          projectId: runtime.project.projectId,
          worktreeId: runtime.project.worktreeId,
          diagnostics: generation.diagnostics,
          trigger: "wrapper-auto-save",
          writeMode: "merge",
          scope: "both",
          writtenPaths: written,
          failedStage: "audit-write",
          failureMessage: errorMessage(error)
        })
      );
    } catch {
      // Best-effort marker persistence should not overwrite the original failure.
    }
    throw error;
  }
  try {
    const record = await runtime.sessionContinuityStore.readRecoveryRecord();
    if (
      record &&
      matchesContinuityRecoveryRecord(record, {
        projectId: runtime.project.projectId,
        worktreeId: runtime.project.worktreeId,
        rolloutPath: generation.diagnostics.rolloutPath,
        sourceSessionId: generation.diagnostics.sourceSessionId,
        scope: "both"
      })
    ) {
      await runtime.sessionContinuityStore.clearRecoveryRecord();
    }
  } catch {
    // Best-effort cleanup should not fail an otherwise successful auto-save.
  }
  return written.length > 0
    ? [
        `Updated session continuity from ${rolloutPath}:`,
        formatSessionContinuityDiagnostics(generation.diagnostics),
        ...written.map((filePath) => `- ${filePath}`)
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
      `Post-run persistence failed: durable sync: ${errorMessage(syncError)}; continuity: ${errorMessage(continuityError)}`
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
