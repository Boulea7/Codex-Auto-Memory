import { compileStartupMemory } from "./startup-memory.js";
import { createEmptySessionContinuityState } from "./session-continuity.js";
import { discoverInstructionFiles } from "./instruction-memory.js";
import { filterDreamRelevantRefs, inspectDreamSidecar } from "./dream-sidecar.js";
import { buildMemoryRef } from "./memory-lifecycle.js";
import type {
  DreamRelevantMemoryRef,
  MemorySearchResponse,
  SessionContinuityState,
  SessionResumeContext
} from "../types.js";
import type { RuntimeContext } from "../runtime/runtime-context.js";

interface BuildSessionResumeContextOptions {
  mergedState?: SessionContinuityState | null;
  suggestedRefLimit?: number;
  continuitySourceFiles?: string[];
  topDurableRefLimit?: number;
}

interface SessionResumeContextBuildResult {
  resumeContext: SessionResumeContext;
  dreamInspection: Awaited<ReturnType<typeof inspectDreamSidecar>>;
  mergedDreamRelevantRefs: DreamRelevantMemoryRef[];
  topDurableRefs: DreamRelevantMemoryRef[];
}

function mergeDreamRelevantRefs(
  ...refGroups: Array<DreamRelevantMemoryRef[] | null | undefined>
): DreamRelevantMemoryRef[] {
  const seenRefs = new Set<string>();
  const merged: DreamRelevantMemoryRef[] = [];

  for (const refs of refGroups) {
    for (const ref of refs ?? []) {
      if (seenRefs.has(ref.ref)) {
        continue;
      }

      seenRefs.add(ref.ref);
      merged.push(ref);
    }
  }

  return merged;
}

async function buildTopDurableRefs(
  runtime: RuntimeContext,
  limit: number
): Promise<DreamRelevantMemoryRef[]> {
  const startup = await compileStartupMemory(
    runtime.syncService.memoryStore,
    runtime.loadedConfig.config.maxStartupLines
  );

  return startup.highlights.slice(0, limit).map((highlight) => ({
    ref: buildMemoryRef(highlight.scope, "active", highlight.topic, highlight.id),
    reason: `Startup highlight from ${highlight.scope}/${highlight.topic}.`,
    approxReadCost: 1,
    matchedQuery: "startup-highlight"
  }));
}

export async function buildSessionResumeContext(
  runtime: RuntimeContext,
  options: BuildSessionResumeContextOptions = {}
): Promise<SessionResumeContextBuildResult> {
  const dreamInspection = await inspectDreamSidecar(runtime);
  const instructionFiles = await discoverInstructionFiles(runtime.project.projectRoot);
  const mergedState =
    options.mergedState ??
    (await runtime.sessionContinuityStore.readMergedState()) ??
    createEmptySessionContinuityState(
      "project-local",
      runtime.project.projectId,
      runtime.project.worktreeId
    );
  const mergedDreamRelevantRefs = mergeDreamRelevantRefs(
    dreamInspection.projectLocalSnapshot?.relevantMemoryRefs,
    dreamInspection.projectSnapshot?.relevantMemoryRefs
  );
  const suggestedDurableRefs =
    options.suggestedRefLimit === undefined
      ? mergedDreamRelevantRefs
      : mergedDreamRelevantRefs.slice(0, options.suggestedRefLimit);
  const topDurableRefs = await buildTopDurableRefs(
    runtime,
    options.topDurableRefLimit ?? 3
  );

  return {
    dreamInspection,
    mergedDreamRelevantRefs,
    topDurableRefs,
    resumeContext: {
      goal: mergedState.goal,
      nextSteps: [...mergedState.incompleteNext],
      instructionFiles,
      suggestedDurableRefs,
      topDurableRefs,
      continuitySourceFiles: options.continuitySourceFiles
    }
  };
}

export async function buildMemoryQuerySurfacing(
  runtime: RuntimeContext,
  query: string
): Promise<NonNullable<MemorySearchResponse["querySurfacing"]>> {
  const { resumeContext, mergedDreamRelevantRefs } = await buildSessionResumeContext(runtime);

  return {
    suggestedDreamRefs: filterDreamRelevantRefs(mergedDreamRelevantRefs, query),
    suggestedInstructionFiles: resumeContext.instructionFiles,
    topDurableRefs: resumeContext.topDurableRefs
  };
}
