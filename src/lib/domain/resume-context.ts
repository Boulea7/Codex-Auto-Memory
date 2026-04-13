import { compileStartupMemory } from "./startup-memory.js";
import { createEmptySessionContinuityState } from "./session-continuity.js";
import { discoverInstructionFiles } from "./instruction-memory.js";
import { filterDreamRelevantRefs, ensureDreamSidecarFresh } from "./dream-sidecar.js";
import { buildMemoryRef } from "./memory-lifecycle.js";
import { searchTeamMemory } from "./team-memory.js";
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
  dreamInspection: Awaited<ReturnType<typeof ensureDreamSidecarFresh>>;
  mergedDreamRelevantRefs: DreamRelevantMemoryRef[];
  topDurableRefs: DreamRelevantMemoryRef[];
}

async function buildSuggestedTeamEntries(
  runtime: RuntimeContext,
  queries: string[],
  limit: number
): Promise<SessionResumeContext["suggestedTeamEntries"]> {
  for (const query of queries) {
    if (!query.trim()) {
      continue;
    }

    const matches = await searchTeamMemory(
      runtime.project,
      runtime.loadedConfig.config,
      query,
      limit,
      { autoBuild: runtime.loadedConfig.config.dreamSidecarAutoBuild === true }
    );
    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
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
  const dreamInspection = await ensureDreamSidecarFresh(runtime);
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
  const suggestedTeamEntries = await buildSuggestedTeamEntries(
    runtime,
    [
      mergedState.goal,
      ...mergedDreamRelevantRefs.map((ref) => ref.matchedQuery),
      ...topDurableRefs.map((ref) => ref.reason)
    ],
    3
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
      suggestedTeamEntries,
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
    topDurableRefs: resumeContext.topDurableRefs,
    suggestedTeamEntries: await buildSuggestedTeamEntries(runtime, [query], 3)
  };
}
